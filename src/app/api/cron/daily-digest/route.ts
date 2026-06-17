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
    // Misconfiguration, not a transient failure: the cron will keep 500ing
    // (and no digest will ever send) until CRON_SECRET is set on the project.
    console.error(
      "[daily-digest] CRON_SECRET is not configured; aborting with 500. " +
        "Set CRON_SECRET in the project's environment variables and redeploy.",
    );
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    console.warn(
      "[daily-digest] Unauthorized request (missing or mismatched Bearer token).",
    );
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const local = getNewYorkParts(now);
  const allowManualRun = request.url.includes("manual=1");

  if (!allowManualRun && !isDigestSendWindow(now)) {
    console.log(
      `[daily-digest] Skipped: outside the 6 AM America/New_York send window ` +
        `(local hour ${local.hour}:${String(local.minute).padStart(2, "0")}, ${local.dateKey}).`,
    );
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
    console.log(
      `[daily-digest] Skipped: a digest has already been sent for ${local.dateKey}.`,
    );
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
    console.log(
      `[daily-digest] Skipped: weekend routine digest suppressed; no critical items found (${local.dateKey}).`,
    );
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

  if (snapshot.degradedProviders?.length) {
    console.warn(
      `[daily-digest] Degraded providers for ${local.dateKey}: ${snapshot.degradedProviders.join(", ")}.`,
    );
  }

  const result = await sendEmail({
    subject,
    html: renderDigestHtml(snapshot),
    text: renderDigestText(snapshot),
  });

  // Only record/stamp once the email actually went out, so a failed send is
  // retried by the next invocation rather than being marked complete.
  if (!("skipped" in result) || !result.skipped) {
    console.log(
      `[daily-digest] Sent digest for ${local.dateKey} to ${monitoringConfig.recipients.length} recipient(s); ${snapshot.newItemsCount} new item(s).`,
    );
    await markReported(shownItemIds(snapshot), local.dateKey);
    await recordSend({
      dateKey: local.dateKey,
      isWeekend: !weekday,
      snapshot,
      recipients: monitoringConfig.recipients,
    });
  } else {
    // Email was not sent (e.g. RESEND_API_KEY missing). Don't stamp it as sent,
    // and make the reason visible instead of failing silently.
    console.error(
      `[daily-digest] Email NOT sent for ${local.dateKey}: ${result.reason ?? "unknown reason"}.`,
    );
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
