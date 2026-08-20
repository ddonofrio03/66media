import { NextResponse } from "next/server";
import { saveManualMention, type ManualMentionInput } from "@/lib/mentions";

/**
 * Record a mention an analyst found by hand. Sits behind the site's Basic Auth
 * gate (only /api/cron/* is excluded), so only logged-in users can add one.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | ManualMentionInput
    | null;

  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const result = await saveManualMention(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
