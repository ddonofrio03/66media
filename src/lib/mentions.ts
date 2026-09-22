import { createStableId } from "@/lib/collectors";
import { setSentiment, upsertCollectedItems, type SentimentValue } from "@/lib/digest-store";
import type { DigestItem, RelevanceLabel } from "@/lib/types";

/**
 * Analyst-entered mentions.
 *
 * Some of the most useful coverage is structurally unreachable by any
 * collector: private Facebook groups, LinkedIn, a segment somebody saw on TV,
 * a print clip. Facebook killed public keyword search with CrowdTangle and
 * LinkedIn never had one, so no amount of engineering closes that gap — but
 * the analyst reading those groups can close it in ten seconds.
 *
 * These rows are ordinary digest_items: they flow into the archive, the
 * reports, the sentiment dials and the deck exactly like collected ones. The
 * only difference is provenance, which is recorded in `reason` so a report
 * never implies a machine found something a person did.
 */

export type ManualMentionInput = {
  url: string;
  title: string;
  source: string;
  sourceType?: string;
  label?: string;
  priority?: string;
  publishedAt?: string;
  snippet?: string;
  note?: string;
  sentiment?: string | null;
};

export type ManualMentionResult =
  | { ok: true; item: DigestItem }
  | { ok: false; error: string };

const LABELS: RelevanceLabel[] = [
  "confirmed_otb",
  "likely_otb",
  "related",
  "uncertain_i66_segment",
];
const SOURCE_TYPES = ["social", "news", "broadcast"];
const PRIORITIES = ["important", "normal", "low"];
const SENTIMENTS: SentimentValue[] = ["positive", "neutral", "negative"];

/** Marks provenance in the one field the deck already prints as "Relevance:". */
function provenanceReason(note: string): string {
  const base = "Added by an analyst (not machine-collected).";
  return note.trim() ? `${base} ${note.trim()}` : base;
}

const MAX_BATCH = 500;

type BuiltMention =
  | { ok: true; item: DigestItem; sentiment: SentimentValue | null }
  | { ok: false; error: string };

/** Platform name from a post link, for rows that leave "where" blank. */
function platformFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  const platforms: Array<[string, string]> = [
    ["facebook.com", "Facebook"],
    ["fb.com", "Facebook"],
    ["x.com", "X"],
    ["twitter.com", "X"],
    ["linkedin.com", "LinkedIn"],
    ["instagram.com", "Instagram"],
    ["threads.net", "Threads"],
    ["reddit.com", "Reddit"],
    ["bsky.app", "Bluesky"],
    ["tiktok.com", "TikTok"],
    ["youtube.com", "YouTube"],
    ["youtu.be", "YouTube"],
    ["nextdoor.com", "Nextdoor"],
  ];
  const match = platforms.find(
    ([domain]) => host === domain || host.endsWith(`.${domain}`),
  );
  return match ? match[1] : host;
}

/** First line of the post, trimmed to headline length. */
function titleFromSnippet(snippet: string): string {
  const firstLine = snippet.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const line = firstLine.trim();
  return line.length > 120 ? `${line.slice(0, 117).trim()}...` : line;
}

function normalizeSourceType(value: string | undefined): string {
  const type = (value ?? "").trim().toLowerCase();
  if (SOURCE_TYPES.includes(type)) return type;
  if (type.includes("tv") || type.includes("radio") || type.includes("broadcast")) {
    return "broadcast";
  }
  if (type.includes("news") || type.includes("online") || type.includes("print")) {
    return "news";
  }
  return "social";
}

function parsePublishedAt(value: string | undefined): string {
  const raw = (value ?? "").trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    // An empty or unparseable date means "now" rather than an error — the
    // point is to make logging a mention fast.
    return new Date().toISOString();
  }
  // A bare date ("9/22/2026") parses as midnight UTC, which is the evening
  // before in Eastern time and can drop a Monday post into the prior week.
  // Pin date-only values to midday instead.
  const hasTime = /\d:\d/.test(raw);
  return new Date(hasTime ? parsed : parsed + 16 * 60 * 60 * 1000).toISOString();
}

function buildManualMention(input: ManualMentionInput): BuiltMention {
  const url = (input.url ?? "").trim();
  const snippet = (input.snippet ?? "").trim();

  if (!url) {
    return { ok: false, error: "A link is required." };
  }
  try {
    new URL(url);
  } catch {
    return { ok: false, error: `"${url}" is not a valid link.` };
  }

  // Headline and source fall back to the post text and the platform, so a
  // row with just a link and the post's words is enough.
  const title = (input.title ?? "").trim() || titleFromSnippet(snippet);
  const source = (input.source ?? "").trim() || platformFromUrl(url);
  if (!title) {
    return { ok: false, error: "A headline or the post text is required." };
  }

  const label = LABELS.includes(input.label as RelevanceLabel)
    ? (input.label as RelevanceLabel)
    : // An analyst bothered to enter it, so it is relevant by construction.
      "confirmed_otb";
  const priority = PRIORITIES.includes((input.priority ?? "").trim().toLowerCase())
    ? ((input.priority ?? "").trim().toLowerCase() as DigestItem["priority"])
    : "normal";
  const sentiment = (input.sentiment ?? "").trim().toLowerCase();

  return {
    ok: true,
    item: {
      id: createStableId(url, title),
      title,
      url,
      source,
      sourceType: normalizeSourceType(input.sourceType),
      label,
      priority,
      reason: provenanceReason(input.note ?? ""),
      snippet,
      publishedAt: parsePublishedAt(input.publishedAt),
    },
    sentiment: SENTIMENTS.includes(sentiment as SentimentValue)
      ? (sentiment as SentimentValue)
      : null,
  };
}

async function storeMentions(
  mentions: Array<{ item: DigestItem; sentiment: SentimentValue | null }>,
): Promise<void> {
  await upsertCollectedItems(
    mentions.map((mention) => mention.item),
    new Date(),
  );

  // Stamped as 'manual', so the automatic scorer will never revisit it — the
  // analyst who logged the mention is the one who read it.
  for (const { item, sentiment } of mentions) {
    if (sentiment) {
      await setSentiment(item.id, sentiment);
    }
  }
}

export async function saveManualMention(
  input: ManualMentionInput,
): Promise<ManualMentionResult> {
  const built = buildManualMention(input);
  if (!built.ok) {
    return built;
  }
  await storeMentions([built]);
  return { ok: true, item: built.item };
}

export type BatchMentionResult =
  | {
      ok: true;
      added: number;
      duplicates: number;
      errors: Array<{ row: number; error: string }>;
    }
  | { ok: false; error: string };

/**
 * Save many analyst-found mentions at once. Valid rows are saved and bad rows
 * are reported by number (1-based, as the analyst sees them), so one typo
 * doesn't sink the batch. The same post listed twice is saved once.
 */
export async function saveManualMentions(
  inputs: ManualMentionInput[],
): Promise<BatchMentionResult> {
  if (inputs.length === 0) {
    return { ok: false, error: "No rows to add." };
  }
  if (inputs.length > MAX_BATCH) {
    return {
      ok: false,
      error: `That's ${inputs.length} rows; the limit is ${MAX_BATCH} per upload.`,
    };
  }

  const errors: Array<{ row: number; error: string }> = [];
  // Keyed by id: one upsert can't write the same row twice.
  const byId = new Map<string, { item: DigestItem; sentiment: SentimentValue | null }>();
  let duplicates = 0;

  inputs.forEach((input, index) => {
    const built = buildManualMention(input);
    if (!built.ok) {
      errors.push({ row: index + 1, error: built.error });
    } else if (byId.has(built.item.id)) {
      duplicates++;
    } else {
      byId.set(built.item.id, built);
    }
  });

  await storeMentions([...byId.values()]);
  return { ok: true, added: byId.size, duplicates, errors };
}
