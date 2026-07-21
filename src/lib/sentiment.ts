import Anthropic from "@anthropic-ai/sdk";
import {
  getUnscoredIds,
  storeAutoSentiment,
  type SentimentValue,
} from "@/lib/digest-store";
import type { DigestItem, RelevanceLabel } from "@/lib/types";

/**
 * Coverage sentiment TOWARD the 66 Express — the input to the Sentiment Meter
 * on the reports page.
 *
 * This scores how the coverage reflects on the client, not the general mood of
 * the article. Routine congestion or a crash on the corridor is neutral news
 * about the facility; an editorial calling the tolls a rip-off is negative.
 * Getting that distinction right is the whole value of the meter, so the
 * prompt leans on it hard.
 *
 * Only confirmed/likely OTB items are scored — the meter should reflect
 * coverage of the client, not corridor news generally. Analyst overrides
 * (sentiment_source='manual') are never re-scored.
 *
 * Gated on ANTHROPIC_API_KEY; any failure leaves items unscored rather than
 * breaking a collection run.
 */

const MODEL = "claude-haiku-4-5";
const MAX_SCORE_ITEMS = 40;
const TIMEOUT_MS = 25_000;

const SCOREABLE: RelevanceLabel[] = ["confirmed_otb", "likely_otb"];
const VALID: SentimentValue[] = ["positive", "neutral", "negative"];

const SYSTEM_PROMPT = `You are a media-monitoring analyst for the 66 Express Outside the Beltway (the tolled express lanes on I-66 west of I-495 in Northern Virginia, operated by I-66 Express Mobility Partners).

For each item, judge the sentiment of the coverage TOWARD THE 66 EXPRESS — how a communications team for the facility would read it. This is NOT the general mood of the story.

- "positive": credits the facility or operator — travel-time savings, successful projects, community investment, favorable quotes from officials or drivers, milestones opened on time.
- "neutral": factual or incidental — routine traffic and crash reports, closure notices, schedule announcements, a passing mention of the lanes in a story about something else. Bad news that happens ON the corridor without reflecting on the facility is NEUTRAL, not negative.
- "negative": reflects badly on the facility or operator — toll-price complaints or "rip-off" framing, congestion blamed on the lanes' design, "stole a lane" arguments, opposition quotes, safety or equity criticism, construction blamed for harm, litigation or regulatory trouble.

The neutral/negative line is the one that matters most. A crash story is neutral. A story where drivers or officials blame the express lanes is negative. Judge from the title, source, and snippet only. When genuinely torn, choose neutral.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          sentiment: {
            type: "string",
            enum: ["positive", "neutral", "negative"],
          },
          reason: { type: "string" },
        },
        required: ["id", "sentiment", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/**
 * Score any confirmed/likely items that have no sentiment yet, and store the
 * results. Call after items are upserted — it reads back which ids still need
 * scoring, so it is safe to call on every run.
 */
export async function scoreAndStoreSentiment(
  items: DigestItem[],
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || items.length === 0) {
    return;
  }

  try {
    const candidates = items.filter((item) => SCOREABLE.includes(item.label));
    if (candidates.length === 0) {
      return;
    }

    // Skip anything already scored — by an earlier run or by an analyst.
    const unscored = await getUnscoredIds(candidates.map((item) => item.id));
    const toScore = candidates
      .filter((item) => unscored.has(item.id))
      .slice(0, MAX_SCORE_ITEMS);
    if (toScore.length === 0) {
      return;
    }

    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
    const payload = toScore.map((item, index) => ({
      id: String(index),
      title: item.title,
      source: item.source,
      snippet: item.snippet,
    }));

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Score each item:\n${JSON.stringify(payload, null, 1)}`,
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) {
      return;
    }
    const parsed = JSON.parse(text) as {
      items: Array<{ id: string; sentiment: string }>;
    };

    const scores: Array<{ id: string; sentiment: SentimentValue }> = [];
    for (const row of parsed.items ?? []) {
      const original = toScore[Number(row.id)];
      if (original && VALID.includes(row.sentiment as SentimentValue)) {
        scores.push({
          id: original.id,
          sentiment: row.sentiment as SentimentValue,
        });
      }
    }

    await storeAutoSentiment(scores);
    console.log(`[sentiment] Scored ${scores.length} item(s).`);
  } catch (error) {
    console.warn("[sentiment] Skipped (non-fatal):", error);
  }
}
