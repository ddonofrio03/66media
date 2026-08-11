import { NextResponse } from "next/server";
import { setSentiment, type SentimentValue } from "@/lib/digest-store";

/**
 * Persist an analyst's sentiment override for a story. Sits behind the site's
 * Basic Auth gate (only /api/cron/* is excluded), so only logged-in users can
 * adjust. A manual call permanently outranks the AI's score.
 */

export const dynamic = "force-dynamic";

const VALID: SentimentValue[] = ["positive", "neutral", "negative"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    sentiment?: unknown;
    score?: unknown;
  } | null;

  const id = typeof body?.id === "string" ? body.id : "";
  const sentiment = body?.sentiment;
  const rawScore = body?.score;
  // score is optional; when present it must be a whole 0–100.
  const hasScore = rawScore !== undefined && rawScore !== null;
  const score = hasScore ? Number(rawScore) : null;
  const scoreValid =
    !hasScore ||
    (Number.isFinite(score) && score! >= 0 && score! <= 100);

  const isValid =
    id.length > 0 &&
    (sentiment === null || VALID.includes(sentiment as SentimentValue)) &&
    scoreValid;

  if (!isValid) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Expected { id, sentiment: 'positive'|'neutral'|'negative'|null, score?: 0-100 }.",
      },
      { status: 400 },
    );
  }

  const result = await setSentiment(
    id,
    sentiment as SentimentValue | null,
    hasScore ? Math.round(score!) : undefined,
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
