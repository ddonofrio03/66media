import { NextResponse } from "next/server";
import {
  buildDigestSnapshot,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest";
import { hasSentOn, markReported, recordSend } from "@/lib/digest-store";
import { sendEmail } from "@/lib/email";
import { monitoringConfig } from "@/lib/monitoring-config";
import { getNewYorkParts, isDigestSendWindow, isWeekday } from "@/lib/time";
import type { DigestSnapshot } from "@/lib/types";

function shownItemIds(snapshot: DigestSnapshot) {
  return [
    ...snapshot.important,
    ...snapshot.confirmed,
    ...snapshot.likely,
    ...(snapshot.broadcast ?? []),
    ...snapshot.social,
    ...snapshot.uncertain,
  ].map((item) => item.id);
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const local = getNewYorkParts(now);
  const allowManualRun = request.url.includes("manual=1");

  if (!allowManualRun && !isDigestSendWindow(now)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Outside the 6 AM America/New_York send window.",
      local,
    });
  }

  // Idempotency: if a digest already went out today, don't send a second one
  // (e.g. if both crons drift into the 6 AM hour). Manual runs bypass this.
  if (!allowManualRun && (await hasSentOn(local.dateKey))) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "A digest has already been sent for this date.",
      local,
    });
  }

  const snapshot = await buildDigestSnapshot();
  const weekday = isWeekday(local.weekday);
  const hasCriticalItems = snapshot.important.length > 0;

  if (!allowManualRun && !weekday && !hasCriticalItems) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Weekend routine digest suppressed; no critical items found.",
      local,
    });
  }

  const subject = snapshot.noRelevantCoverage
    ? `66EMP Daily Media Digest - ${local.dateKey} - No relevant coverage`
    : `66EMP Daily Media Digest - ${local.dateKey}`;

  const result = await sendEmail({
    subject,
    html: renderDigestHtml(snapshot),
    text: renderDigestText(snapshot),
  });

  // Only record/stamp once the email actually went out, so a failed send is
  // retried by the next invocation rather than being marked complete.
  if (!("skipped" in result) || !result.skipped) {
    await markReported(shownItemIds(snapshot), local.dateKey);
    await recordSend({
      dateKey: local.dateKey,
      isWeekend: !weekday,
      snapshot,
      recipients: monitoringConfig.recipients,
    });
  }

  return NextResponse.json({
    ok: true,
    local,
    noRelevantCoverage: snapshot.noRelevantCoverage,
    degradedProviders: snapshot.degradedProviders,
    newItems: snapshot.newItemsCount,
    email: result,
  });
}
