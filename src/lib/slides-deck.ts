import path from "node:path";
import PptxGenJS from "pptxgenjs";
import { socialPlatform } from "@/lib/digest";
import { formatReach } from "@/lib/outlets";
import {
  sentimentBand,
  type Report,
  type ReportItem,
  type SentimentMix,
} from "@/lib/report";
import type { SentimentTrend } from "@/lib/report-insights";
import { buildWeeklyDeck } from "@/lib/weekly-slides";

/**
 * Renders a monthly or custom-range report as an 8.5×11 portrait PowerPoint
 * deck that mirrors the on-screen report (/reports) section for section, so
 * the Google Slides version reads like the printed PDF:
 *
 *   1. Cover (period-themed, same as the web cover)
 *   2. Executive snapshot — summary, KPI tiles, media vs. social by day,
 *      broadcast share
 *   3. Coverage mix — media type, relevance mix, top outlets, sentiment dials
 *   4. Amplification — estimated reach and social echo
 *   5. Social pulse — posts by platform, top accounts, recent posts
 *   6. Featured mentions (analyst-selected)
 *   7. Coverage index — every media mention, then every social mention
 *
 * Weekly reports keep their own client "Executive Summary" layout
 * (weekly-slides.ts).
 *
 * PPTX rather than direct Google Slides API drawing: Google converts .pptx to
 * a native editable Slides deck on upload. Everything is drawn with plain
 * shapes and text (no native charts) so it survives that conversion intact
 * and stays editable.
 */

const BLUE = "105CAE";
const ORANGE = "EE7729";
const GOLD = "F8A829";
const NAVY = "0A1F3C";
const HEADLINE = "123A63";
const WARM_GRAY = "D0CCC9";
const TRACK = "E4E1DE";
const DIVIDER = "E8E5E2";
const CHIP = "EFEDEA";
const BODY = "44546A";
const INK = "141413";
const MUTED = "62655F";
const PANEL = "FFFFFF";
const CANVAS = "F1EFEC";
const PILL_BLUE = "E3EDF9";

const POSITIVE = "1A7F4B";
const NEUTRAL = "8A8580";
const NEGATIVE = "C0392B";

const FONT = "Montserrat";

// US Letter portrait.
const PAGE_W = 8.5;
const PAGE_H = 11;
const MARGIN = 0.55;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 0.5;
const GAP = 0.22;

const TYPE_LABELS: Record<string, string> = {
  broadcast: "Broadcast (TV / radio)",
  news: "Online news",
  social: "Social",
};

const LABEL_LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed 66 OTB",
  likely_otb: "Likely corridor",
  related: "Operator / industry",
  uncertain_i66_segment: "Uncertain segment",
};

export type DeckOptions = {
  title: string;
  clientName: string;
  summary: string;
  featuredIds: string[];
  generatedOn: string;
  mediaThemes?: string[];
  socialThemes?: string[];
  sentimentTrend?: SentimentTrend;
  /** Oldest to newest, ending with the current week. */
  weeklyHistory?: Report[];
  /** Hand-set dials. Null/undefined = print the calculated value. */
  mediaScoreOverride?: number | null;
  socialScoreOverride?: number | null;
};

/** Build the deck and return it as a .pptx buffer. */
export async function buildReportDeck(
  report: Report,
  options: DeckOptions,
): Promise<Buffer> {
  if (report.range.period === "weekly") {
    return buildWeeklyDeck(report, options);
  }
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LETTER_PORTRAIT", width: PAGE_W, height: PAGE_H });
  pptx.layout = "LETTER_PORTRAIT";
  pptx.author = "The Casey Group";
  pptx.company = "The Casey Group";
  pptx.title = options.title;

  const itemsById = new Map(report.items.map((item) => [item.id, item]));
  const featured = [...new Set(options.featuredIds)]
    .map((id) => itemsById.get(id))
    .filter((item): item is ReportItem => Boolean(item));

  addCoverSlide(pptx, report, options);
  addSnapshotSlide(pptx, report, options);
  addCoverageMixSlide(pptx, report, options);
  addAmplificationSlide(pptx, report);
  addSocialPulseSlide(pptx, report);
  addFeaturedSlides(pptx, featured);
  addIndexSlides(
    pptx,
    report.items.filter((item) => item.sourceType !== "social"),
    "All media mentions",
    "No online news or broadcast mentions were captured in this period. Quiet periods are normal.",
  );
  addIndexSlides(
    pptx,
    report.items.filter((item) => item.sourceType === "social"),
    "All social media mentions",
    "No public social mentions were captured in this period.",
  );

  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}

/* ------------------------------- Cover -------------------------------- */

type CoverTheme = {
  background: string;
  badge: string;
  badgeFill: string | null;
  badgeText: string;
  client: string;
  title: string;
  range: string;
  taglineLead: string;
  taglineAccent: string;
  pill: string;
  footer: string;
};

// Same three treatments as COVER_THEMES in reports/report-view.tsx.
const COVER_THEMES: Record<"monthly" | "custom", CoverTheme> = {
  // Majority orange with blue highlights.
  monthly: {
    background: ORANGE,
    badge: "Monthly report",
    badgeFill: BLUE,
    badgeText: "FFFFFF",
    client: NAVY,
    title: "FFFFFF",
    range: "FFFFFF",
    taglineLead: "FFFFFF",
    taglineAccent: NAVY,
    pill: NAVY,
    footer: NAVY,
  },
  // White, with the brand's orange and blue as accents.
  custom: {
    background: "FFFFFF",
    badge: "Custom range",
    badgeFill: null,
    badgeText: BLUE,
    client: "D9621A",
    title: BLUE,
    range: "2F3B47",
    taglineLead: NAVY,
    taglineAccent: ORANGE,
    pill: BLUE,
    footer: "5B6B7C",
  },
};

function addCoverSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
): void {
  const period = report.range.period === "monthly" ? "monthly" : "custom";
  const theme = COVER_THEMES[period];
  const slide = pptx.addSlide();
  slide.background = { color: theme.background };

  if (period === "custom") {
    diagonalStripes(slide);
    rect(slide, 0, 0, 0.16, PAGE_H, ORANGE);
    rect(slide, 0, PAGE_H - 0.1, PAGE_W, 0.1, BLUE);
  } else {
    rect(slide, 0, 0, PAGE_W, 0.16, BLUE);
    rect(slide, 0, PAGE_H - 0.16, PAGE_W, 0.16, BLUE);
    const month = monthAbbreviation(report.range.key);
    if (month) {
      text(slide, month.toUpperCase(), {
        x: 0.3,
        y: PAGE_H - 3.4,
        w: PAGE_W - 0.3,
        h: 3.0,
        fontSize: 190,
        bold: true,
        color: "FFFFFF",
        transparency: 84,
        align: "right",
        valign: "bottom",
      });
    }
  }

  // Logos sit on white chips, as on the web cover.
  const logoBorder = period === "custom" ? WARM_GRAY : "FFFFFF";
  roundRect(slide, MARGIN + 0.1, 0.65, 1.15, 0.95, PANEL, logoBorder, 0.12);
  slide.addImage({
    path: publicAsset("66OTB.png"),
    x: MARGIN + 0.22,
    y: 0.74,
    w: 0.91,
    h: 0.71,
  });
  roundRect(slide, PAGE_W - MARGIN - 2.15, 0.65, 2.15, 0.78, PANEL, logoBorder, 0.12);
  slide.addImage({
    path: publicAsset("TCG.png"),
    x: PAGE_W - MARGIN - 2.0,
    y: 0.79,
    w: 1.85,
    h: 0.52,
  });

  const left = MARGIN + 0.1;
  const width = CONTENT_W - 0.1;
  let y = 3.2;

  pill(slide, left, y, theme.badge, {
    fill: theme.badgeFill,
    border: theme.badgeFill ?? theme.badgeText,
    color: theme.badgeText,
    fontSize: 9,
    h: 0.34,
  });
  y += 0.6;

  text(slide, options.clientName.toUpperCase(), {
    x: left,
    y,
    w: width,
    h: 0.32,
    fontSize: 11,
    bold: true,
    color: theme.client,
    charSpacing: 3,
  });
  y += 0.45;

  const titleLines = estimateLines(options.title, width, 44, true);
  const titleH = Math.min(titleLines, 3) * 0.72;
  text(slide, options.title, {
    x: left,
    y,
    w: width,
    h: titleH,
    fontSize: 44,
    bold: true,
    color: theme.title,
    valign: "top",
    lineSpacingMultiple: 0.95,
  });
  y += titleH + 0.2;

  text(slide, report.range.label, {
    x: left,
    y,
    w: width,
    h: 0.5,
    fontSize: 22,
    color: theme.range,
  });
  y += 0.7;

  if (period === "custom") {
    brandRule(slide, left, y, ORANGE);
  }

  // Tagline, pills and footer anchor to the bottom of the page.
  let by = PAGE_H - 2.6;
  slide.addText(
    [
      { text: "Sit Less. ", options: { color: theme.taglineLead } },
      { text: "Live More.", options: { color: theme.taglineAccent } },
    ],
    {
      x: left,
      y: by,
      w: width,
      h: 0.55,
      fontFace: FONT,
      fontSize: 26,
      bold: true,
      margin: 0,
    },
  );
  by += 0.8;

  let px = left;
  for (const label of ["Earned media", "Washington, DC market", "Web + broadcast + social"]) {
    px += pill(slide, px, by, label, {
      fill: null,
      border: theme.pill,
      borderTransparency: 60,
      color: theme.pill,
      fontSize: 8.5,
      h: 0.38,
    }) + 0.14;
  }
  by += 0.65;

  text(slide, `Prepared by The Casey Group · Generated ${options.generatedOn}`, {
    x: left,
    y: by,
    w: width,
    h: 0.3,
    fontSize: 9,
    color: theme.footer,
  });
}

/** The custom cover's fine diagonal pinstripe, clipped to the page. */
function diagonalStripes(slide: PptxGenJS.Slide): void {
  const spacing = 0.32;
  for (let c = spacing; c < PAGE_W + PAGE_H; c += spacing) {
    // Stripe: y = c - x, running bottom-left to top-right.
    const x1 = Math.max(0, c - PAGE_H);
    const x2 = Math.min(PAGE_W, c);
    if (x2 - x1 < 0.01) continue;
    slide.addShape("line", {
      x: x1,
      y: c - x2,
      w: x2 - x1,
      h: x2 - x1,
      flipV: true,
      line: { color: BLUE, width: 1.25, transparency: 88 },
    });
  }
}

/* ------------------------- Executive snapshot ------------------------- */

function addSnapshotSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: CANVAS };
  let y = sectionHeader(slide, "Executive snapshot", "What are the key results?");

  if (options.summary.trim()) {
    const summary = truncate(options.summary.replace(/\s+/g, " ").trim(), 640);
    const lines = Math.max(2, estimateLines(summary, CONTENT_W - 0.4, 11));
    const h = Math.min(2.6, lines * 0.23 + 0.36);
    roundRect(slide, MARGIN, y, CONTENT_W, h, PANEL, "C9D6E8", 0.1);
    text(slide, summary, {
      x: MARGIN + 0.2,
      y: y + 0.17,
      w: CONTENT_W - 0.4,
      h: h - 0.34,
      fontSize: 11,
      color: "2C5793",
      valign: "top",
      lineSpacingMultiple: 1.2,
    });
    y += h + GAP;
  }

  y = metricRow(slide, y, [
    { label: "Media mentions", value: report.mediaMentions.toLocaleString("en-US") },
    { label: "Social posts", value: report.socialMentions.toLocaleString("en-US") },
    { label: "Media outlets", value: report.uniqueOutlets.toLocaleString("en-US") },
    { label: "Priority mentions", value: report.importantCount.toLocaleString("en-US") },
  ]);

  // Media and social plot as separate series; they are never summed.
  const chartW = CONTENT_W * 0.6 - GAP / 2;
  const shareW = CONTENT_W - chartW - GAP;
  const panelH = BOTTOM - y;
  panel(slide, MARGIN, y, chartW, panelH, "Media vs. social by day");
  dailyChart(slide, report, MARGIN + 0.25, y + 0.55, chartW - 0.5, panelH - 0.8);

  const sx = MARGIN + chartW + GAP;
  panel(slide, sx, y, shareW, panelH, "Broadcast share");
  const broadcastCount =
    report.byType.find((t) => t.type === "broadcast")?.count ?? 0;
  // Share of TRADITIONAL MEDIA, not of everything.
  const broadcastPercent = report.mediaMentions
    ? Math.round((broadcastCount / report.mediaMentions) * 100)
    : 0;
  const d = 1.9;
  const dx = sx + (shareW - d) / 2;
  const dy = y + 0.75;
  donut(slide, dx, dy, d, broadcastPercent);
  text(slide, `${broadcastPercent}%`, {
    x: dx,
    y: dy + d / 2 - 0.36,
    w: d,
    h: 0.45,
    fontSize: 24,
    bold: true,
    color: BLUE,
    align: "center",
  });
  text(slide, "TV / RADIO", {
    x: dx,
    y: dy + d / 2 + 0.08,
    w: d,
    h: 0.22,
    fontSize: 7.5,
    bold: true,
    color: MUTED,
    align: "center",
    charSpacing: 1,
  });
  text(
    slide,
    "Based on verified mention counts, not estimated audience or ad value.",
    {
      x: sx + 0.25,
      y: dy + d + 0.3,
      w: shareW - 0.5,
      h: 0.8,
      fontSize: 9.5,
      color: MUTED,
      align: "center",
      valign: "top",
      lineSpacingMultiple: 1.25,
    },
  );
}

function dailyChart(
  slide: PptxGenJS.Slide,
  report: Report,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Legend, top right.
  let lx = x + w;
  for (const { label, color } of [
    { label: "SOCIAL", color: BLUE },
    { label: "MEDIA", color: ORANGE },
  ]) {
    const lw = label.length * 0.075 + 0.05;
    lx -= lw;
    text(slide, label, {
      x: lx,
      y,
      w: lw,
      h: 0.2,
      fontSize: 7,
      bold: true,
      color: MUTED,
    });
    lx -= 0.16;
    roundRect(slide, lx, y + 0.055, 0.1, 0.1, color, null, 0.02);
    lx -= 0.18;
  }

  const days = report.daily;
  if (!days.length) {
    emptyNote(slide, x, y + h / 2 - 0.2, w, "No mentions in this period.");
    return;
  }
  const max = Math.max(1, ...days.flatMap((d) => [d.media, d.social]));
  const dense = days.length > 10;
  const labelH = 0.25;
  const plotTop = y + 0.35;
  const baseline = y + h - labelH;
  const plotH = baseline - plotTop;
  const slot = w / days.length;
  const barW = Math.min(0.22, (slot * 0.8) / 2);

  rect(slide, x, baseline, w, 0.01, TRACK);
  days.forEach((day, index) => {
    const cx = x + slot * index + slot / 2;
    [
      { value: day.media, color: ORANGE, offset: -barW },
      { value: day.social, color: BLUE, offset: 0 },
    ].forEach(({ value, color, offset }) => {
      const bh = Math.max(value > 0 ? 0.08 : 0.025, (value / max) * plotH);
      slide.addShape("rect", {
        x: cx + offset + 0.005,
        y: baseline - bh,
        w: barW - 0.01,
        h: bh,
        fill: { color, transparency: value > 0 ? 0 : 80 },
        line: { type: "none" },
      });
    });
    const showLabel =
      !dense || index === 0 || index === days.length - 1 || (index + 1) % 5 === 0;
    if (showLabel) {
      text(slide, day.label, {
        x: cx - 0.4,
        y: baseline + 0.06,
        w: 0.8,
        h: 0.18,
        fontSize: 7,
        bold: true,
        color: MUTED,
        align: "center",
      });
    }
  });
}

/** A ring with the share drawn clockwise from 12 o'clock. */
function donut(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  d: number,
  percent: number,
): void {
  const thickness = 0.32;
  slide.addShape("blockArc", {
    x,
    y,
    w: d,
    h: d,
    fill: { color: TRACK },
    line: { type: "none" },
    angleRange: [0, 359.9],
    arcThicknessRatio: thickness,
  });
  if (percent <= 0) return;
  slide.addShape("blockArc", {
    x,
    y,
    w: d,
    h: d,
    fill: { color: BLUE },
    line: { type: "none" },
    // OOXML angles run clockwise from 3 o'clock; 270 is 12 o'clock.
    angleRange: [270, (270 + Math.min(percent, 99.95) * 3.6) % 360],
    arcThicknessRatio: thickness,
  });
}

/* ---------------------------- Coverage mix ---------------------------- */

function addCoverageMixSlide(
  pptx: PptxGenJS,
  report: Report,
  options: DeckOptions,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: CANVAS };
  const top = sectionHeader(slide, "Coverage mix", "How does earned media break down?");

  const colW = (CONTENT_W - GAP) / 2;
  const rightX = MARGIN + colW + GAP;
  const meterH = 2.55;
  const columnsH = BOTTOM - top - meterH - GAP;

  // Left column: media type over relevance mix.
  let ly = top;
  const typeRows = report.byType.map(({ type, count }) => ({
    label: TYPE_LABELS[type] ?? type,
    count,
  }));
  const typeH = mixBarsHeight(typeRows.length);
  panel(slide, MARGIN, ly, colW, typeH, "Media type");
  mixBars(slide, MARGIN, ly, colW, typeRows, report.totalMentions);
  ly += typeH + GAP;

  const labelRows = report.byLabel.map(({ label, count }) => ({
    label: LABEL_LABELS[label] ?? label,
    count,
  }));
  const labelH = Math.min(mixBarsHeight(labelRows.length), top + columnsH - ly);
  panel(slide, MARGIN, ly, colW, labelH, "Relevance mix");
  mixBars(slide, MARGIN, ly, colW, labelRows, report.totalMentions);

  // Right column: outlet ranking, as many rows as the column holds.
  panel(slide, rightX, top, colW, columnsH, "Top media outlets");
  outletRanking(slide, rightX, top, colW, columnsH, report.topOutlets, ORANGE, {
    empty: "No traditional-media outlets recorded in this period.",
  });

  // Two dials: media and social are scored separately, never averaged.
  const my = BOTTOM - meterH;
  sentimentMeter(
    slide,
    MARGIN,
    my,
    colW,
    meterH,
    "Media sentiment",
    report.mediaSentiment,
    options.mediaScoreOverride,
  );
  sentimentMeter(
    slide,
    rightX,
    my,
    colW,
    meterH,
    "Social media sentiment",
    report.socialSentiment,
    options.socialScoreOverride,
  );
}

function mixBarsHeight(rows: number): number {
  return 0.55 + Math.max(rows, 1) * 0.5 + 0.1;
}

function mixBars(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  rows: Array<{ label: string; count: number }>,
  total: number,
): void {
  const inner = w - 0.5;
  if (!rows.length) {
    emptyNote(slide, x + 0.25, y + 0.6, inner, "No mentions in this period.");
    return;
  }
  let ry = y + 0.55;
  for (const { label, count } of rows) {
    const percent = total ? Math.round((count / total) * 100) : 0;
    text(slide, label, {
      x: x + 0.25,
      y: ry,
      w: inner * 0.68,
      h: 0.22,
      fontSize: 9.5,
      bold: true,
      color: INK,
    });
    text(slide, `${count} · ${percent}%`, {
      x: x + 0.25 + inner * 0.6,
      y: ry,
      w: inner * 0.4,
      h: 0.22,
      fontSize: 9,
      color: MUTED,
      align: "right",
    });
    bar(slide, x + 0.25, ry + 0.28, inner, 0.09, percent / 100, BLUE);
    ry += 0.5;
  }
}

function outletRanking(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  rows: Array<{ source: string; count: number }>,
  color: string,
  opts: { empty: string; format?: (value: number) => string; barW?: number },
): void {
  const inner = w - 0.5;
  if (!rows.length) {
    emptyNote(slide, x + 0.25, y + 0.6, inner, opts.empty);
    return;
  }
  const rowH = 0.4;
  const capacity = Math.max(1, Math.floor((h - 0.6) / rowH));
  const shown = rows.slice(0, capacity);
  const max = Math.max(1, ...rows.map((row) => row.count));
  const barW = opts.barW ?? 0.9;
  const valueW = 0.55;
  const nameW = inner - 0.38 - barW - valueW - 0.15;

  shown.forEach(({ source, count }, index) => {
    const ry = y + 0.5 + index * rowH;
    if (index > 0) rect(slide, x + 0.25, ry, inner, 0.008, DIVIDER);
    numberChip(slide, x + 0.25, ry + 0.07, 0.26, index + 1);
    text(slide, truncateToWidth(source, nameW, 9.5, true), {
      x: x + 0.63,
      y: ry + 0.07,
      w: nameW,
      h: 0.26,
      fontSize: 9.5,
      bold: true,
      color: INK,
    });
    bar(slide, x + 0.63 + nameW + 0.08, ry + 0.165, barW, 0.07, count / max, color);
    text(slide, opts.format ? opts.format(count) : String(count), {
      x: x + w - 0.25 - valueW,
      y: ry + 0.07,
      w: valueW,
      h: 0.26,
      fontSize: 10,
      bold: true,
      color,
      align: "right",
    });
  });
  if (rows.length > shown.length) {
    text(slide, `+ ${rows.length - shown.length} more in the coverage index`, {
      x: x + 0.25,
      y: y + 0.5 + shown.length * rowH + 0.04,
      w: inner,
      h: 0.2,
      fontSize: 8,
      italic: true,
      color: MUTED,
    });
  }
}

/**
 * Sentiment toward the 66 Express: the 0–100 dial plus the scored mix.
 * Percentages are of SCORED items, and the unscored remainder is stated.
 */
function sentimentMeter(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  mix: SentimentMix,
  override?: number | null,
): void {
  panel(slide, x, y, w, h, title);
  const inner = w - 0.5;
  const ix = x + 0.25;
  if (mix.scored === 0) {
    emptyNote(slide, ix, y + 0.7, inner, "No coverage scored for sentiment in this period.");
    return;
  }
  const shown = override ?? mix.score;

  slide.addText(
    [
      { text: String(shown), options: { fontSize: 24, bold: true, color: BLUE } },
      { text: " / 100", options: { fontSize: 12, bold: true, color: MUTED } },
    ],
    { x: ix, y: y + 0.48, w: inner * 0.55, h: 0.42, fontFace: FONT, margin: 0, valign: "bottom" },
  );
  text(slide, sentimentBand(shown).toUpperCase(), {
    x: ix,
    y: y + 0.92,
    w: inner * 0.55,
    h: 0.18,
    fontSize: 7.5,
    bold: true,
    color: BLUE,
  });
  text(
    slide,
    `${mix.scored} of ${mix.scored + mix.unscored} mentions scored` +
      (mix.adjusted > 0 ? `\n${mix.adjusted} adjusted by an analyst` : ""),
    {
      x: ix + inner * 0.5,
      y: y + 0.55,
      w: inner * 0.5,
      h: 0.5,
      fontSize: 8,
      color: MUTED,
      align: "right",
      valign: "top",
    },
  );

  // 0–100 dial: red through gray to green, with the needle at the score.
  const dialY = y + 1.22;
  gradientBar(slide, ix, dialY, inner, 0.09);
  if (shown !== null) {
    slide.addShape("roundRect", {
      x: ix + (inner * shown) / 100 - 0.03,
      y: dialY - 0.05,
      w: 0.06,
      h: 0.19,
      fill: { color: INK },
      line: { color: "FFFFFF", width: 1.25 },
      rectRadius: 0.03,
    });
  }
  text(slide, "0 · NEGATIVE", {
    x: ix,
    y: dialY + 0.14,
    w: inner / 2,
    h: 0.16,
    fontSize: 6.5,
    bold: true,
    color: MUTED,
  });
  text(slide, "100 · POSITIVE", {
    x: ix + inner / 2,
    y: dialY + 0.14,
    w: inner / 2,
    h: 0.16,
    fontSize: 6.5,
    bold: true,
    color: MUTED,
    align: "right",
  });

  // Stacked mix bar.
  const segments = [
    { label: "Positive", count: mix.positive, color: POSITIVE },
    { label: "Neutral", count: mix.neutral, color: NEUTRAL },
    { label: "Negative", count: mix.negative, color: NEGATIVE },
  ];
  const pct = (count: number) => (mix.scored ? Math.round((count / mix.scored) * 100) : 0);
  const sy = dialY + 0.42;
  rect(slide, ix, sy, inner, 0.1, TRACK);
  let cursor = ix;
  for (const segment of segments) {
    if (!segment.count) continue;
    const sw = (inner * segment.count) / mix.scored;
    rect(slide, cursor, sy, sw, 0.1, segment.color);
    cursor += sw;
  }

  const legend: PptxGenJS.TextProps[] = [];
  segments.forEach((segment, index) => {
    legend.push({ text: "● ", options: { color: segment.color } });
    legend.push({ text: `${segment.label} `, options: { bold: true, color: INK } });
    legend.push({
      text: `${segment.count} · ${pct(segment.count)}%${index < segments.length - 1 ? "     " : ""}`,
      options: { color: MUTED },
    });
  });
  slide.addText(legend, {
    x: ix,
    y: sy + 0.18,
    w: inner,
    h: 0.24,
    fontFace: FONT,
    fontSize: 8,
    margin: 0,
  });

  if (mix.unscored > 0) {
    text(
      slide,
      `Percentages are of scored coverage. ${mix.unscored} mention${mix.unscored === 1 ? "" : "s"} in this period ${mix.unscored === 1 ? "is" : "are"} not scored; sentiment is assessed for confirmed and likely Outside the Beltway coverage only.`,
      {
        x: ix,
        y: sy + 0.48,
        w: inner,
        h: y + h - (sy + 0.48) - 0.12,
        fontSize: 7,
        color: MUTED,
        valign: "top",
        lineSpacingMultiple: 1.15,
      },
    );
  }
}

/* --------------------------- Amplification --------------------------- */

function addAmplificationSlide(pptx: PptxGenJS, report: Report): void {
  const slide = pptx.addSlide();
  slide.background = { color: CANVAS };
  let y = sectionHeader(slide, "Amplification", "How far did coverage travel?");

  slide.addText(
    [
      { text: "Reach is an " },
      { text: "estimate", options: { bold: true } },
      {
        text: " of the audience for each mention, based on outlet size, not licensed audience measurement. Use it to compare mentions against each other, not as a hard figure. Social echo is the platforms’ own counts.",
      },
    ],
    {
      x: MARGIN,
      y: y - 0.08,
      w: CONTENT_W,
      h: 0.55,
      fontFace: FONT,
      fontSize: 9.5,
      color: MUTED,
      valign: "top",
      lineSpacingMultiple: 1.2,
      margin: 0,
    },
  );
  y += 0.6;

  const totalEcho = report.topByEcho.reduce((sum, row) => sum + row.echo, 0);
  y = metricRow(slide, y, [
    { label: "Est. media reach", value: formatReach(report.reach.total) },
    {
      label: "Mentions estimated",
      value: `${report.reach.estimated} of ${report.reach.estimated + report.reach.unestimated}`,
    },
    { label: "Total social echo", value: totalEcho.toLocaleString("en-US") },
  ]);

  if (report.reach.unestimated > 0) {
    const n = report.reach.unestimated;
    text(
      slide,
      `${n} mention${n === 1 ? " has" : "s have"} no reach estimate and ${n === 1 ? "is" : "are"} excluded from the total rather than counted as zero.`,
      {
        x: MARGIN,
        y: y - 0.1,
        w: CONTENT_W,
        h: 0.22,
        fontSize: 8,
        color: MUTED,
      },
    );
    y += 0.2;
  }

  const outletsH = 0.6 + Math.min(Math.max(report.topOutletsByReach.length, 1), 5) * 0.4;
  const listH = BOTTOM - y - outletsH - GAP;
  const colW = (CONTENT_W - GAP) / 2;
  panel(slide, MARGIN, y, colW, listH, "Top mentions by estimated reach");
  rankedMentions(
    slide,
    MARGIN,
    y,
    colW,
    listH,
    report.topByReach.map(({ item, reach }) => ({ item, value: formatReach(reach) })),
    "No mentions from outlets with a reach estimate.",
  );
  panel(slide, MARGIN + colW + GAP, y, colW, listH, "Top mentions by social echo");
  rankedMentions(
    slide,
    MARGIN + colW + GAP,
    y,
    colW,
    listH,
    report.topByEcho.map(({ item, echo }) => ({
      item,
      value: echo.toLocaleString("en-US"),
    })),
    "No engagement counts captured yet; these populate as new posts are collected.",
  );
  y += listH + GAP;

  panel(slide, MARGIN, y, CONTENT_W, outletsH, "Top outlets by estimated reach");
  outletRanking(
    slide,
    MARGIN,
    y,
    CONTENT_W,
    outletsH,
    report.topOutletsByReach.map((row) => ({
      source: `${row.source} (${row.count} mention${row.count === 1 ? "" : "s"})`,
      count: row.reach,
    })),
    ORANGE,
    {
      empty: "No outlets with a reach estimate in this period.",
      format: formatReach,
      barW: 2.2,
    },
  );
}

function rankedMentions(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  rows: Array<{ item: ReportItem; value: string }>,
  empty: string,
): void {
  const inner = w - 0.5;
  if (!rows.length) {
    emptyNote(slide, x + 0.25, y + 0.6, inner, empty);
    return;
  }
  const rowH = 0.66;
  const capacity = Math.max(1, Math.floor((h - 0.6) / rowH));
  const valueW = 0.5;
  const titleW = inner - 0.36 - valueW - 0.08;
  rows.slice(0, capacity).forEach(({ item, value }, index) => {
    const ry = y + 0.5 + index * rowH;
    if (index > 0) rect(slide, x + 0.25, ry, inner, 0.008, DIVIDER);
    numberChip(slide, x + 0.25, ry + 0.09, 0.22, index + 1);
    text(slide, truncateLines(item.title, titleW, 8.5, 2, true), {
      x: x + 0.59,
      y: ry + 0.07,
      w: titleW,
      h: 0.34,
      fontSize: 8.5,
      bold: true,
      color: HEADLINE,
      valign: "top",
    });
    text(slide, truncateToWidth(`${item.source} · ${formatItemDate(item)}`, titleW, 7.5), {
      x: x + 0.59,
      y: ry + 0.43,
      w: titleW,
      h: 0.16,
      fontSize: 7.5,
      color: MUTED,
    });
    text(slide, value, {
      x: x + w - 0.25 - valueW,
      y: ry + 0.07,
      w: valueW,
      h: 0.22,
      fontSize: 9,
      bold: true,
      color: BLUE,
      align: "right",
    });
  });
}

/* ---------------------------- Social pulse ---------------------------- */

function addSocialPulseSlide(pptx: PptxGenJS, report: Report): void {
  const slide = pptx.addSlide();
  slide.background = { color: CANVAS };
  const top = sectionHeader(slide, "Social media", "Social pulse");

  const leftW = CONTENT_W * 0.4 - GAP / 2;
  const rightW = CONTENT_W - leftW - GAP;
  const rightX = MARGIN + leftW + GAP;

  const platformRows = report.byPlatform.map(({ platform, count }) => ({
    label: platform,
    count,
  }));
  const platformH = mixBarsHeight(platformRows.length);
  panel(slide, MARGIN, top, leftW, platformH, "Posts by platform");
  mixBars(
    slide,
    MARGIN,
    top,
    leftW,
    platformRows,
    report.byPlatform.reduce((sum, p) => sum + p.count, 0),
  );

  const accountsY = top + platformH + GAP;
  const accountsH = BOTTOM - accountsY;
  panel(slide, MARGIN, accountsY, leftW, accountsH, "Top social accounts");
  outletRanking(slide, MARGIN, accountsY, leftW, accountsH, report.topSocialAccounts, BLUE, {
    empty: "No social accounts recorded in this period.",
    barW: 0.35,
  });

  const postsH = BOTTOM - top;
  panel(slide, rightX, top, rightW, postsH, "Recent posts");
  const inner = rightW - 0.5;
  if (!report.socialPosts.length) {
    emptyNote(
      slide,
      rightX + 0.25,
      top + 0.6,
      inner,
      "No public social mentions captured in this period across X, Bluesky, Facebook, Reddit, or LinkedIn.",
    );
    return;
  }
  const rowH = 1.12;
  const capacity = Math.floor((postsH - 0.55) / rowH);
  report.socialPosts.slice(0, capacity).forEach((post, index) => {
    const ry = top + 0.5 + index * rowH;
    if (index > 0) rect(slide, rightX + 0.25, ry - 0.04, inner, 0.008, DIVIDER);
    const pw = pill(slide, rightX + 0.25, ry + 0.04, socialPlatform(post.url), {
      fill: PILL_BLUE,
      border: null,
      color: BLUE,
      fontSize: 6.5,
      h: 0.22,
    });
    text(
      slide,
      truncateToWidth(`${post.source} · ${formatItemDate(post)}`, inner - pw - 0.1, 7.5),
      {
        x: rightX + 0.25 + pw + 0.1,
        y: ry + 0.05,
        w: inner - pw - 0.1,
        h: 0.2,
        fontSize: 7.5,
        color: MUTED,
      },
    );
    text(slide, truncateLines(clean(post.snippet || post.title), inner, 8.5, 3), {
      x: rightX + 0.25,
      y: ry + 0.33,
      w: inner,
      h: 0.52,
      fontSize: 8.5,
      color: BODY,
      valign: "top",
      lineSpacingMultiple: 1.1,
    });
    text(slide, "View post", {
      x: rightX + 0.25,
      y: ry + 0.86,
      w: 1.0,
      h: 0.18,
      fontSize: 7.5,
      bold: true,
      color: BLUE,
      underline: { color: BLUE },
      hyperlink: { url: post.url },
    });
  });
}

/* ------------------------- Featured mentions -------------------------- */

const FEATURED_PER_PAGE = 4;

function addFeaturedSlides(pptx: PptxGenJS, items: ReportItem[]): void {
  if (!items.length) return;
  const pages = Math.ceil(items.length / FEATURED_PER_PAGE);
  for (let p = 0; p < pages; p++) {
    const slide = pptx.addSlide();
    slide.background = { color: CANVAS };
    let y = sectionHeader(
      slide,
      "Curated coverage",
      pages > 1
        ? `Featured mentions and playable clips (${p + 1} of ${pages})`
        : "Featured mentions and playable clips",
    );
    if (p === 0) {
      text(
        slide,
        "YouTube segments open at the moment of the on-air mention when the monitor captured a timestamp.",
        { x: MARGIN, y: y - 0.08, w: CONTENT_W, h: 0.25, fontSize: 9.5, color: MUTED },
      );
      y += 0.3;
    }

    const colW = (CONTENT_W - GAP) / 2;
    const cardH = (BOTTOM - y - GAP) / 2;
    items
      .slice(p * FEATURED_PER_PAGE, (p + 1) * FEATURED_PER_PAGE)
      .forEach((item, index) => {
        featuredCard(
          slide,
          item,
          MARGIN + (index % 2) * (colW + GAP),
          y + Math.floor(index / 2) * (cardH + GAP),
          colW,
          cardH,
        );
      });
  }
}

function featuredCard(
  slide: PptxGenJS.Slide,
  item: ReportItem,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  roundRect(slide, x, y, w, h, PANEL, WARM_GRAY, 0.12);
  const ix = x + 0.25;
  const inner = w - 0.5;

  let px = ix;
  const pills: Array<{ label: string; fill: string; color: string }> = [
    { label: TYPE_LABELS[item.sourceType] ?? item.sourceType, fill: PILL_BLUE, color: BLUE },
  ];
  if (item.priority === "important") {
    pills.push({ label: "Priority", fill: "FBE7BF", color: "7A4D07" });
  }
  pills.push({ label: LABEL_LABELS[item.label] ?? item.label, fill: CHIP, color: BODY });
  for (const p of pills) {
    const pw = pill(slide, px, y + 0.25, p.label, {
      fill: p.fill,
      border: null,
      color: p.color,
      fontSize: 6.5,
      h: 0.22,
    });
    px += pw + 0.08;
  }

  let cy = y + 0.62;
  const title = truncateLines(item.title, inner, 13, 3, true);
  const titleLines = estimateLines(title, inner, 13, true);
  text(slide, title, {
    x: ix,
    y: cy,
    w: inner,
    h: titleLines * 0.24,
    fontSize: 13,
    bold: true,
    color: HEADLINE,
    valign: "top",
    lineSpacingMultiple: 1.0,
  });
  cy += titleLines * 0.24 + 0.1;

  const meta = [item.source, item.byline, formatItemDate(item), engagementLabel(item)]
    .filter(Boolean)
    .join(" · ");
  text(slide, truncateLines(meta, inner, 8, 2, true), {
    x: ix,
    y: cy,
    w: inner,
    h: 0.3,
    fontSize: 8,
    bold: true,
    color: MUTED,
    valign: "top",
  });
  cy += estimateLines(meta, inner, 8, true) > 1 ? 0.4 : 0.26;

  const buttonH = 0.34;
  const bodyH = y + h - 0.25 - buttonH - 0.15 - cy;
  const maxLines = Math.max(1, Math.floor(bodyH / 0.17));
  if (item.transcript) {
    // The transcript is verbatim on-air wording, so it is quoted.
    const quote = truncateLines(`“…${clean(item.transcript)}…”`, inner - 0.15, 8.5, maxLines);
    rect(slide, ix, cy, 0.04, Math.min(bodyH, estimateLines(quote, inner - 0.15, 8.5) * 0.17), ORANGE);
    text(slide, quote, {
      x: ix + 0.15,
      y: cy,
      w: inner - 0.15,
      h: bodyH,
      fontSize: 8.5,
      italic: true,
      color: BODY,
      valign: "top",
      lineSpacingMultiple: 1.1,
    });
  } else if (item.snippet) {
    text(slide, truncateLines(clean(item.snippet), inner, 8.5, maxLines), {
      x: ix,
      y: cy,
      w: inner,
      h: bodyH,
      fontSize: 8.5,
      color: BODY,
      valign: "top",
      lineSpacingMultiple: 1.1,
    });
  }

  const label = item.sourceType === "broadcast" ? "Open clip / source" : "Read original";
  const bw = label.length * 0.075 + 0.35;
  slide.addText(label, {
    shape: "roundRect",
    x: ix,
    y: y + h - 0.25 - buttonH,
    w: bw,
    h: buttonH,
    fill: { color: BLUE },
    line: { type: "none" },
    rectRadius: 0.06,
    fontFace: FONT,
    fontSize: 8.5,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    margin: 0,
    hyperlink: { url: item.clipUrl || item.url },
  });
}

/* --------------------------- Coverage index --------------------------- */

const INDEX_COLS = [3.75, 1.35, 1.0, 0.8, 0.5];
const INDEX_ROW_H = 0.78;

function addIndexSlides(
  pptx: PptxGenJS,
  items: ReportItem[],
  heading: string,
  empty: string,
): void {
  if (!items.length) {
    const slide = pptx.addSlide();
    slide.background = { color: CANVAS };
    const y = sectionHeader(slide, "Coverage index", heading);
    emptyNote(slide, MARGIN, y + 0.1, CONTENT_W, empty);
    return;
  }

  // Measure the header once to know how many rows a page holds.
  const headerBottom = 2.25;
  const perPage = Math.floor((BOTTOM - headerBottom - 0.34) / INDEX_ROW_H);
  const pages = Math.ceil(items.length / perPage);

  for (let p = 0; p < pages; p++) {
    const slide = pptx.addSlide();
    slide.background = { color: CANVAS };
    const y = sectionHeader(
      slide,
      "Coverage index",
      pages > 1 ? `${heading} (${p + 1} of ${pages})` : heading,
    );
    const slice = items.slice(p * perPage, (p + 1) * perPage);
    const head = (label: string): PptxGenJS.TableCell => ({
      text: label.toUpperCase(),
      options: {
        bold: true,
        fontSize: 7,
        color: BLUE,
        fill: { color: "EEF3FA" },
      },
    });
    const rows: PptxGenJS.TableRow[] = [
      ["Mention", "Publisher", "Type", "Date", "Link"].map(head),
      ...slice.map((item): PptxGenJS.TableRow => {
        const titleText = truncateLines(item.title, INDEX_COLS[0] - 0.2, 8, 2, true);
        const snippet = item.snippet
          ? truncateLines(clean(item.snippet), INDEX_COLS[0] - 0.2, 7, 2)
          : "";
        return [
          {
            text: [
              {
                text: titleText,
                options: { bold: true, color: INK, fontSize: 8, breakLine: Boolean(snippet) },
              },
              ...(snippet
                ? [{ text: snippet, options: { color: MUTED, fontSize: 7 } }]
                : []),
            ],
          },
          { text: truncateLines(item.source, INDEX_COLS[1] - 0.2, 7.5, 2) },
          { text: TYPE_LABELS[item.sourceType] ?? item.sourceType },
          { text: formatItemDate(item) },
          {
            text: [
              {
                text: "Open",
                options: { bold: true, color: ORANGE, hyperlink: { url: item.url } },
              },
            ],
          },
        ];
      }),
    ];
    slide.addTable(rows, {
      x: MARGIN,
      y,
      w: CONTENT_W,
      colW: INDEX_COLS,
      rowH: [0.34, ...slice.map(() => INDEX_ROW_H)],
      fontFace: FONT,
      fontSize: 7.5,
      color: "2F3B47",
      fill: { color: PANEL },
      border: { type: "solid", color: TRACK, pt: 0.75 },
      valign: "top",
      margin: [0.08, 0.1, 0.06, 0.1],
    });
  }
}

/* ------------------------------ Helpers ------------------------------- */

/** Kicker, uppercase heading and brand rule; returns the y content starts at. */
function sectionHeader(
  slide: PptxGenJS.Slide,
  kicker: string,
  heading: string,
): number {
  text(slide, kicker.toUpperCase(), {
    x: MARGIN,
    y: 0.55,
    w: CONTENT_W,
    h: 0.22,
    fontSize: 8.5,
    bold: true,
    color: ORANGE,
    charSpacing: 2.5,
  });
  const upper = heading.toUpperCase();
  // Uppercase glyphs run ~25% wider than the mixed-case average.
  const lines = Math.min(estimateLines(upper, CONTENT_W, 24 * 1.25, true), 2);
  const h = lines * 0.4;
  text(slide, upper, {
    x: MARGIN,
    y: 0.82,
    w: CONTENT_W,
    h,
    fontSize: 24,
    bold: true,
    color: BLUE,
    valign: "top",
    lineSpacingMultiple: 0.95,
  });
  const ruleY = 0.82 + h + 0.14;
  brandRule(slide, MARGIN, ruleY, ORANGE);
  return ruleY + 0.4;
}

/** A row of KPI tiles; returns the next y. */
function metricRow(
  slide: PptxGenJS.Slide,
  y: number,
  metrics: Array<{ label: string; value: string }>,
): number {
  const h = 1.15;
  const w = (CONTENT_W - GAP * (metrics.length - 1)) / metrics.length;
  metrics.forEach(({ label, value }, index) => {
    const x = MARGIN + index * (w + GAP);
    roundRect(slide, x, y, w, h, PANEL, WARM_GRAY, 0.12);
    text(slide, value, {
      x: x + 0.2,
      y: y + 0.18,
      w: w - 0.3,
      h: 0.5,
      fontSize: 26,
      bold: true,
      color: BLUE,
    });
    text(slide, label.toUpperCase(), {
      x: x + 0.2,
      y: y + 0.74,
      w: w - 0.3,
      h: 0.3,
      fontSize: 7,
      bold: true,
      color: MUTED,
      charSpacing: 1.2,
      valign: "top",
    });
  });
  return y + h + GAP;
}

function panel(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
): void {
  roundRect(slide, x, y, w, h, PANEL, WARM_GRAY, 0.12);
  text(slide, title.toUpperCase(), {
    x: x + 0.25,
    y: y + 0.2,
    w: w - 0.5,
    h: 0.22,
    fontSize: 8.5,
    bold: true,
    color: BLUE,
    charSpacing: 1,
  });
}

/** A rounded track with a proportional fill. */
function bar(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  fraction: number,
  color: string,
): void {
  roundRect(slide, x, y, w, h, TRACK, null, h / 2);
  const fw = w * Math.max(0, Math.min(1, fraction));
  if (fw > 0) roundRect(slide, x, y, Math.max(fw, h), h, color, null, h / 2);
}

/** Red → warm gray → green, drawn as thin slices (pptx has no CSS gradients). */
function gradientBar(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const slices = 40;
  const sw = w / slices;
  for (let i = 0; i < slices; i++) {
    const t = i / (slices - 1);
    const color =
      t < 0.5 ? mixColor(NEGATIVE, TRACK, t * 2) : mixColor(TRACK, POSITIVE, (t - 0.5) * 2);
    rect(slide, x + i * sw, y, sw + 0.005, h, color);
  }
}

function mixColor(from: string, to: string, t: number): string {
  const a = parseInt(from, 16);
  const b = parseInt(to, 16);
  const channel = (shift: number) => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t);
  };
  return ((channel(16) << 16) | (channel(8) << 8) | channel(0))
    .toString(16)
    .padStart(6, "0")
    .toUpperCase();
}

function numberChip(slide: PptxGenJS.Slide, x: number, y: number, d: number, n: number): void {
  slide.addText(String(n), {
    shape: "ellipse",
    x,
    y,
    w: d,
    h: d,
    fill: { color: CHIP },
    line: { type: "none" },
    fontFace: FONT,
    fontSize: d > 0.24 ? 8.5 : 7.5,
    bold: true,
    color: BODY,
    align: "center",
    valign: "middle",
    margin: 0,
  });
}

/** A rounded label; returns its width. */
function pill(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  label: string,
  opts: {
    fill: string | null;
    border: string | null;
    borderTransparency?: number;
    color: string;
    fontSize: number;
    h: number;
  },
): number {
  const upper = label.toUpperCase();
  const w = upper.length * opts.fontSize * 0.0105 + opts.fontSize * 0.04 + 0.2;
  slide.addText(upper, {
    shape: "roundRect",
    x,
    y,
    w,
    h: opts.h,
    rectRadius: opts.h / 2,
    fill: opts.fill ? { color: opts.fill } : { color: "FFFFFF", transparency: 100 },
    line: opts.border
      ? { color: opts.border, width: 1, transparency: opts.borderTransparency ?? 0 }
      : { type: "none" },
    fontFace: FONT,
    fontSize: opts.fontSize,
    bold: true,
    color: opts.color,
    charSpacing: 1.5,
    align: "center",
    valign: "middle",
    margin: 0,
  });
  return w;
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
    roundRect(slide, cursor, y, segment.w, 0.07, color, null, 0.035);
    cursor += segment.w + segment.gap;
  }
}

function rect(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  slide.addShape("rect", { x, y, w, h, fill: { color }, line: { type: "none" } });
}

function roundRect(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  border: string | null,
  radius: number,
): void {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: border ? { color: border, width: 1 } : { type: "none" },
    rectRadius: radius,
  });
}

/** Text with the deck's font and no inner padding, so boxes align to the grid. */
function text(
  slide: PptxGenJS.Slide,
  value: string,
  options: PptxGenJS.TextPropsOptions,
): void {
  slide.addText(value, { fontFace: FONT, margin: 0, valign: "middle", ...options });
}

function emptyNote(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  value: string,
): void {
  text(slide, value, {
    x,
    y,
    w,
    h: 0.5,
    fontSize: 9.5,
    italic: true,
    color: MUTED,
    align: "center",
    valign: "top",
  });
}

function publicAsset(name: string): string {
  return path.join(process.cwd(), "public", name);
}

// Rough Montserrat metrics (inches per character per point). Slides has no
// shrink-to-fit on import, so text is trimmed to the box up front.
const CHAR_W = 0.0078;
const CHAR_W_BOLD = 0.009;

function charsPerLine(width: number, fontSize: number, bold = false): number {
  return Math.max(8, Math.floor(width / (fontSize * (bold ? CHAR_W_BOLD : CHAR_W))));
}

function estimateLines(value: string, width: number, fontSize: number, bold = false): number {
  const perLine = charsPerLine(width, fontSize, bold);
  let lines = 0;
  let current = 0;
  for (const word of value.split(/\s+/)) {
    if (current === 0) {
      current = word.length;
      lines++;
    } else if (current + 1 + word.length <= perLine) {
      current += 1 + word.length;
    } else {
      lines += Math.floor(word.length / perLine);
      current = word.length % perLine || perLine;
      lines++;
    }
  }
  return Math.max(1, lines);
}

function truncateToWidth(value: string, width: number, fontSize: number, bold = false): string {
  return truncate(value, charsPerLine(width, fontSize, bold));
}

function truncateLines(
  value: string,
  width: number,
  fontSize: number,
  lines: number,
  bold = false,
): string {
  // Word wrap wastes part of each line, so budget ~90% of the raw capacity.
  return truncate(value, Math.floor(charsPerLine(width, fontSize, bold) * lines * 0.9));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function clean(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatItemDate(item: ReportItem): string {
  if (!item.publishedAt) return "Date unavailable";
  const parsed = new Date(item.publishedAt);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      });
}

/** "12 likes · 5 comments · 3 shares", omitting counts the platform didn't report. */
function engagementLabel(item: ReportItem): string {
  const e = item.engagement;
  if (!e) return "";
  const parts: string[] = [];
  const add = (value: number | undefined, one: string, many: string) => {
    if (value !== undefined) {
      parts.push(`${value.toLocaleString("en-US")} ${value === 1 ? one : many}`);
    }
  };
  add(e.likes, "like", "likes");
  add(e.comments, "comment", "comments");
  add(e.shares, "share", "shares");
  return parts.join(" · ");
}

/** "2026-09" -> "Sep", for the monthly cover's background lettering. */
function monthAbbreviation(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return "";
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}
