import { sendEmail } from "@/lib/email";
import type { DigestItem } from "@/lib/types";

/**
 * Near-real-time alert delivery for the 10-minute poller.
 *
 * Channel selection: Pushover when PUSHOVER_APP_TOKEN + PUSHOVER_USER_KEY are
 * configured (instant phone push, per-item with a tap-through link); otherwise
 * falls back to one combined email via the existing Resend setup, so alerting
 * works the moment the poller ships with zero new credentials.
 */

const MAX_PUSHES_PER_RUN = 5;

/** Which new items warrant an immediate alert (vs. waiting for the digest). */
export function shouldAlert(item: DigestItem): boolean {
  return (
    item.priority === "important" ||
    item.label === "confirmed_otb" ||
    (item.sourceType === "broadcast" && item.label === "likely_otb")
  );
}

export async function sendAlerts(
  items: DigestItem[],
): Promise<{ channel: "pushover" | "email" | "none"; sent: number }> {
  if (items.length === 0) {
    return { channel: "none", sent: 0 };
  }

  const token = process.env.PUSHOVER_APP_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (token && user) {
    return sendPushover(items, token, user);
  }

  return sendAlertEmail(items);
}

async function sendPushover(
  items: DigestItem[],
  token: string,
  user: string,
): Promise<{ channel: "pushover"; sent: number }> {
  const toPush = items.slice(0, MAX_PUSHES_PER_RUN);
  const overflow = items.length - toPush.length;
  let sent = 0;

  for (const [index, item] of toPush.entries()) {
    const isLast = index === toPush.length - 1;
    const suffix =
      isLast && overflow > 0 ? ` (+${overflow} more in the archive)` : "";
    try {
      const response = await fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          user,
          title: `66EMP: ${item.source}`,
          message: `${item.title}${suffix}`,
          url: item.url,
          url_title: "Open story",
          priority: item.priority === "important" ? 1 : 0,
        }),
        cache: "no-store",
      });
      if (response.ok) {
        sent++;
      } else {
        console.error(
          `[alerts] Pushover responded ${response.status}: ${await response.text()}`,
        );
      }
    } catch (error) {
      console.error("[alerts] Pushover send failed:", error);
    }
  }

  return { channel: "pushover", sent };
}

async function sendAlertEmail(
  items: DigestItem[],
): Promise<{ channel: "email" | "none"; sent: number }> {
  const lead = items[0];
  const subject =
    items.length === 1
      ? `66EMP Alert: ${truncate(lead.title, 90)}`
      : `66EMP Alert: ${items.length} new mentions (${truncate(lead.title, 60)}...)`;

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #dce3e0;">
            <div style="font-size:12px;color:#66706d;font-weight:bold;">
              ${escapeHtml(item.source)} · ${escapeHtml(item.sourceType)}${item.priority === "important" ? " · IMPORTANT" : ""}
            </div>
            <a href="${escapeHtml(item.url)}" target="_blank" style="font-size:15px;font-weight:bold;color:#134e4a;">
              ${escapeHtml(item.title)}
            </a>
            ${item.snippet ? `<div style="font-size:13px;color:#17211f;margin-top:4px;">${escapeHtml(truncate(item.snippet, 240))}</div>` : ""}
          </td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;">
      <p style="font-size:13px;color:#66706d;">New coverage detected by the 66 Media Monitor real-time poller:</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;
  const text = items
    .map((item) => `${item.source}: ${item.title}\n${item.url}`)
    .join("\n\n");

  try {
    const result = await sendEmail({ subject, html, text });
    if ("skipped" in result && result.skipped) {
      console.warn("[alerts] Email alert skipped:", result.reason);
      return { channel: "none", sent: 0 };
    }
    return { channel: "email", sent: items.length };
  } catch (error) {
    console.error("[alerts] Email alert failed:", error);
    return { channel: "none", sent: 0 };
  }
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
