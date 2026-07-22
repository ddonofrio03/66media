import Anthropic from "@anthropic-ai/sdk";
import type { Report, ReportItem } from "@/lib/report";

/**
 * Deck-time insights that the Exec Summary format needs but the raw archive
 * doesn't carry: the week's Popular Topics/Themes, and the sentiment trend
 * versus the prior period.
 *
 * These run when a deck is exported (not on every /reports load), so a single
 * Haiku call per export is fine and the web page stays fast. Both degrade to
 * empty/neutral output when ANTHROPIC_API_KEY is absent or anything fails, so
 * a deck always generates.
 */

const MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 20_000;

/* ------------------------------- Themes ------------------------------- */

const THEMES_SCHEMA = {
  type: "object",
  properties: {
    themes: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
  },
  required: ["themes"],
  additionalProperties: false,
} as const;

/**
 * Cluster a set of items into 2–5 short topic phrases, the way TCG's report
 * lists "Popular Topics" (e.g. "Incident Response Vehicle", "E-ZPass HOV").
 * `kind` tunes the framing for news vs social.
 */
export async function extractThemes(
  items: ReportItem[],
  kind: "media" | "social",
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || items.length === 0) {
    return [];
  }

  try {
    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
    const lines = items
      .slice(0, 40)
      .map((item, index) => `${index + 1}. ${item.title}`)
      .join("\n");

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: `You summarise a week of ${kind === "social" ? "social posts" : "news coverage"} about the 66 Express Outside the Beltway (I-66 express lanes in Northern Virginia) into a short list of the recurring topics. Each topic is a 2–5 word noun phrase a communications analyst would recognise (e.g. "Incident Response Vehicle", "E-ZPass HOV", "toll pricing"). Return 2–5 topics, most prominent first, covering only what actually recurs. Do not invent topics not present in the items.`,
      output_config: {
        format: { type: "json_schema", schema: THEMES_SCHEMA },
      },
      messages: [{ role: "user", content: `Items:\n${lines}` }],
    });

    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) return [];
    const parsed = JSON.parse(text) as { themes?: string[] };
    return (parsed.themes ?? [])
      .filter((t) => typeof t === "string" && t.trim())
      .map((t) => t.trim())
      .slice(0, 5);
  } catch (error) {
    console.warn("[report-insights] extractThemes skipped:", error);
    return [];
  }
}

/* --------------------------- Sentiment trend -------------------------- */

export type SentimentTrend = {
  /** Short label for the deck: "Higher", "Lower", "Steady", or "No prior data". */
  label: string;
  /** Optional qualifier, e.g. "Neutral to Positive". Empty when not applicable. */
  detail: string;
  currentNet: number | null;
  previousNet: number | null;
};

function netBand(net: number | null): string {
  if (net === null) return "unscored";
  if (net >= 34) return "Positive";
  if (net > -34) return "Neutral";
  return "Negative";
}

/**
 * Compare this period's net sentiment to the prior period's, producing the
 * "Sentiment Trend (compared to previous period)" line — e.g. "Higher (Neutral
 * to Positive)". Both reports are already computed by the caller, so this is
 * pure arithmetic with no extra query.
 */
export function describeSentimentTrend(
  current: Report,
  previous: Report,
): SentimentTrend {
  const currentNet = current.sentiment.net;
  const previousNet = previous.sentiment.net;

  if (previous.sentiment.scored === 0 || previousNet === null) {
    return {
      label: "No prior data",
      detail: "",
      currentNet,
      previousNet: null,
    };
  }
  if (currentNet === null) {
    return { label: "No coverage scored", detail: "", currentNet, previousNet };
  }

  // A few points of drift is noise at these sample sizes; call it Steady.
  const delta = currentNet - previousNet;
  const label = delta >= 8 ? "Higher" : delta <= -8 ? "Lower" : "Steady";
  const fromBand = netBand(previousNet);
  const toBand = netBand(currentNet);
  const detail = fromBand === toBand ? toBand : `${fromBand} to ${toBand}`;

  return { label, detail, currentNet, previousNet };
}
