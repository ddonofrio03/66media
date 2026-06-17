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
    scannedCount: collection.scannedCount,
    offTopicCount: collection.offTopicCount,
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

function digestSections(snapshot: DigestSnapshot) {
  return [
    ["Important / Needs Review", snapshot.important],
    ["Confirmed 66 Outside the Beltway", snapshot.confirmed],
    ["Likely 66 Outside the Beltway", snapshot.likely],
    ["TV, Radio & Broadcast", snapshot.broadcast ?? []],
    ["Reddit and Public Social", snapshot.social],
    ["Uncertain / Possible Matches", snapshot.uncertain],
  ] as const;
}

/**
 * Honest "what we looked at" numbers. `suppressedCount` historically mixed two
 * very different things — items older than the time window (stale feed clutter)
 * and in-window off-topic items — which made a quiet day read as if 369 stories
 * were thrown away. Prefer the in-window scanned/off-topic split when present,
 * falling back to legacy snapshots.
 */
function coverageStats(snapshot: DigestSnapshot) {
  const offTopic = snapshot.offTopicCount ?? snapshot.suppressedCount;
  const scanned =
    snapshot.scannedCount ?? snapshot.totalRelevantCount + snapshot.suppressedCount;
  return { scanned, offTopic, relevant: snapshot.totalRelevantCount };
}

/**
 * One-line "why so few" footnote. Reframes a quiet day as "we checked N, this is
 * what was relevant" rather than "369 suppressed", which reads like a failure.
 */
function coverageFootnote(snapshot: DigestSnapshot) {
  const { scanned, offTopic, relevant } = coverageStats(snapshot);
  const repeated =
    snapshot.repeatedItemsCount > 0
      ? ` · ${snapshot.repeatedItemsCount} already-reported ${snapshot.repeatedItemsCount === 1 ? "item" : "items"} not repeated`
      : "";
  return `Screened ${scanned} recent ${scanned === 1 ? "item" : "items"} from this window — ${relevant} relevant, ${offTopic} off-topic.${repeated}`;
}

/**
 * "At a glance" summary table — mirrors Meltwater's anchor block so a reader can
 * see the shape of the day (how many items per bucket) before scrolling. Only
 * renders buckets that have items, plus a relevant/scanned scoreboard.
 */
function renderSummary(snapshot: DigestSnapshot) {
  const { scanned, offTopic } = coverageStats(snapshot);
  const rows = digestSections(snapshot)
    .filter(([, items]) => items.length > 0)
    .map(
      ([title, items]) =>
        `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #eef2f1;font-size:14px;">${escapeHtml(title)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #eef2f1;font-size:14px;font-weight:bold;text-align:right;color:#0f766e;">${items.length}</td>
        </tr>`,
    )
    .join("");

  return `<section style="background:#fff;border:1px solid #dce3e0;border-radius:8px;padding:8px 6px;margin-bottom:16px;">
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${rows}
        <tr>
          <td style="padding:10px 14px;font-size:13px;color:#66706d;">Relevant items shown</td>
          <td style="padding:10px 14px;font-size:13px;color:#66706d;text-align:right;">${snapshot.totalRelevantCount}</td>
        </tr>
        <tr>
          <td style="padding:0 14px 10px;font-size:13px;color:#66706d;">Recent items screened</td>
          <td style="padding:0 14px 10px;font-size:13px;color:#66706d;text-align:right;">${scanned} (${offTopic} off-topic)</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

export function renderDigestHtml(snapshot: DigestSnapshot) {
  const sections = digestSections(snapshot);

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f7f8f8;color:#17211f;font-family:Arial,sans-serif;">
    <main style="max-width:720px;margin:0 auto;padding:28px 20px;">
      <h1 style="font-size:24px;line-height:1.2;margin:0 0 8px;">66EMP Daily Media Digest</h1>
      <p style="color:#66706d;margin:0 0 24px;">Monitoring window: ${escapeHtml(snapshot.windowLabel)}</p>
      ${snapshot.noRelevantCoverage ? "" : renderSummary(snapshot)}
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
      <p style="color:#66706d;font-size:12px;margin-top:24px;">${escapeHtml(coverageFootnote(snapshot))}</p>
    </main>
  </body>
</html>`;
}

export function renderDigestText(snapshot: DigestSnapshot) {
  const sections = digestSections(snapshot);

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

  const suppressedLine = coverageFootnote(snapshot);

  const glanceLines = sections
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => `  ${title}: ${items.length}`);

  return [
    "66EMP Daily Media Digest",
    "",
    `Monitoring window: ${snapshot.windowLabel}`,
    "",
    "At a glance",
    ...glanceLines,
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
  const snippet = cleanSnippet(item);
  return `<article style="border-top:1px solid #dce3e0;padding-top:12px;margin-top:12px;">
    <h3 style="font-size:16px;margin:0 0 6px;"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#0f766e;text-decoration:none;">${escapeHtml(item.title)}</a></h3>
    <p style="color:#66706d;font-size:13px;margin:0 0 6px;">${escapeHtml(item.source)} · ${escapeHtml(formatItemDate(item.publishedAt))} · ${escapeHtml(item.reason)}</p>
    ${snippet ? `<p style="margin:0;line-height:1.45;">${escapeHtml(snippet)}</p>` : ""}
  </article>`;
}

/**
 * Strips the redundant excerpt many providers (esp. Google News RSS) return,
 * where the "description" is just "<title> <source>" — an echo, not a lede.
 * Returns the snippet only when it adds information beyond the title/source.
 */
function cleanSnippet(item: DigestItem): string {
  const snippet = item.snippet?.trim() ?? "";
  if (!snippet) return "";

  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  let body = norm(snippet);
  const title = norm(item.title);
  const source = norm(item.source);

  // Drop a leading title echo, then a trailing/leading source-name echo.
  if (body.startsWith(title)) body = body.slice(title.length).trim();
  if (source && body.endsWith(source)) body = body.slice(0, -source.length).trim();
  if (source && body.startsWith(source)) body = body.slice(source.length).trim();

  // Whatever remains is too thin to be a real excerpt — suppress it.
  if (body.replace(/[\s.,–-]/g, "").length < 8) return "";
  return snippet;
}

function renderTextSection(title: string, items: DigestItem[]) {
  return [
    title,
    "-".repeat(title.length),
    ...items.flatMap((item) => {
      const snippet = cleanSnippet(item);
      return [
        `${item.title}`,
        `${item.source} | ${formatItemDate(item.publishedAt)} | ${item.reason}`,
        `${item.url}`,
        ...(snippet ? [snippet] : []),
        "",
      ];
    }),
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
