import type { MonitoringSettings } from "@/lib/monitoring-settings";
import type { RawItem } from "@/lib/collectors";
import type { Engagement } from "@/lib/types";
import { isXOfficialEnabled } from "@/lib/x-official";
import {
  listPendingApifyRuns,
  markApifyRunCollected,
  recordApifyRun,
} from "@/lib/apify-runs";

// Apify pay-per-result social collector. X (Twitter) keyword search is the
// backbone; Facebook open keyword search is best-effort (FB has no usable
// official API since CrowdTangle shut down, so we lean on a community actor).
//
// Cost control lives in three places: a hard per-run item cap (SOCIAL_MAX_ITEMS),
// per-actor maxItems passed into Apify (you are billed per result returned), and
// a spend ceiling you set in the Apify console ($5/mo recommended). Daily-only —
// this runs once per digest, never on the dashboard/preview paths.
//
// The whole thing is behind SOCIAL_ENABLED (default OFF) so it stays dark until
// APIFY_TOKEN is set and the console ceiling is in place.

const APIFY_BASE = "https://api.apify.com/v2";

// Actor IDs are env-overridable so a better actor can be swapped in without a
// code change (Apify actors come and go, especially for Facebook).
const X_ACTOR = process.env.APIFY_X_ACTOR || "apidojo/tweet-scraper";
// Page-watchlist scraper (posts FROM listed pages). The old
// facebook-search-scraper was removed: it matched Pages by name, not posts,
// so it never provided mention monitoring.
const FB_ACTOR = process.env.APIFY_FB_ACTOR || "apify/facebook-posts-scraper";

// Facebook page watchlist — public pages where I-66 corridor coverage and
// commuter reaction actually appear. Scraped only when FB_WATCHLIST="true"
// (requires a paid Apify plan; ~$2 per 1,000 posts). Override the list with
// FB_PAGES (comma-separated page URLs).
const DEFAULT_FB_PAGES = [
  // DC-market media
  "https://www.facebook.com/wtopnews",
  "https://www.facebook.com/NBCWashington",
  "https://www.facebook.com/fox5dc",
  "https://www.facebook.com/7NewsDC",
  "https://www.facebook.com/wusa9",
  "https://www.facebook.com/DCNewsNow",
  "https://www.facebook.com/PotomacLocal",
  "https://www.facebook.com/InsideNoVa",
  // Client + agencies + public safety
  "https://www.facebook.com/Ride66Express",
  "https://www.facebook.com/VaDOT",
  "https://www.facebook.com/VDOTNOVA",
  "https://www.facebook.com/fairfaxcounty",
  "https://www.facebook.com/PWCgov",
  "https://www.facebook.com/VirginiaStatePolice",
  "https://www.facebook.com/FairfaxCountyPD",
  // Proven producers — every one of these generated a mention that made the
  // 08-07-2026 client report, so they earn their place over guesswork.
  "https://www.facebook.com/jtechusa",
  "https://www.facebook.com/towtimesmagazine",
  "https://www.facebook.com/PrinceWilliamLiving",
  "https://www.facebook.com/TrafficProBeds",
  "https://www.facebook.com/PWCCFoundation",
  "https://www.facebook.com/pinkspacetheory1",
  "https://www.facebook.com/slugi66",
  "https://www.facebook.com/SullyDistrict",
];

// Public Facebook GROUPS to watch, from FB_GROUPS (comma-separated URLs).
// Dark until that variable is set — no group URLs, no actor call, no spend.
//
// Same structural limit as pages: there is no keyword search, so a group is
// only visible if it is named here. Private groups (most local commuter groups)
// are invisible to a cookie-free scraper and cannot be added.
const FB_GROUPS_ACTOR =
  process.env.APIFY_FB_GROUPS_ACTOR || "apify/facebook-groups-scraper";
// LinkedIn has no open keyword search, so we run in "company-page mode": scrape
// the recent posts of specific pages (LINKEDIN_PAGES) with a cookie-free
// company-posts actor. No login, ToS-friendly — but only the pages' own posts,
// not public mentions of "66".
const LINKEDIN_ACTOR =
  process.env.APIFY_LINKEDIN_ACTOR || "apimaestro/linkedin-company-posts";

// Per-run caps. X is the backbone so it gets the larger share; the combined
// result is sliced to TOTAL_CAP afterward. Lower these to spend less.
//
// TOTAL_CAP must stay comfortably ABOVE the sum of the per-actor caps. Apify
// bills per result returned, so anything the actors fetch and this cap then
// discards is money spent on data we never look at.
const X_MAX_ITEMS = 35;
// 23 pages x FB_POSTS_PER_PAGE, with headroom. The busy DC stations post many
// times a day; at the old 3-per-page/20-total the corridor posts were usually
// pushed out by weather and sports before we ever saw them.
const FB_MAX_ITEMS = 150;
const FB_POSTS_PER_PAGE = 10;
const FB_POSTS_PER_GROUP = 15;
const FB_GROUPS_MAX_ITEMS = 60;
const LINKEDIN_MAX_PER_PAGE = 5;
const TOTAL_CAP = 200;

// Broad, recall-oriented X searches run alongside the exact brand phrases. These
// catch how people actually tweet about the corridor ("the I-66 toll was $40");
// the shared relevance classifier then drops the off-topic hits (Route 66, etc.).
const X_BROAD_QUERIES = [
  '"66 Express Lanes" OR "I-66 Express" OR "66 Express"',
  '"I-66" (toll OR tolls OR lanes OR express OR traffic OR crash OR closure OR commute)',
  '"Interstate 66" (toll OR lanes OR Virginia OR traffic)',
];

// run-sync-get-dataset-items blocks until the actor finishes. Keep it well under
// the route's maxDuration (60s) so a slow scrape degrades to "no social this
// run" instead of timing out the whole digest. The actor's own run is also
// killed server-side at this bound via the `timeout` query param.
//
// Only the small, fast actors (X, LinkedIn pages) still run this way. Facebook
// does NOT — see startActor below.
const ACTOR_TIMEOUT_MS = 40_000;

// How long we'll wait on the *start* call for a deferred run. Apify returns the
// run id immediately, so this only guards a hung connection.
const ACTOR_START_TIMEOUT_MS = 15_000;

// Server-side ceiling for a deferred run. Nothing is waiting on the request
// side any more, so this can be generous — it exists to stop a wedged actor
// from billing forever, not to fit inside a request.
const ACTOR_RUN_TIMEOUT_SECONDS = 300;

// Apify run states that will never change again. A run in any of these is safe
// to drain — including the failure states, because a TIMED-OUT or ABORTED run
// still leaves behind every result it produced before it stopped, and we were
// billed for those.
const TERMINAL_RUN_STATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

// Give up waiting on a run this old and drain whatever its dataset holds. Guards
// against a run whose status we can never read (deleted, token rotated) pinning
// a row as pending forever.
const PENDING_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Provider labels. These are stored on the run row and pick the mapper when the
// dataset is drained later, so changing one is a data migration — not a rename.
const FB_PAGES_PROVIDER = "Facebook (Apify)";
const FB_GROUPS_PROVIDER = "Facebook groups (Apify)";

function isEnabled(): boolean {
  return (
    process.env.SOCIAL_ENABLED === "true" && Boolean(process.env.APIFY_TOKEN)
  );
}

/**
 * Start an actor WITHOUT waiting for it, and remember the run so a later
 * request can collect the results.
 *
 * This is the fix for the Facebook watchlist: `run-sync-get-dataset-items`
 * returns data only for a run that SUCCEEDED, and a 23-page scrape cannot
 * finish inside a serverless request. Bounding it with `?timeout=40` meant
 * Apify killed the run every single time, the sync call errored, and ~200
 * already-billed posts a day were thrown away. Starting the run instead
 * decouples the scrape from the request entirely.
 */
async function startActor(
  actorId: string,
  input: Record<string, unknown>,
  token: string,
  maxItems: number,
  provider: string,
): Promise<void> {
  const url = new URL(
    `${APIFY_BASE}/acts/${actorId.replace("/", "~")}/runs`,
  );
  url.searchParams.set("token", token);
  url.searchParams.set("maxItems", String(maxItems));
  url.searchParams.set("timeout", String(ACTOR_RUN_TIMEOUT_SECONDS));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTOR_START_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Apify ${actorId} start responded ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: { id?: string; defaultDatasetId?: string };
    };
    const runId = body.data?.id;
    const datasetId = body.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      throw new Error(`Apify ${actorId} start returned no run id`);
    }

    await recordApifyRun({ runId, actor: actorId, provider, datasetId });
    console.log(`[social] started ${provider} run ${runId} (deferred).`);
  } finally {
    clearTimeout(timer);
  }
}

/** Current status of a run, e.g. RUNNING / SUCCEEDED / TIMED-OUT. */
async function getRunState(runId: string, token: string): Promise<string> {
  const url = new URL(`${APIFY_BASE}/actor-runs/${runId}`);
  url.searchParams.set("token", token);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Apify run ${runId} status responded ${response.status}`);
  }
  const body = (await response.json()) as { data?: { status?: string } };
  return body.data?.status ?? "UNKNOWN";
}

/** Everything a finished run left in its dataset. */
async function fetchDatasetItems(
  datasetId: string,
  token: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`${APIFY_BASE}/datasets/${datasetId}/items`);
  url.searchParams.set("token", token);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("clean", "true");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Apify dataset ${datasetId} responded ${response.status}`);
  }
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/** Which RawItem mapper a stored run's results should go through. */
function mapperFor(
  provider: string,
): ((post: Record<string, unknown>) => RawItem) | null {
  switch (provider) {
    case FB_PAGES_PROVIDER:
      return mapFacebookPagePost;
    case FB_GROUPS_PROVIDER:
      return mapFacebookGroupPost;
    default:
      return null;
  }
}

/**
 * Collect the results of actor runs an earlier request started.
 *
 * Runs on EVERY collection, poller included — unlike starting an actor, this
 * costs nothing. The results were billed when Apify produced them, so reading
 * a finished dataset is free and the only question is whether we bother to.
 *
 * Best-effort per run: one unreadable run is logged and skipped rather than
 * failing the drain for the others.
 */
export async function drainPendingApifyRuns(): Promise<RawItem[]> {
  if (!isEnabled()) {
    return [];
  }

  const token = process.env.APIFY_TOKEN as string;
  const pending = await listPendingApifyRuns();
  if (pending.length === 0) {
    return [];
  }

  const items: RawItem[] = [];
  for (const run of pending) {
    const age = Date.now() - Date.parse(run.startedAt);
    const expired = Number.isFinite(age) && age > PENDING_RUN_MAX_AGE_MS;
    try {
      let state = "EXPIRED";
      if (!expired) {
        state = await getRunState(run.runId, token);
        if (!TERMINAL_RUN_STATES.has(state)) {
          // Still working. Leave it pending and try again next poll.
          continue;
        }
      }

      const map = mapperFor(run.provider);
      const raw = map
        ? await fetchDatasetItems(run.datasetId, token, TOTAL_CAP)
        : [];
      const mapped = map ? raw.map(map).filter((item) => item.url) : [];
      items.push(...mapped);

      await markApifyRunCollected(run.runId, state, mapped.length);
      console.log(
        `[social] drained ${run.provider} run ${run.runId} (${state}): ` +
          `${raw.length} raw -> ${mapped.length} items.`,
      );
    } catch (error) {
      // Leave the row pending: a transient Apify error should not cost us a
      // dataset we already paid for. The age guard above is the backstop.
      console.warn(`[social] drain failed for run ${run.runId}:`, error);
    }
  }

  items.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
  return dedupeByUrl(items).slice(0, TOTAL_CAP);
}

/**
 * Collect recent X + Facebook posts matching the monitoring keywords. Returns
 * social-typed RawItems for the shared pipeline (dedup / time-window / classify
 * / "Reddit and Public Social" digest section).
 *
 * Silent no-op (returns []) when disabled or unconfigured — that is the default
 * state and must not flag the provider as degraded. Throws only when ENABLED
 * and every actor failed, mirroring collectFeedItems so a real outage surfaces
 * in degradedProviders.
 */
export async function collectSocialItems(
  settings: MonitoringSettings,
  now: Date = new Date(),
): Promise<RawItem[]> {
  if (!isEnabled()) {
    return [];
  }

  const token = process.env.APIFY_TOKEN as string;
  const keywords = settings.positiveKeywords.filter(Boolean);
  if (keywords.length === 0) {
    return [];
  }

  const tasks: Array<{ name: string; run: () => Promise<RawItem[]> }> = [];

  // The Apify tweet-scraper is the fallback X source; when the official X API
  // token is configured (x-official.ts, run as its own provider), skip the
  // scraper so we don't pay twice for the same tweets.
  if (!isXOfficialEnabled()) {
    tasks.push({ name: "X", run: () => collectX(keywords, token) });
  }

  // Facebook page watchlist: posts FROM the curated public pages, filtered by
  // the shared classifier. Explicitly opt-in (paid Apify plan required).
  //
  // These two only START their actors — the scrape is far too slow to wait on,
  // so they contribute nothing to THIS run and their results arrive via
  // drainPendingApifyRuns() on a later poll. Returning [] keeps them ordinary
  // tasks, so a failure to even start still counts toward "all actors failed".
  if (process.env.FB_WATCHLIST === "true") {
    tasks.push({
      name: "Facebook",
      run: async () => {
        await startFacebookPages(token);
        return [];
      },
    });
  }

  // Public Facebook groups, only when FB_GROUPS names some. Same reasoning as
  // LinkedIn below: never call a billed actor with nothing to scrape.
  const groups = facebookGroups();
  if (groups.length > 0) {
    tasks.push({
      name: "Facebook groups",
      run: async () => {
        await startFacebookGroups(groups, token);
        return [];
      },
    });
  }

  // LinkedIn only runs when pages are configured — no point calling the actor
  // (and being billed) with nothing to scrape.
  const pages = linkedinPages();
  if (pages.length > 0) {
    tasks.push({ name: "LinkedIn", run: () => collectLinkedIn(pages, token) });
  }

  if (tasks.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));

  if (settled.every((r) => r.status === "rejected")) {
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[social] ${tasks[i].name} failed:`, r.reason);
      }
    });
    throw new Error("All social actors failed");
  }

  const items: RawItem[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...r.value);
    } else {
      // One channel down (commonly the best-effort FB actor) is tolerated.
      console.warn(`[social] ${tasks[i].name} skipped:`, r.reason);
    }
  });

  // Recency-first, then cap. The actor caps bound spend; this bounds the digest.
  items.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
  return dedupeByUrl(items).slice(0, TOTAL_CAP);
}

async function collectX(keywords: string[], token: string): Promise<RawItem[]> {
  // The exact brand phrases ("66 EMP", "66 Outside the Beltway") almost never
  // appear verbatim in tweets, so searching only those returns noResults. Mirror
  // the news collector: pair the precise phrases with broad, recall-oriented
  // corridor queries and let the shared classifier filter for relevance.
  const searchTerms = [...keywords.map((k) => `"${k.replace(/"/g, "")}"`), ...X_BROAD_QUERIES];

  // apidojo/tweet-scraper takes an array of search terms and returns the latest
  // matching tweets, billed per result. We ask for English, sorted newest.
  const input = {
    searchTerms,
    sort: "Latest",
    maxItems: X_MAX_ITEMS,
    tweetLanguage: "en",
  };

  const raw = await runActor(X_ACTOR, input, token, X_MAX_ITEMS);
  return raw.map((post) => {
    const text = str(post.text ?? post.fullText ?? post.full_text ?? "");
    const handle = str(
      pick(post, ["author.userName", "author.username", "username", "screen_name"]),
    );
    const url = str(
      post.url ?? post.twitterUrl ?? pick(post, ["author.url"]) ?? "",
    );
    return {
      title: text ? truncate(text, 120) : handle ? `@${handle} on X` : "X post",
      source: handle ? `@${handle}` : "X",
      url,
      sourceType: "social" as const,
      snippet: text,
      publishedAt: toIso(
        post.createdAt ?? post.created_at ?? post.timestamp ?? post.date,
      ),
      provider: "X (Apify)",
      domain: "x.com",
      engagement: engagementFrom(post),
    };
  }).filter((item) => item.url);
}

/** Comma-separated public group URLs from FB_GROUPS. Empty = feature off. */
function facebookGroups(): string[] {
  return (process.env.FB_GROUPS || "")
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);
}

/**
 * Recent posts from public Facebook groups. Corridor relevance is decided
 * downstream by the shared classifier, so a general commuter group is fine.
 *
 * Best-effort like the page watchlist: group scrapers are the most fragile
 * actors on Apify (group layouts change, and a group flipped to private simply
 * stops returning). A failure here is tolerated rather than failing the run.
 */
async function startFacebookGroups(
  groups: string[],
  token: string,
): Promise<void> {
  await startActor(
    FB_GROUPS_ACTOR,
    {
      startUrls: groups.map((url) => ({ url })),
      resultsLimit: FB_POSTS_PER_GROUP,
    },
    token,
    FB_GROUPS_MAX_ITEMS,
    FB_GROUPS_PROVIDER,
  );
}

function mapFacebookGroupPost(post: Record<string, unknown>): RawItem {
  const text = str(
    pick(post, [
      "text", "message", "content", "postText", "caption", "description",
    ]),
  );
  const group = str(
    pick(post, ["groupTitle", "groupName", "group.name", "facebookGroup"]),
  );
  const author = str(
    pick(post, ["user.name", "author.name", "authorName", "from.name"]),
  );
  const url = str(
    pick(post, ["url", "postUrl", "link", "facebookUrl", "permalink"]),
  );
  return {
    title: text ? truncate(text, 120) : `Post in ${group || "a Facebook group"}`,
    // Attribute to the group, not the individual — the group is the
    // "outlet" for reporting, and it avoids naming private people.
    source: group || "Facebook group",
    url,
    sourceType: "social" as const,
    snippet: author ? `${author}: ${text}` : text,
    publishedAt: toIso(
      pick(post, ["time", "date", "publishedTime", "timestamp", "createdAt"]),
    ),
    provider: FB_GROUPS_PROVIDER,
    domain: "facebook.com",
    engagement: engagementFrom(post),
  };
}

// Comma-separated FB page URLs, falling back to the curated default watchlist.
function facebookPages(): string[] {
  const fromEnv = (process.env.FB_PAGES || "")
    .split(",")
    .map((page) => page.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_FB_PAGES;
}

async function startFacebookPages(token: string): Promise<void> {
  // apify/facebook-posts-scraper: recent posts FROM each watchlist page
  // (startUrls), capped per page. Corridor relevance is decided downstream by
  // the shared classifier, so pages can post about anything.
  //
  // Deferred: 23 pages x 10 posts takes minutes, not seconds. drainPending-
  // ApifyRuns() picks the results up on a later poll.
  const input = {
    startUrls: facebookPages().map((url) => ({ url })),
    resultsLimit: FB_POSTS_PER_PAGE,
  };

  await startActor(FB_ACTOR, input, token, FB_MAX_ITEMS, FB_PAGES_PROVIDER);
}

// Output shape varies across actor versions — read fields defensively.
function mapFacebookPagePost(post: Record<string, unknown>): RawItem {
  const text = str(
    pick(post, [
      "text", "message", "content", "postText", "caption",
      "info", "intro", "description", "about",
    ]),
  );
  const author = str(
    pick(post, [
      "pageName", "name", "title", "user.name", "author.name",
      "authorName", "from.name",
    ]),
  );
  const url = str(
    pick(post, [
      "url", "postUrl", "link", "facebookUrl", "permalink", "pageUrl",
    ]),
  );
  return {
    title: text
      ? truncate(text, 120)
      : author
        ? `${author} on Facebook`
        : "Facebook post",
    source: author || "Facebook",
    url,
    sourceType: "social" as const,
    snippet: text,
    publishedAt: toIso(
      pick(post, ["time", "date", "publishedTime", "timestamp", "createdAt"]),
    ),
    provider: FB_PAGES_PROVIDER,
    domain: "facebook.com",
    engagement: engagementFrom(post),
  };
}

// Company pages to monitor, from LINKEDIN_PAGES (comma-separated). Accepts bare
// slugs ("66-express") or full URLs — the actor mapper normalizes either.
function linkedinPages(): string[] {
  return (process.env.LINKEDIN_PAGES || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

async function collectLinkedIn(
  pages: string[],
  token: string,
): Promise<RawItem[]> {
  // One actor call per page (the list is small). Best-effort: a page that fails
  // or returns junk is skipped, and the defensive mapper tolerates schema drift
  // the same way the Facebook path does.
  const settled = await Promise.allSettled(
    pages.map((page) => collectLinkedInPage(page, token)),
  );
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

async function collectLinkedInPage(
  page: string,
  token: string,
): Promise<RawItem[]> {
  const identifier = linkedinSlug(page);
  // Different company-posts actors name the company input differently; send the
  // common keys so a swapped-in actor still works without a code change.
  const input = {
    username: identifier,
    company_name: identifier,
    identifier,
    companyUrl: page.startsWith("http")
      ? page
      : `https://www.linkedin.com/company/${identifier}`,
    limit: LINKEDIN_MAX_PER_PAGE,
    maxItems: LINKEDIN_MAX_PER_PAGE,
    page_number: 1,
  };

  const raw = await runActor(LINKEDIN_ACTOR, input, token, LINKEDIN_MAX_PER_PAGE);
  return raw
    .map((post) => {
      const text = str(
        pick(post, ["text", "content", "commentary", "postText", "description"]),
      );
      const author = str(
        pick(post, ["companyName", "company.name", "authorName", "author.name"]),
      ) || identifier;
      const url = str(
        pick(post, ["url", "postUrl", "linkedinUrl", "shareUrl", "link"]),
      );
      return {
        title: text
          ? truncate(text, 120)
          : `${author} on LinkedIn`,
        source: author,
        url,
        sourceType: "social" as const,
        snippet: text,
        publishedAt: toIso(
          pick(post, ["postedAtISO", "postedAt", "date", "time", "publishedAt"]),
        ),
        provider: "LinkedIn (Apify)",
        domain: "linkedin.com",
        engagement: engagementFrom(post),
      };
    })
    .filter((item) => item.url);
}

// Reduce a page URL or slug to its company identifier for the actor input.
function linkedinSlug(page: string): string {
  const match = page.match(/linkedin\.com\/(?:company|school)\/([^/?#]+)/i);
  return (match ? match[1] : page).trim();
}

/**
 * Run an Apify actor synchronously and return its dataset items. Uses
 * run-sync-get-dataset-items so one HTTP call both runs the actor and returns
 * results — no polling. Bounded by an AbortController (client) and the `timeout`
 * query param (server) so a hung scrape can't exceed the route budget.
 */
async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  token: string,
  maxItems: number,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(
    `${APIFY_BASE}/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items`,
  );
  url.searchParams.set("token", token);
  url.searchParams.set("maxItems", String(maxItems));
  url.searchParams.set("timeout", String(Math.ceil(ACTOR_TIMEOUT_MS / 1000)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTOR_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Apify ${actorId} responded ${response.status}`);
    }
    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } finally {
    clearTimeout(timer);
  }
}

// Read a possibly-nested field by dotted path, returning the first non-empty
// match. Lets the FB/X mappers tolerate the schema drift between actor versions.
function pick(obj: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    let cursor: unknown = obj;
    for (const key of path.split(".")) {
      if (cursor && typeof cursor === "object" && key in cursor) {
        cursor = (cursor as Record<string, unknown>)[key];
      } else {
        cursor = undefined;
        break;
      }
    }
    if (cursor !== undefined && cursor !== null && cursor !== "") {
      return cursor;
    }
  }
  return undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

/**
 * A count from an actor payload, or undefined when the actor didn't report one.
 * Never coerces a missing field to 0 — "no data" and "nobody engaged" mean
 * different things when ranking social echo. Actors sometimes return counts as
 * formatted strings ("1,234"), so digits are extracted rather than parsed.
 */
function count(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  const digits = str(value).replace(/[,\s]/g, "");
  if (!/^\d+$/.test(digits)) {
    return undefined;
  }
  return Number.parseInt(digits, 10);
}

/** Collapse a payload's engagement fields, dropping the ones it didn't report. */
function engagementFrom(post: Record<string, unknown>): Engagement | undefined {
  const engagement: Engagement = {
    likes: count(
      pick(post, ["likes", "likesCount", "likeCount", "reactionsCount",
        "numLikes", "stats.likes", "reactions.total"]),
    ),
    comments: count(
      pick(post, ["comments", "commentsCount", "commentCount", "numComments",
        "stats.comments", "repliesCount"]),
    ),
    shares: count(
      pick(post, ["shares", "sharesCount", "shareCount", "repostsCount",
        "numShares", "stats.shares", "retweetCount"]),
    ),
    views: count(
      pick(post, ["views", "viewsCount", "viewCount", "playCount",
        "impressions", "stats.views"]),
    ),
  };
  return Object.values(engagement).some((v) => v !== undefined)
    ? engagement
    : undefined;
}

function toIso(value: unknown): string {
  const raw = str(value);
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

function dateValue(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function dedupeByUrl(items: RawItem[]): RawItem[] {
  const seen = new Set<string>();
  const out: RawItem[] = [];
  for (const item of items) {
    const key = item.url || item.title;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}
