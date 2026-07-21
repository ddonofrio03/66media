import { NextResponse } from "next/server";
import { isDriveConfigured, uploadDeckToDrive } from "@/lib/google-drive";
import { getReport, resolveReportRange, type ReportParams } from "@/lib/report";
import { buildReportDeck } from "@/lib/slides-deck";

/**
 * Generate the current report as a PowerPoint deck.
 *
 * With Google Drive configured, the deck is uploaded to the shared folder and
 * converted to an editable Google Slides file; the response carries the link.
 * Without it, the .pptx streams back as a download — which Slides still
 * imports if you drag it into Drive yourself.
 *
 * The client posts its curation state (title, client name, edited summary,
 * featured selection) alongside the range, and the report is recomputed
 * server-side so the deck matches exactly what is on screen.
 *
 * Behind the site's Basic Auth gate, like the other non-cron routes.
 */

export const runtime = "nodejs"; // pptxgenjs needs Node, not the edge runtime
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TEXT = 400;
const MAX_SUMMARY = 4000;

function clean(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    params?: ReportParams;
    title?: unknown;
    clientName?: unknown;
    summary?: unknown;
    featuredIds?: unknown;
    generatedOn?: unknown;
    destination?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  const params = (body.params ?? {}) as ReportParams;
  const range = resolveReportRange(params);
  const report = await getReport(range, typeof params.q === "string" ? params.q : "");

  const title = clean(body.title, MAX_TEXT, "Earned Media Report");
  const options = {
    title,
    clientName: clean(
      body.clientName,
      MAX_TEXT,
      "The 66 Express Outside the Beltway",
    ),
    summary: clean(body.summary, MAX_SUMMARY, ""),
    featuredIds: Array.isArray(body.featuredIds)
      ? body.featuredIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    generatedOn: clean(
      body.generatedOn,
      MAX_TEXT,
      new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      }),
    ),
  };

  let deck: Buffer;
  try {
    deck = await buildReportDeck(report, options);
  } catch (error) {
    console.error("[export/slides] Deck generation failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not generate the deck." },
      { status: 500 },
    );
  }

  // Drive keeps the real name; the download header cannot (range labels carry
  // en/em dashes, which are not valid in an HTTP header value).
  const filename = `${title} — ${range.label}`.replace(/[\\/:*?"<>|]/g, "-");
  const asciiFilename =
    filename
      .replace(/[‐-―]/g, "-") // hyphen/en/em dashes
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7E]/g, "")
      .trim() || "earned-media-report";

  // An explicit download request (or an unconfigured Drive) returns the file.
  const wantsDownload = body.destination === "download" || !isDriveConfigured();
  if (wantsDownload) {
    return new NextResponse(new Uint8Array(deck), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        // filename* carries the real (UTF-8) name for clients that support it.
        "Content-Disposition":
          `attachment; filename="${asciiFilename}.pptx"; ` +
          `filename*=UTF-8''${encodeURIComponent(`${filename}.pptx`)}`,
      },
    });
  }

  try {
    const file = await uploadDeckToDrive(deck, filename);
    return NextResponse.json({ ok: true, ...file });
  } catch (error) {
    console.error("[export/slides] Drive upload failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not upload to Google Drive.",
      },
      { status: 502 },
    );
  }
}
