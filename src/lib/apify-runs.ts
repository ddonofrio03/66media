import { getSupabase } from "@/lib/db";

/**
 * Bookkeeping for Apify actor runs we start but do not wait for.
 *
 * The Facebook watchlist scrape takes longer than any serverless request is
 * allowed to live (23 pages x 10 posts ran ~40s+ and was being killed mid-run,
 * which cost money and returned nothing). So the digest now *starts* the actor
 * and records the run here; the 10-minute poller drains the dataset once the
 * run finishes. The results are billed the moment Apify produces them, so
 * reading the dataset later is free — this table is what makes sure we
 * actually read it.
 *
 * Every function is a no-op when Supabase is not configured, matching
 * digest-store: without persistence the app still runs, it just cannot defer.
 */

export type PendingApifyRun = {
  runId: string;
  actor: string;
  provider: string;
  datasetId: string;
  startedAt: string;
};

/** Remember a run we started, so a later request knows to come back for it. */
export async function recordApifyRun(run: {
  runId: string;
  actor: string;
  provider: string;
  datasetId: string;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    console.warn(
      `[apify-runs] Supabase not configured; ${run.provider} run ${run.runId} ` +
        "will be billed but never read.",
    );
    return;
  }

  const { error } = await supabase.from("apify_runs").upsert(
    {
      run_id: run.runId,
      actor: run.actor,
      provider: run.provider,
      dataset_id: run.datasetId,
      started_at: new Date().toISOString(),
    },
    { onConflict: "run_id" },
  );

  if (error) {
    console.error("[apify-runs] recordApifyRun failed:", error.message);
  }
}

/**
 * Runs we started and have not yet read. Oldest first so a backlog drains in
 * the order it was created rather than starving the earliest run.
 */
export async function listPendingApifyRuns(
  limit = 10,
): Promise<PendingApifyRun[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("apify_runs")
    .select("run_id, actor, provider, dataset_id, started_at")
    .is("collected_at", null)
    .order("started_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[apify-runs] listPendingApifyRuns failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    runId: row.run_id as string,
    actor: row.actor as string,
    provider: row.provider as string,
    datasetId: row.dataset_id as string,
    startedAt: row.started_at as string,
  }));
}

/**
 * Mark a run read. Called for terminal runs of any status — a TIMED-OUT or
 * ABORTED run still has a partial dataset that was already paid for, and
 * leaving the row pending would mean re-fetching it on every poll forever.
 */
export async function markApifyRunCollected(
  runId: string,
  status: string,
  itemCount: number,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("apify_runs")
    .update({
      collected_at: new Date().toISOString(),
      status,
      item_count: itemCount,
    })
    .eq("run_id", runId);

  if (error) {
    console.error("[apify-runs] markApifyRunCollected failed:", error.message);
  }
}
