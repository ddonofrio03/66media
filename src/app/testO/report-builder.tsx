"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { ArchiveItem } from "@/lib/digest-store";

type Props = {
  items: ArchiveItem[];
  from: string;
  to: string;
  isDemo: boolean;
};

type CoverageType = "Broadcast" | "Online news" | "Social" | "Other";

const REPORT_TIMEZONE = "America/New_York";

const fullDate = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIMEZONE,
  month: "long",
  day: "numeric",
  year: "numeric",
});

const shortDate = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIMEZONE,
  month: "short",
  day: "numeric",
});

function parseReportDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function itemDate(item: ArchiveItem) {
  const value = item.publishedAt ?? item.firstSeenAt;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function coverageType(item: ArchiveItem): CoverageType {
  const value = item.sourceType.toLowerCase();
  if (/broadcast|radio|television|tv|podcast/.test(value)) return "Broadcast";
  if (/social|reddit|facebook|instagram|x|twitter|linkedin/.test(value)) {
    return "Social";
  }
  if (/news|web|article|rss|online/.test(value)) return "Online news";
  return "Other";
}

function sourceTypeLabel(item: ArchiveItem) {
  const type = coverageType(item);
  return type === "Broadcast" ? "TV / radio" : type;
}

function formatItemDate(item: ArchiveItem) {
  const date = itemDate(item);
  return date ? fullDate.format(date) : "Date unavailable";
}

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
    return /^[a-zA-Z0-9_-]{6,}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}

function escapeCsv(value: string | number) {
  const stringValue = String(value);
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function downloadCsv(items: ArchiveItem[], from: string, to: string) {
  const header = [
    "Published date",
    "Title",
    "Publisher",
    "Media type",
    "Priority",
    "URL",
    "Snippet",
  ];
  const rows = items.map((item) => [
    formatItemDate(item),
    item.title,
    item.source,
    sourceTypeLabel(item),
    item.priority,
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
  link.download = `earned-media-${from}-to-${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function ClipPlayer({ item }: { item: ArchiveItem }) {
  const mediaType = directMediaType(item.url);
  const embedUrl = youtubeEmbedUrl(item.url);

  if (mediaType === "video") {
    return (
      <video className="mt-4 w-full rounded-xl bg-black" controls preload="metadata">
        <source src={item.url} />
        Your browser does not support embedded video.
      </video>
    );
  }

  if (mediaType === "audio") {
    return (
      <audio className="mt-4 w-full" controls preload="metadata">
        <source src={item.url} />
        Your browser does not support embedded audio.
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

export default function ReportBuilder({ items, from, to, isDemo }: Props) {
  const [title, setTitle] = useState("Earned Media Measurement Report");
  const [clientName, setClientName] = useState(
    "66 Express Outside the Beltway",
  );
  const [summary, setSummary] = useState(
    "Coverage centered on regional transportation and roadway operations. Broadcast links and official source pages are preserved below wherever the monitoring source supplies them.",
  );
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(
    () => new Set(items.slice(0, Math.min(4, items.length)).map((item) => item.id)),
  );

  const stats = useMemo(() => {
    const mix = new Map<CoverageType, number>([
      ["Broadcast", 0],
      ["Online news", 0],
      ["Social", 0],
      ["Other", 0],
    ]);
    const publishers = new Map<string, number>();
    const days = new Map<string, number>();

    for (const item of items) {
      const type = coverageType(item);
      mix.set(type, (mix.get(type) ?? 0) + 1);
      publishers.set(item.source, (publishers.get(item.source) ?? 0) + 1);
      const date = itemDate(item);
      const key = date ? shortDate.format(date) : "Undated";
      days.set(key, (days.get(key) ?? 0) + 1);
    }

    const topPublishers = [...publishers.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6);
    const trend = [...days.entries()].reverse();
    const maxDay = Math.max(1, ...trend.map(([, count]) => count));

    return {
      mix: [...mix.entries()],
      topPublishers,
      trend,
      maxDay,
      outlets: publishers.size,
      broadcast: mix.get("Broadcast") ?? 0,
      important: items.filter((item) => item.priority === "important").length,
    };
  }, [items]);

  const featured = items.filter((item) => featuredIds.has(item.id));
  const broadcastPercent = items.length
    ? Math.round((stats.broadcast / items.length) * 100)
    : 0;

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
              onClick={() => downloadCsv(items, from, to)}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-bold hover:bg-[#f7f9f8]"
            >
              Download CSV
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
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          The web report can play supported clips. A saved PDF keeps clickable
          source links, but video and audio playback remains in this web view.
        </p>
      </section>

      <article className="report-document overflow-hidden rounded-[28px] border border-[#d4ded9] bg-[#f2f6f4] shadow-xl">
        <section className="report-page report-cover relative overflow-hidden bg-[#0b4f47] p-7 text-white md:p-12">
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
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-200">
                {isDemo ? "Sample report · " : ""}
                {clientName}
              </p>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
                {title}
              </h2>
              <p className="mt-6 text-lg text-emerald-50 md:text-2xl">
                {fullDate.format(parseReportDate(from))} –{" "}
                {fullDate.format(parseReportDate(to))}
              </p>
            </div>

            <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              <span className="rounded-full border border-white/25 px-4 py-2">
                Earned media
              </span>
              <span className="rounded-full border border-white/25 px-4 py-2">
                Washington, DC market
              </span>
              <span className="rounded-full border border-white/25 px-4 py-2">
                Web + broadcast
              </span>
            </div>
          </div>
        </section>

        <section className="report-page p-5 md:p-10">
          <div className="mb-7">
            <p className="report-kicker">Executive snapshot</p>
            <h2 className="report-heading">What are the key results?</h2>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="report-summary mt-4 min-h-24 w-full resize-y rounded-xl border border-[#cedbd5] bg-white p-4 text-sm leading-6 text-[#3f4d48] outline-none focus:border-[var(--accent)] md:text-base"
              aria-label="Executive summary"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Earned mentions" value={items.length} />
            <Metric label="Unique publishers" value={stats.outlets} />
            <Metric label="Broadcast mentions" value={stats.broadcast} />
            <Metric label="Priority mentions" value={stats.important} />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
            <ReportPanel title="Mention activity">
              {stats.trend.length ? (
                <div className="flex min-h-48 items-end gap-2 pt-5">
                  {stats.trend.map(([label, count]) => (
                    <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <span className="text-xs font-bold text-[#41534d]">{count}</span>
                      <div
                        className="w-full max-w-12 rounded-t-md bg-[#1b9a83]"
                        style={{ height: `${Math.max(12, (count / stats.maxDay) * 120)}px` }}
                      />
                      <span className="truncate text-[10px] font-semibold text-[var(--muted)]">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>No dated mentions in this report.</EmptyState>
              )}
            </ReportPanel>

            <ReportPanel title="Broadcast share">
              <div className="flex min-h-48 items-center justify-center gap-6">
                <div
                  className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `conic-gradient(#1b9a83 0 ${broadcastPercent}%, #dce8e3 ${broadcastPercent}% 100%)`,
                  }}
                >
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center">
                    <div>
                      <strong className="block text-3xl text-[#174f47]">
                        {broadcastPercent}%
                      </strong>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        TV / radio
                      </span>
                    </div>
                  </div>
                </div>
                <p className="max-w-36 text-sm leading-6 text-[var(--muted)]">
                  Based on verified mention counts, not estimated audience or ad value.
                </p>
              </div>
            </ReportPanel>
          </div>
        </section>

        <section className="report-page p-5 md:p-10">
          <p className="report-kicker">Coverage mix</p>
          <h2 className="report-heading">How does earned media break down?</h2>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <ReportPanel title="Media type">
              <div className="space-y-4 py-2">
                {stats.mix.map(([label, count]) => {
                  const percent = items.length ? Math.round((count / items.length) * 100) : 0;
                  return (
                    <div key={label}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold">{label}</span>
                        <span className="text-[var(--muted)]">
                          {count} · {percent}%
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[#e2ebe7]">
                        <div
                          className="h-full rounded-full bg-[#1b9a83]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ReportPanel>

            <ReportPanel title="Top publishers">
              <ol className="divide-y divide-[#e1e8e5]">
                {stats.topPublishers.map(([publisher, count], index) => (
                  <li key={publisher} className="flex items-center gap-3 py-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e4f1ed] text-sm font-bold text-[#126b5d]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {publisher}
                    </span>
                    <strong className="text-[#174f47]">{count}</strong>
                  </li>
                ))}
              </ol>
            </ReportPanel>
          </div>

          <div className="mt-5 rounded-2xl border border-[#d5e1dc] bg-white p-5">
            <h3 className="text-base font-bold text-[#174f47]">Measurement note</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              This report intentionally omits AVE, unverified reach, and automated
              sentiment. Those fields should only appear after a defensible data
              source and review method are connected.
            </p>
          </div>
        </section>

        <section className="report-page p-5 md:p-10">
          <p className="report-kicker">Curated coverage</p>
          <h2 className="report-heading">Featured mentions and playable clips</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Select or remove featured items in the coverage index below. Supported
            direct media and YouTube links play here; all other items retain a
            clickable source link.
          </p>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {featured.length ? (
              featured.map((item) => (
                <article
                  key={item.id}
                  className="report-section rounded-2xl border border-[#d5e1dc] bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em]">
                    <span className="rounded-full bg-[#e2f1ed] px-2.5 py-1 text-[#126b5d]">
                      {sourceTypeLabel(item)}
                    </span>
                    {item.priority === "important" ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
                        Priority
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-4 text-xl font-semibold leading-snug text-[#173d37]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-xs font-semibold text-[var(--muted)]">
                    {item.source} · {formatItemDate(item)}
                  </p>
                  {item.snippet ? (
                    <p className="mt-3 text-sm leading-6 text-[#52605c]">{item.snippet}</p>
                  ) : null}
                  <ClipPlayer item={item} />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex rounded-lg bg-[#174f47] px-4 py-2 text-sm font-bold text-white"
                  >
                    {coverageType(item) === "Broadcast" ? "Open clip / source" : "Read original"}
                  </a>
                </article>
              ))
            ) : (
              <div className="lg:col-span-2">
                <EmptyState>Select at least one item in the coverage index.</EmptyState>
              </div>
            )}
          </div>
        </section>

        <section className="report-page p-5 md:p-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="report-kicker">Coverage index</p>
              <h2 className="report-heading">All captured mentions</h2>
            </div>
            <p className="no-print max-w-md text-xs leading-5 text-[var(--muted)]">
              Check the stories that should appear in Featured mentions. Your
              selection is reflected instantly in the report above.
            </p>
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-[#d5e1dc] bg-white">
            <table className="report-table w-full border-collapse">
              <thead>
                <tr>
                  <th className="no-print">Feature</th>
                  <th>Mention</th>
                  <th>Publisher</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
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
                      {item.snippet ? (
                        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                          {item.snippet}
                        </span>
                      ) : null}
                    </td>
                    <td>{item.source}</td>
                    <td>{sourceTypeLabel(item)}</td>
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
        </section>
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="report-section rounded-2xl border border-[#d5e1dc] bg-white p-5 shadow-sm">
      <strong className="block text-4xl font-semibold tracking-tight text-[#174f47]">
        {value.toLocaleString("en-US")}
      </strong>
      <span className="mt-2 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </span>
    </div>
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
    <section className="report-section rounded-2xl border border-[#d5e1dc] bg-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-[#174f47]">{title}</h3>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#becdc7] bg-[#f8faf9] p-8 text-center text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}
