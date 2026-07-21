import { socialPlatform } from "@/lib/digest";
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

export type ReportPeriod = "weekly" | "monthly" | "custom";

export type ReportRange = {
  period: ReportPeriod;
  key: string; // monthly: "2026-07" · weekly/custom: the start date "2026-07-11"
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
  feedback: string | null;
  sentiment: string | null;
  sentimentSource: string | null;
};

/**
 * Sentiment toward the 66 Express across the range. `scored` is the
 * denominator for the percentages — unscored items are excluded rather than
 * counted as neutral, so the meter never overstates how much coverage was
 * actually assessed. `adjusted` is how many of the scored items an analyst set
 * by hand.
 */
export type SentimentMix = {
  positive: number;
  neutral: number;
  negative: number;
  scored: number;
  unscored: number;
  adjusted: number;
  /** -100 (all negative) to +100 (all positive); null when nothing is scored. */
  net: number | null;
};

export type Report = {
  range: ReportRange;
  available: boolean; // false when Supabase isn't configured
  totalMentions: number;
  uniqueOutlets: number;
  byType: Array<{ type: string; count: number }>;
  byLabel: Array<{ label: string; count: number }>;
  topOutlets: Array<{ source: string; count: number }>;
  daily: Array<{ label: string; count: number }>;
  // Ranked best-first: important, then confirmed, likely, the rest. The full
  // in-range list (capped at 500) — the coverage index / CSV export use all of
  // it; "featured" defaults come from the top of this ranking.
  items: ReportItem[];
  importantCount: number;
  sentiment: SentimentMix;
  // Social breakdown for the Social Pulse section.
  byPlatform: Array<{ platform: string; count: number }>;
  socialPosts: ReportItem[]; // newest-first, capped
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

/** Rolling range covering the last `n` Eastern days, ending today. */
export function lastNDaysRange(n: number, now = new Date()): ReportRange {
  const today = easternDateKey(now);
  const range = customRange(addDays(today, -(n - 1)), today);
  return { ...range, label: `Last ${n} days` };
}

/* ------------------------------ Custom ------------------------------- */

const MAX_CUSTOM_DAYS = 92;

/** Arbitrary from/to (inclusive) range, capped at MAX_CUSTOM_DAYS. */
export function customRange(fromKey: string, toKey: string): ReportRange {
  let start = fromKey;
  let end = toKey;
  if (start > end) {
    [start, end] = [end, start];
  }
  const dayCount = Math.min(
    MAX_CUSTOM_DAYS,
    Math.round(
      (utcMidnightEastern(end).getTime() - utcMidnightEastern(start).getTime()) /
        86_400_000,
    ) + 1,
  );
  end = addDays(start, dayCount - 1);
  return {
    period: "custom",
    key: start,
    label: `${shortDate(start)} – ${shortDate(end)}, ${utcMidnightEastern(end).getUTCFullYear()}`,
    startUtc: utcMidnightEastern(start),
    endUtc: utcMidnightEastern(addDays(start, dayCount)),
    dayKeys: Array.from({ length: dayCount }, (_, i) => addDays(start, i)),
  };
}

/* --------------------------- Range from params ------------------------ */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;

export type ReportParams = {
  period?: string;
  week?: string;
  month?: string;
  from?: string;
  to?: string;
  q?: string;
};

/**
 * Resolve URL/query params to a range. Shared by the reports page and the deck
 * export so a generated deck always covers exactly the period on screen.
 */
export function resolveReportRange(params: ReportParams): ReportRange {
  if (params.period === "monthly") {
    return monthlyRange(
      MONTH_KEY.test(params.month ?? "")
        ? (params.month as string)
        : currentMonthKey(),
    );
  }
  if (
    params.period === "custom" &&
    DATE_KEY.test(params.from ?? "") &&
    DATE_KEY.test(params.to ?? "")
  ) {
    return customRange(params.from as string, params.to as string);
  }
  // Weekly (Sat–Fri) is the default — it matches the client deliverable cadence.
  return weeklyRange(
    DATE_KEY.test(params.week ?? "") ? (params.week as string) : currentWeekKey(),
  );
}

/* ------------------------------ Report ------------------------------- */

export async function getReport(
  range: ReportRange,
  q = "",
): Promise<Report> {
  const base: Report = {
    range,
    available: false,
    totalMentions: 0,
    uniqueOutlets: 0,
    byType: [],
    byLabel: [],
    topOutlets: [],
    daily: [],
    items: [],
    importantCount: 0,
    sentiment: {
      positive: 0,
      neutral: 0,
      negative: 0,
      scored: 0,
      unscored: 0,
      adjusted: 0,
      net: null,
    },
    byPlatform: [],
    socialPosts: [],
  };

  const supabase = getSupabase();
  if (!supabase) {
    return base;
  }

  const term = q.replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
  const runQuery = (columns: string) => {
    let query = supabase
      .from("digest_items")
      .select(columns)
      .gte("published_at", range.startUtc.toISOString())
      .lt("published_at", range.endUtc.toISOString())
      .order("published_at", { ascending: false })
      .limit(2000);
    if (term) {
      query = query.or(
        `title.ilike.%${term}%,source.ilike.%${term}%,snippet.ilike.%${term}%`,
      );
    }
    return query;
  };

  // Tolerate the optional analyst columns not existing yet: each has its own
  // migration, so degrade through the column sets until one selects cleanly.
  const BASE_COLUMNS =
    "id, title, url, source, source_type, label, priority, snippet, published_at";
  let { data, error } = await runQuery(
    `${BASE_COLUMNS}, feedback, sentiment, sentiment_source`,
  );
  if (error && error.message.includes("sentiment")) {
    ({ data, error } = await runQuery(`${BASE_COLUMNS}, feedback`));
  }
  if (error && error.message.includes("feedback")) {
    ({ data, error } = await runQuery(BASE_COLUMNS));
  }

  if (error) {
    console.error("[report] getReport failed:", error.message);
    return base;
  }

  const items: ReportItem[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    source: row.source as string,
    sourceType: (row.source_type as string) || "news",
    label: (row.label as string) || "uncertain_i66_segment",
    priority: (row.priority as string) || "normal",
    snippet: (row.snippet as string | null) ?? "",
    publishedAt: (row.published_at as string | null) ?? null,
    feedback: (row.feedback as string | null) ?? null,
    sentiment: (row.sentiment as string | null) ?? null,
    sentimentSource: (row.sentiment_source as string | null) ?? null,
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
    uniqueOutlets: outletCounts.size,
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
          : shortDate(key),
      count: dayCounts.get(key) ?? 0,
    })),
    items: [...items]
      .sort((a, b) => storyRank(a) - storyRank(b))
      .slice(0, 500),
    importantCount: items.filter((item) => item.priority === "important")
      .length,
    sentiment: (() => {
      const counts = { positive: 0, neutral: 0, negative: 0 };
      let adjusted = 0;
      for (const item of items) {
        if (item.sentiment && item.sentiment in counts) {
          counts[item.sentiment as keyof typeof counts]++;
          if (item.sentimentSource === "manual") {
            adjusted++;
          }
        }
      }
      const scored = counts.positive + counts.neutral + counts.negative;
      return {
        ...counts,
        scored,
        unscored: items.length - scored,
        adjusted,
        net: scored
          ? Math.round(((counts.positive - counts.negative) / scored) * 100)
          : null,
      };
    })(),
    byPlatform: (() => {
      const counts = new Map<string, number>();
      for (const item of items) {
        if (item.sourceType === "social") {
          const platform = socialPlatform(item.url);
          counts.set(platform, (counts.get(platform) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([platform, count]) => ({ platform, count }))
        .sort((a, b) => b.count - a.count);
    })(),
    // `items` arrives from the query newest-first; keep that order here.
    socialPosts: items
      .filter((item) => item.sourceType === "social")
      .slice(0, 8),
  };
}
