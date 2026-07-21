"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import SentimentControl from "@/components/sentiment-control";
import type { Report, ReportItem, SentimentMix } from "@/lib/report";

/**
 * Client-side report document. Data (Eastern-time day buckets, relevance mix,
 * outlet counts) is computed server-side in lib/report.ts; this component owns
 * the presentation and the analyst curation workflow: editable title/summary,
 * featured-story selection, inline clip playback, CSV export, print-to-PDF.
 */

type Props = {
  report: Report;
  generatedOn: string;
  initialSummary: string;
};

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

const itemDateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatItemDate(item: ReportItem) {
  if (!item.publishedAt) return "Date unavailable";
  const parsed = new Date(item.publishedAt);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : itemDateFormat.format(parsed);
}

// Local copy of the platform bucketing (importing it from lib/digest would
// pull the whole server digest pipeline into the client bundle).
function platformOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("x.com") || host.endsWith("twitter.com")) return "X";
    if (host.endsWith("bsky.app")) return "Bluesky";
    if (host.endsWith("facebook.com")) return "Facebook";
    if (host.endsWith("reddit.com")) return "Reddit";
    if (host.endsWith("linkedin.com")) return "LinkedIn";
    return "Other";
  } catch {
    return "Other";
  }
}

function typeLabel(item: ReportItem) {
  return TYPE_LABELS[item.sourceType] ?? item.sourceType;
}

/* ------------------------------ Clips -------------------------------- */

function directMediaType(url: string) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(mp4|webm|mov)$/.test(path)) return "video";
    if (/\.(mp3|m4a|wav|ogg)$/.test(path)) return "audio";
  } catch {
    return null;
  }
  return null;
}

/**
 * YouTube embed URL, preserving a start timestamp when the monitor deep-linked
 * the moment of the on-air mention (?t=123s from the caption matcher).
 */
function youtubeEmbedUrl(url: string) {
  try {
    const parsed = new URL(url);
    let id = "";
    if (parsed.hostname === "youtu.be") id = parsed.pathname.slice(1);
    if (parsed.hostname.endsWith("youtube.com")) {
      id = parsed.searchParams.get("v") ?? "";
      if (!id && parsed.pathname.startsWith("/shorts/")) {
        id = parsed.pathname.split("/")[2] ?? "";
      }
    }
    if (!/^[a-zA-Z0-9_-]{6,}$/.test(id)) return null;
    const start = Number.parseInt(parsed.searchParams.get("t") ?? "", 10);
    const startParam =
      Number.isFinite(start) && start > 0 ? `?start=${start}` : "";
    return `https://www.youtube-nocookie.com/embed/${id}${startParam}`;
  } catch {
    return null;
  }
}

function ClipPlayer({ item }: { item: ReportItem }) {
  const mediaType = directMediaType(item.url);
  const embedUrl = youtubeEmbedUrl(item.url);

  if (mediaType === "video") {
    return (
      <video className="mt-4 w-full rounded-xl bg-black" controls preload="metadata">
        <source src={item.url} />
      </video>
    );
  }
  if (mediaType === "audio") {
    return (
      <audio className="mt-4 w-full" controls preload="metadata">
        <source src={item.url} />
      </audio>
    );
  }
  if (embedUrl) {
    return (
      <iframe
        className="mt-4 aspect-video w-full rounded-xl border-0 bg-black"
        src={embedUrl}
        title={`Playable clip: ${item.title}`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return null;
}

/* ------------------------------ CSV ---------------------------------- */

function escapeCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv(report: Report) {
  const header = [
    "Published date",
    "Title",
    "Publisher",
    "Media type",
    "Relevance",
    "Priority",
    "Sentiment",
    "Sentiment set by",
    "URL",
    "Snippet",
  ];
  const rows = report.items.map((item) => [
    formatItemDate(item),
    item.title,
    item.source,
    typeLabel(item),
    LABEL_LABELS[item.label] ?? item.label,
    item.priority,
    item.sentiment ?? "not scored",
    item.sentimentSource === "manual"
      ? "analyst"
      : item.sentimentSource === "auto"
        ? "automatic"
        : "",
    item.url,
    item.snippet,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `earned-media-${report.range.key}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ View --------------------------------- */

export default function ReportView({
  report,
  generatedOn,
  initialSummary,
}: Props) {
  const [title, setTitle] = useState(
    report.range.period === "weekly"
      ? "Weekly Earned Media Report"
      : report.range.period === "monthly"
        ? "Monthly Earned Media Report"
        : "Earned Media Report",
  );
  const [clientName, setClientName] = useState(
    "The 66 Express Outside the Beltway",
  );
  const [summary, setSummary] = useState(initialSummary);
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(
    () =>
      new Set(
        report.items
          .slice(0, Math.min(4, report.items.length))
          .map((item) => item.id),
      ),
  );

  // Sentiment edits made since the page loaded, keyed by item id. Applied as a
  // delta to the server-computed mix rather than recounting client-side: the
  // coverage index is capped at 500 rows while the mix covers the whole range.
  const [sentimentEdits, setSentimentEdits] = useState<
    Record<string, string | null>
  >({});

  const sentimentMix = useMemo(
    () => applySentimentEdits(report, sentimentEdits),
    [report, sentimentEdits],
  );

  const [exportState, setExportState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; url: string; name: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  /**
   * Post the current range plus the analyst's curation to the export route.
   * "drive" uploads and converts to Slides; "download" returns the raw .pptx
   * (also the automatic fallback when Drive isn't configured).
   */
  async function exportDeck(destination: "drive" | "download") {
    setExportState({ kind: "working" });
    const payload = {
      params: Object.fromEntries(new URLSearchParams(window.location.search)),
      title,
      clientName,
      summary,
      featuredIds: [...featuredIds],
      generatedOn,
      destination,
    };

    try {
      const response = await fetch("/api/export/slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && !contentType.includes("application/json")) {
        // Raw .pptx came back — save it.
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${title} — ${report.range.label}.pptx`.replace(
          /[\\/:*?"<>|]/g,
          "-",
        );
        link.click();
        URL.revokeObjectURL(url);
        setExportState({ kind: "idle" });
        return;
      }

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        webViewLink?: string;
        name?: string;
      };
      if (!response.ok || !data.ok || !data.webViewLink) {
        throw new Error(data.error ?? `Export failed (HTTP ${response.status}).`);
      }
      setExportState({
        kind: "done",
        url: data.webViewLink,
        name: data.name ?? title,
      });
    } catch (error) {
      setExportState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not export the deck.",
      });
    }
  }

  const featured = report.items.filter((item) => featuredIds.has(item.id));
  const maxDaily = Math.max(1, ...report.daily.map((d) => d.count));
  const broadcastCount =
    report.byType.find((t) => t.type === "broadcast")?.count ?? 0;
  const broadcastPercent = report.totalMentions
    ? Math.round((broadcastCount / report.totalMentions) * 100)
    : 0;
  const maxOutlet = Math.max(1, ...report.topOutlets.map((o) => o.count));
  const denseChart = report.daily.length > 10;

  const labelForBar = useMemo(
    () => (index: number) =>
      !denseChart ||
      index === 0 ||
      index === report.daily.length - 1 ||
      (index + 1) % 5 === 0,
    [denseChart, report.daily.length],
  );

  function toggleFeatured(id: string) {
    setFeaturedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="report-shell">
      <section className="no-print mb-5 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Report title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Client / program
            <input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadCsv(report)}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-bold hover:bg-[#f7f9f8]"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => exportDeck("drive")}
              disabled={exportState.kind === "working"}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-bold hover:bg-[#f7f9f8] disabled:opacity-50"
            >
              {exportState.kind === "working"
                ? "Building deck…"
                : "Send to Google Slides"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]"
            >
              Print / Save PDF
            </button>
          </div>
        </div>
        {exportState.kind === "done" ? (
          <p className="mt-3 text-xs leading-5">
            <a
              href={exportState.url}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-[var(--accent)] underline decoration-1 underline-offset-2"
            >
              Open “{exportState.name}” in Google Slides →
            </a>{" "}
            <span className="text-[var(--muted)]">
              Saved to the shared reports folder.
            </span>
          </p>
        ) : null}
        {exportState.kind === "error" ? (
          <p className="mt-3 text-xs leading-5 text-[#c0392b]">
            {exportState.message}{" "}
            <button
              type="button"
              onClick={() => exportDeck("download")}
              className="font-bold underline decoration-1 underline-offset-2"
            >
              Download the .pptx instead
            </button>
            .
          </p>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          The web report plays supported clips inline. A saved PDF keeps
          clickable source links; playback stays in this web view. The Slides
          export carries your edited title, summary, and featured selection.
        </p>
      </section>

      <article className="report-document overflow-hidden rounded-[28px] border border-[#d0ccc9] bg-[#f1efec] shadow-xl">
        {/* Cover — navy with the brand's orange frame accents */}
        <section
          className="report-page report-cover relative overflow-hidden p-7 text-white md:p-12"
          style={{
            background:
              "linear-gradient(150deg, #0a1f3c 0%, #0d2c55 55%, #105cae 130%)",
          }}
        >
          <div className="absolute inset-x-0 top-0 z-20 h-1.5 bg-[#ee7729]" />
          <div className="absolute inset-x-0 bottom-0 z-20 h-1.5 bg-[#ee7729]" />
          <div className="report-orb report-orb-one" />
          <div className="report-orb report-orb-two" />
          <div className="relative z-10 flex min-h-[440px] flex-col justify-between">
            <div className="flex items-start justify-between gap-5">
              <div className="rounded-xl bg-white p-2 shadow-lg">
                <Image
                  src="/66OTB.png"
                  alt="66 Express Outside the Beltway"
                  width={67}
                  height={52}
                  priority
                />
              </div>
              <div className="rounded-xl bg-white px-3 py-2 shadow-lg">
                <Image src="/TCG.png" alt="The Casey Group" width={135} height={38} />
              </div>
            </div>

            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#f8a829]">
                {clientName}
              </p>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
                {title}
              </h2>
              <p className="mt-6 text-lg text-[#dbe7f6] md:text-2xl">
                {report.range.label}
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <p className="text-2xl font-bold tracking-tight md:text-3xl">
                <span className="text-white">Sit Less. </span>
                <span className="text-[#f8a829]">Live More.</span>
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-[0.16em] text-[#c8d9ef]">
                  <span className="rounded-full border border-white/25 px-4 py-2">
                    Earned media
                  </span>
                  <span className="rounded-full border border-white/25 px-4 py-2">
                    Washington, DC market
                  </span>
                  <span className="rounded-full border border-white/25 px-4 py-2">
                    Web + broadcast + social
                  </span>
                </div>
                <p className="text-xs text-[#9fb8d8]">
                  Prepared by The Casey Group · Generated {generatedOn}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Executive snapshot */}
        <section className="report-page p-5 md:p-10">
          <div className="mb-7">
            <p className="report-kicker">Executive snapshot</p>
            <h2 className="report-heading">What are the key results?</h2>
          <div className="brand-rule"><span /><span /><span /></div>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="report-summary mt-4 min-h-24 w-full resize-y rounded-xl border border-[#c9d6e8] bg-white p-4 text-sm leading-6 text-[#2c5793] outline-none focus:border-[var(--accent)] md:text-base"
              aria-label="Executive summary"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Earned mentions" value={report.totalMentions} />
            <Metric label="Unique publishers" value={report.uniqueOutlets} />
            <Metric label="Broadcast mentions" value={broadcastCount} />
            <Metric label="Priority mentions" value={report.importantCount} />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
            <ReportPanel title="Mention activity by day">
              <div className="flex min-h-48 items-end gap-1.5 pt-5">
                {report.daily.map(({ label, count }, index) => (
                  <div
                    key={`${label}-${index}`}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                    title={`${label}: ${count} mention${count === 1 ? "" : "s"}`}
                  >
                    {(!denseChart || count > 0) && (
                      <span className="text-xs font-bold text-[#105cae]">
                        {count > 0 ? count : ""}
                      </span>
                    )}
                    <div
                      className="w-full max-w-12 rounded-t-md bg-[#105cae]"
                      style={{
                        height: `${Math.max(count > 0 ? 12 : 3, (count / maxDaily) * 120)}px`,
                        opacity: count > 0 ? 1 : 0.25,
                      }}
                    />
                    {labelForBar(index) && (
                      <span className="truncate text-[10px] font-semibold text-[var(--muted)]">
                        {label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ReportPanel>

            <ReportPanel title="Broadcast share">
              <div className="flex min-h-48 items-center justify-center gap-6">
                <div
                  className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `conic-gradient(#105cae 0 ${broadcastPercent}%, #e4e1de ${broadcastPercent}% 100%)`,
                  }}
                >
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center">
                    <div>
                      <strong className="block text-3xl text-[#105cae]">
                        {broadcastPercent}%
                      </strong>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        TV / radio
                      </span>
                    </div>
                  </div>
                </div>
                <p className="max-w-36 text-sm leading-6 text-[var(--muted)]">
                  Based on verified mention counts, not estimated audience or ad
                  value.
                </p>
              </div>
            </ReportPanel>
          </div>
        </section>

        {/* Coverage mix */}
        <section className="report-page p-5 md:p-10">
          <p className="report-kicker">Coverage mix</p>
          <h2 className="report-heading">How does earned media break down?</h2>
          <div className="brand-rule"><span /><span /><span /></div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <ReportPanel title="Media type">
                <MixBars
                  rows={report.byType.map(({ type, count }) => ({
                    label: TYPE_LABELS[type] ?? type,
                    count,
                  }))}
                  total={report.totalMentions}
                />
              </ReportPanel>
              <ReportPanel title="Relevance mix">
                <MixBars
                  rows={report.byLabel.map(({ label, count }) => ({
                    label: LABEL_LABELS[label] ?? label,
                    count,
                  }))}
                  total={report.totalMentions}
                />
              </ReportPanel>
            </div>

            <ReportPanel title="Top publishers">
              {report.topOutlets.length ? (
                <ol className="divide-y divide-[#e8e5e2]">
                  {report.topOutlets.map(({ source, count }, index) => (
                    <li key={source} className="flex items-center gap-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e3edf9] text-sm font-bold text-[#105cae]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {source}
                      </span>
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-[#e4e1de]">
                        <div
                          className="h-full rounded-full bg-[#105cae]"
                          style={{ width: `${(count / maxOutlet) * 100}%` }}
                        />
                      </div>
                      <strong className="w-6 text-right text-[#105cae]">
                        {count}
                      </strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState>No publishers recorded in this period.</EmptyState>
              )}
            </ReportPanel>
          </div>

          <div className="mt-5">
            <SentimentMeter mix={sentimentMix} />
          </div>
        </section>

        {/* Social pulse */}
        <section className="report-page p-5 md:p-10">
          <p className="report-kicker">Social media</p>
          <h2 className="report-heading">Social pulse</h2>
          <div className="brand-rule"><span /><span /><span /></div>

          <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <ReportPanel title="Posts by platform">
              <MixBars
                rows={report.byPlatform.map(({ platform, count }) => ({
                  label: platform,
                  count,
                }))}
                total={report.byPlatform.reduce((sum, p) => sum + p.count, 0)}
              />
            </ReportPanel>

            <ReportPanel title="Recent posts">
              {report.socialPosts.length ? (
                <div className="divide-y divide-[#e8e5e2]">
                  {report.socialPosts.map((post) => (
                    <div key={post.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em]">
                        <span className="rounded-full bg-[#e3edf9] px-2.5 py-1 text-[#105cae]">
                          {platformOf(post.url)}
                        </span>
                        <span className="text-[var(--muted)] normal-case tracking-normal">
                          {post.source} · {formatItemDate(post)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-[#44546a]">
                        {post.snippet || post.title}
                      </p>
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs font-bold text-[#105cae] underline decoration-1 underline-offset-2"
                      >
                        View post
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>
                  No public social mentions captured in this period across X,
                  Bluesky, Facebook, Reddit, or LinkedIn.
                </EmptyState>
              )}
            </ReportPanel>
          </div>
        </section>

        {/* Featured mentions */}
        <section className="report-page p-5 md:p-10">
          <p className="report-kicker">Curated coverage</p>
          <h2 className="report-heading">Featured mentions and playable clips</h2>
          <div className="brand-rule"><span /><span /><span /></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Select or remove featured items in the coverage index below.
            YouTube segments open at the moment of the on-air mention when the
            monitor captured a timestamp.
          </p>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {featured.length ? (
              featured.map((item) => (
                <article
                  key={item.id}
                  className="report-section rounded-2xl border border-[#d0ccc9] bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em]">
                    <span className="rounded-full bg-[#e3edf9] px-2.5 py-1 text-[#105cae]">
                      {typeLabel(item)}
                    </span>
                    {item.priority === "important" && (
                      <span className="rounded-full bg-[#fbe7bf] px-2.5 py-1 text-[#7a4d07]">
                        Priority
                      </span>
                    )}
                    <span className="rounded-full bg-[#efedea] px-2.5 py-1 text-[#44546a]">
                      {LABEL_LABELS[item.label] ?? item.label}
                    </span>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold leading-snug text-[#123a63]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-xs font-semibold text-[var(--muted)]">
                    {item.source} · {formatItemDate(item)}
                  </p>
                  {item.snippet && (
                    <p className="mt-3 text-sm leading-6 text-[#44546a]">
                      {item.snippet}
                    </p>
                  )}
                  <ClipPlayer item={item} />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex rounded-lg bg-[#105cae] px-4 py-2 text-sm font-bold text-white"
                  >
                    {item.sourceType === "broadcast"
                      ? "Open clip / source"
                      : "Read original"}
                  </a>
                </article>
              ))
            ) : (
              <div className="lg:col-span-2">
                <EmptyState>
                  Select at least one item in the coverage index.
                </EmptyState>
              </div>
            )}
          </div>
        </section>

        {/* Coverage index */}
        <section className="report-page p-5 md:p-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="report-kicker">Coverage index</p>
              <h2 className="report-heading">All captured mentions</h2>
          <div className="brand-rule"><span /><span /><span /></div>
            </div>
            <p className="no-print max-w-md text-xs leading-5 text-[var(--muted)]">
              Check the stories that should appear in Featured mentions. Your
              selection is reflected instantly in the report above.
            </p>
          </div>

          {report.items.length ? (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-[#d0ccc9] bg-white">
              <table className="report-table w-full border-collapse">
                <thead>
                  <tr>
                    <th className="no-print">Feature</th>
                    <th>Mention</th>
                    <th>Publisher</th>
                    <th>Type</th>
                    <th className="no-print">Sentiment</th>
                    <th>Date</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => (
                    <tr key={item.id}>
                      <td className="no-print text-center">
                        <input
                          type="checkbox"
                          checked={featuredIds.has(item.id)}
                          onChange={() => toggleFeatured(item.id)}
                          aria-label={`Feature ${item.title}`}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      </td>
                      <td>
                        <strong className="block leading-5">{item.title}</strong>
                        {item.snippet && (
                          <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                            {item.snippet}
                          </span>
                        )}
                      </td>
                      <td>{item.source}</td>
                      <td>{typeLabel(item)}</td>
                      <td className="no-print">
                        <SentimentControl
                          id={item.id}
                          initial={item.sentiment}
                          initialSource={item.sentimentSource}
                          onChange={(value) =>
                            setSentimentEdits((edits) => ({
                              ...edits,
                              [item.id]: value,
                            }))
                          }
                        />
                      </td>
                      <td>{formatItemDate(item)}</td>
                      <td>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-[var(--accent)] underline decoration-1 underline-offset-2"
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState>
                No mentions were captured in this period. The daily digest and
                real-time alerts continue to monitor; quiet periods are normal.
              </EmptyState>
            </div>
          )}
        </section>
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="report-section rounded-2xl border border-[#d0ccc9] bg-white p-5 shadow-sm">
      <strong className="block text-4xl font-semibold tracking-tight text-[#105cae]">
        {value.toLocaleString("en-US")}
      </strong>
      <span className="mt-2 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </span>
    </div>
  );
}

function MixBars({
  rows,
  total,
}: {
  rows: Array<{ label: string; count: number }>;
  total: number;
}) {
  if (!rows.length) {
    return <EmptyState>No mentions in this period.</EmptyState>;
  }
  return (
    <div className="space-y-4 py-2">
      {rows.map(({ label, count }) => {
        const percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <div key={label}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold">{label}</span>
              <span className="text-[var(--muted)]">
                {count} · {percent}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#e4e1de]">
              <div
                className="h-full rounded-full bg-[#105cae]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Bucket = "positive" | "neutral" | "negative";

function isBucket(value: string | null): value is Bucket {
  return value === "positive" || value === "neutral" || value === "negative";
}

/**
 * Fold in-page sentiment edits into the server-computed mix. Each edit moves
 * one item out of its old bucket and into the new one (or out of "scored"
 * entirely when cleared), so the meter stays exact without re-querying.
 */
function applySentimentEdits(
  report: Report,
  edits: Record<string, string | null>,
): SentimentMix {
  const entries = Object.entries(edits);
  if (entries.length === 0) {
    return report.sentiment;
  }

  const mix = { ...report.sentiment };
  for (const [id, next] of entries) {
    const item = report.items.find((candidate) => candidate.id === id);
    if (!item) {
      continue;
    }
    const previous = item.sentiment;
    if (previous === next) {
      continue;
    }

    if (isBucket(previous)) {
      mix[previous]--;
      mix.scored--;
      mix.unscored++;
      if (item.sentimentSource === "manual") {
        mix.adjusted--;
      }
    }
    if (isBucket(next)) {
      mix[next]++;
      mix.scored++;
      mix.unscored--;
      mix.adjusted++; // an in-page edit is a manual call by definition
    }
  }

  mix.net = mix.scored
    ? Math.round(((mix.positive - mix.negative) / mix.scored) * 100)
    : null;
  return mix;
}

/**
 * Sentiment toward the 66 Express: a single stacked bar plus a net score.
 * Percentages are of SCORED items, not of total mentions — and the unscored
 * remainder is stated plainly underneath, so the meter can't imply more
 * assessment than actually happened.
 */
function SentimentMeter({ mix }: { mix: SentimentMix }) {
  const segments = [
    { key: "positive", label: "Positive", count: mix.positive, color: "#1a7f4b" },
    { key: "neutral", label: "Neutral", count: mix.neutral, color: "#8a8580" },
    { key: "negative", label: "Negative", count: mix.negative, color: "#c0392b" },
  ];
  const pct = (count: number) =>
    mix.scored ? Math.round((count / mix.scored) * 100) : 0;

  return (
    <ReportPanel title="Sentiment toward the 66 Express">
      {mix.scored === 0 ? (
        <EmptyState>
          No coverage scored for sentiment in this period.
        </EmptyState>
      ) : (
        <div className="py-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-3xl font-extrabold leading-none text-[#105cae]">
                {mix.net! > 0 ? `+${mix.net}` : mix.net}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-[var(--muted)]">
                Net sentiment
              </div>
            </div>
            <div className="text-right text-sm text-[var(--muted)]">
              {mix.scored} of {mix.scored + mix.unscored} mentions scored
              {mix.adjusted > 0 ? (
                <>
                  <br />
                  {mix.adjusted} adjusted by an analyst
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#e4e1de]">
            {segments.map((segment) =>
              segment.count ? (
                <div
                  key={segment.key}
                  title={`${segment.label}: ${segment.count}`}
                  style={{
                    width: `${pct(segment.count)}%`,
                    backgroundColor: segment.color,
                  }}
                />
              ) : null,
            )}
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="font-semibold">{segment.label}</span>
                <span className="text-[var(--muted)]">
                  {segment.count} · {pct(segment.count)}%
                </span>
              </li>
            ))}
          </ul>

          {mix.unscored > 0 ? (
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Percentages are of scored coverage. {mix.unscored} mention
              {mix.unscored === 1 ? "" : "s"} in this period {mix.unscored === 1 ? "is" : "are"} not
              scored — sentiment is assessed for confirmed and likely Outside
              the Beltway coverage only.
            </p>
          ) : null}
        </div>
      )}
    </ReportPanel>
  );
}

function ReportPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section rounded-2xl border border-[#d0ccc9] bg-white p-5 shadow-sm">
      <h3 className="text-sm font-extrabold uppercase tracking-[0.08em] text-[#105cae]">{title}</h3>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#d0ccc9] bg-[#faf9f7] p-8 text-center text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}
