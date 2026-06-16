import { NextResponse } from "next/server";
import {
  loadDashboardSnapshot,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await loadDashboardSnapshot();

  return NextResponse.json({
    snapshot,
    html: renderDigestHtml(snapshot),
    text: renderDigestText(snapshot),
  });
}
