import { NextResponse } from "next/server";
import {
  loadDashboardSnapshot,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest";

export const dynamic = "force-dynamic";

/**
 * Preview the digest exactly as it will be emailed.
 *
 * - default: renders the HTML email (so the "Digest Preview" link shows the
 *   real thing, not a JSON blob)
 * - ?format=text: the plain-text version
 * - ?format=json: the raw snapshot + rendered html/text, for debugging
 */
export async function GET(request: Request) {
  const snapshot = await loadDashboardSnapshot();
  const format = new URL(request.url).searchParams.get("format");

  if (format === "json") {
    return NextResponse.json({
      snapshot,
      html: renderDigestHtml(snapshot),
      text: renderDigestText(snapshot),
    });
  }

  if (format === "text") {
    return new Response(renderDigestText(snapshot), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(renderDigestHtml(snapshot), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
