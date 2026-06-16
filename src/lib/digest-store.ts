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
  let query = supabase
    .from("digest_items")
    .select(
      "id, title, url, source, source_type, label, priority, snippet, published_at, first_seen_at",
    )
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit + 1);

  if (opts.since) {
    query = query.gte("published_at", opts.since);
  }

  const term = (opts.q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
  if (term) {
    query = query.or(
      `title.ilike.%${term}%,source.ilike.%${term}%,snippet.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[digest-store] getArchiveItems failed:", error.message);
    return { items: [], truncated: false };
  }

  const rows = data ?? [];
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
  }));

  return { items, truncated };
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
