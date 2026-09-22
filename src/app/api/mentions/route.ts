import { NextResponse } from "next/server";
import {
  saveManualMention,
  saveManualMentions,
  type ManualMentionInput,
} from "@/lib/mentions";

/**
 * Record mentions an analyst found by hand: one mention as the body, or a
 * batch as `{ mentions: [...] }`. Sits behind the site's Basic Auth gate (only
 * /api/cron/* is excluded), so only logged-in users can add them.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | (ManualMentionInput & { mentions?: unknown })
    | null;

  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (body.mentions !== undefined) {
    if (!Array.isArray(body.mentions)) {
      return NextResponse.json(
        { ok: false, error: "`mentions` must be a list." },
        { status: 400 },
      );
    }
    const result = await saveManualMentions(body.mentions as ManualMentionInput[]);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const result = await saveManualMention(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
