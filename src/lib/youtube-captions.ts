import type { RawItem } from "@/lib/collectors";

/**
 * Spoken-word matching for DC-station YouTube uploads (aired TV segments).
 *
 * The station channels upload their actual newscast segments, but the feed only
 * exposes title + description — a segment that spends 40 seconds on I-66 tolls
 * under a generic "Evening news update" title is invisible to text matching.
 * YouTube auto-generates captions (ASR) for these videos, and the InnerTube
 * player API (IOS client — the WEB/MWEB clients reject datacenter requests)
 * exposes the caption track without an API key. We fetch the transcript for
 * recent videos whose title/description does NOT already match, search it for
 * corridor terms, and on a hit rewrite the item's snippet to the matched
 * transcript excerpt (so the shared classifier keeps it) and deep-link the URL
 * to the moment the mention airs (&t=...s).
 *
 * Strictly best-effort: every failure (bot-blocked IP, no captions, timeout)
 * leaves the item exactly as it was. Bounded by MAX_LOOKUPS and per-request
 * timeouts so a slow run costs at most a few seconds of the cron budget.
 */

const MAX_LOOKUPS = 12;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 6000;

// Spoken-word variants: ASR often renders "I-66" as "i 66" or "i66", so match
// on de-hyphenated/de-spaced forms as well.
const TRANSCRIPT_TERMS = [
  "i-66",
  "i 66",
  "i66",
  "interstate 66",
  "66 express",
  "express lanes",
  "express lane",
  "66 emp",
  "outside the beltway",
  "transform 66",
];

export async function enrichYouTubeTranscripts(
  items: RawItem[],
  extraTerms: string[] = [],
): Promise<void> {
  const terms = [
    ...TRANSCRIPT_TERMS,
    ...extraTerms.map((t) => t.toLowerCase().trim()).filter(Boolean),
  ];

  const candidates = items
    .filter((item) => {
      if (!item.url.includes("youtube.com/watch")) {
        return false;
      }
      const text = `${item.title} ${item.snippet}`.toLowerCase();
      // Already matches on title/description — the classifier will keep it
      // without needing the transcript.
      return !terms.some((term) => text.includes(term));
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_LOOKUPS);

  if (candidates.length === 0) {
    return;
  }

  // Simple promise-pool: CONCURRENCY workers draining a shared queue.
  const queue = [...candidates];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        await enrichOne(item, terms);
      } catch {
        // Best-effort by design: leave the item untouched.
      }
    }
  });
  await Promise.all(workers);
}

async function enrichOne(item: RawItem, terms: string[]): Promise<void> {
  const videoId = item.url.match(/[?&]v=([\w-]{6,})/)?.[1];
  if (!videoId) {
    return;
  }

  const track = await fetchCaptionTrackUrl(videoId);
  if (!track) {
    return;
  }

  const transcript = await fetchTranscript(track);
  if (!transcript) {
    return;
  }

  const hit = findFirstMatch(transcript, terms);
  if (!hit) {
    return;
  }

  const seconds = Math.max(0, Math.floor(hit.startMs / 1000) - 5);
  item.url = `${item.url}${item.url.includes("?") ? "&" : "?"}t=${seconds}s`;
  item.snippet = `On-air transcript match ("${hit.term}"): "...${hit.excerpt}..."`;
}

type CaptionEvent = { tStartMs?: number; segs?: Array<{ utf8?: string }> };

async function fetchCaptionTrackUrl(videoId: string): Promise<string | null> {
  const response = await fetchWithTimeout(
    "https://www.youtube.com/youtubei/v1/player",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "IOS",
            clientVersion: "20.10.4",
            deviceModel: "iPhone16,2",
          },
        },
        videoId,
      }),
    },
  );
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
      };
    };
  };
  const tracks =
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const english = tracks.filter((t) =>
    (t.languageCode ?? "").startsWith("en"),
  );
  // Prefer ASR (what was actually said on air) over uploaded caption files.
  const track =
    english.find((t) => t.kind === "asr") ?? english[0] ?? tracks[0];
  return track?.baseUrl ?? null;
}

async function fetchTranscript(
  baseUrl: string,
): Promise<CaptionEvent[] | null> {
  const response = await fetchWithTimeout(`${baseUrl}&fmt=json3`, {
    headers: { "User-Agent": "com.google.ios.youtube/20.10.4 (iPhone16,2)" },
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { events?: CaptionEvent[] };
  return data.events ?? null;
}

function findFirstMatch(
  events: CaptionEvent[],
  terms: string[],
): { term: string; excerpt: string; startMs: number } | null {
  // Build one normalized string while remembering each word's event start time.
  const words: Array<{ text: string; startMs: number }> = [];
  for (const event of events) {
    for (const seg of event.segs ?? []) {
      const text = (seg.utf8 ?? "").replace(/\s+/g, " ").trim();
      if (text) {
        words.push({ text: text.toLowerCase(), startMs: event.tStartMs ?? 0 });
      }
    }
  }
  if (words.length === 0) {
    return null;
  }

  const joined = words.map((w) => w.text).join(" ");
  for (const term of terms) {
    const index = joined.indexOf(term);
    if (index === -1) {
      continue;
    }

    // Map the character offset back to a word index for the timestamp.
    let charCount = 0;
    let wordIndex = 0;
    for (let i = 0; i < words.length; i++) {
      if (charCount >= index) {
        wordIndex = i;
        break;
      }
      charCount += words[i].text.length + 1;
      wordIndex = i;
    }

    const start = Math.max(0, wordIndex - 20);
    const end = Math.min(words.length, wordIndex + 30);
    const excerpt = words
      .slice(start, end)
      .map((w) => w.text)
      .join(" ");
    return { term, excerpt, startMs: words[wordIndex].startMs };
  }

  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
