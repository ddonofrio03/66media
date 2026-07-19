import { getSupabase } from "@/lib/db";

/**
 * Weekly + monthly earned-media reports built from the digest_items archive —
 * the Meltwater-style client deliverable (mention volume, outlet mix,
 * media-type split, top stories) generated from data the monitor already
 * collects.
 *
 * Weekly periods run SATURDAY through FRIDAY, matching the cadence of TCG's
 * weekly Executive Summary deck for the client.
 */

export type ReportPeriod = "weekly" | "monthly";

export type ReportRange = {
  period: ReportPeriod;
  key: string; // monthly: "2026-07" · weekly: the Saturday start "2026-07-11"
  label: string;
  startUtc: Date;
  endUtc: Date;
  // Eastern-timezone date keys ("2026-07-11") for each day in the range.
  dayKeys: string[];
};

export type ReportItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceType: string;
  label: string;
  priority: string;
  snippet: string;
  publishedAt: string | null;
};

export type Report = {
  range: ReportRange;
  available: boolean; // false when Supabase isn't configured
  totalMentions: number;
  byType: Array<{ type: string; count: number }>;
  byLabel: Array<{ label: string; count: number }>;
  topOutlets: Array<{ source: string; count: number }>;
  daily: Array<{ label: string; count: number }>;
  topStories: ReportItem[];
  importantCount: number;
};

// Midnight Eastern approximated as 04:00 UTC. A DST hour of slop at each
// boundary is acceptable for these rollups.
const ET_OFFSET_HOURS = 4;

function easternDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function utcMidnightEastern(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, ET_OFFSET_HOURS));
}

function addDays(dateKey: string, delta: number): string {
  const date = utcMidnightEastern(dateKey);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function shortDate(dateKey: string): string {
  return utcMidnightEastern(dateKey).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/* ------------------------------ Monthly ------------------------------ */

export function currentMonthKey(now = new Date()): string {
  return easternDateKey(now).slice(0, 7);
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthlyRange(monthKey: string): ReportRange {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = `${monthKey}-01`;
  return {
    period: "monthly",
    key: monthKey,
    label: new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    startUtc: utcMidnightEastern(first),
    endUtc: utcMidnightEastern(addDays(first, daysInMonth)),
    dayKeys: Array.from({ length: daysInMonth }, (_, i) => addDays(first, i)),
  };
}

/* ------------------------------ Weekly ------------------------------- */

/** Saturday that starts the Sat–Fri week containing `now` (Eastern). */
export function currentWeekKey(now = new Date()): string {
  const todayKey = easternDateKey(now);
  // getUTCDay on the 04:00Z anchor matches the Eastern weekday. Saturday = 6.
  const weekday = utcMidnightEastern(todayKey).getUTCDay();
  const daysSinceSaturday = (weekday + 1) % 7;
  return addDays(todayKey, -daysSinceSaturday);
}

export function shiftWeekKey(weekKey: string, delta: number): string {
  return addDays(weekKey, delta * 7);
}

export function weeklyRange(weekKey: string): ReportRange {
  const endKey = addDays(weekKey, 6);
  const year = utcMidnightEastern(endKey).getUTCFullYear();
  return {
    period: "weekly",
    key: weekKey,
    label: `Week of ${shortDate(weekKey)} – ${shortDate(endKey)}, ${year}`,
    startUtc: utcMidnightEastern(weekKey),
    endUtc: utcMidnightEastern(addDays(weekKey, 7)),
    dayKeys: Array.from({ length: 7 }, (_, i) => addDays(weekKey, i)),
  };
}

/* ------------------------------ Report ------------------------------- */

export async function getReport(range: ReportRange): Promise<Report> {
  const base: Report = {
    range,
    available: false,
    totalMentions: 0,
    byType: [],
    byLabel: [],
    topOutlets: [],
    daily: [],
    topStories: [],
    importantCount: 0,
  };

  const supabase = getSupabase();
  if (!supabase) {
    return base;
  }

  const { data, error } = await supabase
    .from("digest_items")
    .select(
      "id, title, url, source, source_type, label, priority, snippet, published_at",
    )
    .gte("published_at", range.startUtc.toISOString())
    .lt("published_at", range.endUtc.toISOString())
    .order("published_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("[report] getReport failed:", error.message);
    return base;
  }

  const items: ReportItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    source: row.source as string,
    sourceType: (row.source_type as string) || "news",
    label: (row.label as string) || "uncertain_i66_segment",
    priority: (row.priority as string) || "normal",
    snippet: (row.snippet as string | null) ?? "",
    publishedAt: (row.published_at as string | null) ?? null,
  }));

  const typeCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  const outletCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>(
    range.dayKeys.map((key) => [key, 0]),
  );

  for (const item of items) {
    typeCounts.set(item.sourceType, (typeCounts.get(item.sourceType) ?? 0) + 1);
    labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
    outletCounts.set(item.source, (outletCounts.get(item.source) ?? 0) + 1);
    if (item.publishedAt) {
      const key = easternDateKey(new Date(item.publishedAt));
      if (dayCounts.has(key)) {
        dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const storyRank = (item: ReportItem) => {
    if (item.priority === "important") return 0;
    if (item.label === "confirmed_otb") return 1;
    if (item.label === "likely_otb") return 2;
    return 3;
  };

  return {
    ...base,
    available: true,
    totalMentions: items.length,
    byType: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    byLabel: [...labelCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    topOutlets: [...outletCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    daily: range.dayKeys.map((key) => ({
      label:
        range.period === "weekly"
          ? utcMidnightEastern(key).toLocaleDateString("en-US", {
              weekday: "short",
              timeZone: "UTC",
            })
          : String(Number(key.slice(8))),
      count: dayCounts.get(key) ?? 0,
    })),
    topStories: [...items]
      .sort((a, b) => storyRank(a) - storyRank(b))
      .slice(0, 15),
    importantCount: items.filter((item) => item.priority === "important")
      .length,
  };
}
