import { NextResponse } from "next/server";
import {
  buildDigestSnapshot,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest";
import { sendEmail } from "@/lib/email";
import { getNewYorkParts, isDigestSendWindow, isWeekday } from "@/lib/time";

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
      reason: "Not the 6:30 AM America/New_York send window.",
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

  return NextResponse.json({
    ok: true,
    local,
    noRelevantCoverage: snapshot.noRelevantCoverage,
    email: result,
  });
}
