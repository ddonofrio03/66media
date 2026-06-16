import { collectDigestItems } from "@/lib/collectors";
import {
  getLatestStoredSnapshot,
  getReportedMap,
  upsertCollectedItems,
} from "@/lib/digest-store";
import { monitoringConfig } from "@/lib/monitoring-config";
import { getMonitoringSettings } from "@/lib/monitoring-settings";
import { getSources } from "@/lib/sources";
import { getDigestLookbackHours } from "@/lib/time";
import type { DigestItem, DigestSnapshot } from "@/lib/types";

/**
 * Runs a live collection and builds the digest the cron job will email. When
 * Supabase is configured it persists everything collected and suppresses items
 * already reported in a previous digest (critical/`important` items always pass
 * through). This performs live external fetches, so the dashboard/preview should
 * use {@link loadDashboardSnapshot} instead.
 */
export async function buildDigestSnapshot(): Promise<DigestSnapshot> {
  const now = new Date();
  const sources = await getSources();
  const settings = await getMonitoringSettings();
  const collection = await collectDigestItems(sources, now, settings);
  const collectedItems = collection.items;

  const reportedMap = await getReportedMap(
    collectedItems.map((item) => item.id),
  );
  await upsertCollectedItems(collectedItems, now);

  // An item is shown if it's critical or has never been emailed before.
  const shown = collectedItems.filter(
    (item) => item.priority === "important" || !reportedMap.get(item.id),
  );
  const repeatedItemsCount = collectedItems.length - shown.length;
  const newItemsCount = shown.filter((item) => !reportedMap.get(item.id)).length;

  const important = shown.filter((item) => item.priority === "important");
  const confirmed = shown.filter(
    (item) =>
      item.priority !== "important" &&
      item.sourceType !== "social" &&
      item.sourceType !== "broadcast" &&
      item.label === "confirmed_otb",
  );
  const likely = shown.filter(
    (item) =>
      item.priority !== "important" &&
      item.sourceType !== "social" &&
      item.sourceType !== "broadcast" &&
      item.label === "likely_otb",
  );
  // TV & radio (direct station feeds + YouTube segments), kept together in
  // their own section regardless of relevance label.
  const broadcast = shown.filter(
    (item) =>
      item.priority !== "important" && item.sourceType === "broadcast",
  );
  const social = shown.filter(
    (item) =>
      item.priority !== "important" &&
      item.sourceType === "social" &&
      item.label !== "uncertain_i66_segment",
  );
  const uncertain = shown.filter(
    (item) =>
      item.priority !== "important" &&
      item.sourceType !== "broadcast" &&
      item.label === "uncertain_i66_segment",
  );

  return {
    generatedAt: now.toISOString(),
    windowLabel: `last ${getDigestLookbackHours(now)} hours`,
    recipients: monitoringConfig.recipients,
    totalRelevantCount: shown.length,
    important,
    confirmed,
    likely,
    broadcast,
    social,
    uncertain,
    suppressedCount: collection.suppressedCount,
    noRelevantCoverage: shown.length === 0,
    degradedProviders: collection.degradedProviders,
    newItemsCount,
    repeatedItemsCount,
  };
}

/**
 * Snapshot for read-only surfaces (dashboard, preview). Returns the last stored
 * snapshot when persistence is enabled and a digest has been sent — avoiding a
 * live external fetch on every anonymous page load. Falls back to a live build
 * when persistence is off or nothing has been stored yet.
 */
export async function loadDashboardSnapshot(): Promise<DigestSnapshot> {
  const stored = await getLatestStoredSnapshot();
  return stored ?? buildDigestSnapshot();
}

export function renderDigestHtml(snapshot: DigestSnapshot) {
  const sections = [
    ["Important / Needs Review", snapshot.important],
    ["Confirmed 66 Outside the Beltway", snapshot.confirmed],
    ["Likely 66 Outside the Beltway", snapshot.likely],
    ["TV, Radio & Broadcast", snapshot.broadcast ?? []],
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
      ${
        snapshot.degradedProviders.length > 0
          ? `<p style="color:#b45309;font-size:12px;margin-top:24px;">⚠ Some sources failed this run and may be missing: ${escapeHtml(snapshot.degradedProviders.join(", "))}.</p>`
          : ""
      }
      <p style="color:#66706d;font-size:12px;margin-top:24px;">Suppressed noise count: ${snapshot.suppressedCount}${
        snapshot.repeatedItemsCount > 0
          ? ` · ${snapshot.repeatedItemsCount} already-reported ${snapshot.repeatedItemsCount === 1 ? "item" : "items"} not repeated`
          : ""
      }</p>
    </main>
  </body>
</html>`;
}

export function renderDigestText(snapshot: DigestSnapshot) {
  const sections = [
    ["Important / Needs Review", snapshot.important],
    ["Confirmed 66 Outside the Beltway", snapshot.confirmed],
    ["Likely 66 Outside the Beltway", snapshot.likely],
    ["TV, Radio & Broadcast", snapshot.broadcast ?? []],
    ["Reddit and Public Social", snapshot.social],
    ["Uncertain / Possible Matches", snapshot.uncertain],
  ] as const;

  const degradedLine =
    snapshot.degradedProviders.length > 0
      ? `Warning: some sources failed this run and may be missing: ${snapshot.degradedProviders.join(", ")}.`
      : "";

  if (snapshot.noRelevantCoverage) {
    return [
      "66EMP Daily Media Digest",
      "",
      `Monitoring window: ${snapshot.windowLabel}`,
      "",
      "No relevant coverage found.",
      ...(degradedLine ? ["", degradedLine] : []),
    ].join("\n");
  }

  const suppressedLine =
    snapshot.repeatedItemsCount > 0
      ? `Suppressed noise count: ${snapshot.suppressedCount} · ${snapshot.repeatedItemsCount} already-reported not repeated`
      : `Suppressed noise count: ${snapshot.suppressedCount}`;

  return [
    "66EMP Daily Media Digest",
    "",
    `Monitoring window: ${snapshot.windowLabel}`,
    suppressedLine,
    ...(degradedLine ? [degradedLine] : []),
    "",
    ...sections
      .filter(([, items]) => items.length > 0)
      .flatMap(([title, items]) => renderTextSection(title, items)),
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
    <p style="color:#66706d;font-size:13px;margin:0 0 6px;">${escapeHtml(item.source)} · ${escapeHtml(formatItemDate(item.publishedAt))} · ${escapeHtml(item.reason)}</p>
    <p style="margin:0;line-height:1.45;">${escapeHtml(item.snippet)}</p>
  </article>`;
}

function renderTextSection(title: string, items: DigestItem[]) {
  return [
    title,
    "-".repeat(title.length),
    ...items.flatMap((item) => [
      `${item.title}`,
      `${item.source} | ${formatItemDate(item.publishedAt)} | ${item.reason}`,
      `${item.url}`,
      item.snippet,
      "",
    ]),
  ];
}

function formatItemDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: monitoringConfig.timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
