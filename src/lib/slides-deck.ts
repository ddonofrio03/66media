import PptxGenJS from "pptxgenjs";
import { socialPlatform } from "@/lib/digest";
import type { Report, ReportItem } from "@/lib/report";

/**
 * Renders a report as a 16:9 PowerPoint deck.
 *
 * PPTX rather than direct Google Slides API drawing: Google converts .pptx to
 * a native, fully-editable Slides deck on upload, and .pptx is the same format
 * as TCG's existing Executive Summary deck. Building the layout here (instead
 * of as Slides API batchUpdate calls) also keeps it readable and changeable.
 *
 * Styling follows the Feb 2023 brand guidelines, matching the web report:
 * navy cover with orange frame rules, blue uppercase headings over the
 * signature orange dashed rule, Montserrat throughout.
 */

const BLUE = "105CAE";
const ORANGE = "EE7729";
const GOLD = "F8A829";
const NAVY = "0A1F3C";
const NAVY_MID = "0D2C55";
const WARM_GRAY = "D0CCC9";
const INK = "141413";
const MUTED = "5A5754";
const PANEL = "FFFFFF";
const CANVAS = "F7F6F4";

const POSITIVE = "1A7F4B";
const NEUTRAL = "8A8580";
const NEGATIVE = "C0392B";

const FONT = "Montserrat";

// 13.333in x 7.5in at 16:9.
const W = 13.333;
const MARGIN = 0.62;
const CONTENT_W = W - MARGIN * 2;

const TYPE_LABELS: Record<string, string> = {
  broadcast: "TV / radio",
  news: "News",
  social: "Social",
  local: "Local news",
};

const LABEL_LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed — Outside the Beltway",
  likely_otb: "Likely — corridor",
  uncertain_i66_segment: "Uncertain segment",
  related: "Related / parent company",
};

export type DeckOptions = {
  title: string;
  clientName: string;
  summary: string;
  featuredIds: string[];
  generatedOn: string;
};

/** Build the deck and return it as a .pptx buffer. */
export async function buildReportDeck(
  report: Report,
  options: DeckOptions,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "The Casey Group";
  pptx.company = "The Casey Group";
  pptx.title = options.title;

  addCoverSlide(pptx, report, options);
  addSnapshotSlide(pptx, report, options);
  addCoverageMixSlide(pptx, report);
  addSentimentSlide(pptx, report);
  addFeaturedSlide(pptx, report, options);
  addIndexSlides(pptx, report);

  // `write` returns a Node Buffer under the "nodebuffer" output type.
  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}

/* ------------------------------- Slides ------------------------------- */

function addCoverSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: NAVY };

  // Diagonal wash approximating the web cover's navy-to-blue gradient.
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: 7.5,
    fill: { type: "solid", color: NAVY_MID, transparency: 45 },
    line: { type: "none" },
    rotate: 0,
  });
  // Orange frame rules, top and bottom.
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: 0.1,
    fill: { color: ORANGE },
    line: { type: "none" },
  });
  slide.addShape("rect", {
    x: 0,
    y: 7.4,
    w: W,
    h: 0.1,
    fill: { color: ORANGE },
    line: { type: "none" },
  });

  slide.addText(options.clientName.toUpperCase(), {
    x: MARGIN,
    y: 1.5,
    w: CONTENT_W,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: GOLD,
    charSpacing: 2,
  });

  slide.addText(options.title, {
    x: MARGIN,
    y: 2.05,
    w: CONTENT_W,
    h: 1.5,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: "FFFFFF",
  });

  slide.addText(report.range.label, {
    x: MARGIN,
    y: 3.5,
    w: CONTENT_W,
    h: 0.5,
    fontFace: FONT,
    fontSize: 20,
    color: "D8E4F4",
  });

  brandRule(slide, MARGIN, 4.15);

  slide.addText("Sit Less. Live More.", {
    x: MARGIN,
    y: 4.5,
    w: CONTENT_W,
    h: 0.45,
    fontFace: FONT,
    fontSize: 18,
    italic: true,
    color: ORANGE,
  });

  slide.addText(
    "EARNED MEDIA  ·  WASHINGTON, DC MARKET  ·  WEB + BROADCAST + SOCIAL",
    {
      x: MARGIN,
      y: 6.35,
      w: CONTENT_W,
      h: 0.3,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: "9FB6D4",
      charSpacing: 1,
    },
  );
  slide.addText(
    `Prepared by The Casey Group  ·  Generated ${options.generatedOn}`,
    {
      x: MARGIN,
      y: 6.7,
      w: CONTENT_W,
      h: 0.3,
      fontFace: FONT,
      fontSize: 11,
      color: "8AA3C4",
    },
  );
}

function addSnapshotSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
): void {
  const slide = contentSlide(
    pptx,
    "Executive snapshot",
    "What are the key results?",
  );

  const broadcast =
    report.byType.find((type) => type.type === "broadcast")?.count ?? 0;
  const metrics = [
    { label: "Earned mentions", value: report.totalMentions },
    { label: "Unique publishers", value: report.uniqueOutlets },
    { label: "Broadcast mentions", value: broadcast },
    { label: "Priority mentions", value: report.importantCount },
  ];

  const cardW = (CONTENT_W - 0.3 * 3) / 4;
  metrics.forEach((metric, index) => {
    const x = MARGIN + index * (cardW + 0.3);
    slide.addShape("roundRect", {
      x,
      y: 1.95,
      w: cardW,
      h: 1.5,
      fill: { color: PANEL },
      line: { color: WARM_GRAY, width: 1 },
      rectRadius: 0.12,
    });
    slide.addText(String(metric.value), {
      x,
      y: 2.1,
      w: cardW,
      h: 0.75,
      align: "center",
      fontFace: FONT,
      fontSize: 40,
      bold: true,
      color: BLUE,
    });
    slide.addText(metric.label.toUpperCase(), {
      x,
      y: 2.85,
      w: cardW,
      h: 0.4,
      align: "center",
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: MUTED,
      charSpacing: 1,
    });
  });

  slide.addShape("roundRect", {
    x: MARGIN,
    y: 3.7,
    w: CONTENT_W,
    h: 2.9,
    fill: { color: PANEL },
    line: { color: WARM_GRAY, width: 1 },
    rectRadius: 0.12,
  });
  slide.addText("SUMMARY", {
    x: MARGIN + 0.3,
    y: 3.9,
    w: CONTENT_W - 0.6,
    h: 0.3,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: BLUE,
    charSpacing: 1,
  });
  slide.addText(options.summary, {
    x: MARGIN + 0.3,
    y: 4.25,
    w: CONTENT_W - 0.6,
    h: 2.1,
    fontFace: FONT,
    fontSize: 14,
    color: INK,
    lineSpacingMultiple: 1.3,
    valign: "top",
  });
}

function addCoverageMixSlide(pptx: PptxGenJS, report: Report): void {
  const slide = contentSlide(
    pptx,
    "Coverage mix",
    "How does earned media break down?",
  );

  const colW = (CONTENT_W - 0.4) / 2;

  panel(slide, MARGIN, 1.95, colW, 2.15, "Media type");
  mixBars(
    slide,
    report.byType.map(({ type, count }) => ({
      label: TYPE_LABELS[type] ?? type,
      count,
    })),
    report.totalMentions,
    MARGIN + 0.25,
    2.45,
    colW - 0.5,
  );

  panel(slide, MARGIN, 4.3, colW, 2.3, "Relevance mix");
  mixBars(
    slide,
    report.byLabel.map(({ label, count }) => ({
      label: LABEL_LABELS[label] ?? label,
      count,
    })),
    report.totalMentions,
    MARGIN + 0.25,
    4.8,
    colW - 0.5,
  );

  const rightX = MARGIN + colW + 0.4;
  panel(slide, rightX, 1.95, colW, 4.65, "Top publishers");
  if (report.topOutlets.length) {
    const rows: PptxGenJS.TableRow[] = report.topOutlets
      .slice(0, 10)
      .map(({ source, count }) => [
        {
          text: source,
          options: { fontFace: FONT, fontSize: 11, color: INK, bold: true },
        },
        {
          text: String(count),
          options: {
            fontFace: FONT,
            fontSize: 11,
            color: BLUE,
            bold: true,
            align: "right" as const,
          },
        },
      ]);
    slide.addTable(rows, {
      x: rightX + 0.25,
      y: 2.45,
      w: colW - 0.5,
      colW: [colW - 1.2, 0.7],
      border: { type: "solid", color: "EDEAE7", pt: 1 },
      rowH: 0.32,
      valign: "middle",
    });
  } else {
    emptyNote(slide, rightX + 0.25, 2.5, colW - 0.5, "No publishers recorded.");
  }
}

function addSentimentSlide(pptx: PptxGenJS, report: Report): void {
  const slide = contentSlide(
    pptx,
    "Sentiment",
    "How did coverage reflect on the 66 Express?",
  );
  const mix = report.sentiment;

  if (mix.scored === 0) {
    emptyNote(
      slide,
      MARGIN,
      2.6,
      CONTENT_W,
      "No coverage was scored for sentiment in this period.",
    );
    return;
  }

  slide.addText(mix.net! > 0 ? `+${mix.net}` : String(mix.net), {
    x: MARGIN,
    y: 2.0,
    w: 3.0,
    h: 1.2,
    fontFace: FONT,
    fontSize: 60,
    bold: true,
    color: BLUE,
  });
  slide.addText("NET SENTIMENT", {
    x: MARGIN,
    y: 3.1,
    w: 3.0,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    bold: true,
    color: MUTED,
    charSpacing: 1,
  });

  slide.addText(
    [
      {
        text: `${mix.scored} of ${mix.scored + mix.unscored} mentions scored`,
        options: { breakLine: true },
      },
      ...(mix.adjusted > 0
        ? [{ text: `${mix.adjusted} adjusted by an analyst` }]
        : []),
    ],
    {
      x: W - MARGIN - 4.2,
      y: 2.15,
      w: 4.2,
      h: 0.8,
      align: "right",
      fontFace: FONT,
      fontSize: 12,
      color: MUTED,
    },
  );

  // Stacked bar, proportional to scored coverage.
  const barY = 3.75;
  const barH = 0.34;
  const segments = [
    { label: "Positive", count: mix.positive, color: POSITIVE },
    { label: "Neutral", count: mix.neutral, color: NEUTRAL },
    { label: "Negative", count: mix.negative, color: NEGATIVE },
  ];
  let cursor = MARGIN;
  for (const segment of segments) {
    if (!segment.count) continue;
    const width = (segment.count / mix.scored) * CONTENT_W;
    slide.addShape("rect", {
      x: cursor,
      y: barY,
      w: width,
      h: barH,
      fill: { color: segment.color },
      line: { type: "none" },
    });
    cursor += width;
  }

  segments.forEach((segment, index) => {
    const x = MARGIN + index * (CONTENT_W / 3);
    slide.addShape("ellipse", {
      x,
      y: barY + 0.65,
      w: 0.16,
      h: 0.16,
      fill: { color: segment.color },
      line: { type: "none" },
    });
    slide.addText(
      `${segment.label}   ${segment.count} · ${Math.round((segment.count / mix.scored) * 100)}%`,
      {
        x: x + 0.26,
        y: barY + 0.57,
        w: CONTENT_W / 3 - 0.3,
        h: 0.32,
        fontFace: FONT,
        fontSize: 13,
        color: INK,
      },
    );
  });

  slide.addText(
    mix.unscored > 0
      ? `Percentages are of scored coverage. ${mix.unscored} mention${mix.unscored === 1 ? "" : "s"} in this period ${mix.unscored === 1 ? "is" : "are"} not scored — sentiment is assessed for confirmed and likely Outside the Beltway coverage only. Analyst adjustments override the automatic score.`
      : "Sentiment is assessed for confirmed and likely Outside the Beltway coverage. Analyst adjustments override the automatic score.",
    {
      x: MARGIN,
      y: 5.5,
      w: CONTENT_W,
      h: 0.9,
      fontFace: FONT,
      fontSize: 10,
      color: MUTED,
      lineSpacingMultiple: 1.3,
    },
  );
}

function addFeaturedSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
): void {
  const slide = contentSlide(
    pptx,
    "Curated coverage",
    "Featured mentions",
  );

  const featuredSet = new Set(options.featuredIds);
  const featured = report.items.filter((item) => featuredSet.has(item.id));

  if (featured.length === 0) {
    emptyNote(
      slide,
      MARGIN,
      2.6,
      CONTENT_W,
      "No featured stories were selected for this period.",
    );
    return;
  }

  const shown = featured.slice(0, 4);
  const cardH = 1.05;
  shown.forEach((item, index) => {
    const y = 1.95 + index * (cardH + 0.18);
    slide.addShape("roundRect", {
      x: MARGIN,
      y,
      w: CONTENT_W,
      h: cardH,
      fill: { color: PANEL },
      line: { color: WARM_GRAY, width: 1 },
      rectRadius: 0.1,
    });
    slide.addText(item.title, {
      x: MARGIN + 0.28,
      y: y + 0.12,
      w: CONTENT_W - 0.56,
      h: 0.42,
      fontFace: FONT,
      fontSize: 14,
      bold: true,
      color: INK,
      hyperlink: { url: item.url },
    });
    slide.addText(
      `${item.source}  ·  ${typeLabelOf(item)}  ·  ${formatDate(item)}${
        item.sentiment ? `  ·  ${sentimentWord(item.sentiment)}` : ""
      }`,
      {
        x: MARGIN + 0.28,
        y: y + 0.55,
        w: CONTENT_W - 0.56,
        h: 0.34,
        fontFace: FONT,
        fontSize: 11,
        color: MUTED,
      },
    );
  });

  if (featured.length > shown.length) {
    slide.addText(
      `+ ${featured.length - shown.length} more featured mention${featured.length - shown.length === 1 ? "" : "s"} in the coverage index.`,
      {
        x: MARGIN,
        y: 6.5,
        w: CONTENT_W,
        h: 0.3,
        fontFace: FONT,
        fontSize: 11,
        italic: true,
        color: MUTED,
      },
    );
  }
}

const INDEX_ROWS_PER_SLIDE = 12;
const INDEX_MAX_SLIDES = 8;

function addIndexSlides(pptx: PptxGenJS, report: Report): void {
  if (report.items.length === 0) {
    const slide = contentSlide(pptx, "Coverage index", "All captured mentions");
    emptyNote(
      slide,
      MARGIN,
      2.6,
      CONTENT_W,
      "No mentions were captured in this period.",
    );
    return;
  }

  const capacity = INDEX_ROWS_PER_SLIDE * INDEX_MAX_SLIDES;
  const included = report.items.slice(0, capacity);
  const omitted = report.items.length - included.length;
  const pageCount = Math.ceil(included.length / INDEX_ROWS_PER_SLIDE);

  for (let page = 0; page < pageCount; page++) {
    const rows = included.slice(
      page * INDEX_ROWS_PER_SLIDE,
      (page + 1) * INDEX_ROWS_PER_SLIDE,
    );
    const slide = contentSlide(
      pptx,
      "Coverage index",
      pageCount > 1
        ? `All captured mentions (${page + 1} of ${pageCount})`
        : "All captured mentions",
    );

    const header: PptxGenJS.TableRow = [
      "Date",
      "Mention",
      "Publisher",
      "Type",
      "Sentiment",
    ].map((text) => ({
      text,
      options: {
        fontFace: FONT,
        fontSize: 10,
        bold: true,
        color: "FFFFFF",
        fill: { color: BLUE },
        align: "left" as const,
      },
    }));

    const body: PptxGenJS.TableRow[] = rows.map((item) => [
      {
        text: formatDate(item),
        options: { fontFace: FONT, fontSize: 10, color: MUTED },
      },
      {
        text: item.title,
        options: {
          fontFace: FONT,
          fontSize: 10,
          color: INK,
          hyperlink: { url: item.url },
        },
      },
      {
        text: item.source,
        options: { fontFace: FONT, fontSize: 10, color: INK },
      },
      {
        text: typeLabelOf(item),
        options: { fontFace: FONT, fontSize: 10, color: MUTED },
      },
      {
        text: item.sentiment ? sentimentWord(item.sentiment) : "—",
        options: {
          fontFace: FONT,
          fontSize: 10,
          color: item.sentiment ? sentimentColor(item.sentiment) : MUTED,
          bold: Boolean(item.sentiment),
        },
      },
    ]);

    slide.addTable([header, ...body], {
      x: MARGIN,
      y: 1.95,
      w: CONTENT_W,
      colW: [1.15, 5.5, 2.5, 1.35, 1.6],
      border: { type: "solid", color: "E6E3E0", pt: 1 },
      rowH: 0.34,
      valign: "middle",
      autoPage: false,
    });

    if (page === pageCount - 1 && omitted > 0) {
      slide.addText(
        `${omitted} further mention${omitted === 1 ? "" : "s"} captured in this period ${omitted === 1 ? "is" : "are"} not listed here — the full set is in the CSV export.`,
        {
          x: MARGIN,
          y: 6.55,
          w: CONTENT_W,
          h: 0.35,
          fontFace: FONT,
          fontSize: 10,
          italic: true,
          color: MUTED,
        },
      );
    }
  }
}

/* ------------------------------ Helpers ------------------------------- */

function contentSlide(
  pptx: PptxGenJS,
  kicker: string,
  heading: string,
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: CANVAS };

  slide.addText(kicker.toUpperCase(), {
    x: MARGIN,
    y: 0.5,
    w: CONTENT_W,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    bold: true,
    color: ORANGE,
    charSpacing: 2,
  });
  slide.addText(heading.toUpperCase(), {
    x: MARGIN,
    y: 0.82,
    w: CONTENT_W,
    h: 0.55,
    fontFace: FONT,
    fontSize: 26,
    bold: true,
    color: BLUE,
  });
  brandRule(slide, MARGIN, 1.5);
  return slide;
}

/** The brand's dashed orange rule: one long bar, a dot, a short bar. */
function brandRule(slide: PptxGenJS.Slide, x: number, y: number): void {
  const segments = [
    { w: 1.85, gap: 0.1 },
    { w: 0.17, gap: 0.1 },
    { w: 0.66, gap: 0 },
  ];
  let cursor = x;
  for (const segment of segments) {
    slide.addShape("roundRect", {
      x: cursor,
      y,
      w: segment.w,
      h: 0.07,
      fill: { color: ORANGE },
      line: { type: "none" },
      rectRadius: 0.035,
    });
    cursor += segment.w + segment.gap;
  }
}

function panel(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
): void {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    fill: { color: PANEL },
    line: { color: WARM_GRAY, width: 1 },
    rectRadius: 0.12,
  });
  slide.addText(title.toUpperCase(), {
    x: x + 0.25,
    y: y + 0.16,
    w: w - 0.5,
    h: 0.3,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: BLUE,
    charSpacing: 1,
  });
}

function mixBars(
  slide: PptxGenJS.Slide,
  rows: Array<{ label: string; count: number }>,
  total: number,
  x: number,
  y: number,
  w: number,
): void {
  if (rows.length === 0) {
    emptyNote(slide, x, y, w, "No mentions in this period.");
    return;
  }
  rows.slice(0, 4).forEach((row, index) => {
    const rowY = y + index * 0.42;
    const percent = total ? Math.round((row.count / total) * 100) : 0;
    slide.addText(row.label, {
      x,
      y: rowY,
      w: w * 0.62,
      h: 0.24,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: INK,
    });
    slide.addText(`${row.count} · ${percent}%`, {
      x: x + w * 0.62,
      y: rowY,
      w: w * 0.38,
      h: 0.24,
      align: "right",
      fontFace: FONT,
      fontSize: 11,
      color: MUTED,
    });
    slide.addShape("roundRect", {
      x,
      y: rowY + 0.25,
      w,
      h: 0.1,
      fill: { color: "E4E1DE" },
      line: { type: "none" },
      rectRadius: 0.05,
    });
    if (percent > 0) {
      slide.addShape("roundRect", {
        x,
        y: rowY + 0.25,
        w: Math.max(w * (percent / 100), 0.08),
        h: 0.1,
        fill: { color: BLUE },
        line: { type: "none" },
        rectRadius: 0.05,
      });
    }
  });
}

function emptyNote(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  text: string,
): void {
  slide.addText(text, {
    x,
    y,
    w,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    italic: true,
    color: MUTED,
  });
}

function typeLabelOf(item: ReportItem): string {
  if (item.sourceType === "social") {
    return socialPlatform(item.url);
  }
  return TYPE_LABELS[item.sourceType] ?? item.sourceType;
}

function formatDate(item: ReportItem): string {
  if (!item.publishedAt) {
    return "—";
  }
  return new Date(item.publishedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function sentimentWord(sentiment: string): string {
  return sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
}

function sentimentColor(sentiment: string): string {
  if (sentiment === "positive") return POSITIVE;
  if (sentiment === "negative") return NEGATIVE;
  return NEUTRAL;
}
