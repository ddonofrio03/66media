import { NextResponse } from "next/server";
import { setFeedback } from "@/lib/digest-store";

/**
 * Persist a thumbs up/down vote on a story. Sits behind the site's Basic Auth
 * gate (only /api/cron/* is excluded from it), so only logged-in users can
 * vote. Votes are read back as analyst examples by the AI classifier.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    feedback?: unknown;
  } | null;

  const id = typeof body?.id === "string" ? body.id : "";
  const feedback = body?.feedback;
  const isValid =
    id.length > 0 &&
    (feedback === "up" || feedback === "down" || feedback === null);

  if (!isValid) {
    return NextResponse.json(
      { ok: false, error: "Expected { id, feedback: 'up' | 'down' | null }." },
      { status: 400 },
    );
  }

  const result = await setFeedback(id, feedback as "up" | "down" | null);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
