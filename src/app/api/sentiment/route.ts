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
  } | null;

  const id = typeof body?.id === "string" ? body.id : "";
  const sentiment = body?.sentiment;
  const isValid =
    id.length > 0 &&
    (sentiment === null || VALID.includes(sentiment as SentimentValue));

  if (!isValid) {
    return NextResponse.json(
      {
        ok: false,
        error: "Expected { id, sentiment: 'positive' | 'neutral' | 'negative' | null }.",
      },
      { status: 400 },
    );
  }

  const result = await setSentiment(id, sentiment as SentimentValue | null);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
