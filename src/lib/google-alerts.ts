import type { RawItem } from "@/lib/collectors";

/**
 * Google Alerts, delivered as RSS. Each alert at google.com/alerts can be set
 * to "Deliver to: RSS feed", which gives it a private Atom feed URL. Alerts
 * reach web pages, blogs, and small outlets that Google News search misses,
 * so they complement it rather than replace it.
 *
 * Gated on:
 *   GOOGLE_ALERTS_FEEDS   comma- or newline-separated feed URLs
 *
 * Silent no-op when unset. One dead feed doesn't drop the rest; only a total
 * wipeout throws, so the provider flags as degraded.
 */

const TIMEOUT_MS = 8000;
const USER_AGENT = "66EMP media monitor; contact ddonofrio@thecaseygroup.us";

export function getGoogleAlertsFeeds(): string[] {
  return (process.env.GOOGLE_ALERTS_FEEDS ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith("https://"));
}

export async function collectGoogleAlertsItems(): Promise<RawItem[]> {
  const feeds = getGoogleAlertsFeeds();
  if (feeds.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(feeds.map(collectAlertFeed));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        `[google-alerts] feed ${index + 1} failed:`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  });
  if (results.every((result) => result.status === "rejected")) {
    throw new Error("All Google Alerts feeds failed");
  }

  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

async function collectAlertFeed(feedUrl: string): Promise<RawItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let xml: string;
  try {
    const response = await fetch(feedUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/atom+xml,application/xml,text/xml,*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
    xml = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  return parseAlertEntries(xml);
}

/**
 * Google Alerts Atom entries carry HTML-escaped titles and snippets (the
 * matched terms wrapped in <b>), and a google.com/url redirect as the link.
 * Unwrap both so the item looks like any other article: real title, real
 * publisher URL, publisher host as the source.
 */
export function parseAlertEntries(xml: string): RawItem[] {
  const items: RawItem[] = [];

  for (const [, entryXml] of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const href = entryXml.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const url = unwrapGoogleRedirect(decodeEntities(href));
    const title = htmlToText(readTag(entryXml, "title"));
    if (!url || !title) {
      continue;
    }

    const host = hostOf(url);
    const published = readTag(entryXml, "published") || readTag(entryXml, "updated");
    items.push({
      title,
      source: host || "Google Alerts",
      url,
      sourceType: "news",
      snippet: htmlToText(readTag(entryXml, "content")) || title,
      publishedAt: toIso(published),
      provider: "Google Alerts",
      domain: host || undefined,
    });
  }

  return items;
}

function unwrapGoogleRedirect(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.endsWith("google.com") && url.pathname === "/url") {
      return url.searchParams.get("url") || url.searchParams.get("q") || value;
    }
    return value;
  } catch {
    return "";
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function readTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return (match?.[1] ?? "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

// Two entity layers: the XML escaping, then the HTML inside type="html".
function htmlToText(value: string): string {
  const html = decodeEntities(value);
  // Inline emphasis goes without a space: the <b> Google wraps around the
  // matched term would otherwise turn "I-<b>66</b>" into "I- 66", which the
  // classifier can't match.
  return decodeEntities(
    html.replace(/<\/?(b|strong|i|em)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function toIso(value: string): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}
