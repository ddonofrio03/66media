import { NextResponse } from "next/server";
import { refineClassifications } from "@/lib/ai-classify";
import { scoreAndStoreSentiment } from "@/lib/sentiment";
import { sendAlerts, shouldAlert } from "@/lib/alerts";
import { collectDigestItems } from "@/lib/collectors";
import { isXOfficialEnabled } from "@/lib/x-official";
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

  // Which optional social sources are configured — surfaced so a verification
  // run can positively confirm "enabled and returning N raw posts" vs.
  // "credential missing" (both otherwise look like silent zeroes).
  const socialConfig = {
    xOfficial: isXOfficialEnabled(),
    bluesky: Boolean(
      process.env.BLUESKY_IDENTIFIER && process.env.BLUESKY_APP_PASSWORD,
    ),
    apifyActors:
      process.env.SOCIAL_ENABLED === "true" && Boolean(process.env.APIFY_TOKEN),
    fbWatchlist: process.env.FB_WATCHLIST === "true",
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    pushover: Boolean(
      process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_KEY,
    ),
  };

  // Also logged (not just returned) so configuration is verifiable from
  // Vercel runtime logs even when the GitHub Actions UI/API is unavailable.
  console.log(
    `[poll] config ${JSON.stringify(socialConfig)} providers ${JSON.stringify(collection.providerCounts)}`,
  );

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
      providerCounts: collection.providerCounts,
      socialConfig,
    });
  }

  // AI second-opinion on just the new items (borderline ones only get sent;
  // may drop false positives before they're stored or alerted).
  const refined = await refineClassifications(newItems);
  await upsertCollectedItems(refined, now);
  await scoreAndStoreSentiment(refined);

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
    providerCounts: collection.providerCounts,
    socialConfig,
  });
}
