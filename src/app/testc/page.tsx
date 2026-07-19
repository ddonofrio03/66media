import Image from "next/image";
import Link from "next/link";
import SiteNav from "@/components/site-nav";
import {
  currentMonthKey,
  currentWeekKey,
  getReport,
  monthlyRange,
  shiftMonthKey,
  shiftWeekKey,
  weeklyRange,
  type ReportItem,
  type ReportRange,
} from "@/lib/report";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  broadcast: "Broadcast (TV / Radio)",
  news: "News / Online",
  social: "Social",
};

const LABEL_LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed 66 OTB",
  likely_otb: "Likely corridor",
  related: "Operator / industry",
  uncertain_i66_segment: "Uncertain segment",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; month?: string; week?: string }>;
}) {
  const params = await searchParams;
  const period = params.period === "weekly" ? "weekly" : "monthly";

  let range: ReportRange;
  if (period === "weekly") {
    const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? "")
      ? (params.week as string)
      : currentWeekKey();
    range = weeklyRange(weekKey);
  } else {
    const monthKey = /^\d{4}-\d{2}$/.test(params.month ?? "")
      ? (params.month as string)
      : currentMonthKey();
    range = monthlyRange(monthKey);
  }

  const report = await getReport(range);
  const maxDaily = Math.max(1, ...report.daily.map((d) => d.count));
  const maxOutlet = Math.max(1, ...report.topOutlets.map((o) => o.count));
  const generatedOn = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
  });

  const prevHref =
    period === "weekly"
      ? `/testc?period=weekly&week=${shiftWeekKey(range.key, -1)}`
      : `/testc?month=${shiftMonthKey(range.key, -1)}`;
  const nextHref =
    period === "weekly"
      ? `/testc?period=weekly&week=${shiftWeekKey(range.key, 1)}`
      : `/testc?month=${shiftMonthKey(range.key, 1)}`;

  return (
    <>
      <div className="print:hidden">
        <SiteNav active="testc" />
      </div>
      <main className="min-h-screen px-5 py-6 md:px-8 print:px-0 print:py-0">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase text-[var(--accent)]">
                  {period === "weekly" ? "Weekly" : "Monthly"} Earned Media
                  Report
                </p>
                <h1 className="mt-1 text-3xl font-semibold md:text-4xl">
                  {report.range.label}
                </h1>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  I-66 Express Lanes Outside the Beltway · 66 Express Mobility
                  Partners · Prepared by The Casey Group · Generated{" "}
                  {generatedOn}
                </p>
              </div>
              <Image
                src="/66OTB.png"
                alt="66 Express Outside the Beltway"
                width={84}
                height={65}
                className="hidden sm:block"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="mr-2 flex overflow-hidden rounded-md border border-[var(--line)]">
                <PeriodTab
                  href="/testc?period=weekly"
                  label="Weekly"
                  active={period === "weekly"}
                />
                <PeriodTab
                  href="/testc"
                  label="Monthly"
                  active={period === "monthly"}
                />
              </div>
              <NavLink href={prevHref} label="← Prev" />
              <span className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm font-semibold">
                {report.range.label}
              </span>
              <NavLink href={nextHref} label="Next →" />
              <div className="ml-auto">
                <PrintButton />
              </div>
            </div>
          </header>

          {!report.available ? (
            <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">
              Reports need the Supabase archive. Set SUPABASE_URL and
              SUPABASE_SERVICE_ROLE_KEY, then let the collector run — this page
              fills in automatically.
            </section>
          ) : (
            <>
              <section className="metric-grid">
                <Metric label="Total Mentions" value={report.totalMentions} />
                <Metric
                  label="Broadcast"
                  value={countFor(report, "broadcast")}
                  detail="TV & radio items"
                />
                <Metric
                  label="News / Online"
                  value={countFor(report, "news")}
                  detail="Articles & wires"
                />
                <Metric
                  label="Social"
                  value={countFor(report, "social")}
                  detail="Reddit, X, Facebook"
                />
                <Metric
                  label="Important"
                  value={report.importantCount}
                  detail="Critical-flagged items"
                />
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
                <h2 className="text-xl font-semibold">Mentions by Day</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Daily volume of relevant coverage across all monitored
                  channels.
                </p>
                <div className="mt-5 flex h-36 items-end gap-[3px]">
                  {report.daily.map(({ label, count }, index) => (
                    <div
                      key={`${label}-${index}`}
                      className="flex flex-1 flex-col items-center gap-1"
                      title={`${label}: ${count} mention${count === 1 ? "" : "s"}`}
                    >
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t-sm bg-[var(--accent)]"
                          style={{
                            height: `${Math.max(count > 0 ? 6 : 2, (count / maxDaily) * 115)}px`,
                            opacity: count > 0 ? 1 : 0.15,
                          }}
                        />
                      </div>
                      {(report.daily.length <= 7 ||
                        index === 0 ||
                        index === report.daily.length - 1 ||
                        (index + 1) % 5 === 0) && (
                        <span className="text-[10px] text-[var(--muted)]">
                          {label}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-2 print:grid-cols-2">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
                  <h2 className="text-xl font-semibold">Top Outlets</h2>
                  <div className="mt-4 space-y-2.5">
                    {report.topOutlets.map(({ source, count }) => (
                      <div key={source} className="flex items-center gap-3">
                        <span className="w-40 truncate text-sm" title={source}>
                          {source}
                        </span>
                        <div className="h-4 flex-1 rounded-sm bg-[#eef2f1]">
                          <div
                            className="h-4 rounded-sm bg-[var(--accent)]"
                            style={{ width: `${(count / maxOutlet) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-sm font-semibold">
                          {count}
                        </span>
                      </div>
                    ))}
                    {report.topOutlets.length === 0 && (
                      <p className="text-sm text-[var(--muted)]">
                        No coverage recorded this {period === "weekly" ? "week" : "month"}.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
                  <h2 className="text-xl font-semibold">Relevance Mix</h2>
                  <div className="mt-4 space-y-2.5">
                    {report.byLabel.map(({ label, count }) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="w-40 truncate text-sm">
                          {LABEL_LABELS[label] ?? label}
                        </span>
                        <div className="h-4 flex-1 rounded-sm bg-[#eef2f1]">
                          <div
                            className="h-4 rounded-sm bg-[var(--info)]"
                            style={{
                              width: `${(count / Math.max(1, report.totalMentions)) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="w-8 text-right text-sm font-semibold">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                  <h2 className="mt-6 text-xl font-semibold">Media Type</h2>
                  <div className="mt-4 space-y-2.5">
                    {report.byType.map(({ type, count }) => (
                      <div key={type} className="flex items-center gap-3">
                        <span className="w-40 truncate text-sm">
                          {TYPE_LABELS[type] ?? type}
                        </span>
                        <div className="h-4 flex-1 rounded-sm bg-[#eef2f1]">
                          <div
                            className="h-4 rounded-sm bg-[var(--accent-strong)]"
                            style={{
                              width: `${(count / Math.max(1, report.totalMentions)) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="w-8 text-right text-sm font-semibold">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
                <h2 className="text-xl font-semibold">Top Stories</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Highest-signal coverage this{" "}
                  {period === "weekly" ? "week" : "month"} (important and
                  confirmed items first).
                </p>
                <div className="mt-4 divide-y divide-[var(--line)]">
                  {report.topStories.map((story) => (
                    <Story key={story.id} story={story} />
                  ))}
                  {report.topStories.length === 0 && (
                    <p className="py-3 text-sm text-[var(--muted)]">
                      No stories recorded in this period.
                    </p>
                  )}
                </div>
              </section>

              <p className="pb-8 text-xs text-[var(--muted)]">
                Sources monitored: DC-market TV (NBC4, FOX5, WJLA, WUSA9, DC
                News Now incl. aired-segment transcripts), radio (WTOP, WAMU,
                WMAL, Federal News Network), regional and corridor outlets,
                Google/Bing news search, GDELT, and public social. Generated by
                66 Media Monitor.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function countFor(
  report: { byType: Array<{ type: string; count: number }> },
  type: string,
) {
  return report.byType.find((t) => t.type === type)?.count ?? 0;
}

function PeriodTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`px-3 py-1.5 text-sm font-semibold ${
        active
          ? "bg-[var(--accent)] text-white"
          : "bg-[var(--panel)] hover:bg-[#fbfcfc]"
      }`}
    >
      {label}
    </Link>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm font-semibold hover:bg-[#fbfcfc]"
    >
      {label}
    </Link>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-xs font-bold uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      {detail && (
        <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>
      )}
    </div>
  );
}

function Story({ story }: { story: ReportItem }) {
  const published = story.publishedAt
    ? new Date(story.publishedAt).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
      })
    : "";
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        {story.priority === "important" && (
          <span className="rounded-full bg-[#f8e8e8] px-2 py-0.5 text-xs font-semibold text-[var(--critical)]">
            Important
          </span>
        )}
        <span className="rounded-full bg-[#e6f3f1] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">
          {LABEL_LABELS[story.label] ?? story.label}
        </span>
        <span className="text-xs font-semibold text-[var(--muted)]">
          {story.source}
          {published ? ` · ${published}` : ""}
        </span>
      </div>
      <a
        href={story.url}
        target="_blank"
        rel="noreferrer"
        className="text-wrap mt-1 block font-semibold hover:text-[var(--accent-strong)] hover:underline"
      >
        {story.title}
      </a>
      {story.snippet && (
        <p className="text-wrap mt-1 text-sm leading-6 text-[var(--muted)]">
          {story.snippet}
        </p>
      )}
    </div>
  );
}
