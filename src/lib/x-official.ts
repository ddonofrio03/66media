import type { RawItem } from "@/lib/collectors";

/**
 * X (Twitter) keyword monitoring via the official X API v2 Recent Search.
 *
 * X now bills pay-per-use ($0.005 per post READ, prepaid credits, hard spend
 * caps, no subscription) with 24-hour dedup — the same post returned twice in
 * a UTC day bills once. That makes frequent polling affordable: this runs on
 * every collection (digest + 10-minute poller) with a tight per-run cap and a
 * short lookback, and the daily bill stays at cents.
 *
 * Gated on X_BEARER_TOKEN (from the X Developer Console). When the token is
 * present, the Apify tweet-scraper is skipped (see social.ts) — official data
 * is more defensible in client-facing reports.
 */

const SEARCH_URL = "https://api.x.com/2/tweets/search/recent";

// One combined recall-oriented query (Recent Search allows ~512 chars).
// Precise brand phrases OR corridor phrases with traffic/toll context; the
// shared relevance classifier filters the remainder.
const QUERY =
  '("66 Express Lanes" OR "66 Express" OR "I-66" OR "Interstate 66") ' +
  "(toll OR tolls OR lanes OR express OR traffic OR crash OR closure OR commute OR HOV) " +
  "-is:retweet lang:en";

const MAX_RESULTS = 25; // per run; 24h dedup keeps repeat reads unbilled
const LOOKBACK_MINUTES = 180; // poller overlap window; digest still catches stragglers
const TIMEOUT_MS = 8000;

type Tweet = {
  id: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
};

type XUser = { id: string; username?: string; name?: string };

export function isXOfficialEnabled(): boolean {
  return Boolean(process.env.X_BEARER_TOKEN);
}

export async function collectXOfficialItems(
  now: Date = new Date(),
): Promise<RawItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    return [];
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set("query", QUERY);
  url.searchParams.set("max_results", String(MAX_RESULTS));
  url.searchParams.set(
    "start_time",
    new Date(now.getTime() - LOOKBACK_MINUTES * 60_000).toISOString(),
  );
  // public_metrics is free on the same read — it is what the report ranks
  // "top mentions by social echo" on.
  url.searchParams.set("tweet.fields", "created_at,author_id,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (response.status === 429) {
      console.warn("[x-official] Rate-limited (429); skipping this run.");
      return [];
    }
    if (!response.ok) {
      console.warn(
        `[x-official] Search skipped (HTTP ${response.status}): ${await response.text()}`,
      );
      return [];
    }

    const data = (await response.json()) as {
      data?: Tweet[];
      includes?: { users?: XUser[] };
    };
    const usersById = new Map(
      (data.includes?.users ?? []).map((user) => [user.id, user]),
    );

    return (data.data ?? [])
      .map((tweet) => {
        const user = tweet.author_id
          ? usersById.get(tweet.author_id)
          : undefined;
        const handle = user?.username ?? "";
        const text = (tweet.text ?? "").replace(/\s+/g, " ").trim();
        return {
          title: text
            ? truncate(text, 120)
            : handle
              ? `@${handle} on X`
              : "X post",
          source: handle ? `@${handle}` : "X",
          url: handle
            ? `https://x.com/${handle}/status/${tweet.id}`
            : `https://x.com/i/status/${tweet.id}`,
          sourceType: "social" as const,
          snippet: text,
          publishedAt: toIso(tweet.created_at),
          provider: "X (Official)",
          domain: "x.com",
          engagement: {
            likes: tweet.public_metrics?.like_count,
            comments: tweet.public_metrics?.reply_count,
            // Retweets and quotes are both onward shares; echo counts them together.
            shares:
              tweet.public_metrics?.retweet_count === undefined &&
              tweet.public_metrics?.quote_count === undefined
                ? undefined
                : (tweet.public_metrics?.retweet_count ?? 0) +
                  (tweet.public_metrics?.quote_count ?? 0),
            views: tweet.public_metrics?.impression_count,
          },
        };
      })
      .filter((item) => item.url);
  } catch (error) {
    console.warn("[x-official] Skipped:", error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toIso(value?: string): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}...`;
}
