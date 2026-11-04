import type { RawItem } from "@/lib/collectors";
import { getDigestLookbackHours } from "@/lib/time";

/**
 * YouTube keyword search via the YouTube Data API v3 (search.list).
 *
 * Finds uploads from ANY channel that match the monitoring keywords, not just
 * the station channels listed in feeds.ts. Gated on:
 *
 *   YOUTUBE_API_KEY   a key from Google Cloud with "YouTube Data API v3" enabled
 *
 * Silent no-op when unset. Best-effort: any failure returns [] and is logged.
 *
 * Quota: each search.list call costs 100 units against a default 10,000/day
 * project quota. Per collection: 3 keyword searches + 5 station searches =
 * 800 units. The poller runs every 2 hours (12 collections/day), so about
 * 9,600 units/day, close to the default cap. Lower MAX_QUERIES if the quota is shared with other
 * projects. The station pass is the one to keep.
 *
 * The search snippet already carries title, description and channel name, so
 * no follow-up videos.list call is needed.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3/search";
// Keyword phrases searched across ALL of YouTube. Kept at 3 so the total stays
// under the 10,000/day quota with the station pass below.
const MAX_QUERIES = 3;
const RESULTS_PER_QUERY = 10;
const RESULTS_PER_STATION = 50;
const TIMEOUT_MS = 8000;

// The DC TV stations, searched per channel so every upload in the lookback
// window is seen, not just the feed's ~15 newest. Channel IDs match the feeds
// in feeds.ts (WRC = NBC4 Washington, WTTG = FOX 5 DC, WDVM = DC News Now).
export const STATION_CHANNELS: Array<{ name: string; channelId: string }> = [
  { name: "WJLA 7News", channelId: "UCfIjR00qhYUFkbWIugAAbGg" },
  { name: "WRC NBC4", channelId: "UC1VKVKhJLc7PjdPPVxTDk0Q" },
  { name: "WTTG FOX 5", channelId: "UCHLyP4MuA-JAFBCwxXOEDdA" },
  { name: "WUSA9", channelId: "UCcT6w3xUyVshyR2_2vrMp1w" },
  { name: "WDVM DC News Now", channelId: "UCP3sSdrcCw7qC0qSrD8xOHQ" },
];

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[];
  error?: { code?: number; message?: string };
};

export async function collectYouTubeSearchItems(
  keywords: string[],
  now = new Date(),
): Promise<RawItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return [];
  }

  const queries = toQueries(keywords).slice(0, MAX_QUERIES);
  if (queries.length === 0) {
    return [];
  }

  const publishedAfter = lookbackStart(now);

  const results = await Promise.allSettled(
    queries.map((query) =>
      searchQuery(query, apiKey, {
        q: query,
        maxResults: String(RESULTS_PER_QUERY),
        publishedAfter,
      }),
    ),
  );

  const seen = new Set<string>();
  const items: RawItem[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const item of result.value) {
      if (seen.has(item.url)) {
        continue;
      }
      seen.add(item.url);
      items.push(item);
    }
  }
  return items;
}

// Quote each keyword as an exact phrase and drop case-insensitive duplicates
// (the default list has "66 EMP" and "66EMP" as separate entries).
function toQueries(keywords: string[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const keyword of keywords) {
    const cleaned = keyword.replace(/"/g, "").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push(`"${cleaned}"`);
  }
  return queries;
}

/**
 * Every upload from the four DC station channels inside the lookback window.
 * One search.list call per channel (100 units each, 400 per collection). The
 * classifier then keeps only the items that match 66 OTB keywords. Silent []
 * unless YOUTUBE_API_KEY is set.
 */
export async function collectStationChannelItems(
  now = new Date(),
): Promise<RawItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return [];
  }

  const publishedAfter = lookbackStart(now);
  const results = await Promise.allSettled(
    STATION_CHANNELS.map((station) =>
      searchQuery(
        `channel:${station.name}`,
        apiKey,
        {
          channelId: station.channelId,
          maxResults: String(RESULTS_PER_STATION),
          publishedAfter,
        },
      ),
    ),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

function lookbackStart(now: Date) {
  return new Date(
    now.getTime() - getDigestLookbackHours(now) * 60 * 60 * 1000,
  ).toISOString();
}

async function searchQuery(
  label: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<RawItem[]> {
  const url = new URL(API_BASE);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "date");
  url.searchParams.set("maxResults", String(RESULTS_PER_QUERY));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
    });
    const data = (await response.json()) as YouTubeSearchResponse;
    if (!response.ok) {
      console.warn(
        `[youtube-search] ${label} skipped (HTTP ${response.status}): ${data.error?.message ?? "unknown error"}`,
      );
      return [];
    }
    return (data.items ?? []).map(toRawItem).filter((item) => item.url);
  } catch (error) {
    console.warn(`[youtube-search] ${label} failed:`, error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toRawItem(item: YouTubeSearchItem): RawItem {
  const videoId = item.id?.videoId ?? "";
  const title = decodeEntities(item.snippet?.title ?? "").trim();
  const description = decodeEntities(item.snippet?.description ?? "").trim();
  return {
    title: title || "Untitled video",
    source: item.snippet?.channelTitle || "YouTube",
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    // Search results are mostly newscast uploads, so they share the broadcast
    // bucket with the station feeds. A judgment call; change here if wrong.
    sourceType: "broadcast",
    snippet: description || title,
    publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
    provider: "YouTube Search",
    domain: "youtube.com",
  };
}

// The Data API returns HTML entities (e.g. &#39;) in titles and descriptions.
function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
