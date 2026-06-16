import { getSupabase } from "@/lib/db";
import { monitoringConfig } from "@/lib/monitoring-config";

export type MonitoringSettings = {
  positiveKeywords: string[];
  avoidPhrases: string[];
};

// Defaults reuse the existing config, so behavior is unchanged until someone
// edits the lists.
export const DEFAULT_SETTINGS: MonitoringSettings = {
  positiveKeywords: monitoringConfig.includeTerms,
  avoidPhrases: monitoringConfig.excludeTerms,
};

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of values) {
    const term = String(value).trim();
    const key = term.toLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      cleaned.push(term);
    }
  }
  return cleaned;
}

/** Normalize arbitrary input into a saveable settings object. */
export function normalizeSettings(input: {
  positiveKeywords?: unknown;
  avoidPhrases?: unknown;
}): MonitoringSettings {
  return {
    positiveKeywords: cleanList(input.positiveKeywords),
    avoidPhrases: cleanList(input.avoidPhrases),
  };
}

/**
 * Current monitoring keywords. Falls back to {@link DEFAULT_SETTINGS} when
 * Supabase is not configured, no row exists yet, or a list is empty — so the
 * monitor never runs with an empty keyword set.
 */
export async function getMonitoringSettings(): Promise<MonitoringSettings> {
  const supabase = getSupabase();
  if (!supabase) {
    return DEFAULT_SETTINGS;
  }

  const { data, error } = await supabase
    .from("monitoring_settings")
    .select("positive_keywords, avoid_phrases")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("[monitoring-settings] read failed:", error.message);
    return DEFAULT_SETTINGS;
  }

  const positive = cleanList(data?.positive_keywords);
  const avoid = cleanList(data?.avoid_phrases);

  return {
    positiveKeywords: positive.length ? positive : DEFAULT_SETTINGS.positiveKeywords,
    avoidPhrases: avoid.length ? avoid : DEFAULT_SETTINGS.avoidPhrases,
  };
}

export async function saveMonitoringSettings(
  settings: MonitoringSettings,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return {
      ok: false,
      error: "Persistence is not configured (set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    };
  }

  const { error } = await supabase.from("monitoring_settings").upsert(
    {
      id: 1,
      positive_keywords: settings.positiveKeywords,
      avoid_phrases: settings.avoidPhrases,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("[monitoring-settings] save failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
