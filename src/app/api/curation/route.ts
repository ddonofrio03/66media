import { NextResponse } from "next/server";
import { saveReportCuration } from "@/lib/digest-store";

/**
 * Persist analyst curation for one report period — the written title, client
 * name and summary, the featured selection, and the hand-set sentiment dials.
 *
 * Behind the site's Basic Auth gate (only /api/cron/* is excluded). Only the
 * keys present in the request body are written, so saving a dial never
 * overwrites a summary someone is editing in another tab.
 */

export const dynamic = "force-dynamic";

function optionalScore(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null; // explicit "clear the override"
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return undefined; // ignore junk rather than storing a bad dial
  }
  return Math.round(score * 10) / 10;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  const period = typeof body?.period === "string" ? body.period : "";
  const rangeKey = typeof body?.rangeKey === "string" ? body.rangeKey : "";
  if (!period || !rangeKey) {
    return NextResponse.json(
      { ok: false, error: "Expected { period, rangeKey, ...fields }." },
      { status: 400 },
    );
  }

  const text = (value: unknown) =>
    value === undefined ? undefined : value === null ? null : String(value);

  const result = await saveReportCuration(period, rangeKey, {
    title: text(body?.title),
    clientName: text(body?.clientName),
    summary: text(body?.summary),
    featuredIds: Array.isArray(body?.featuredIds)
      ? (body.featuredIds as unknown[]).map(String)
      : undefined,
    mediaScore: optionalScore(body?.mediaScore),
    socialScore: optionalScore(body?.socialScore),
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
