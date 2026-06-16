import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "@/lib/csv";
import type { Source, SourcePriority } from "@/lib/types";

const SOURCE_PATH = path.join(process.cwd(), "data", "sources.csv");

function value(record: Record<string, string>, key: string) {
  return record[key]?.trim() ?? "";
}

function priority(raw: string): SourcePriority {
  if (raw === "high" || raw === "medium" || raw === "low") {
    return raw;
  }
  return "medium";
}

export async function getSources(): Promise<Source[]> {
  const csv = await fs.readFile(SOURCE_PATH, "utf8");
  const [headers = [], ...rows] = parseCsv(csv);

  return rows.map((row) => {
    const record = Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? ""]),
    );

    return {
      sourceName: value(record, "source_name"),
      medium: value(record, "medium"),
      geography: value(record, "geography"),
      website: value(record, "website"),
      rawWebsiteOrEmail: value(record, "raw_website_or_email"),
      twitterHandle: value(record, "twitter_handle"),
      verificationStatus: value(record, "verification_status"),
      originalStatus: value(record, "original_status"),
      priority: priority(value(record, "priority")),
      monitoringMethod: value(record, "monitoring_method")
        .split(";")
        .filter(Boolean),
      includeInV1: value(record, "include_in_v1") !== "no",
      notes: value(record, "notes"),
    };
  });
}

export function summarizeSources(sources: Source[]) {
  const byMedium = countBy(sources, (source) => source.medium);
  const byPriority = countBy(sources, (source) => source.priority);
  const byStatus = countBy(sources, (source) => source.verificationStatus);

  return {
    total: sources.length,
    included: sources.filter((source) => source.includeInV1).length,
    withTwitter: sources.filter((source) => source.twitterHandle).length,
    withWebsite: sources.filter((source) => source.website).length,
    byMedium,
    byPriority,
    byStatus,
  };
}

function countBy<T>(items: T[], getter: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getter(item) || "blank";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
