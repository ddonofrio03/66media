import type { RawItem } from "@/lib/collectors";

/**
 * Bluesky keyword search. Free and official, but Bluesky now requires an
 * authenticated session for search — so this is gated on a (free) account's
 * credentials:
 *
 *   BLUESKY_IDENTIFIER   e.g. "66media.bsky.social" (or an email)
 *   BLUESKY_APP_PASSWORD an App Password from Settings -> App Passwords
 *                        (never the real account password)
 *
 * Silent no-op when unconfigured. Cheap and rate-limit-friendly, so it runs
 * on every collection (daily digest AND the 10-minute poller), unlike the
 * pay-per-result Apify actors. Best-effort: any failure returns [].
 */

const PDS = "https://bsky.social";

// Recall-oriented corridor queries; the shared classifier drops off-topic
// hits (historic Route 66 etc.) downstream.
const QUERIES = ['"I-66"', '"66 Express"', '"Interstate 66"'];

const PER_QUERY_LIMIT = 25;
const TIMEOUT_MS = 6000;

type BskyPost = {
  uri?: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
};

export async function collectBlueskyItems(): Promise<RawItem[]> {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) {
    return [];
  }

  const token = await createSession(identifier, password);
  if (!token) {
    return [];
  }

  const results = await Promise.allSettled(
    QUERIES.map((query) => searchQuery(query, token)),
  );
  const items = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  // Dedupe across the overlapping queries.
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

async function createSession(
  identifier: string,
  password: string,
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      `${PDS}/xrpc/com.atproto.server.createSession`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      },
    );
    if (!response.ok) {
      console.warn(`[bluesky] Login failed (HTTP ${response.status})`);
      return null;
    }
    const data = (await response.json()) as { accessJwt?: string };
    return data.accessJwt ?? null;
  } catch (error) {
    console.warn("[bluesky] Login skipped:", error);
    return null;
  }
}

async function searchQuery(query: string, token: string): Promise<RawItem[]> {
  const url = new URL(`${PDS}/xrpc/app.bsky.feed.searchPosts`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(PER_QUERY_LIMIT));
  url.searchParams.set("sort", "latest");
  url.searchParams.set("lang", "en");

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    console.warn(`[bluesky] Search skipped (HTTP ${response.status})`);
    return [];
  }
  const data = (await response.json()) as { posts?: BskyPost[] };
  return (data.posts ?? []).map(toRawItem).filter((item) => item.url);
}

function toRawItem(post: BskyPost): RawItem {
  const text = (post.record?.text ?? "").replace(/\s+/g, " ").trim();
  const handle = post.author?.handle ?? "";
  // at://did:plc:xxx/app.bsky.feed.post/RKEY -> bsky.app web URL
  const rkey = post.uri?.split("/").pop() ?? "";
  const url =
    handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : "";

  return {
    title: text ? truncate(text, 120) : handle ? `@${handle} on Bluesky` : "Bluesky post",
    source: handle ? `@${handle}` : "Bluesky",
    url,
    sourceType: "social",
    snippet: text,
    publishedAt: toIso(post.record?.createdAt ?? post.indexedAt),
    provider: "Bluesky",
    domain: "bsky.app",
  };
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

function toIso(value?: string): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}...`;
}
