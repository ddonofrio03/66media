import Anthropic from "@anthropic-ai/sdk";
import type { DigestItem, RelevanceLabel } from "@/lib/types";

/**
 * AI relevance refinement for borderline items.
 *
 * The rule-based classifier (collectors.ts) is precise on strong signals
 * ("66 Outside the Beltway") but produces an "uncertain" bucket it cannot
 * disambiguate — is this I-66 story about OUR segment (Outside the Beltway,
 * Fairfax/Prince William) or the Inside-the-Beltway segment / some other
 * Route 66 entirely? This pass sends only the borderline items (uncertain +
 * likely) to Claude Haiku for a cheap second opinion: confirm, downgrade, or
 * drop each one.
 *
 * Gated on ANTHROPIC_API_KEY — without it (or on any error/timeout) the items
 * are returned exactly as the rule classifier labeled them, so this can never
 * break a digest run. Cost: one small request per digest (~fractions of a
 * cent/day at Haiku pricing).
 */

const MODEL = "claude-haiku-4-5";
const MAX_REVIEW_ITEMS = 40;
const TIMEOUT_MS = 25_000;

const REVIEWABLE: RelevanceLabel[] = ["uncertain_i66_segment", "likely_otb"];

const VERDICT_TO_LABEL: Record<string, RelevanceLabel | "drop"> = {
  confirmed_otb: "confirmed_otb",
  likely_otb: "likely_otb",
  uncertain_i66_segment: "uncertain_i66_segment",
  related: "related",
  drop: "drop",
};

const SYSTEM_PROMPT = `You are a media-monitoring analyst for 66 Express Mobility Partners (66 EMP), the private operator of the I-66 Express Lanes OUTSIDE the Beltway in Northern Virginia (the tolled express lanes on Interstate 66 west of I-495, through Fairfax and Prince William counties: Vienna, Centreville, Gainesville, Manassas, Haymarket). The concession is backed by Cintra/Ferrovial and Meridiam ("Transform 66 Outside the Beltway" project).

You will receive news/social items a keyword classifier flagged as possibly relevant. For each, decide:
- "confirmed_otb": clearly about the I-66 Express Lanes Outside the Beltway, 66 EMP, or the Transform 66 OTB project.
- "likely_otb": about I-66 in the corridor (traffic, crashes, tolls, closures west of the Beltway) — probably relevant even if the operator isn't named.
- "uncertain_i66_segment": mentions I-66 but you genuinely cannot tell which segment (could be Inside the Beltway or unclear).
- "related": about the parent companies (Ferrovial, Cintra, Meridiam) or managed-lanes industry with a Virginia/corridor tie, but not the facility directly.
- "drop": NOT relevant — historic Route 66, I-66 in Kentucky, the Inside-the-Beltway segment only, "66" in an address/price/score, or otherwise off-topic.

Judge from the title/snippet/source only. Be decisive: prefer confirmed/likely/drop over uncertain when the text supports it.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: {
            type: "string",
            enum: [
              "confirmed_otb",
              "likely_otb",
              "uncertain_i66_segment",
              "related",
              "drop",
            ],
          },
          reason: { type: "string" },
        },
        required: ["id", "verdict", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export async function refineClassifications(
  items: DigestItem[],
): Promise<DigestItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || items.length === 0) {
    return items;
  }

  const review = items
    .filter((item) => REVIEWABLE.includes(item.label))
    .slice(0, MAX_REVIEW_ITEMS);
  if (review.length === 0) {
    return items;
  }

  try {
    const client = new Anthropic({
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });

    const payload = review.map((item, index) => ({
      id: String(index),
      title: item.title,
      source: item.source,
      snippet: item.snippet,
      current_label: item.label,
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
          content: `Classify each item:\n${JSON.stringify(payload, null, 1)}`,
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) {
      return items;
    }
    const parsed = JSON.parse(text) as {
      items: Array<{ id: string; verdict: string; reason: string }>;
    };

    const verdictByItemId = new Map<string, { verdict: string; reason: string }>();
    for (const row of parsed.items ?? []) {
      const original = review[Number(row.id)];
      if (original && VERDICT_TO_LABEL[row.verdict]) {
        verdictByItemId.set(original.id, row);
      }
    }

    let dropped = 0;
    const refined: DigestItem[] = [];
    for (const item of items) {
      const verdict = verdictByItemId.get(item.id);
      if (!verdict) {
        refined.push(item);
        continue;
      }
      const label = VERDICT_TO_LABEL[verdict.verdict];
      if (label === "drop") {
        dropped++;
        continue;
      }
      refined.push({
        ...item,
        label,
        reason: `AI review: ${truncate(verdict.reason, 140)}`,
      });
    }

    console.log(
      `[ai-classify] Reviewed ${review.length} borderline item(s); dropped ${dropped}.`,
    );
    return refined;
  } catch (error) {
    console.warn("[ai-classify] Skipped (non-fatal):", error);
    return items;
  }
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}
