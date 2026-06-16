import { NextResponse } from "next/server";
import {
  buildDigestSnapshot,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest";

export async function GET() {
  const snapshot = await buildDigestSnapshot();

  return NextResponse.json({
    snapshot,
    html: renderDigestHtml(snapshot),
    text: renderDigestText(snapshot),
  });
}
