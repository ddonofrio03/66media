import { monitoringConfig } from "@/lib/monitoring-config";
import type { DigestItem, DigestSnapshot } from "@/lib/types";

function createPlaceholderItems(): DigestItem[] {
  return [];
}

export async function buildDigestSnapshot(): Promise<DigestSnapshot> {
  const collectedItems = createPlaceholderItems();

  const important = collectedItems.filter((item) => item.priority === "important");
  const confirmed = collectedItems.filter((item) => item.label === "confirmed_otb");
  const likely = collectedItems.filter((item) => item.label === "likely_otb");
  const social = collectedItems.filter((item) => item.sourceType === "social");
  const uncertain = collectedItems.filter(
    (item) => item.label === "uncertain_i66_segment",
  );

  return {
    generatedAt: new Date().toISOString(),
    windowLabel: "last 24-36 hours",
    recipients: monitoringConfig.recipients,
    important,
    confirmed,
    likely,
    social,
    uncertain,
    suppressedCount: 0,
    noRelevantCoverage: collectedItems.length === 0,
  };
}

export function renderDigestHtml(snapshot: DigestSnapshot) {
  const sections = [
    ["Important / Needs Review", snapshot.important],
    ["Confirmed 66 Outside the Beltway", snapshot.confirmed],
    ["Likely 66 Outside the Beltway", snapshot.likely],
    ["Reddit and Public Social", snapshot.social],
    ["Uncertain / Possible Matches", snapshot.uncertain],
  ] as const;

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f7f8f8;color:#17211f;font-family:Arial,sans-serif;">
    <main style="max-width:720px;margin:0 auto;padding:28px 20px;">
      <h1 style="font-size:24px;line-height:1.2;margin:0 0 8px;">66EMP Daily Media Digest</h1>
      <p style="color:#66706d;margin:0 0 24px;">Monitoring window: ${escapeHtml(snapshot.windowLabel)}</p>
      ${
        snapshot.noRelevantCoverage
          ? `<section style="background:#fff;border:1px solid #dce3e0;border-radius:8px;padding:20px;">
              <h2 style="font-size:18px;margin:0 0 8px;">No relevant coverage found</h2>
              <p style="margin:0;color:#66706d;">No confirmed, likely, or uncertain 66EMP-relevant media items were found for this monitoring window.</p>
            </section>`
          : sections
              .filter(([, items]) => items.length > 0)
              .map(([title, items]) => renderSection(title, items))
              .join("")
      }
      <p style="color:#66706d;font-size:12px;margin-top:24px;">Suppressed noise count: ${snapshot.suppressedCount}</p>
    </main>
  </body>
</html>`;
}

export function renderDigestText(snapshot: DigestSnapshot) {
  if (snapshot.noRelevantCoverage) {
    return [
      "66EMP Daily Media Digest",
      "",
      `Monitoring window: ${snapshot.windowLabel}`,
      "",
      "No relevant coverage found.",
    ].join("\n");
  }

  return [
    "66EMP Daily Media Digest",
    "",
    `Monitoring window: ${snapshot.windowLabel}`,
    `Suppressed noise count: ${snapshot.suppressedCount}`,
  ].join("\n");
}

function renderSection(title: string, items: DigestItem[]) {
  return `<section style="background:#fff;border:1px solid #dce3e0;border-radius:8px;padding:20px;margin-bottom:16px;">
    <h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(title)}</h2>
    ${items.map(renderItem).join("")}
  </section>`;
}

function renderItem(item: DigestItem) {
  return `<article style="border-top:1px solid #dce3e0;padding-top:12px;margin-top:12px;">
    <h3 style="font-size:16px;margin:0 0 6px;"><a href="${escapeHtml(item.url)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(item.title)}</a></h3>
    <p style="color:#66706d;font-size:13px;margin:0 0 6px;">${escapeHtml(item.source)} · ${escapeHtml(item.publishedAt)} · ${escapeHtml(item.reason)}</p>
    <p style="margin:0;line-height:1.45;">${escapeHtml(item.snippet)}</p>
  </article>`;
}

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
