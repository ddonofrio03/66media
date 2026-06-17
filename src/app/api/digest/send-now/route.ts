import {
  buildDigestSnapshot,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest";
import { markReported, recordSend } from "@/lib/digest-store";
import { sendEmail } from "@/lib/email";
import { monitoringConfig } from "@/lib/monitoring-config";
import { getNewYorkParts, isWeekday } from "@/lib/time";
import type { DigestSnapshot } from "@/lib/types";

/**
 * On-demand digest send for humans. Unlike /api/cron/daily-digest (which is
 * driven by Vercel's scheduler and authenticated with CRON_SECRET), this route
 * is reached from a browser and is protected by the site-wide Basic Auth gate
 * in proxy.ts — so no secret needs to be copied around. GET shows a confirm
 * button; POST builds the current digest and emails it immediately, bypassing
 * the 6 AM send window.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Send digest now</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:38rem;margin:4rem auto;padding:0 1.25rem;color:#111;line-height:1.55}h1{font-size:1.4rem;margin-bottom:.5rem}button{font-size:1rem;padding:.7rem 1.2rem;border:0;border-radius:.5rem;background:#111;color:#fff;cursor:pointer}button:hover{background:#333}.note{color:#555;font-size:.92rem}.ok{color:#0a7d28}.err{color:#b00020;white-space:pre-wrap}a{color:#0a58ca}</style></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET() {
  return page(`
    <h1>Send the 66EMP digest now</h1>
    <p class="note">This builds the current digest from live sources and emails it
    immediately to ${monitoringConfig.recipients.length} recipient(s), bypassing the
    6&nbsp;AM schedule. Use it for an on-demand send or a test.</p>
    <form method="post"><button type="submit">Send the digest now</button></form>
  `);
}

export async function POST() {
  const now = new Date();
  const local = getNewYorkParts(now);
  const weekday = isWeekday(local.weekday);

  try {
    const snapshot = await buildDigestSnapshot();
    const subject = snapshot.noRelevantCoverage
      ? `66EMP Daily Media Digest - ${local.dateKey} - No relevant coverage`
      : `66EMP Daily Media Digest - ${local.dateKey}`;

    const result = await sendEmail({
      subject,
      html: renderDigestHtml(snapshot),
      text: renderDigestText(snapshot),
    });

    if ("skipped" in result && result.skipped) {
      console.error(
        `[send-now] Email NOT sent: ${result.reason ?? "unknown reason"}.`,
      );
      return page(
        `<h1 class="err">Not sent</h1>
         <p class="err">${escapeHtml(result.reason ?? "Unknown reason.")}</p>
         <p class="note">Set RESEND_API_KEY in the project's environment variables, redeploy, then <a href="">try again</a>.</p>`,
        500,
      );
    }

    console.log(
      `[send-now] Sent digest for ${local.dateKey} to ${monitoringConfig.recipients.length} recipient(s); ${snapshot.newItemsCount} new item(s).`,
    );
    await markReported(shownItemIds(snapshot), local.dateKey);
    await recordSend({
      dateKey: local.dateKey,
      isWeekend: !weekday,
      snapshot,
      recipients: monitoringConfig.recipients,
    });

    return page(`
      <h1 class="ok">Sent &#10003;</h1>
      <p>The digest for ${local.dateKey} was emailed to ${monitoringConfig.recipients.length} recipient(s).</p>
      <p class="note">${snapshot.newItemsCount} new item(s) included. You can close this tab.</p>
    `);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[send-now] Failed: ${message}`);
    return page(
      `<h1 class="err">Send failed</h1>
       <p class="err">${escapeHtml(message)}</p>
       <p class="note"><a href="">Try again</a></p>`,
      500,
    );
  }
}
