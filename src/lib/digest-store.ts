import { getSupabase } from "@/lib/db";
import type { DigestItem, DigestSnapshot } from "@/lib/types";

/**
 * Persistence helpers for the digest pipeline. Every function is a no-op (or
 * returns an empty/neutral value) when Supabase is not configured, so the app
 * runs identically with or without a database.
 */

/** reported_on (Eastern date_key) per item id, for items we've already emailed. */
export async function getReportedMap(
  ids: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("digest_items")
    .select("id, reported_on")
    .in("id", ids);

  if (error) {
    console.error("[digest-store] getReportedMap failed:", error.message);
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.id as string, (row.reported_on as string | null) ?? null);
  }
  return map;
}

/**
 * Which of these ids already exist in digest_items. Used by the real-time
 * poller to detect genuinely-new items (returns null when Supabase is not
 * configured, so the caller can tell "no persistence" apart from "all new").
 */
export async function getExistingIds(
  ids: string[],
): Promise<Set<string> | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return null;
  }
  if (ids.length === 0) {
    return new Set();
  }

  const { data, error } = await supabase
    .from("digest_items")
    .select("id")
    .in("id", ids);

  if (error) {
    console.error("[digest-store] getExistingIds failed:", error.message);
    // Fail closed: treating everything as "existing" prevents duplicate
    // alerts; the daily digest still catches anything a failed poll missed.
    return new Set(ids);
  }

  return new Set((data ?? []).map((row) => row.id as string));
}

/**
 * Upsert collected items. Deliberately omits `reported_on` from the payload so
 * an existing item's reported date is preserved across runs; only `last_seen_at`
 * and the mutable display fields are refreshed.
 */
export async function upsertCollectedItems(
  items: DigestItem[],
  now: Date,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || items.length === 0) {
    return;
  }

  const seenAt = now.toISOString();
  const rows = items.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    source_type: item.sourceType,
    label: item.label,
    priority: item.priority,
    reason: item.reason,
    snippet: item.snippet,
    published_at: item.publishedAt,
    last_seen_at: seenAt,
  }));

  const { error } = await supabase
    .from("digest_items")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("[digest-store] upsertCollectedItems failed:", error.message);
  }
}

/** Stamp the items that actually went out in today's digest as reported. */
export async function markReported(
  ids: string[],
  dateKey: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("digest_items")
    .update({ reported_on: dateKey })
    .in("id", ids)
    .is("reported_on", null);

  if (error) {
    console.error("[digest-store] markReported failed:", error.message);
  }
}

/** Once-per-day idempotency guard. */
export async function hasSentOn(dateKey: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase
    .from("digest_sends")
    .select("date_key")
    .eq("date_key", dateKey)
    .maybeSingle();

  if (error) {
    console.error("[digest-store] hasSentOn failed:", error.message);
    return false;
  }

  return Boolean(data);
}

export async function recordSend(record: {
  dateKey: string;
  isWeekend: boolean;
  snapshot: DigestSnapshot;
  recipients: string[];
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    return;
  }

  const { snapshot } = record;
  const { error } = await supabase.from("digest_sends").upsert(
    {
      date_key: record.dateKey,
      is_weekend: record.isWeekend,
      no_relevant_coverage: snapshot.noRelevantCoverage,
      total_items: snapshot.totalRelevantCount,
      important_count: snapshot.important.length,
      new_items: snapshot.newItemsCount ?? snapshot.totalRelevantCount,
      degraded_providers: snapshot.degradedProviders ?? [],
      recipients: record.recipients,
      snapshot,
    },
    { onConflict: "date_key" },
  );

  if (error) {
    console.error("[digest-store] recordSend failed:", error.message);
  }
}

export type ArchiveItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceType: string;
  label: string;
  priority: string;
  snippet: string;
  publishedAt: string | null;
  firstSeenAt: string | null;
  feedback: string | null;
  sentiment: string | null;
  sentimentSource: string | null;
};

/**
 * Stories for the archive, newest first. `q` does a case-insensitive match on
 * title/source/snippet; `since` is an ISO lower bound on published_at. Returns
 * one extra row beyond `limit` internally to report truncation.
 */
export async function getArchiveItems(opts: {
  q?: string;
  since?: string;
  limit?: number;
}): Promise<{ items: ArchiveItem[]; truncated: boolean }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { items: [], truncated: false };
  }

  const limit = opts.limit ?? 500;
  const term = (opts.q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
  const runQuery = (columns: string) => {
    let query = supabase
      .from("digest_items")
      .select(columns)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit + 1);
    if (opts.since) {
      query = query.gte("published_at", opts.since);
    }
    if (term) {
      query = query.or(
        `title.ilike.%${term}%,source.ilike.%${term}%,snippet.ilike.%${term}%`,
      );
    }
    return query;
  };

  const { data, error } = await selectWithOptionalColumns(
    runQuery,
    "id, title, url, source, source_type, label, priority, snippet, published_at, first_seen_at",
  );
  if (error) {
    console.error("[digest-store] getArchiveItems failed:", error.message);
    return { items: [], truncated: false };
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const truncated = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    source: row.source as string,
    sourceType: row.source_type as string,
    label: row.label as string,
    priority: row.priority as string,
    snippet: (row.snippet as string | null) ?? "",
    publishedAt: (row.published_at as string | null) ?? null,
    firstSeenAt: (row.first_seen_at as string | null) ?? null,
    feedback: (row.feedback as string | null) ?? null,
    sentiment: (row.sentiment as string | null) ?? null,
    sentimentSource: (row.sentiment_source as string | null) ?? null,
  }));

  return { items, truncated };
}

/**
 * Persist a thumbs up/down vote (null clears). Fails softly with a hint until
 * the feedback migration has been run in the Supabase SQL editor.
 */
export async function setFeedback(
  id: string,
  feedback: "up" | "down" | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const { error } = await supabase
    .from("digest_items")
    .update({
      feedback,
      feedback_at: feedback ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) {
    console.error("[digest-store] setFeedback failed:", error.message);
    const hint = error.message.includes("feedback")
      ? " (has the feedback migration been run in the Supabase SQL editor?)"
      : "";
    return { ok: false, error: `${error.message}${hint}` };
  }
  return { ok: true };
}

export type SentimentValue = "positive" | "neutral" | "negative";

/**
 * Persist an analyst's sentiment call (null clears). Always stamps
 * sentiment_source='manual', which permanently excludes the row from automatic
 * re-scoring — a human judgment is never silently reverted by a later AI pass.
 */
export async function setSentiment(
  id: string,
  sentiment: SentimentValue | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const { error } = await supabase
    .from("digest_items")
    .update({
      sentiment,
      // Clearing drops back to unscored, not back to the AI's guess: the next
      // scoring pass will pick the story up again.
      sentiment_source: sentiment ? "manual" : null,
      sentiment_at: sentiment ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) {
    console.error("[digest-store] setSentiment failed:", error.message);
    const hint = error.message.includes("sentiment")
      ? " (has the sentiment migration been run in the Supabase SQL editor?)"
      : "";
    return { ok: false, error: `${error.message}${hint}` };
  }
  return { ok: true };
}

/**
 * Of these ids, the ones with no sentiment recorded yet. Rows an analyst has
 * scored by hand are never returned, so the AI pass cannot overwrite them.
 * Returns an empty set (score nothing) if the migration hasn't run.
 */
export async function getUnscoredIds(ids: string[]): Promise<Set<string>> {
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) {
    return new Set();
  }

  const { data, error } = await supabase
    .from("digest_items")
    .select("id, sentiment")
    .in("id", ids)
    .is("sentiment", null);

  if (error) {
    // Expected until the migration runs; scoring is skipped entirely.
    return new Set();
  }

  return new Set((data ?? []).map((row) => row.id as string));
}

/**
 * Write AI-scored sentiment. Guarded on sentiment_source so a manual call made
 * between scoring and writing still wins the race.
 */
export async function storeAutoSentiment(
  scores: Array<{ id: string; sentiment: SentimentValue }>,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || scores.length === 0) {
    return;
  }

  const scoredAt = new Date().toISOString();
  const byValue = new Map<SentimentValue, string[]>();
  for (const { id, sentiment } of scores) {
    byValue.set(sentiment, [...(byValue.get(sentiment) ?? []), id]);
  }

  // One update per distinct value (at most three) rather than per item.
  for (const [sentiment, ids] of byValue) {
    const { error } = await supabase
      .from("digest_items")
      .update({
        sentiment,
        sentiment_source: "auto",
        sentiment_at: scoredAt,
      })
      .in("id", ids)
      // NOT `.neq(...)`: SQL `sentiment_source <> 'manual'` is NULL for
      // never-scored rows, which would exclude the very rows we mean to fill.
      .or("sentiment_source.is.null,sentiment_source.neq.manual");

    if (error) {
      console.error("[digest-store] storeAutoSentiment failed:", error.message);
      return;
    }
  }
}

/**
 * Recent thumbs-up/down story titles, used as analyst examples in the AI
 * classifier prompt. Returns empty lists until the migration exists.
 */
export async function getFeedbackExamples(): Promise<{
  up: string[];
  down: string[];
}> {
  const supabase = getSupabase();
  if (!supabase) {
    return { up: [], down: [] };
  }

  const { data, error } = await supabase
    .from("digest_items")
    .select("title, feedback")
    .not("feedback", "is", null)
    .order("feedback_at", { ascending: false })
    .limit(40);

  if (error) {
    // Expected until the migration runs; never block classification on it.
    return { up: [], down: [] };
  }

  const up: string[] = [];
  const down: string[] = [];
  for (const row of data ?? []) {
    const bucket = row.feedback === "up" ? up : down;
    if (bucket.length < 8) {
      bucket.push(row.title as string);
    }
  }
  return { up, down };
}

/**
 * Optional analyst columns, richest first. Each has its own migration, so a
 * database may have any prefix of these applied.
 */
const OPTIONAL_COLUMN_SETS = [
  ", feedback, sentiment, sentiment_source",
  ", feedback",
  "",
];

function isMissingOptionalColumn(message: string): boolean {
  return message.includes("feedback") || message.includes("sentiment");
}

/**
 * Run an item select with the optional analyst columns, degrading to a smaller
 * column list when a migration hasn't been applied yet — so pages keep working
 * either way.
 */
async function selectWithOptionalColumns(
  run: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  baseColumns: string,
): Promise<{ data: unknown; error: { message: string } | null }> {
  let result: { data: unknown; error: { message: string } | null } = {
    data: null,
    error: { message: "no column set attempted" },
  };
  for (const extra of OPTIONAL_COLUMN_SETS) {
    result = await run(`${baseColumns}${extra}`);
    if (!result.error || !isMissingOptionalColumn(result.error.message)) {
      return result;
    }
  }
  return result;
}

/** Social posts from the archive, newest first, for the /social tab. */
export async function getSocialItems(opts: {
  since?: string;
  limit?: number;
}): Promise<ArchiveItem[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return [];
  }

  const runQuery = (columns: string) => {
    let query = supabase
      .from("digest_items")
      .select(columns)
      .eq("source_type", "social")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(opts.limit ?? 300);
    if (opts.since) {
      query = query.gte("published_at", opts.since);
    }
    return query;
  };

  const { data, error } = await selectWithOptionalColumns(
    runQuery,
    "id, title, url, source, source_type, label, priority, snippet, published_at, first_seen_at",
  );
  if (error) {
    console.error("[digest-store] getSocialItems failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    source: row.source as string,
    sourceType: row.source_type as string,
    label: row.label as string,
    priority: row.priority as string,
    snippet: (row.snippet as string | null) ?? "",
    publishedAt: (row.published_at as string | null) ?? null,
    firstSeenAt: (row.first_seen_at as string | null) ?? null,
    feedback: (row.feedback as string | null) ?? null,
    sentiment: (row.sentiment as string | null) ?? null,
    sentimentSource: (row.sentiment_source as string | null) ?? null,
  }));
}

/** Latest stored snapshot, for the dashboard/preview to render without a live fetch. */
export async function getLatestStoredSnapshot(): Promise<DigestSnapshot | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("digest_sends")
    .select("snapshot")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[digest-store] getLatestStoredSnapshot failed:", error.message);
    return null;
  }

  return (data?.snapshot as DigestSnapshot | undefined) ?? null;
}
