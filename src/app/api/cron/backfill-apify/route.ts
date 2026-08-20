import { NextResponse } from "next/server";
import { refineClassifications } from "@/lib/ai-classify";
import { scoreAndStoreSentiment } from "@/lib/sentiment";
import { classifyBackfillItems } from "@/lib/collectors";
import { backfillFacebookRuns } from "@/lib/social";
import { upsertCollectedItems } from "@/lib/digest-store";
import { getMonitoringSettings } from "@/lib/monitoring-settings";
import { getSources } from "@/lib/sources";

/**
 * One-shot recovery of Facebook posts Apify already scraped and billed for but
 * that never reached the archive.
 *
 * Between 08-11 and 08-20 every watchlist run was killed at 40 seconds and its
 * dataset thrown away unread. The datasets survive in Apify, so this walks the
 * actor's run history, pulls them back, and pushes them through the normal
 * classify + upsert path.
 *
 * Two deliberate differences from the live pipeline:
 *   - NO time-window filter. The whole point is items older than the 36-hour
 *     lookback, which every live path would drop.
 *   - NO alerts. Week-old posts are not news; they belong in the archive and
 *     the reports, not on your phone.
 *
 * Safe to run more than once — items carry stable ids, so a repeat run
 * re-upserts the same rows instead of duplicating them.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "7");
  const sinceDays = Number.isFinite(days) && days > 0 ? Math.min(days, 30) : 7;

  const now = new Date();
  const [sources, settings] = await Promise.all([
    getSources(),
    getMonitoringSettings(),
  ]);

  const { items, runs, rawPosts } = await backfillFacebookRuns(sinceDays);
  if (items.length === 0) {
    return NextResponse.json({
      ok: true,
      sinceDays,
      runsRead: runs,
      rawPosts,
      relevant: 0,
      note:
        runs === 0
          ? "No terminal Facebook runs in range (or SOCIAL_ENABLED/APIFY_TOKEN unset)."
          : "Runs were read but held no usable posts.",
    });
  }

  const classified = classifyBackfillItems(items, sources, settings);
  const refined = await refineClassifications(classified);
  await upsertCollectedItems(refined, now);
  await scoreAndStoreSentiment(refined);

  console.log(
    `[backfill] ${runs} runs, ${rawPosts} raw posts -> ${items.length} mapped ` +
      `-> ${refined.length} relevant, stored.`,
  );

  return NextResponse.json({
    ok: true,
    sinceDays,
    runsRead: runs,
    rawPosts,
    mapped: items.length,
    relevant: refined.length,
    byLabel: refined.reduce<Record<string, number>>((acc, item) => {
      acc[item.label] = (acc[item.label] ?? 0) + 1;
      return acc;
    }, {}),
  });
}
