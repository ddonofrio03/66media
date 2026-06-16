import { NextResponse } from "next/server";
import {
  getMonitoringSettings,
  normalizeSettings,
  saveMonitoringSettings,
} from "@/lib/monitoring-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getMonitoringSettings();
  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { positiveKeywords, avoidPhrases } = (body ?? {}) as {
    positiveKeywords?: unknown;
    avoidPhrases?: unknown;
  };
  const settings = normalizeSettings({ positiveKeywords, avoidPhrases });

  const result = await saveMonitoringSettings(settings);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, settings });
}
