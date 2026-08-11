import { socialPlatform } from "@/lib/digest";
import { getSupabase } from "@/lib/db";
import type { Engagement } from "@/lib/types";

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
  /** Analyst's 0–100 score. Null = fall back to the bucket. */
  sentimentScore: number | null;
  /** Why the classifier kept this story — the deck's "Relevance:" line. */
  reason: string;
  /** Reporter credit, when the feed supplied one. */
  byline: string;
  /** Verbatim on-air excerpt, quoted under broadcast mentions. */
  transcript: string;
  /** Deep link to the moment of the mention. */
  clipUrl: string;
  engagement: Engagement | null;
};

/** Total onward reach of a post — the "social echo" ranking key. */
export function echoScore(item: ReportItem): number {
  const e = item.engagement;
  if (!e) return 0;
  return (e.likes ?? 0) + (e.comments ?? 0) + (e.shares ?? 0);
}

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
  /**
   * The 0–100 dial the client deck prints. Reverse-engineered from the printed
   * reports and verified against them: the 08-07-2026 issue shows 72.5 for a
   * social mix of 11 positive / 7 neutral / 2 negative of 20, and 100 for a
   * media mix of 4 positive of 4. Null when nothing is scored.
   */
  score: number | null;
};

/** Band label under the dial, matching the deck's wording. */
export function sentimentBand(score: number | null): string {
  if (score === null) return "Not scored";
  if (score >= 90) return "Positive";
  if (score >= 60) return "Mostly Positive";
  if (score > 40) return "Neutral";
  if (score > 10) return "Mostly Negative";
  return "Negative";
}

/** The 0–100 value each bucket stands for. */
const BUCKET_SCORE: Record<string, number> = {
  positive: 100,
  neutral: 50,
  negative: 0,
};

/**
 * An item's sentiment on the 0–100 scale: its hand-set score when an analyst
 * gave one, otherwise the value its bucket stands for. Null when unscored.
 *
 * Averaging this over scored items reproduces the bucket-only formula exactly
 * — (100p + 50u + 0n)/s is algebraically 50 + 50(p−n)/s — so per-item scores
 * generalise the dial without moving it for coverage nobody has hand-scored.
 */
export function effectiveScore(item: ReportItem): number | null {
  if (item.sentimentScore !== null) {
    return item.sentimentScore;
  }
  return item.sentiment ? (BUCKET_SCORE[item.sentiment] ?? null) : null;
}

/**
 * Sentiment mix over a set of items. `scored` is the denominator — unscored
 * items are excluded rather than counted as neutral, so the dial never
 * overstates how much coverage was actually assessed.
 */
export function sentimentOf(items: ReportItem[]): SentimentMix {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  let adjusted = 0;
  let total = 0;
  let scored = 0;

  for (const item of items) {
    const score = effectiveScore(item);
    if (score === null) {
      continue;
    }
    scored++;
    total += score;
    // The bucket breakdown stays the coarse view for the stacked bar. A
    // numeric-only score still lands in a bucket by which third it falls in.
    const bucket =
      item.sentiment && item.sentiment in counts
        ? (item.sentiment as keyof typeof counts)
        : score >= 67
          ? "positive"
          : score > 33
            ? "neutral"
            : "negative";
    counts[bucket]++;
    if (item.sentimentSource === "manual") {
      adjusted++;
    }
  }

  const mean = scored ? total / scored : 0;
  return {
    ...counts,
    scored,
    unscored: items.length - scored,
    adjusted,
    // Net keeps its old -100..+100 meaning, derived from the same mean.
    net: scored ? Math.round((mean - 50) * 2) : null,
    // Halves are meaningful here (the deck prints 72.5), so round to 0.1.
    score: scored ? Math.round(mean * 10) / 10 : null,
  };
}

/**
 * Traditional media and social are reported as two separate universes, the way
 * the client deck does it — separate counts, separate outlet rankings, separate
 * sentiment gauges. Lumping them produced a "Top Publishers" list where an X
 * handle outranked WTOP, which is meaningless to a comms team.
 *
 * media = news + broadcast · social = social.
 */
export function isSocial(item: ReportItem): boolean {
  return item.sourceType === "social";
}

export type Report = {
  range: ReportRange;
  available: boolean; // false when Supabase isn't configured
  /** Media + social combined. Prefer the split counts in client-facing copy. */
  totalMentions: number;
  mediaMentions: number;
  socialMentions: number;
  /** Distinct traditional-media outlets only — never social accounts. */
  uniqueOutlets: number;
  uniqueSocialAccounts: number;
  byType: Array<{ type: string; count: number }>;
  byLabel: Array<{ label: string; count: number }>;
  /** Traditional media only. */
  topOutlets: Array<{ source: string; count: number }>;
  /** Social accounts only, ranked by post count. */
  topSocialAccounts: Array<{ source: string; count: number }>;
  /** Per-day totals, split into the two series the overview chart plots. */
  daily: Array<{ label: string; count: number; media: number; social: number }>;
  // Ranked best-first: important, then confirmed, likely, the rest. The full
  // in-range list (capped at 500) — the coverage index / CSV export use all of
  // it; "featured" defaults come from the top of this ranking.
  items: ReportItem[];
  importantCount: number;
  /** All coverage combined. The deck prints the two split gauges instead. */
  sentiment: SentimentMix;
  mediaSentiment: SentimentMix;
  socialSentiment: SentimentMix;
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

/** The period immediately before `range`, same length — for trend comparison. */
export function previousRange(range: ReportRange): ReportRange {
  if (range.period === "weekly") {
    return weeklyRange(shiftWeekKey(range.key, -1));
  }
  if (range.period === "monthly") {
    return monthlyRange(shiftMonthKey(range.key, -1));
  }
  // Custom: the same number of days ending the day before this range starts.
  const days = range.dayKeys.length;
  const end = addDays(range.dayKeys[0], -1);
  const start = addDays(end, -(days - 1));
  return customRange(start, end);
}

/* ------------------------------ Report ------------------------------- */

export async function getReport(
  range: ReportRange,
  q = "",
): Promise<Report> {
  const emptyMix = sentimentOf([]);
  const base: Report = {
    range,
    available: false,
    totalMentions: 0,
    mediaMentions: 0,
    socialMentions: 0,
    uniqueOutlets: 0,
    uniqueSocialAccounts: 0,
    byType: [],
    byLabel: [],
    topOutlets: [],
    topSocialAccounts: [],
    daily: [],
    items: [],
    importantCount: 0,
    sentiment: emptyMix,
    mediaSentiment: emptyMix,
    socialSentiment: emptyMix,
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

  // Tolerate the optional columns not existing yet: each arrived with its own
  // migration, so degrade through the column sets until one selects cleanly.
  const BASE_COLUMNS =
    "id, title, url, source, source_type, label, priority, reason, snippet, published_at";
  const ANALYST_COLUMNS = `${BASE_COLUMNS}, feedback, sentiment, sentiment_source`;
  const ENRICHED_COLUMNS = `${ANALYST_COLUMNS}, byline, transcript, clip_url, engagement`;
  let { data, error } = await runQuery(`${ENRICHED_COLUMNS}, sentiment_score`);
  if (error && error.message.includes("sentiment_score")) {
    ({ data, error } = await runQuery(ENRICHED_COLUMNS));
  }
  if (
    error &&
    ["byline", "transcript", "clip_url", "engagement"].some((column) =>
      error?.message.includes(column),
    )
  ) {
    ({ data, error } = await runQuery(ANALYST_COLUMNS));
  }
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
    sentimentScore:
      typeof row.sentiment_score === "number" ? row.sentiment_score : null,
    reason: (row.reason as string | null) ?? "",
    byline: (row.byline as string | null) ?? "",
    transcript: (row.transcript as string | null) ?? "",
    clipUrl: (row.clip_url as string | null) ?? "",
    engagement: (row.engagement as Engagement | null) ?? null,
  }));

  const mediaItems = items.filter((item) => !isSocial(item));
  const socialItems = items.filter(isSocial);

  const typeCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  // Outlets and accounts are counted in separate maps so a busy X handle can
  // never appear in — or crowd out — the traditional-media outlet ranking.
  const outletCounts = new Map<string, number>();
  const accountCounts = new Map<string, number>();
  const dayCounts = new Map<string, { media: number; social: number }>(
    range.dayKeys.map((key) => [key, { media: 0, social: 0 }]),
  );

  for (const item of items) {
    typeCounts.set(item.sourceType, (typeCounts.get(item.sourceType) ?? 0) + 1);
    labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
    const bucket = isSocial(item) ? accountCounts : outletCounts;
    bucket.set(item.source, (bucket.get(item.source) ?? 0) + 1);
    if (item.publishedAt) {
      const key = easternDateKey(new Date(item.publishedAt));
      const day = dayCounts.get(key);
      if (day) {
        if (isSocial(item)) day.social++;
        else day.media++;
      }
    }
  }

  const ranked = (counts: Map<string, number>, limit: number) =>
    [...counts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

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
    mediaMentions: mediaItems.length,
    socialMentions: socialItems.length,
    uniqueOutlets: outletCounts.size,
    uniqueSocialAccounts: accountCounts.size,
    byType: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    byLabel: [...labelCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    topOutlets: ranked(outletCounts, 12),
    topSocialAccounts: ranked(accountCounts, 12),
    daily: range.dayKeys.map((key) => {
      const day = dayCounts.get(key) ?? { media: 0, social: 0 };
      return {
        label:
          range.period === "weekly"
            ? utcMidnightEastern(key).toLocaleDateString("en-US", {
                weekday: "short",
                timeZone: "UTC",
              })
            : shortDate(key),
        count: day.media + day.social,
        media: day.media,
        social: day.social,
      };
    }),
    items: [...items]
      .sort((a, b) => storyRank(a) - storyRank(b))
      .slice(0, 500),
    importantCount: items.filter((item) => item.priority === "important")
      .length,
    sentiment: sentimentOf(items),
    mediaSentiment: sentimentOf(mediaItems),
    socialSentiment: sentimentOf(socialItems),
    byPlatform: (() => {
      const counts = new Map<string, number>();
      for (const item of socialItems) {
        const platform = socialPlatform(item.url);
        counts.set(platform, (counts.get(platform) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([platform, count]) => ({ platform, count }))
        .sort((a, b) => b.count - a.count);
    })(),
    // `items` arrives from the query newest-first; keep that order here.
    socialPosts: socialItems.slice(0, 40),
  };
}
