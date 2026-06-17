import type { MonitoringSettings } from "@/lib/monitoring-settings";
import type { RawItem } from "@/lib/collectors";

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
const FB_ACTOR = process.env.APIFY_FB_ACTOR || "apify/facebook-search-scraper";
// LinkedIn has no open keyword search, so we run in "company-page mode": scrape
// the recent posts of specific pages (LINKEDIN_PAGES) with a cookie-free
// company-posts actor. No login, ToS-friendly — but only the pages' own posts,
// not public mentions of "66".
const LINKEDIN_ACTOR =
  process.env.APIFY_LINKEDIN_ACTOR || "apimaestro/linkedin-company-posts";

// Per-run caps. X is the backbone so it gets the larger share; the combined
// result is sliced to TOTAL_CAP afterward. Lower these to spend less.
const X_MAX_ITEMS = 35;
const FB_MAX_ITEMS = 20;
const LINKEDIN_MAX_PER_PAGE = 5;
const TOTAL_CAP = 50;

// run-sync-get-dataset-items blocks until the actor finishes. Keep it well under
// the route's maxDuration (60s) so a slow scrape degrades to "no social this
// run" instead of timing out the whole digest. The actor's own run is also
// killed server-side at this bound via the `timeout` query param.
const ACTOR_TIMEOUT_MS = 40_000;

function isEnabled(): boolean {
  return (
    process.env.SOCIAL_ENABLED === "true" && Boolean(process.env.APIFY_TOKEN)
  );
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

  const tasks: Array<{ name: string; run: () => Promise<RawItem[]> }> = [
    { name: "X", run: () => collectX(keywords, token) },
    { name: "Facebook", run: () => collectFacebook(keywords, token) },
  ];

  // LinkedIn only runs when pages are configured — no point calling the actor
  // (and being billed) with nothing to scrape.
  const pages = linkedinPages();
  if (pages.length > 0) {
    tasks.push({ name: "LinkedIn", run: () => collectLinkedIn(pages, token) });
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
  // apidojo/tweet-scraper takes an array of search terms and returns the latest
  // matching tweets, billed per result. We ask for English, sorted newest.
  const input = {
    searchTerms: keywords,
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
    };
  }).filter((item) => item.url);
}

async function collectFacebook(
  keywords: string[],
  token: string,
): Promise<RawItem[]> {
  // apify/facebook-search-scraper takes keywords in `categories` (required) and
  // caps with `resultsLimit`. It returns Facebook pages/results matching the
  // terms (FB has no open *post* keyword search without a login). Output shape
  // varies, so read fields defensively — covers post- and page-shaped results.
  const input = {
    categories: keywords,
    locations: [] as string[],
    resultsLimit: FB_MAX_ITEMS,
  };

  const raw = await runActor(FB_ACTOR, input, token, FB_MAX_ITEMS);
  return raw.map((post) => {
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
      title: text ? truncate(text, 120) : author ? `${author} on Facebook` : "Facebook post",
      source: author || "Facebook",
      url,
      sourceType: "social" as const,
      snippet: text,
      publishedAt: toIso(
        pick(post, ["time", "date", "publishedTime", "timestamp", "createdAt"]),
      ),
      provider: "Facebook (Apify)",
      domain: "facebook.com",
    };
  }).filter((item) => item.url);
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
