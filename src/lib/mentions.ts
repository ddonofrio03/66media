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

export async function saveManualMention(
  input: ManualMentionInput,
): Promise<ManualMentionResult> {
  const url = (input.url ?? "").trim();
  const title = (input.title ?? "").trim();
  const source = (input.source ?? "").trim();

  if (!url || !title || !source) {
    return { ok: false, error: "A link, a headline and a source are required." };
  }
  try {
    new URL(url);
  } catch {
    return { ok: false, error: `"${url}" is not a valid link.` };
  }

  const label = LABELS.includes(input.label as RelevanceLabel)
    ? (input.label as RelevanceLabel)
    : // An analyst bothered to enter it, so it is relevant by construction.
      "confirmed_otb";
  const sourceType = SOURCE_TYPES.includes(input.sourceType ?? "")
    ? (input.sourceType as string)
    : "social";
  const priority = PRIORITIES.includes(input.priority ?? "")
    ? (input.priority as DigestItem["priority"])
    : "normal";

  // An empty or unparseable date means "now" rather than an error — the point
  // is to make logging a mention fast.
  const parsed = input.publishedAt ? Date.parse(input.publishedAt) : NaN;
  const publishedAt = Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();

  const item: DigestItem = {
    id: createStableId(url, title),
    title,
    url,
    source,
    sourceType,
    label,
    priority,
    reason: provenanceReason(input.note ?? ""),
    snippet: (input.snippet ?? "").trim(),
    publishedAt,
  };

  await upsertCollectedItems([item], new Date());

  // Stamped as 'manual', so the automatic scorer will never revisit it — the
  // analyst who logged the mention is the one who read it.
  const sentiment = input.sentiment;
  if (sentiment && SENTIMENTS.includes(sentiment as SentimentValue)) {
    await setSentiment(item.id, sentiment as SentimentValue);
  }

  return { ok: true, item };
}
