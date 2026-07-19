import { NextResponse } from "next/server";
import { refineClassifications } from "@/lib/ai-classify";
import { sendAlerts, shouldAlert } from "@/lib/alerts";
import { collectDigestItems } from "@/lib/collectors";
import { getExistingIds, upsertCollectedItems } from "@/lib/digest-store";
import { getMonitoringSettings } from "@/lib/monitoring-settings";
import { getSources } from "@/lib/sources";

/**
 * Near-real-time poller, invoked every ~10 minutes by a GitHub Actions
 * schedule (Vercel Hobby crons are daily-only). Flow:
 *
 *   collect (no social actors, no blanket AI pass)
 *     -> diff against digest_items to find genuinely-new items
 *     -> AI-refine only the new borderline ones
 *     -> upsert the new items (archive becomes near-real-time)
 *     -> push/email alerts for the high-signal subset
 *
 * The daily 6:30 AM digest is unchanged and still catches anything a poll
 * missed. Requires Supabase (new-item detection) — without it the poller
 * would re-alert the same stories forever, so it no-ops instead.
 *
 * Social (Apify) deliberately never runs here: those actors bill per result
 * and stay daily-only in the digest run.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[poll] CRON_SECRET is not configured; aborting.");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const sources = await getSources();
  const settings = await getMonitoringSettings();
  // ?social=1: manual verification runs only — also fire the pay-per-result
  // Apify actors (FB watchlist etc.) that normally run daily-digest-only.
  const includeSocial = request.url.includes("social=1");
  const collection = await collectDigestItems(sources, now, settings, {
    includeSocial,
    refine: false,
  });

  const existingIds = await getExistingIds(
    collection.items.map((item) => item.id),
  );
  if (existingIds === null) {
    console.warn("[poll] Supabase not configured; poller is a no-op.");
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Supabase persistence is required for real-time polling.",
    });
  }

  const newItems = collection.items.filter((item) => !existingIds.has(item.id));
  if (newItems.length === 0) {
    console.log(
      `[poll] No new items (${collection.items.length} collected, all previously seen).`,
    );
    return NextResponse.json({
      ok: true,
      collected: collection.items.length,
      newItems: 0,
      alerts: 0,
      degradedProviders: collection.degradedProviders,
    });
  }

  // AI second-opinion on just the new items (borderline ones only get sent;
  // may drop false positives before they're stored or alerted).
  const refined = await refineClassifications(newItems);
  await upsertCollectedItems(refined, now);

  const alertable = refined.filter(shouldAlert);
  const result = await sendAlerts(alertable);

  console.log(
    `[poll] ${collection.items.length} collected, ${refined.length} new, ` +
      `${alertable.length} alertable -> ${result.sent} sent via ${result.channel}.`,
  );

  return NextResponse.json({
    ok: true,
    collected: collection.items.length,
    newItems: refined.length,
    alerts: result.sent,
    alertChannel: result.channel,
    degradedProviders: collection.degradedProviders,
  });
}
