import path from "node:path";
import PptxGenJS from "pptxgenjs";
import { socialPlatform } from "@/lib/digest";
import { sentimentBand, sentimentOf, type Report, type ReportItem } from "@/lib/report";
import type { DeckOptions } from "@/lib/slides-deck";

/** The editable, letter-portrait weekly draft based on TCG's Exec Summary. */
const W = 8.5;
const H = 11;
const M = 0.52;
const CW = W - M * 2;
const BLUE = "105CAE";
const ORANGE = "EE7729";
const INK = "171717";
const MUTED = "5A5754";
const RULE = "D0CCC9";
const PALE = "EFF4FA";
const FONT = "Montserrat";
const FACILITY = new Set(["confirmed_otb", "likely_otb"]);
const RADIO = /\bwtop\b|\bwamu\b|\bwmal\b|\bnpr\b|radio/i;

type StoryGroup = { label: string; items: ReportItem[] };
type Toc = { label: string; page: number };

const COMMENT_CATEGORIES = [
  "Customer service issues / discussion",
  "HOV issues / discussion",
  "E-ZPass issues / complaints",
  "Scam claims",
  "Construction / configuration discussion",
  "Congestion / traffic / accident discussion",
  "Toll discussion / high tolls",
  "Signage complaints / discussion",
  "Paying for roads already paid for",
  "Charged despite not using",
  "Took away a lane",
  "Larger vehicles discussion",
  "Driver behavior complaints",
  "Wishing for legal / media / legislative action",
  "Wishing for transit expansion",
  "Complaints about VDOT, government, or ownership",
  "Comparison with other toll facilities",
  "Neutral or off-topic",
  "Positive, congratulatory, explanatory, or supportive",
];

export async function buildWeeklyDeck(report: Report, options: DeckOptions): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LETTER_PORTRAIT", width: W, height: H });
  pptx.layout = "LETTER_PORTRAIT";
  pptx.author = "The Casey Group";
  pptx.company = "The Casey Group";
  pptx.title = options.title;
  pptx.subject = `Weekly media report: ${report.range.label}`;

  const facility = report.items.filter((item) => item.sourceType !== "social" && FACILITY.has(item.label));
  const relevant = report.items.filter((item) => item.sourceType !== "social" && item.label === "related");
  const social = report.items.filter((item) => item.sourceType === "social");
  const byId = new Map(report.items.map((item) => [item.id, item]));
  const featured = [...new Set(options.featuredIds)]
    .map((id) => byId.get(id))
    .filter((item): item is ReportItem => Boolean(item));
  const mediaGroups: StoryGroup[] = [
    { label: "Online / Print", items: facility.filter((item) => item.sourceType !== "broadcast") },
    { label: "Radio", items: facility.filter((item) => item.sourceType === "broadcast" && RADIO.test(item.source)) },
    { label: "TV", items: facility.filter((item) => item.sourceType === "broadcast" && !RADIO.test(item.source)) },
  ];
  const socialGroups = groupSocial(social);
  const orderedSocial = socialGroups.flatMap((group) => group.items);
  const summaryParts = splitWords(options.summary.trim(), 540);

  let page = 2;
  const toc: Toc[] = [{ label: "Weekly overview", page }];
  page += 1 + Math.max(0, summaryParts.length - 1);
  if (featured.length) {
    toc.push({ label: "Featured mentions", page });
    page += Math.ceil(featured.length / 2);
  }
  toc.push({ label: "Traditional media mentions", page });
  page += 1 + Math.max(1, groupPages(mediaGroups, 3));
  toc.push({ label: "Relevant news", page });
  page += Math.max(1, Math.ceil(relevant.length / 3));
  toc.push({ label: "Social media mentions", page });
  page += 1 + Math.max(1, Math.ceil(orderedSocial.length / 4));
  toc.push({ label: "Comments by category", page });
  page += 1;
  toc.push({ label: "Screenshot slots", page });

  addCover(pptx, report, options, toc);
  addOverview(pptx, report, options, summaryParts[0] ?? "");
  for (const part of summaryParts.slice(1)) addSummaryContinuation(pptx, part);
  addFeatured(pptx, featured);
  addMediaSummary(pptx, mediaGroups, options);
  addGroupedStories(pptx, mediaGroups, "Traditional Media Mentions", "Media coverage", "media");
  addStories(pptx, relevant, "Relevant News", "Potentially Relevant News", "relevant");
  addSocialSummary(pptx, report, socialGroups, options);
  addSocialStories(pptx, orderedSocial);
  addCommentsTable(pptx);
  addScreenshotSlot(pptx, 1);
  addScreenshotSlot(pptx, 2);

  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}

function addCover(pptx: PptxGenJS, report: Report, options: DeckOptions, toc: Toc[]): void {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  const logo = path.join(process.cwd(), "public", "66OTB.png");
  const tcg = path.join(process.cwd(), "public", "TCG.png");
  slide.addImage({ path: logo, x: 2.6, y: 0.48, w: 3.3, h: 2.56 });
  slide.addText(options.title, {
    x: M, y: 3.17, w: CW, h: 0.58, fontFace: FONT,
    fontSize: options.title.length > 30 ? 21 : 27,
    bold: true, color: INK, align: "center", underline: { color: INK },
  });
  slide.addText(options.clientName, {
    x: M, y: 3.75, w: CW, h: 0.35, fontFace: FONT, fontSize: 17,
    bold: true, color: INK, align: "center",
  });
  slide.addText("News Media & Social Media Mention / Sentiment Trends", {
    x: M, y: 4.18, w: CW, h: 0.35, fontFace: FONT, fontSize: 12,
    bold: true, color: INK, align: "center",
  });
  slide.addShape("rect", { x: 0.12, y: 4.72, w: W - 0.24, h: 0.52, fill: { color: BLUE }, line: { color: BLUE } });
  slide.addText(`Period: ${report.range.label}`, {
    x: 0.26, y: 4.78, w: W - 0.52, h: 0.4, fontFace: FONT,
    fontSize: 17, color: "FFFFFF", align: "center", bold: true,
  });
  slide.addText("TABLE OF CONTENTS", {
    x: 0.85, y: 5.72, w: 3.4, h: 0.35, fontFace: FONT,
    fontSize: 13, bold: true, underline: { color: INK }, color: INK,
  });
  toc.forEach((entry, index) => {
    const y = 6.2 + index * 0.46;
    slide.addText(entry.label, { x: 0.85, y, w: 5.75, h: 0.32, fontFace: FONT, fontSize: 11.5, color: INK });
    slide.addText(String(entry.page), { x: 6.65, y, w: 0.65, h: 0.32, fontFace: FONT, fontSize: 11.5, color: INK, align: "right" });
  });
  slide.addText("Prepared by", { x: 5.55, y: 10.08, w: 1.3, h: 0.2, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" });
  slide.addImage({ path: tcg, x: 6.78, y: 9.94, w: 1.18, h: 0.33 });
}

function pageSlide(pptx: PptxGenJS, title: string): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape("rect", { x: M, y: 0.58, w: CW, h: 0.57, fill: { color: BLUE }, line: { color: BLUE } });
  slide.addText(title.toUpperCase(), {
    x: M + 0.12, y: 0.67, w: CW - 0.24, h: 0.38,
    fontFace: FONT, fontSize: 18, bold: true, color: "FFFFFF",
  });
  slide.addShape("line", { x: M, y: 10.54, w: CW, h: 0, line: { color: RULE, width: 0.8 } });
  return slide;
}

function sectionLabel(slide: PptxGenJS.Slide, label: string, y: number): void {
  slide.addText(label, { x: M, y, w: CW, h: 0.28, fontFace: FONT, fontSize: 12,
    bold: true, color: INK });
}

function addOverview(pptx: PptxGenJS, report: Report, options: DeckOptions, summary: string): void {
  const slide = pageSlide(pptx, "Weekly Overview");
  sectionLabel(slide, "Executive summary", 1.45);
  slide.addText(summary || "Add the analyst's summary before client review.", {
    x: M + 0.08, y: 1.82, w: CW - 0.16, h: 2.1,
    fontFace: FONT, fontSize: 12.2, color: INK, valign: "top", breakLine: false,
  });
  sectionLabel(slide, "Three-week coverage and sentiment", 4.2);
  const history = options.weeklyHistory?.length === 3
    ? options.weeklyHistory
    : [report];
  const rows: PptxGenJS.TableRow[] = [
    ["Week", "Facility media", "Social posts", "Media score", "Social score"].map(tableCell),
    ...history.map((week) => ([
      week.range.label.replace("Week of ", ""),
      week.available ? String(facilityCount(week)) : "—",
      week.available ? String(week.socialMentions) : "—",
      week.available ? scoreLabel(
        week.range.key === report.range.key && options.mediaScoreOverride != null
          ? options.mediaScoreOverride
          : sentimentOf(week.items.filter((item) => item.sourceType !== "social" && FACILITY.has(item.label))).score,
      ) : "—",
      week.available ? scoreLabel(
        week.range.key === report.range.key && options.socialScoreOverride != null
          ? options.socialScoreOverride
          : week.socialSentiment.score,
      ) : "—",
    ]).map(tableCell)),
  ];
  slide.addTable(rows, {
    x: M, y: 4.62, w: CW, colW: [2.35, 1.24, 1.12, 1.36, 1.39],
    rowH: 0.52, fontFace: FONT, fontSize: 10, color: INK,
    border: { type: "solid", color: RULE, pt: 0.6 },
    fill: { color: "FFFFFF" }, margin: 0.08, valign: "middle",
  });
  slide.addText("Sentiment scores run from 0 to 100. A dash means the archive was unavailable for that week.", {
    x: M, y: 7.05, w: CW, h: 0.42, fontFace: FONT, fontSize: 9.5, color: MUTED,
  });
  sectionLabel(slide, "Analyst observations", 7.75);
  slide.addText("Add the main coverage change, client implication, and any item needing follow-up.", {
    x: M + 0.08, y: 8.18, w: CW - 0.16, h: 1.0,
    fontFace: FONT, fontSize: 11, color: MUTED, italic: true,
  });
}

function addSummaryContinuation(pptx: PptxGenJS, summary: string): void {
  const slide = pageSlide(pptx, "Executive Summary (continued)");
  slide.addText(summary, { x: M, y: 1.58, w: CW, h: 8.7,
    fontFace: FONT, fontSize: 12, color: INK, valign: "top" });
}

function addFeatured(pptx: PptxGenJS, featured: ReportItem[]): void {
  for (let start = 0; start < featured.length; start += 2) {
    const slide = pageSlide(pptx, "Featured Mentions");
    featured.slice(start, start + 2).forEach((item, index) => {
      const y = 1.55 + index * 4.38;
      sectionLabel(slide, `${formatDate(item)}  ·  ${item.source}`, y);
      slide.addText(item.title, { x: M, y: y + 0.38, w: CW, h: 0.88,
        fontFace: FONT, fontSize: 17, bold: true, color: BLUE, valign: "top",
        hyperlink: validLink(item.url) });
      const excerpt = item.transcript || item.snippet || item.reason;
      slide.addText(shorten(excerpt, 480) || "Add an excerpt or analyst note.", {
        x: M, y: y + 1.38, w: CW, h: 1.85,
        fontFace: FONT, fontSize: 11.5, color: INK, valign: "top",
      });
      addSourceLink(slide, item, y + 3.34);
      slide.addShape("line", { x: M, y: y + 4.05, w: CW, h: 0,
        line: { color: RULE, width: 0.8 } });
    });
  }
}

function addMediaSummary(pptx: PptxGenJS, groups: StoryGroup[], options: DeckOptions): void {
  const slide = pageSlide(pptx, "Traditional Media Mentions");
  sectionLabel(slide, "Mentions of our facility this week", 1.48);
  addMetricLine(slide, 1.92, groups.map((group) => `${group.label}: ${group.items.length}`).join("     "));
  const mix = sentimentOf(groups.flatMap((group) => group.items));
  sectionLabel(slide, "Sentiment regarding our facility", 2.66);
  addMetricLine(slide, 3.06, `Negative: ${mix.negative}     Neutral: ${mix.neutral}     Positive: ${mix.positive}`);
  addMetricLine(slide, 3.62, `Media sentiment: ${scoreLabel(options.mediaScoreOverride ?? mix.score)} / 100  ·  ${sentimentBand(options.mediaScoreOverride ?? mix.score)}`);
  sectionLabel(slide, "Popular topics", 4.55);
  addBullets(slide, options.mediaThemes ?? [], 4.96);
  sectionLabel(slide, "Prominent outlets", 6.45);
  const outlets = countSources(groups.flatMap((group) => group.items)).slice(0, 5);
  addBullets(slide, outlets, 6.86);
  slide.addText("Broadcast and published mentions follow, grouped by online/print, radio, and TV.", {
    x: M, y: 9.76, w: CW, h: 0.35, fontFace: FONT, fontSize: 10, color: MUTED,
  });
}

function addSocialSummary(pptx: PptxGenJS, report: Report, groups: StoryGroup[], options: DeckOptions): void {
  const slide = pageSlide(pptx, "Social Media Mentions");
  sectionLabel(slide, "Posts mentioning our facility this week", 1.48);
  addMetricLine(slide, 1.9, String(report.socialMentions));
  const mix = report.socialSentiment;
  sectionLabel(slide, "Sentiment", 2.63);
  addMetricLine(slide, 3.02, `Negative: ${mix.negative}     Neutral: ${mix.neutral}     Positive: ${mix.positive}`);
  addMetricLine(slide, 3.57, `Social sentiment: ${scoreLabel(options.socialScoreOverride ?? mix.score)} / 100  ·  ${sentimentBand(options.socialScoreOverride ?? mix.score)}`);
  const previous = options.weeklyHistory?.at(-2);
  const previousScore = previous?.socialSentiment.score;
  const currentScore = options.socialScoreOverride ?? mix.score;
  addMetricLine(slide, 4.12, `Vs. previous week: ${trendLabel(currentScore, previousScore)}`);
  sectionLabel(slide, "Posts by platform", 5.01);
  addBullets(slide, groups.map((group) => `${group.label}: ${group.items.length}`), 5.42);
  sectionLabel(slide, "Popular themes", 7.5);
  addBullets(slide, options.socialThemes ?? [], 7.91);
}

function addGroupedStories(
  pptx: PptxGenJS,
  groups: StoryGroup[],
  heading: string,
  subheading: string,
  kind: "media" | "social",
): void {
  if (!groups.some((group) => group.items.length)) {
    addEmptyStories(pptx, heading, "No mentions captured this week.");
    return;
  }
  for (const group of groups) {
    if (!group.items.length) continue;
    addStoryPages(pptx, group.items, heading, `${subheading} · ${group.label}`, kind);
  }
}

function addStories(
  pptx: PptxGenJS,
  items: ReportItem[],
  heading: string,
  subheading: string,
  kind: "relevant",
): void {
  if (!items.length) {
    addEmptyStories(pptx, heading, "No adjacent or industry stories were captured this week.");
    return;
  }
  addStoryPages(pptx, items, heading, subheading, kind);
}

function addSocialStories(pptx: PptxGenJS, items: ReportItem[]): void {
  if (!items.length) {
    addEmptyStories(pptx, "Social Media Mentions", "No social posts captured this week.");
    return;
  }
  addStoryPages(pptx, items, "Social Media Mentions", "Details of Posts", "social");
}

function addStoryPages(
  pptx: PptxGenJS,
  items: ReportItem[],
  heading: string,
  subheading: string,
  kind: "media" | "relevant" | "social",
): void {
  const perPage = kind === "social" ? 4 : 3;
  const pages = Math.ceil(items.length / perPage);
  for (let p = 0; p < pages; p++) {
    const slide = pageSlide(pptx, heading);
    slide.addText(pages > 1 ? `${subheading} (${p + 1} of ${pages})` : subheading, {
      x: M, y: 1.34, w: CW, h: 0.3, fontFace: FONT, fontSize: 11,
      bold: true, color: INK,
    });
    items.slice(p * perPage, (p + 1) * perPage).forEach((item, index) => {
      renderStory(slide, item, 1.8 + index * (kind === "social" ? 2.1 : 2.82), kind);
    });
  }
}

function renderStory(slide: PptxGenJS.Slide, item: ReportItem, y: number, kind: "media" | "relevant" | "social"): void {
  const compact = kind === "social";
  slide.addText(`${formatDate(item)}  ·  ${compact ? `${socialPlatform(item.url)}  ·  ` : ""}${item.source}`, {
    x: M, y, w: CW, h: 0.28, fontFace: FONT, fontSize: 10, bold: true, color: MUTED,
  });
  slide.addText(shorten(item.title, 155), {
    x: M, y: y + 0.34, w: CW, h: compact ? 0.49 : 0.65, fontFace: FONT, fontSize: compact ? 11.8 : 13,
    bold: true, color: INK, valign: "top", hyperlink: validLink(item.url),
  });
  const content = kind === "relevant"
    ? item.reason || item.snippet
    : item.transcript || item.snippet || item.reason;
  slide.addText(`${kind === "relevant" ? "Relevance: " : "Excerpt: "}${shorten(content, compact ? 170 : 290) || "Add analyst description."}`, {
    x: M, y: y + (compact ? 0.85 : 1.07), w: CW, h: compact ? 0.55 : 0.83, fontFace: FONT,
    fontSize: compact ? 9.8 : 10.5, color: INK, valign: "top",
  });
  if (kind !== "relevant") {
    slide.addText(`Sentiment: ${sentimentWord(item.sentiment)}`, {
      x: M, y: y + (compact ? 1.43 : 1.94), w: 2.7, h: 0.25, fontFace: FONT,
      fontSize: 9.8, color: INK,
    });
  }
  addSourceLink(slide, item, y + (compact ? 1.67 : 2.23));
  slide.addShape("line", { x: M, y: y + (compact ? 2.0 : 2.67), w: CW, h: 0,
    line: { color: RULE, width: 0.7 } });
}

function addSourceLink(slide: PptxGenJS.Slide, item: ReportItem, y: number): void {
  const link = item.clipUrl || item.url;
  slide.addText(shorten(link, 105), {
    x: M, y, w: CW, h: 0.28, fontFace: FONT, fontSize: 9.2,
    color: BLUE, underline: { color: BLUE }, hyperlink: validLink(link),
  });
}

function addEmptyStories(pptx: PptxGenJS, heading: string, text: string): void {
  const slide = pageSlide(pptx, heading);
  slide.addText(text, { x: M, y: 1.85, w: CW, h: 0.6,
    fontFace: FONT, fontSize: 12, color: MUTED });
}

function addCommentsTable(pptx: PptxGenJS): void {
  const slide = pageSlide(pptx, "Social Media Comments");
  slide.addText("Analyst entry: count and classify comments after review. Leave categories blank when not assessed.", {
    x: M, y: 1.36, w: CW, h: 0.48, fontFace: FONT, fontSize: 10, color: MUTED,
  });
  const rows: PptxGenJS.TableRow[] = [
    ["Comments by category", "Count", "Share"].map(tableCell),
    ...COMMENT_CATEGORIES.map((category) => [category, "", ""].map(tableCell)),
    ["Total comments reviewed", "", ""].map(tableCell),
  ];
  slide.addTable(rows, {
    x: M, y: 1.92, w: CW, colW: [5.75, 0.84, 0.87], rowH: 0.4,
    fontFace: FONT, fontSize: 9.8, color: INK, margin: 0.07,
    border: { type: "solid", color: RULE, pt: 0.6 },
    fill: { color: "FFFFFF" }, valign: "middle",
  });
}

function addScreenshotSlot(pptx: PptxGenJS, number: number): void {
  const slide = pageSlide(pptx, "Social Media Screenshots");
  slide.addText(`Screenshot ${number}`, { x: M, y: 1.45, w: CW, h: 0.32,
    fontFace: FONT, fontSize: 12, bold: true, color: INK });
  slide.addShape("rect", { x: M, y: 1.95, w: CW, h: 7.52,
    fill: { color: "FFFFFF" }, line: { color: RULE, width: 1, dashType: "dash" } });
  slide.addText("Paste a post or comment screenshot here", {
    x: M + 0.4, y: 5.37, w: CW - 0.8, h: 0.45,
    fontFace: FONT, fontSize: 13, color: MUTED, align: "center", italic: true,
  });
  slide.addText("Platform / source link:", { x: M, y: 9.7, w: CW, h: 0.35,
    fontFace: FONT, fontSize: 10, color: MUTED });
}

function groupSocial(items: ReportItem[]): StoryGroup[] {
  const groups = new Map<string, ReportItem[]>();
  for (const item of items) {
    const platform = socialPlatform(item.url);
    groups.set(platform, [...(groups.get(platform) ?? []), item]);
  }
  return [...groups.entries()].map(([label, grouped]) => ({ label, items: grouped }));
}

function tableCell(text: string): PptxGenJS.TableCell {
  return { text };
}

function groupPages(groups: StoryGroup[], perPage: number): number {
  return groups.reduce((count, group) => count + Math.ceil(group.items.length / perPage), 0);
}

function facilityCount(report: Report): number {
  return report.items.filter((item) =>
    item.sourceType !== "social" && FACILITY.has(item.label),
  ).length;
}

function countSources(items: ReportItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => source);
}

function addMetricLine(slide: PptxGenJS.Slide, y: number, text: string): void {
  slide.addText(text, { x: M + 0.1, y, w: CW - 0.2, h: 0.4,
    fontFace: FONT, fontSize: 12.5, color: INK });
}

function addBullets(slide: PptxGenJS.Slide, values: string[], y: number): void {
  const shown = values.slice(0, 5);
  if (!shown.length) {
    slide.addText("No recurring theme identified.", { x: M + 0.1, y, w: CW - 0.1, h: 0.3,
      fontFace: FONT, fontSize: 11, color: MUTED });
    return;
  }
  shown.forEach((value, index) => {
    slide.addText(`•  ${value}`, { x: M + 0.1, y: y + index * 0.31, w: CW - 0.1, h: 0.29,
      fontFace: FONT, fontSize: 11, color: INK });
  });
}

function splitWords(value: string, limit: number): string[] {
  if (!value) return [""];
  const words = value.split(/\s+/);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > limit) {
      parts.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function scoreLabel(score: number | null): string {
  return score === null ? "Not scored" : String(score);
}

function trendLabel(current: number | null, previous: number | null | undefined): string {
  if (current === null) return "No posts scored this week";
  if (previous == null) return "No prior score";
  const difference = Math.round((current - previous) * 10) / 10;
  if (Math.abs(difference) < 8) return `Steady (${current} vs. ${previous})`;
  return `${difference > 0 ? "Higher" : "Lower"} (${current} vs. ${previous})`;
}

function sentimentWord(value: string | null): string {
  if (!value) return "Not scored";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(item: ReportItem): string {
  if (!item.publishedAt) return "Date unavailable";
  return new Date(item.publishedAt).toLocaleDateString("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  });
}

function shorten(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function validLink(url: string): { url: string } | undefined {
  return /^https?:\/\//i.test(url) ? { url } : undefined;
}
