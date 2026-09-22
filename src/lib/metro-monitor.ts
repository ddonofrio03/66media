import { getDigestLookbackHours } from "@/lib/time";
import type { RawItem } from "@/lib/collectors";

/**
 * Metro Monitor (streamslist.com) media monitoring: TV/radio/web hits
 * matched against a saved query in their portal. TV/radio fills a gap no
 * free RSS source can reach; web hits are included too (at the user's
 * request) even though their links point back into Metro Monitor's
 * login-gated portal rather than the original public article.
 *
 * IMPORTANT: Metro Monitor's `/shares/{type}/{uuid}` links are NOT stable —
 * every time a story is returned (by a search or by the portal's own "Share"
 * button) it mints a brand-new, short-lived (~1-2 day) share token, even for
 * the identical story. Storing that uuid at collection time means the link
 * is already stale by the time a digest is read days later. So `toRawItems`
 * points every item at our own `/api/metro-monitor/open` redirect instead,
 * keyed on the story's *stable* numeric id (`percolatable.id`) — that route
 * mints a fresh share link on click via `mintFreshShareLink`, verified
 * against the live API (see `POST /public-shares`).
 *
 * Gated on:
 *   METRO_MONITOR_USERNAME
 *   METRO_MONITOR_PASSWORD
 *   METRO_MONITOR_QUERY_ID   the saved query's numeric id (portal URL's ?qId=)
 *
 * Silent no-op when unconfigured. Best-effort: any failure returns [].
 */

const API_BASE = "https://api.streamslist.com";
const TIMEOUT_MS = 8000;
const PAGE_SIZE = 50;
const MAX_PAGES = 6;

// All three source types (Web, Radio, Television) — matches the saved
// query's own default filter, verified working against the live API.
const ALL_SOURCE_TYPES = "sourcetypes: (2,6,3)";
const SHARE_TYPE: Record<number, string> = { 3: "tv", 6: "radio", 2: "web" };

// The saved query's own free-text search string, required by `/public-shares`
// alongside the query id. Captured verbatim from a live share-generation
// request; only needs updating if the saved query's keywords change in the
// portal (id 27417).
const FREE_QUERY_TEXT =
  '("66 Express" or "66 outside the beltway" or "Express mobility Partners" ' +
  'or "I-66 EMP" or "66 emp" or "I-66 outside the beltway" or "I-66 Express" ' +
  'or "66 Express Lanes" or "66 Express Mobility Partners" or "66EMP" or ' +
  '"Ferrovial construction" or "FAM Construction" or "Transform 66")';

// Sent on every request, matching what the portal's own frontend sends.
// Cheap insurance in case the API validates these server-side.
const BROWSER_HEADERS = {
  Origin: "https://client.metromonitor.com",
  Referer: "https://client.metromonitor.com/",
};

type MetroSourceType = { id?: number; name?: string };
type MetroSource = {
  name?: string;
  sourceType?: MetroSourceType;
  market?: { name?: string };
};
type MetroItem = {
  id: number;
  uuid?: string[];
  title?: string;
  content?: string;
  published?: string;
  timezones?: string[];
  sources?: MetroSource[];
};
type MetroSearchResponse = {
  content?: MetroItem[];
  highlights?: Record<string, { content?: string[] }>;
  totalPages?: number;
};

export async function collectMetroMonitorItems(
  now = new Date(),
): Promise<RawItem[]> {
  const username = process.env.METRO_MONITOR_USERNAME;
  const password = process.env.METRO_MONITOR_PASSWORD;
  const queryId = process.env.METRO_MONITOR_QUERY_ID;
  if (!username || !password || !queryId) {
    console.log(
      "[metro-monitor] Skipped: one or more of METRO_MONITOR_USERNAME/" +
        "PASSWORD/QUERY_ID is not set.",
    );
    return [];
  }

  const token = await login(username, password);
  if (!token) {
    // login() already logged the specific reason (HTTP status or exception).
    return [];
  }
  console.log("[metro-monitor] Login succeeded.");

  const lookbackHours = getDigestLookbackHours(now);
  const end = now.getTime();
  const start = end - lookbackHours * 60 * 60 * 1000;

  const items: RawItem[] = [];
  let rawContentCount = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(token, queryId, start, end, page);
    if (!batch) {
      // fetchPage() already logged the specific reason.
      break;
    }
    rawContentCount += batch.content?.length ?? 0;
    items.push(...toRawItems(batch));
    const totalPages = batch.totalPages ?? 1;
    if (page + 1 >= totalPages || (batch.content?.length ?? 0) === 0) {
      break;
    }
  }

  console.log(
    `[metro-monitor] Fetched ${rawContentCount} raw stories, kept ${items.length} ` +
      "after mapping (dropped ones lacked a recognized source type or uuid).",
  );
  return items;
}

async function login(
  username: string,
  password: string,
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/auth/portal/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      console.warn(`[metro-monitor] Login failed (HTTP ${response.status})`);
      return null;
    }
    const data = (await response.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (error) {
    console.warn("[metro-monitor] Login skipped:", error);
    return null;
  }
}

/**
 * Mints a fresh, short-lived share link for one story, called at click time
 * (see `src/app/api/metro-monitor/open/route.ts`) rather than at collection
 * time, since a link stored during collection would already be stale by the
 * time anyone clicks it (see the file header). `percolatableId` is the
 * story's stable numeric id (Metro Monitor's `MetroItem.id`), not a uuid.
 */
export async function mintFreshShareLink(
  percolatableId: number,
  shareType: string,
): Promise<string | null> {
  const username = process.env.METRO_MONITOR_USERNAME;
  const password = process.env.METRO_MONITOR_PASSWORD;
  const queryId = process.env.METRO_MONITOR_QUERY_ID;
  if (!username || !password || !queryId) {
    return null;
  }

  const token = await login(username, password);
  if (!token) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE}/public-shares`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${token}`,
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify({
        percolatable: { id: percolatableId },
        query: { id: Number(queryId) },
        freeQueryText: FREE_QUERY_TEXT,
      }),
    });
    if (!response.ok) {
      console.warn(
        `[metro-monitor] mintFreshShareLink failed (HTTP ${response.status})`,
      );
      return null;
    }
    const data = (await response.json()) as { publicId?: string };
    if (!data.publicId) {
      console.warn("[metro-monitor] mintFreshShareLink: no publicId in response");
      return null;
    }
    return `https://client.metromonitor.com/shares/${shareType}/${data.publicId}`;
  } catch (error) {
    console.warn("[metro-monitor] mintFreshShareLink skipped:", error);
    return null;
  }
}

async function fetchPage(
  token: string,
  queryId: string,
  start: number,
  end: number,
  page: number,
): Promise<MetroSearchResponse | null> {
  const url = new URL(`${API_BASE}/percolatables/search/query-results`);
  url.searchParams.set("queryId", queryId);
  url.searchParams.set("selectedQueryFilters", ALL_SOURCE_TYPES);
  url.searchParams.set("page", String(page));
  url.searchParams.set("previewEnabled", "false");
  url.searchParams.set("enableAggregations", "true");
  url.searchParams.set("enableHighlights", "true");
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("facetsApplied", `(start: (${start}) AND end: (${end}))`);
  url.searchParams.set("sortField", "PUBLISH_DATETIME");
  url.searchParams.set("sortOrder", "DESCENDING");
  url.searchParams.set("storyDurationFilterId", "4");
  url.searchParams.set("curationFacets", "");

  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${token}`,
        ...BROWSER_HEADERS,
      },
    });
    if (!response.ok) {
      console.warn(
        `[metro-monitor] Search failed (HTTP ${response.status})`,
      );
      return null;
    }
    return (await response.json()) as MetroSearchResponse;
  } catch (error) {
    console.warn("[metro-monitor] Search skipped:", error);
    return null;
  }
}

function toRawItems(batch: MetroSearchResponse): RawItem[] {
  const highlights = batch.highlights ?? {};

  return (batch.content ?? [])
    .map((item) => {
      const source = item.sources?.[0];
      const typeId = source?.sourceType?.id;
      const shareType = typeId ? SHARE_TYPE[typeId] : undefined;
      const uuid = item.uuid?.[0];
      if (!shareType || !uuid) {
        return null;
      }

      // Not the raw Metro Monitor share link — see the file header. The uuid
      // check above only confirms this story actually has a shareable clip.
      const url = `${appBaseUrl()}/api/metro-monitor/open?id=${item.id}&type=${shareType}`;
      const content = item.content ?? "";
      const snippet = pickSnippet(highlights[String(item.id)]?.content, content);
      // TV/radio always show in their own section regardless of relevance
      // (same convention as the TV/Radio RSS feeds in collectors.ts); web
      // hits go through normal keyword classification like any other article.
      const sourceType = typeId === 2 ? "news" : "broadcast";

      const raw: RawItem = {
        title: item.title || source?.name || "Untitled segment",
        source: source?.name || "Metro Monitor",
        url,
        sourceType,
        snippet,
        publishedAt: toIso(item.published, item.timezones),
        provider: "Metro Monitor",
        transcript: content || undefined,
        clipUrl: url,
      };
      return raw;
    })
    .filter((item): item is RawItem => item !== null);
}

function pickSnippet(highlightSnippets: string[] | undefined, content: string): string {
  const highlight = highlightSnippets?.[0];
  if (highlight) {
    return stripTags(highlight);
  }
  return truncate(content.replace(/\s+/g, " ").trim(), 360);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}...`;
}

// Duplicated from digest.ts (not imported) to avoid a circular import:
// digest.ts -> collectors.ts -> metro-monitor.ts -> digest.ts.
function appBaseUrl() {
  return (process.env.APP_BASE_URL || "https://66media.vercel.app").replace(
    /\/$/,
    "",
  );
}

/**
 * `published` is a naive wall-clock string with no offset; `timezones` says
 * which zone it's in ("US/Eastern" for broadcast items). Converts to a real
 * UTC ISO string, DST-aware, using the double-format trick (the
 * default-timezone parsing error cancels out in the subtraction).
 */
function toIso(published: string | undefined, timezones: string[] | undefined): string {
  if (!published) {
    return new Date().toISOString();
  }
  const zone = timezones?.[0];
  if (!zone || zone === "Z" || zone === "UTC") {
    const parsed = new Date(`${published}Z`);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  const naive = new Date(`${published}Z`);
  if (Number.isNaN(naive.getTime())) {
    return new Date().toISOString();
  }
  const offsetMs = getTimeZoneOffsetMs(naive, zone);
  return new Date(naive.getTime() - offsetMs).toISOString();
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return tzDate.getTime() - utcDate.getTime();
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
