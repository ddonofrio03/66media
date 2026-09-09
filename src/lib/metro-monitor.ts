import { getDigestLookbackHours } from "@/lib/time";
import type { RawItem } from "@/lib/collectors";

/**
 * Metro Monitor (streamslist.com) broadcast monitoring: TV/radio five-minute
 * story transcripts matched against a saved query in their portal. Fills a
 * gap no free RSS source can reach — local TV/radio segments — so this stays
 * scoped to TV/Radio only. Web-source hits from the same query are skipped:
 * their links point back into Metro Monitor's login-gated portal, and the
 * same articles are already reachable (with real, public URLs) via the
 * Google News collector.
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

// Television, Radio (Metro Monitor's sourceType ids). Web is deliberately
// excluded — see file header.
const BROADCAST_SOURCE_TYPES = "sourcetypes: (3,6)";
const SHARE_TYPE: Record<number, string> = { 3: "tv", 6: "radio" };

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
    return [];
  }

  const token = await login(username, password);
  if (!token) {
    return [];
  }

  const lookbackHours = getDigestLookbackHours(now);
  const end = now.getTime();
  const start = end - lookbackHours * 60 * 60 * 1000;

  const items: RawItem[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(token, queryId, start, end, page);
    if (!batch) {
      break;
    }
    items.push(...toRawItems(batch));
    const totalPages = batch.totalPages ?? 1;
    if (page + 1 >= totalPages || (batch.content?.length ?? 0) === 0) {
      break;
    }
  }

  return items;
}

async function login(
  username: string,
  password: string,
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/auth/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

async function fetchPage(
  token: string,
  queryId: string,
  start: number,
  end: number,
  page: number,
): Promise<MetroSearchResponse | null> {
  const url = new URL(`${API_BASE}/percolatables/search/query-results`);
  url.searchParams.set("queryId", queryId);
  url.searchParams.set("selectedQueryFilters", BROADCAST_SOURCE_TYPES);
  url.searchParams.set("page", String(page));
  url.searchParams.set("previewEnabled", "false");
  url.searchParams.set("enableAggregations", "false");
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
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
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

      const url = `https://client.metromonitor.com/shares/${shareType}/${uuid}`;
      const content = item.content ?? "";
      const snippet = pickSnippet(highlights[String(item.id)]?.content, content);

      const raw: RawItem = {
        title: item.title || source?.name || "Untitled segment",
        source: source?.name || "Metro Monitor",
        url,
        sourceType: "broadcast",
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
