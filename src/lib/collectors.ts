import { MEDIA_FEEDS, type FeedSource } from "@/lib/feeds";
import {
  DEFAULT_SETTINGS,
  type MonitoringSettings,
} from "@/lib/monitoring-settings";
import { getDigestLookbackHours } from "@/lib/time";
import type { DigestItem, RelevanceLabel, Source } from "@/lib/types";

type RawItem = {
  title: string;
  source: string;
  url: string;
  sourceType: "news" | "social" | "broadcast";
  snippet: string;
  publishedAt: string;
  provider: string;
  domain?: string;
};

type CollectionResult = {
  items: DigestItem[];
  suppressedCount: number;
  degradedProviders: string[];
};

// Built-in corridor net for incidents (crashes/closures), run in addition to
// the editable positive keywords.
const BROAD_NEWS_QUERY =
  '("I-66" OR "Interstate 66") (toll OR express OR lanes OR crash OR closure OR traffic) (Fairfax OR "Prince William" OR Gainesville OR Manassas OR Centreville OR Haymarket OR "Northern Virginia")';

const CRITICAL_PRIORITY_TERMS = [
  "fatal",
  "fatality",
  "major crash",
  "multi-vehicle crash",
  "closure",
  "closed",
  "shut down",
  "shutdown",
  "all lanes",
  "lawsuit",
  "tolling issue",
  "payment issue",
];

const USER_AGENT =
  "66EMP media monitor; contact ddonofrio@thecaseygroup.us";

export async function collectDigestItems(
  sources: Source[],
  now = new Date(),
  settings: MonitoringSettings = DEFAULT_SETTINGS,
): Promise<CollectionResult> {
  const exactQueries = settings.positiveKeywords.map(quotePhrase);
  const newsQueries = [...exactQueries, BROAD_NEWS_QUERY];

  const providers: Array<{ name: string; run: () => Promise<RawItem[]> }> = [
    // Direct outlet feeds run first so a station's own article wins dedup over
    // a search-engine copy and keeps its broadcast classification.
    { name: "Media Feeds", run: () => collectFeedItems(MEDIA_FEEDS) },
    { name: "GDELT", run: () => collectGdeltArticles(exactQueries) },
    { name: "Google News", run: () => collectGoogleNewsItems(newsQueries) },
    { name: "Bing News", run: () => collectBingNewsItems(exactQueries) },
    { name: "Reddit", run: () => collectRedditItems(exactQueries) },
  ];

  const settled = await Promise.allSettled(providers.map((p) => p.run()));
  const rawItems: RawItem[] = [];
  const degradedProviders: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      rawItems.push(...result.value);
    } else {
      degradedProviders.push(providers[index].name);
      console.error(
        `[collectors] ${providers[index].name} collection failed:`,
        result.reason,
      );
    }
  });

  const lookbackHours = getDigestLookbackHours(now);
  const uniqueItems = dedupeRawItems(rawItems);
  const timelyItems = uniqueItems.filter((item) =>
    isInsideDigestWindow(item.publishedAt, now, lookbackHours),
  );
  const items = timelyItems
    .map((item) => classifyItem(item, sources, settings))
    .filter((item): item is DigestItem => Boolean(item))
    .sort(sortDigestItems);

  return {
    items,
    suppressedCount: Math.max(uniqueItems.length - items.length, 0),
    degradedProviders,
  };
}

async function collectGdeltArticles(exactQueries: string[]): Promise<RawItem[]> {
  if (exactQueries.length === 0) {
    return [];
  }
  // GDELT is a best-effort bonus source. It rate-limits to ~1 request / 5s per
  // IP (Vercel shares IPs across projects, so 429s are common), is often slow,
  // and frequently returns no I-66 coverage at all. Any failure — 429, timeout,
  // non-JSON notice — degrades to an empty result and never flags as degraded;
  // the reliable backbone is Google News + Bing News + Reddit.
  try {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", `(${exactQueries.join(" OR ")})`);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "25");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("timespan", "2d");

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      console.warn(`[collectors] GDELT skipped (HTTP ${response.status})`);
      return [];
    }

    const data = JSON.parse(await response.text()) as {
      articles?: GdeltArticle[];
    };
    return (data.articles ?? []).map((article) => ({
      title: article.title ?? "Untitled article",
      source: article.domain ?? "GDELT",
      url: article.url ?? "",
      sourceType: "news",
      snippet: article.title ?? "",
      publishedAt: parseGdeltDate(article.seendate),
      provider: "GDELT",
      domain: article.domain,
    }));
  } catch (error) {
    console.warn("[collectors] GDELT skipped:", error);
    return [];
  }
}

async function collectGoogleNewsItems(queries: string[]): Promise<RawItem[]> {
  if (queries.length === 0) {
    return [];
  }
  const results = await Promise.allSettled(
    queries.map((query) => collectGoogleNewsQuery(query)),
  );

  if (results.every((result) => result.status === "rejected")) {
    throw new Error("All Google News queries failed");
  }

  return results.flatMap(unwrapSettled);
}

async function collectGoogleNewsQuery(query: string): Promise<RawItem[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:2d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const xml = await fetchText(url);
  return parseRssItems(xml).map((item) => ({
    title: item.title || "Untitled article",
    source: item.source || "Google News",
    url: item.link,
    sourceType: "news",
    snippet: item.description || item.title,
    publishedAt: parseDate(item.pubDate),
    provider: "Google News",
  }));
}

async function collectBingNewsItems(exactQueries: string[]): Promise<RawItem[]> {
  // A second, independent news feed so coverage does not depend on Google News
  // alone. Bing's news RSS works server-side without an API key.
  const queries = exactQueries.length
    ? [exactQueries.join(" OR "), BROAD_NEWS_QUERY]
    : [BROAD_NEWS_QUERY];
  const results = await Promise.allSettled(
    queries.map((query) => collectBingNewsQuery(query)),
  );

  if (results.every((result) => result.status === "rejected")) {
    throw new Error("All Bing News queries failed");
  }

  return results.flatMap(unwrapSettled);
}

async function collectBingNewsQuery(query: string): Promise<RawItem[]> {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");

  const xml = await fetchText(url);
  return parseRssItems(xml).map((item) => ({
    title: item.title || "Untitled article",
    source: item.source || "Bing News",
    url: item.link,
    sourceType: "news",
    snippet: item.description || item.title,
    publishedAt: parseDate(item.pubDate),
    provider: "Bing News",
  }));
}

async function collectRedditItems(exactQueries: string[]): Promise<RawItem[]> {
  if (exactQueries.length === 0) {
    return [];
  }
  // Reddit's JSON search (reddit.com/search.json) returns an HTML block page
  // from datacenter IPs like Vercel's. The old.reddit.com RSS (Atom) endpoint
  // is not blocked the same way, so use that instead.
  const url = new URL("https://old.reddit.com/search.rss");
  url.searchParams.set("q", exactQueries.join(" OR "));
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "25");

  const response = await fetchWithTimeout(url);
  if (response.status === 429) {
    console.warn("[collectors] Reddit rate-limited (429); skipping this run");
    return [];
  }
  if (!response.ok) {
    throw new Error(`Reddit request failed with ${response.status}`);
  }

  const xml = await response.text();
  return parseAtomEntries(xml).map((entry) => ({
    title: entry.title || "Untitled Reddit post",
    source: entry.subreddit || "Reddit",
    url: entry.link,
    sourceType: "social",
    snippet: entry.content || entry.title || "",
    publishedAt: parseDate(entry.updated),
    provider: "Reddit",
    domain: "reddit.com",
  }));
}

async function collectFeedItems(feeds: FeedSource[]): Promise<RawItem[]> {
  if (feeds.length === 0) {
    return [];
  }
  // Direct RSS/Atom/YouTube feeds for broadcast, agency, and local outlets.
  // Individual feed failures are tolerated (a flaky station site shouldn't drop
  // the rest); only a total wipeout flags the provider as degraded.
  const results = await Promise.allSettled(feeds.map((feed) => collectFeed(feed)));

  if (results.every((result) => result.status === "rejected")) {
    throw new Error("All media feeds failed");
  }

  return results.flatMap(unwrapSettled);
}

async function collectFeed(feed: FeedSource): Promise<RawItem[]> {
  // TV and radio land in the dedicated broadcast section; agency/online feeds
  // flow into the normal news buckets.
  const sourceType =
    feed.medium === "TV" || feed.medium === "Radio" ? "broadcast" : "news";
  const provider = `Feed: ${feed.name}`;
  const xml = await fetchText(new URL(feed.url));

  if (feed.kind === "youtube") {
    return parseYouTubeEntries(xml).map((entry) => ({
      title: entry.title || "Untitled segment",
      source: feed.name,
      url: entry.link,
      sourceType,
      snippet: entry.description || entry.title,
      publishedAt: parseDate(entry.published),
      provider,
      domain: feed.domain,
    }));
  }

  return parseRssItems(xml).map((item) => ({
    title: item.title || "Untitled item",
    source: feed.name,
    url: item.link,
    sourceType,
    snippet: item.description || item.title,
    publishedAt: parseDate(item.pubDate),
    provider,
    domain: feed.domain,
  }));
}

function classifyItem(
  item: RawItem,
  sources: Source[],
  settings: MonitoringSettings,
): DigestItem | null {
  if (!item.url || !item.title) {
    return null;
  }

  const combined = normalizeText(
    [item.title, item.snippet, item.source, item.domain].join(" "),
  );

  // Avoid phrases win: suppress as noise regardless of any keyword match.
  if (matchesAny(combined, settings.avoidPhrases)) {
    return null;
  }

  const sourceMatch = findSourceMatch(item, sources);
  let label = determineLabel(combined);

  // A positive keyword the user is monitoring always keeps the item, even if
  // the built-in I-66 classifier would have dropped it as noise.
  if (label === "noise") {
    if (matchesAny(combined, settings.positiveKeywords)) {
      label = "likely_otb";
    } else {
      return null;
    }
  }

  const priority = isCritical(combined) ? "important" : "normal";
  const reason = buildReason(label, sourceMatch);

  return {
    id: createStableId(item.url, item.title),
    title: cleanText(item.title),
    source: sourceMatch?.sourceName || cleanText(item.source),
    url: item.url,
    sourceType: item.sourceType,
    label,
    priority,
    reason,
    snippet: truncate(cleanText(item.snippet || item.title), 360),
    publishedAt: item.publishedAt,
  };
}

function determineLabel(text: string): RelevanceLabel {
  const hasExactOutsideTerm = [
    "66 outside the beltway",
    "i-66 outside the beltway",
    "66 express mobility partners",
    "66 emp",
    "66emp",
    "transform 66 outside the beltway",
  ].some((term) => text.includes(term));

  if (hasExactOutsideTerm) {
    return "confirmed_otb";
  }

  const mentionsExpressLanes =
    text.includes("66 express lanes") || text.includes("i-66 express lanes");
  const mentionsI66 =
    text.includes("i-66") ||
    text.includes("interstate 66") ||
    text.includes("route 66");
  const mentionsInsideBeltway =
    text.includes("inside the beltway") || text.includes("inside beltway");
  const hasCorridorTerm = [
    "fairfax",
    "prince william",
    "gainesville",
    "manassas",
    "centreville",
    "haymarket",
    "vienna",
    "northern virginia",
    "nova",
  ].some((term) => text.includes(term));
  const hasTollOrTrafficTerm = [
    "toll",
    "express",
    "lanes",
    "traffic",
    "commute",
    "crash",
    "closure",
    "closed",
  ].some((term) => text.includes(term));

  if (mentionsExpressLanes && hasCorridorTerm && !mentionsInsideBeltway) {
    return "confirmed_otb";
  }

  if (mentionsExpressLanes || (mentionsI66 && hasCorridorTerm && hasTollOrTrafficTerm)) {
    return mentionsInsideBeltway ? "uncertain_i66_segment" : "likely_otb";
  }

  if (mentionsI66 && (hasCorridorTerm || hasTollOrTrafficTerm)) {
    return "uncertain_i66_segment";
  }

  return "noise";
}

function buildReason(
  label: RelevanceLabel,
  sourceMatch: Source | undefined,
) {
  const labelReason: Record<RelevanceLabel, string> = {
    confirmed_otb: "Strong Outside the Beltway / 66EMP match",
    likely_otb: "Likely I-66 Express Lanes or corridor match",
    uncertain_i66_segment: "Mentions I-66, but the exact road segment is unclear",
    noise: "Suppressed as unrelated",
  };

  if (!sourceMatch) {
    return labelReason[label];
  }

  return `${labelReason[label]} · Known ${sourceMatch.priority}-priority source`;
}

function findSourceMatch(item: RawItem, sources: Source[]) {
  const itemHost = normalizeHost(item.domain || item.url);
  const itemSource = normalizeText(item.source);

  return sources.find((source) => {
    const sourceHost = normalizeHost(source.website);
    const sourceName = normalizeText(source.sourceName);

    return (
      Boolean(sourceHost && itemHost && itemHost.endsWith(sourceHost)) ||
      Boolean(sourceName && itemSource.includes(sourceName))
    );
  });
}

function matchesAny(text: string, terms: string[]) {
  return terms.some((term) => {
    const normalized = normalizeText(term);
    return normalized.length > 0 && text.includes(normalized);
  });
}

function quotePhrase(keyword: string) {
  const cleaned = keyword.replace(/"/g, "").trim();
  return `"${cleaned}"`;
}

function isCritical(text: string) {
  return CRITICAL_PRIORITY_TERMS.some((term) =>
    text.includes(normalizeText(term)),
  );
}

function sortDigestItems(a: DigestItem, b: DigestItem) {
  const priorityOrder = { important: 0, normal: 1, low: 2 };
  const labelOrder: Record<RelevanceLabel, number> = {
    confirmed_otb: 0,
    likely_otb: 1,
    uncertain_i66_segment: 2,
    noise: 3,
  };

  const priorityDelta = priorityOrder[a.priority] - priorityOrder[b.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const labelDelta = labelOrder[a.label] - labelOrder[b.label];
  if (labelDelta !== 0) {
    return labelDelta;
  }

  return dateValue(b.publishedAt) - dateValue(a.publishedAt);
}

function dedupeRawItems(items: RawItem[]) {
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped: RawItem[] = [];

  for (const item of items) {
    const key = createStableId(item.url, item.title);
    const titleKey = canonicalTitleKey(item);
    if (seen.has(key) || (titleKey && seenTitles.has(titleKey))) {
      continue;
    }

    seen.add(key);
    if (titleKey) {
      seenTitles.add(titleKey);
    }
    deduped.push(item);
  }

  return deduped;
}

function canonicalTitleKey(item: RawItem) {
  const withoutSource = item.title.replace(/\s+-\s+[^-]+$/, "");
  const key = normalizeText(withoutSource);
  return key.length > 24 ? key : "";
}

function createStableId(url: string, title: string) {
  const normalizedUrl = normalizeUrl(url);
  if (normalizedUrl) {
    return normalizedUrl;
  }

  return normalizeText(title);
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "fbclid" ||
        key === "gclid" ||
        key === "ocid"
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.text();
}

async function fetchWithTimeout(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    return await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/xml,application/rss+xml,text/plain,*/*",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssItems(xml: string) {
  const items: RssItem[] = [];
  const itemMatches = xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);

  for (const [, itemXml] of itemMatches) {
    items.push({
      title: readXmlTag(itemXml, "title"),
      link: readXmlTag(itemXml, "link"),
      pubDate: readXmlTag(itemXml, "pubDate"),
      description: stripTags(readXmlTag(itemXml, "description")),
      source: readXmlTag(itemXml, "source"),
    });
  }

  return items.filter((item) => item.link && item.title);
}

function parseAtomEntries(xml: string) {
  const entries: AtomEntry[] = [];
  const entryMatches = xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi);

  for (const [, entryXml] of entryMatches) {
    const link = entryXml.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const subreddit =
      entryXml.match(/<category\b[^>]*label="([^"]+)"/i)?.[1] ?? "";
    entries.push({
      title: readXmlTag(entryXml, "title"),
      link: decodeXml(link),
      updated: readXmlTag(entryXml, "updated"),
      content: stripTags(readXmlTag(entryXml, "content")),
      subreddit: decodeXml(subreddit).trim(),
    });
  }

  return entries.filter((entry) => entry.link && entry.title);
}

function parseYouTubeEntries(xml: string) {
  const entries: YouTubeEntry[] = [];
  const entryMatches = xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi);

  for (const [, entryXml] of entryMatches) {
    const link =
      entryXml.match(/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ??
      entryXml.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    entries.push({
      title: readXmlTag(entryXml, "title"),
      link: decodeXml(link),
      published: readXmlTag(entryXml, "published"),
      description: stripTags(readXmlTag(entryXml, "media:description")),
    });
  }

  return entries.filter((entry) => entry.link && entry.title);
}

function readXmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(stripCdata(match?.[1] ?? ""));
}

function stripCdata(value: string) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function parseGdeltDate(value?: string) {
  if (!value) {
    return new Date().toISOString();
  }

  if (/^\d{14}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const second = Number(value.slice(12, 14));
    return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
  }

  return parseDate(value);
}

function parseDate(value?: string) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeText(value: string) {
  return cleanText(value).toLowerCase();
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function normalizeHost(value: string) {
  if (!value) {
    return "";
  }

  try {
    const host = value.startsWith("http")
      ? new URL(value).hostname
      : new URL(`https://${value}`).hostname;
    return host.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
  }
}

function isInsideDigestWindow(
  publishedAt: string,
  now: Date,
  lookbackHours: number,
) {
  const timestamp = dateValue(publishedAt);
  if (!timestamp) {
    return true;
  }

  const nowValue = now.getTime();
  return (
    timestamp >= nowValue - lookbackHours * 60 * 60 * 1000 &&
    timestamp <= nowValue + 6 * 60 * 60 * 1000
  );
}

function dateValue(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function unwrapSettled<T>(result: PromiseSettledResult<T[]>): T[] {
  return result.status === "fulfilled" ? result.value : [];
}

type GdeltArticle = {
  title?: string;
  url?: string;
  seendate?: string;
  domain?: string;
};

type RssItem = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
};

type AtomEntry = {
  title: string;
  link: string;
  updated: string;
  content: string;
  subreddit: string;
};

type YouTubeEntry = {
  title: string;
  link: string;
  published: string;
  description: string;
};
