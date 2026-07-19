import Link from "next/link";
import SiteNav from "@/components/site-nav";
import {
  currentMonthKey,
  currentWeekKey,
  customRange,
  getReport,
  monthlyRange,
  shiftMonthKey,
  shiftWeekKey,
  weeklyRange,
  type Report,
  type ReportRange,
} from "@/lib/report";
import ReportView from "./report-view";

export const dynamic = "force-dynamic";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;

type Params = {
  period?: string;
  week?: string;
  month?: string;
  from?: string;
  to?: string;
  q?: string;
};

function resolveRange(params: Params): ReportRange {
  if (params.period === "monthly") {
    return monthlyRange(
      MONTH_KEY.test(params.month ?? "")
        ? (params.month as string)
        : currentMonthKey(),
    );
  }
  if (
    params.period === "custom" &&
    DATE_KEY.test(params.from ?? "") &&
    DATE_KEY.test(params.to ?? "")
  ) {
    return customRange(params.from as string, params.to as string);
  }
  // Weekly (Sat–Fri) is the default — it matches the client deliverable cadence.
  return weeklyRange(
    DATE_KEY.test(params.week ?? "")
      ? (params.week as string)
      : currentWeekKey(),
  );
}

function defaultSummary(report: Report): string {
  if (report.totalMentions === 0) {
    return "No relevant earned media was captured for this period. Monitoring covered DC-market TV and radio, regional and corridor outlets, news search, and public social channels.";
  }
  const broadcast =
    report.byType.find((t) => t.type === "broadcast")?.count ?? 0;
  const top = report.topOutlets
    .slice(0, 3)
    .map((o) => o.source)
    .join(", ");
  const parts = [
    `Monitoring captured ${report.totalMentions} relevant mention${report.totalMentions === 1 ? "" : "s"} across ${report.uniqueOutlets} outlet${report.uniqueOutlets === 1 ? "" : "s"} this period`,
    broadcast > 0
      ? `including ${broadcast} TV/radio item${broadcast === 1 ? "" : "s"}`
      : "",
    top ? `led by ${top}` : "",
  ].filter(Boolean);
  const important =
    report.importantCount > 0
      ? ` ${report.importantCount} item${report.importantCount === 1 ? " was" : "s were"} flagged critical and reviewed the day of coverage.`
      : "";
  return `${parts.join(", ")}.${important} Coverage detail, featured clips, and the full mention index follow.`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 80);
  const range = resolveRange(params);
  const report = await getReport(range, q);

  const generatedOn = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
  });

  const withQ = (href: string) =>
    q ? `${href}${href.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : href;

  const period = range.period;
  const prevHref =
    period === "monthly"
      ? withQ(`/reports?period=monthly&month=${shiftMonthKey(range.key, -1)}`)
      : withQ(`/reports?week=${shiftWeekKey(range.key, -1)}`);
  const nextHref =
    period === "monthly"
      ? withQ(`/reports?period=monthly&month=${shiftMonthKey(range.key, 1)}`)
      : withQ(`/reports?week=${shiftWeekKey(range.key, 1)}`);

  return (
    <>
      <SiteNav active="reports" />
      <main className="min-h-screen px-4 py-6 md:px-8">
        <div className="mx-auto max-w-7xl">
          <section className="no-print mb-5 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                  Earned media reports
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                  {report.range.label}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                  Client-ready web report — pick featured stories, play
                  available clips, export CSV, or save a polished PDF.
                </p>
              </div>

              <div className="flex flex-col items-start gap-3 lg:items-end">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-lg border border-[var(--line)]">
                    <PeriodTab
                      href={withQ("/reports")}
                      label="Weekly"
                      active={period === "weekly"}
                    />
                    <PeriodTab
                      href={withQ("/reports?period=monthly")}
                      label="Monthly"
                      active={period === "monthly"}
                    />
                    <PeriodTab
                      href={withQ(
                        `/reports?period=custom&from=${range.dayKeys[0]}&to=${range.dayKeys[range.dayKeys.length - 1]}`,
                      )}
                      label="Custom"
                      active={period === "custom"}
                    />
                  </div>
                  {period !== "custom" && (
                    <>
                      <NavLink href={prevHref} label="← Prev" />
                      <NavLink href={nextHref} label="Next →" />
                    </>
                  )}
                </div>

                <form method="get" action="/reports" className="flex flex-wrap items-end gap-2">
                  {period === "custom" ? (
                    <>
                      <input type="hidden" name="period" value="custom" />
                      <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        From
                        <input
                          type="date"
                          name="from"
                          defaultValue={range.dayKeys[0]}
                          className="mt-1 block rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm font-normal normal-case tracking-normal"
                        />
                      </label>
                      <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        To
                        <input
                          type="date"
                          name="to"
                          defaultValue={range.dayKeys[range.dayKeys.length - 1]}
                          className="mt-1 block rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm font-normal normal-case tracking-normal"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <input type="hidden" name="period" value={period} />
                      {period === "weekly" ? (
                        <input type="hidden" name="week" value={range.key} />
                      ) : (
                        <input type="hidden" name="month" value={range.key} />
                      )}
                    </>
                  )}
                  <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                    Keyword filter
                    <input
                      type="search"
                      name="q"
                      defaultValue={q}
                      placeholder="e.g. toll, crash"
                      className="mt-1 block w-40 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm font-normal normal-case tracking-normal"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]"
                  >
                    Apply
                  </button>
                </form>
              </div>
            </div>

            {!report.available && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Reports need the Supabase archive (SUPABASE_URL +
                SUPABASE_SERVICE_ROLE_KEY). Once the collector runs, this page
                fills in automatically.
              </div>
            )}
            {q && (
              <p className="mt-3 text-xs font-semibold text-[var(--muted)]">
                Filtered to mentions matching “{q}” —{" "}
                <Link href="/reports" className="text-[var(--accent)] underline">
                  clear filter
                </Link>
              </p>
            )}
          </section>

          {/* Keyed by period+range so switching Weekly/Monthly/Custom (or
              prev/next) remounts the document — the title and auto-drafted
              summary regenerate instead of carrying over stale edits. */}
          <ReportView
            key={`${report.range.period}:${report.range.key}:${q}`}
            report={report}
            generatedOn={generatedOn}
            initialSummary={defaultSummary(report)}
          />
        </div>
      </main>
    </>
  );
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
          : "bg-white hover:bg-[#f7f9f8]"
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
      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold hover:bg-[#f7f9f8]"
    >
      {label}
    </Link>
  );
}
