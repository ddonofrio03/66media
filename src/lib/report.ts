import { getSupabase } from "@/lib/db";

/**
 * Monthly earned-media report built from the digest_items archive — the
 * Meltwater-style client deliverable (mention volume, outlet mix, media-type
 * split, top stories) generated from data the monitor already collects.
 */

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

export type MonthlyReport = {
  monthKey: string; // "2026-07"
  monthLabel: string; // "July 2026"
  available: boolean; // false when Supabase isn't configured
  totalMentions: number;
  byType: Array<{ type: string; count: number }>;
  byLabel: Array<{ label: string; count: number }>;
  topOutlets: Array<{ source: string; count: number }>;
  daily: Array<{ day: number; count: number }>;
  topStories: ReportItem[];
  importantCount: number;
};

export function currentMonthKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).slice(0, 7);
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function getMonthlyReport(
  monthKey: string,
): Promise<MonthlyReport> {
  const [year, month] = monthKey.split("-").map(Number);
  const base: MonthlyReport = {
    monthKey,
    monthLabel: monthLabel(monthKey),
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
  if (!supabase || !year || !month) {
    return base;
  }

  // Month boundaries approximated at midnight Eastern (UTC-4). A DST hour of
  // slop at each edge is acceptable for a monthly rollup.
  const start = new Date(Date.UTC(year, month - 1, 1, 4)).toISOString();
  const end = new Date(Date.UTC(year, month, 1, 4)).toISOString();

  const { data, error } = await supabase
    .from("digest_items")
    .select(
      "id, title, url, source, source_type, label, priority, snippet, published_at",
    )
    .gte("published_at", start)
    .lt("published_at", end)
    .order("published_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("[report] getMonthlyReport failed:", error.message);
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
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayCounts = new Array<number>(daysInMonth).fill(0);

  for (const item of items) {
    typeCounts.set(item.sourceType, (typeCounts.get(item.sourceType) ?? 0) + 1);
    labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
    outletCounts.set(item.source, (outletCounts.get(item.source) ?? 0) + 1);

    if (item.publishedAt) {
      const easternDay = Number(
        new Date(item.publishedAt).toLocaleDateString("en-CA", {
          timeZone: "America/New_York",
          day: "2-digit",
        }),
      );
      if (easternDay >= 1 && easternDay <= daysInMonth) {
        dayCounts[easternDay - 1]++;
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
    daily: dayCounts.map((count, index) => ({ day: index + 1, count })),
    topStories: [...items]
      .sort((a, b) => storyRank(a) - storyRank(b))
      .slice(0, 15),
    importantCount: items.filter((item) => item.priority === "important")
      .length,
  };
}
