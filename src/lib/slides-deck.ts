import PptxGenJS from "pptxgenjs";
import { socialPlatform } from "@/lib/digest";
import type { Report, ReportItem } from "@/lib/report";
import type { SentimentTrend } from "@/lib/report-insights";

/**
 * Renders a report as an 8.5×11 portrait PowerPoint deck, matching the layout
 * of TCG's weekly "Executive Summary" deliverable rather than a generic slide
 * shape.
 *
 * PPTX rather than direct Google Slides API drawing: Google converts .pptx to
 * a native editable Slides deck on upload, and .pptx is the same format as the
 * existing Exec Summary decks.
 *
 * Section order follows the client template:
 *   1. Cover + table of contents
 *   2. Weekly Overview divider
 *   3. Facility mentions — counts (Online/Print · Radio · TV), sentiment,
 *      topics, outlets, then the itemised list
 *   4. Relevant News — adjacent/industry stories
 *   5. Social — counts, sentiment, trend, themes, posts by platform
 *   6. Comments & Screenshots — a placeholder the analyst fills by hand
 *
 * Comment taxonomy and screenshots stay manual for now, so the deck ends with
 * a labelled placeholder rather than fabricating those pages.
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

// US Letter portrait.
const PAGE_W = 8.5;
const PAGE_H = 11;
const MARGIN = 0.55;
const CONTENT_W = PAGE_W - MARGIN * 2;

const LABEL_LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed — Outside the Beltway",
  likely_otb: "Likely — corridor",
  uncertain_i66_segment: "Uncertain segment",
  related: "Related / adjacent",
};

// Known radio outlets, to split "broadcast" into Radio vs TV the way the
// template reports them. Everything else broadcast is treated as TV.
const RADIO = /\bwtop\b|\bwamu\b|\bwmal\b|\bnpr\b|radio/i;

const FACILITY_LABELS = new Set(["confirmed_otb", "likely_otb"]);

export type DeckOptions = {
  title: string;
  clientName: string;
  summary: string;
  featuredIds: string[];
  generatedOn: string;
  mediaThemes?: string[];
  socialThemes?: string[];
  sentimentTrend?: SentimentTrend;
};

type Derived = {
  facility: ReportItem[];
  relevant: ReportItem[];
  social: ReportItem[];
  online: number;
  radio: number;
  tv: number;
  facilitySentiment: { positive: number; neutral: number; negative: number };
  socialSentiment: { positive: number; neutral: number; negative: number };
  facilityOutlets: string[];
};

/** Build the deck and return it as a .pptx buffer. */
export async function buildReportDeck(
  report: Report,
  options: DeckOptions,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LETTER_PORTRAIT", width: PAGE_W, height: PAGE_H });
  pptx.layout = "LETTER_PORTRAIT";
  pptx.author = "The Casey Group";
  pptx.company = "The Casey Group";
  pptx.title = options.title;

  const d = derive(report);

  // Pre-compute how many slides each itemised section spans, so the table of
  // contents can carry real page numbers.
  const facilityListPages = pageCount(d.facility.length, FACILITY_PER_PAGE);
  const relevantPages = pageCount(d.relevant.length, RELEVANT_PER_PAGE);
  const socialPages = pageCount(d.social.length, SOCIAL_PER_PAGE);

  let page = 1;
  const toc: TocEntry[] = [];
  page += 1; // cover itself
  page += 1; // weekly overview divider
  toc.push({ label: "Number and Sentiment of Mentions", page });
  page += 1 + facilityListPages; // facility summary + its list
  toc.push({ label: "Relevant News", page });
  page += Math.max(relevantPages, 1);
  toc.push({ label: "Social Media Mentions and Comments", page });
  page += 1 + socialPages; // social summary + its posts
  toc.push({ label: "Social Media Screenshots", page });

  addCoverSlide(pptx, report, options, toc);
  addDividerSlide(pptx, "Weekly Overview");
  addFacilitySummarySlide(pptx, report, options, d);
  addItemListSlides(pptx, d.facility, FACILITY_PER_PAGE, {
    kicker: "Number and Sentiment of Mentions",
    heading: "Broadcast / Published Mentions",
    showSentiment: true,
  });
  addItemListSlides(pptx, d.relevant, RELEVANT_PER_PAGE, {
    kicker: "Relevant News",
    heading: "News Potentially Relevant to 66 Express OTB / I-66 EMP",
    showSentiment: false,
    emptyNote:
      "No adjacent or industry news was captured as relevant this period.",
  });
  addSocialSummarySlide(pptx, options, d);
  addItemListSlides(pptx, d.social, SOCIAL_PER_PAGE, {
    kicker: "Social Media Mentions",
    heading: "Details of Posts",
    showSentiment: true,
    showPlatform: true,
  });
  addPlaceholderSlide(pptx);

  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}

/* ------------------------------ Derive ------------------------------- */

function countSentiment(items: ReportItem[]) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const item of items) {
    if (item.sentiment && item.sentiment in counts) {
      counts[item.sentiment as keyof typeof counts]++;
    }
  }
  return counts;
}

function derive(report: Report): Derived {
  const news = report.items.filter((item) => item.sourceType !== "social");
  const facility = news.filter((item) => FACILITY_LABELS.has(item.label));
  const relevant = news.filter((item) => item.label === "related");
  const social = report.items.filter((item) => item.sourceType === "social");

  let online = 0;
  let radio = 0;
  let tv = 0;
  for (const item of facility) {
    if (item.sourceType === "broadcast") {
      if (RADIO.test(item.source)) radio++;
      else tv++;
    } else {
      online++;
    }
  }

  const outletCounts = new Map<string, number>();
  for (const item of facility) {
    outletCounts.set(item.source, (outletCounts.get(item.source) ?? 0) + 1);
  }
  const facilityOutlets = [...outletCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([source]) => source);

  return {
    facility,
    relevant,
    social,
    online,
    radio,
    tv,
    facilitySentiment: countSentiment(facility),
    socialSentiment: countSentiment(social),
    facilityOutlets,
  };
}

/* ------------------------------- Slides ------------------------------- */

type TocEntry = { label: string; page: number };

function addCoverSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
  toc: TocEntry[],
): void {
  const slide = pptx.addSlide();
  slide.background = { color: NAVY };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: PAGE_W,
    h: PAGE_H,
    fill: { type: "solid", color: NAVY_MID, transparency: 45 },
    line: { type: "none" },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: PAGE_W,
    h: 0.12,
    fill: { color: ORANGE },
    line: { type: "none" },
  });
  slide.addShape("rect", {
    x: 0,
    y: PAGE_H - 0.12,
    w: PAGE_W,
    h: 0.12,
    fill: { color: ORANGE },
    line: { type: "none" },
  });

  slide.addText("EXECUTIVE SUMMARY", {
    x: MARGIN,
    y: 1.3,
    w: CONTENT_W,
    h: 0.45,
    fontFace: FONT,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
    charSpacing: 1,
  });
  slide.addText(options.clientName, {
    x: MARGIN,
    y: 1.85,
    w: CONTENT_W,
    h: 0.4,
    fontFace: FONT,
    fontSize: 18,
    color: GOLD,
  });
  slide.addText("News Media & Social Media Mention / Sentiment Trends", {
    x: MARGIN,
    y: 2.3,
    w: CONTENT_W,
    h: 0.35,
    fontFace: FONT,
    fontSize: 13,
    color: "D8E4F4",
  });
  slide.addText(`Period: ${report.range.label}`, {
    x: MARGIN,
    y: 2.72,
    w: CONTENT_W,
    h: 0.35,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: "FFFFFF",
  });

  brandRule(slide, MARGIN, 3.25, "FFFFFF");

  // Table of contents.
  slide.addText("TABLE OF CONTENTS", {
    x: MARGIN,
    y: 3.7,
    w: CONTENT_W,
    h: 0.35,
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: GOLD,
    charSpacing: 1,
  });
  const tocRows: PptxGenJS.TableRow[] = toc.map((entry) => [
    {
      text: entry.label,
      options: { fontFace: FONT, fontSize: 13, color: "FFFFFF" },
    },
    {
      text: String(entry.page),
      options: {
        fontFace: FONT,
        fontSize: 13,
        color: "D8E4F4",
        align: "right" as const,
      },
    },
  ]);
  slide.addTable(tocRows, {
    x: MARGIN,
    y: 4.15,
    w: CONTENT_W,
    colW: [CONTENT_W - 0.9, 0.9],
    border: { type: "solid", color: "24466E", pt: 1 },
    rowH: 0.4,
    valign: "middle",
  });

  slide.addText(
    `Prepared by The Casey Group  ·  Generated ${options.generatedOn}`,
    {
      x: MARGIN,
      y: PAGE_H - 0.8,
      w: CONTENT_W,
      h: 0.3,
      fontFace: FONT,
      fontSize: 10,
      color: "8AA3C4",
    },
  );
}

function addDividerSlide(pptx: PptxGenJS, title: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: BLUE };
  slide.addText(title.toUpperCase(), {
    x: MARGIN,
    y: PAGE_H / 2 - 0.6,
    w: CONTENT_W,
    h: 1.0,
    align: "center",
    fontFace: FONT,
    fontSize: 30,
    bold: true,
    color: "FFFFFF",
    charSpacing: 2,
  });
  brandRuleCentered(slide, PAGE_H / 2 + 0.45);
}

function addFacilitySummarySlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
  d: Derived,
): void {
  const slide = contentSlide(
    pptx,
    "Number and Sentiment of Mentions",
    "Mentions of Our Facility",
  );

  let y = 1.75;

  y = labelledCounts(
    slide,
    y,
    "Media Mentions of Our Facility This Period",
    [
      { label: "Online / Print", value: d.online },
      { label: "Radio", value: d.radio },
      { label: "TV", value: d.tv },
    ],
    BLUE,
  );

  y = labelledCounts(
    slide,
    y,
    "Sentiment Regarding Our Facility",
    [
      { label: "Negative", value: d.facilitySentiment.negative, color: NEGATIVE },
      { label: "Neutral", value: d.facilitySentiment.neutral, color: NEUTRAL },
      { label: "Positive", value: d.facilitySentiment.positive, color: POSITIVE },
    ],
    INK,
  );

  y = labelledList(
    slide,
    y,
    "Popular Topics",
    options.mediaThemes?.length ? options.mediaThemes : ["—"],
  );

  y = labelledList(
    slide,
    y,
    "Prominent Outlets",
    d.facilityOutlets.length ? d.facilityOutlets : ["—"],
  );

  // Executive summary paragraph, if the analyst wrote one.
  if (options.summary.trim()) {
    panel(slide, MARGIN, y + 0.1, CONTENT_W, 1.6, "Summary");
    slide.addText(options.summary, {
      x: MARGIN + 0.25,
      y: y + 0.55,
      w: CONTENT_W - 0.5,
      h: 1.05,
      fontFace: FONT,
      fontSize: 11,
      color: INK,
      valign: "top",
      lineSpacingMultiple: 1.25,
    });
  }
}

function addSocialSummarySlide(
  pptx: PptxGenJS,
  options: DeckOptions,
  d: Derived,
): void {
  const slide = contentSlide(
    pptx,
    "Social Media Mentions and Comments",
    "Social Media Mentions",
  );

  let y = 1.75;

  slide.addText("Posts Mentioning Our Facility This Period", {
    x: MARGIN,
    y,
    w: CONTENT_W * 0.7,
    h: 0.4,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: BLUE,
  });
  slide.addText(String(d.social.length), {
    x: MARGIN + CONTENT_W * 0.7,
    y: y - 0.1,
    w: CONTENT_W * 0.3,
    h: 0.6,
    align: "right",
    fontFace: FONT,
    fontSize: 30,
    bold: true,
    color: BLUE,
  });
  y += 0.7;

  y = labelledCounts(
    slide,
    y,
    "Sentiment (per TCG analysis)",
    [
      { label: "Negative", value: d.socialSentiment.negative, color: NEGATIVE },
      { label: "Neutral", value: d.socialSentiment.neutral, color: NEUTRAL },
      { label: "Positive", value: d.socialSentiment.positive, color: POSITIVE },
    ],
    INK,
  );

  const trend = options.sentimentTrend;
  const trendText = trend
    ? trend.detail
      ? `${trend.label} (${trend.detail})`
      : trend.label
    : "—";
  slide.addText(
    [
      {
        text: "Sentiment Trend (vs. previous period):  ",
        options: { bold: true, color: BLUE },
      },
      { text: trendText, options: { color: INK } },
    ],
    {
      x: MARGIN,
      y,
      w: CONTENT_W,
      h: 0.4,
      fontFace: FONT,
      fontSize: 13,
    },
  );
  y += 0.55;

  labelledList(
    slide,
    y,
    "Popular Themes of Posts",
    options.socialThemes?.length ? options.socialThemes : ["—"],
  );
}

type ListOptions = {
  kicker: string;
  heading: string;
  showSentiment: boolean;
  showPlatform?: boolean;
  emptyNote?: string;
};

const FACILITY_PER_PAGE = 7;
const RELEVANT_PER_PAGE = 7;
const SOCIAL_PER_PAGE = 8;

function addItemListSlides(
  pptx: PptxGenJS,
  items: ReportItem[],
  perPage: number,
  opts: ListOptions,
): void {
  if (items.length === 0) {
    const slide = contentSlide(pptx, opts.kicker, opts.heading);
    emptyNote(
      slide,
      MARGIN,
      2.0,
      CONTENT_W,
      opts.emptyNote ?? "No items captured in this period.",
    );
    return;
  }

  const pages = pageCount(items.length, perPage);
  for (let p = 0; p < pages; p++) {
    const slice = items.slice(p * perPage, (p + 1) * perPage);
    const slide = contentSlide(
      pptx,
      opts.kicker,
      pages > 1 ? `${opts.heading} (${p + 1} of ${pages})` : opts.heading,
    );

    let y = 1.8;
    const rowH = (PAGE_H - y - MARGIN) / perPage;
    for (const item of slice) {
      renderItemRow(slide, item, y, rowH, opts);
      y += rowH;
    }
  }
}

function renderItemRow(
  slide: PptxGenJS.Slide,
  item: ReportItem,
  y: number,
  rowH: number,
  opts: ListOptions,
): void {
  slide.addShape("line", {
    x: MARGIN,
    y: y + rowH - 0.04,
    w: CONTENT_W,
    h: 0,
    line: { color: "E6E3E0", width: 1 },
  });

  const meta = [formatDate(item), item.source]
    .filter(Boolean)
    .join("  ·  ");
  slide.addText(meta, {
    x: MARGIN,
    y: y + 0.04,
    w: CONTENT_W,
    h: 0.24,
    fontFace: FONT,
    fontSize: 9,
    bold: true,
    color: MUTED,
  });

  slide.addText(item.title, {
    x: MARGIN,
    y: y + 0.28,
    w: CONTENT_W,
    h: rowH - 0.55,
    fontFace: FONT,
    fontSize: 11,
    bold: true,
    color: BLUE,
    valign: "top",
    hyperlink: { url: item.url },
  });

  const tags: string[] = [];
  if (opts.showPlatform) tags.push(socialPlatform(item.url));
  if (opts.showSentiment && item.sentiment) {
    tags.push(sentimentWord(item.sentiment));
  }
  if (tags.length) {
    slide.addText(tags.join("   ·   "), {
      x: MARGIN,
      y: y + rowH - 0.28,
      w: CONTENT_W,
      h: 0.22,
      fontFace: FONT,
      fontSize: 9,
      bold: true,
      color:
        opts.showSentiment && item.sentiment
          ? sentimentColor(item.sentiment)
          : MUTED,
    });
  }
}

function addPlaceholderSlide(pptx: PptxGenJS): void {
  const slide = contentSlide(
    pptx,
    "Social Media Screenshots",
    "Comments & Screenshots",
  );
  slide.addShape("roundRect", {
    x: MARGIN,
    y: 2.2,
    w: CONTENT_W,
    h: PAGE_H - 2.2 - MARGIN,
    fill: { color: PANEL },
    line: { color: WARM_GRAY, width: 1, dashType: "dash" },
    rectRadius: 0.12,
  });
  slide.addText(
    [
      {
        text: "Analyst section",
        options: { bold: true, fontSize: 14, color: BLUE, breakLine: true },
      },
      {
        text: "\nThe comment-category breakdown and post screenshots are added here by hand. Automated comment capture and screenshotting are on the roadmap, not yet in this deck.",
        options: { fontSize: 12, color: MUTED },
      },
    ],
    {
      x: MARGIN + 0.4,
      y: 2.6,
      w: CONTENT_W - 0.8,
      h: 1.6,
      fontFace: FONT,
      align: "center",
      valign: "top",
      lineSpacingMultiple: 1.3,
    },
  );
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
    y: 0.45,
    w: CONTENT_W,
    h: 0.3,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: ORANGE,
    charSpacing: 2,
  });
  slide.addText(heading.toUpperCase(), {
    x: MARGIN,
    y: 0.75,
    w: CONTENT_W,
    h: 0.55,
    fontFace: FONT,
    fontSize: 22,
    bold: true,
    color: BLUE,
  });
  brandRule(slide, MARGIN, 1.42, ORANGE);
  return slide;
}

/** A bold label with a row of "Name: value" counts; returns the next y. */
function labelledCounts(
  slide: PptxGenJS.Slide,
  y: number,
  label: string,
  entries: Array<{ label: string; value: number; color?: string }>,
  valueColor: string,
): number {
  slide.addText(`${label}:`, {
    x: MARGIN,
    y,
    w: CONTENT_W,
    h: 0.32,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: BLUE,
  });
  const runs: PptxGenJS.TextProps[] = [];
  entries.forEach((entry, index) => {
    runs.push({
      text: `${entry.label}: `,
      options: { color: entry.color ?? MUTED, bold: true },
    });
    runs.push({
      text: String(entry.value),
      options: { color: entry.color ?? valueColor, bold: true },
    });
    if (index < entries.length - 1) {
      runs.push({ text: "        ", options: { color: MUTED } });
    }
  });
  slide.addText(runs, {
    x: MARGIN + 0.1,
    y: y + 0.33,
    w: CONTENT_W - 0.1,
    h: 0.32,
    fontFace: FONT,
    fontSize: 13,
  });
  return y + 0.85;
}

/** A bold label with a comma-free bulleted phrase list; returns the next y. */
function labelledList(
  slide: PptxGenJS.Slide,
  y: number,
  label: string,
  values: string[],
): number {
  slide.addText(`${label}:`, {
    x: MARGIN,
    y,
    w: CONTENT_W,
    h: 0.32,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: BLUE,
  });
  slide.addText(values.join("     •     "), {
    x: MARGIN + 0.1,
    y: y + 0.33,
    w: CONTENT_W - 0.1,
    h: 0.32,
    fontFace: FONT,
    fontSize: 12,
    color: INK,
  });
  return y + 0.8;
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
    rectRadius: 0.1,
  });
  slide.addText(title.toUpperCase(), {
    x: x + 0.25,
    y: y + 0.14,
    w: w - 0.5,
    h: 0.3,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: BLUE,
    charSpacing: 1,
  });
}

/** The brand's dashed orange rule: one long bar, a dot, a short bar. */
function brandRule(slide: PptxGenJS.Slide, x: number, y: number, color: string): void {
  const segments = [
    { w: 1.6, gap: 0.09 },
    { w: 0.15, gap: 0.09 },
    { w: 0.58, gap: 0 },
  ];
  let cursor = x;
  for (const segment of segments) {
    slide.addShape("roundRect", {
      x: cursor,
      y,
      w: segment.w,
      h: 0.06,
      fill: { color },
      line: { type: "none" },
      rectRadius: 0.03,
    });
    cursor += segment.w + segment.gap;
  }
}

function brandRuleCentered(slide: PptxGenJS.Slide, y: number): void {
  const total = 1.6 + 0.09 + 0.15 + 0.09 + 0.58;
  brandRule(slide, (PAGE_W - total) / 2, y, ORANGE);
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

function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

function formatDate(item: ReportItem): string {
  if (!item.publishedAt) return "";
  return new Date(item.publishedAt).toLocaleDateString("en-US", {
    weekday: "short",
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
