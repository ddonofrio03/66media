import SiteNav from "@/components/site-nav";
import { isPersistenceEnabled } from "@/lib/db";
import { getArchiveItems, type ArchiveItem } from "@/lib/digest-store";
import { monitoringConfig } from "@/lib/monitoring-config";
import ReportBuilder from "./report-builder";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: monitoringConfig.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : dateKeyFormatter.format(date);
}

function validDateKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : value;
}

function startOfMonth(key: string) {
  return `${key.slice(0, 7)}-01`;
}

function queryLowerBound(key: string) {
  const midnightUtc = Date.parse(`${key}T00:00:00Z`);
  return new Date(midnightUtc - DAY_MS).toISOString();
}

function isInsideRange(item: ArchiveItem, from: string, to: string) {
  const value = item.publishedAt ?? item.firstSeenAt;
  if (!value) return false;
  const key = dateKey(value);
  return key >= from && key <= to;
}

const DEMO_ITEMS: ArchiveItem[] = [
  {
    id: "demo-wtop-1",
    title: "Morning traffic update mentions the 66 Express Outside the Beltway corridor",
    url: "https://wtop.com/",
    source: "WTOP Radio",
    sourceType: "broadcast",
    label: "confirmed_otb",
    priority: "important",
    snippet:
      "Illustrative report item showing how a verified radio mention and its source link would appear.",
    publishedAt: null,
    firstSeenAt: null,
  },
  {
    id: "demo-tv-1",
    title: "Demo clip: regional transportation update",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    source: "Sample broadcast clip",
    sourceType: "broadcast",
    label: "confirmed_otb",
    priority: "important",
    snippet:
      "This CC0 sample video is included only to demonstrate the playable-clip experience. Live reports use licensed or official station URLs.",
    publishedAt: null,
    firstSeenAt: null,
  },
  {
    id: "demo-local-1",
    title: "Northern Virginia travel conditions improve after the morning commute",
    url: "https://www.vdot.virginia.gov/",
    source: "Northern Virginia local news",
    sourceType: "news",
    label: "likely_otb",
    priority: "normal",
    snippet:
      "Illustrative online coverage item. The production report will link to the captured article.",
    publishedAt: null,
    firstSeenAt: null,
  },
  {
    id: "demo-trade-1",
    title: "Managed-lane operations highlighted in regional infrastructure coverage",
    url: "https://www.transportation.gov/",
    source: "Transportation trade media",
    sourceType: "news",
    label: "confirmed_otb",
    priority: "normal",
    snippet:
      "Illustrative trade-publication item for demonstrating publisher and coverage-mix summaries.",
    publishedAt: null,
    firstSeenAt: null,
  },
];

function withDemoDates(items: ArchiveItem[], to: string) {
  const anchor = Date.parse(`${to}T16:00:00Z`);
  return items.map((item, index) => ({
    ...item,
    publishedAt: new Date(anchor - index * 2 * DAY_MS).toISOString(),
    firstSeenAt: new Date(anchor - index * 2 * DAY_MS).toISOString(),
  }));
}

export default async function ReportLabPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  const params = await searchParams;
  // Server component: current time establishes the default reporting window.
  const today = dateKey(new Date());
  const to = validDateKey(params.to) ?? today;
  const requestedFrom = validDateKey(params.from) ?? startOfMonth(to);
  const from = requestedFrom <= to ? requestedFrom : startOfMonth(to);
  const q = (params.q ?? "").trim().slice(0, 80);
  const enabled = isPersistenceEnabled();

  const result = enabled
    ? await getArchiveItems({ q, since: queryLowerBound(from), limit: 500 })
    : { items: [], truncated: false };
  const liveItems = result.items.filter((item) => isInsideRange(item, from, to));
  const useDemo = liveItems.length === 0;
  const items = useDemo ? withDemoDates(DEMO_ITEMS, to) : liveItems;

  return (
    <>
      <SiteNav active="reports" />
      <main className="min-h-screen px-4 py-6 md:px-8">
        <div className="mx-auto max-w-7xl">
          <section className="no-print mb-5 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                  New workspace
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                  Earned Media Report Lab
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] md:text-base">
                  Turn collected coverage into a client-ready web report, choose
                  featured stories, play available clips, and save a polished PDF.
                </p>
              </div>

              <form method="get" className="grid gap-3 sm:grid-cols-4 lg:min-w-[650px]">
                <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  From
                  <input
                    type="date"
                    name="from"
                    defaultValue={from}
                    className="mt-1 block w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
                  />
                </label>
                <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  To
                  <input
                    type="date"
                    name="to"
                    defaultValue={to}
                    className="mt-1 block w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
                  />
                </label>
                <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  Search
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Optional keyword"
                    className="mt-1 block w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
                  />
                </label>
                <button
                  type="submit"
                  className="self-end rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)]"
                >
                  Load coverage
                </button>
              </form>
            </div>

            {useDemo ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <strong>Sample report:</strong>{" "}
                {enabled
                  ? "No stored coverage matched this range, so the page is showing clearly labeled demo items."
                  : "Supabase is not configured in this environment, so the page is showing clearly labeled demo items."}
              </div>
            ) : null}
            {result.truncated ? (
              <p className="mt-3 text-xs font-semibold text-[var(--warning)]">
                This view is limited to the newest 500 matching items. Narrow the
                date range before producing the final report.
              </p>
            ) : null}
          </section>

          <ReportBuilder
            items={items}
            from={from}
            to={to}
            isDemo={useDemo}
          />
        </div>
      </main>
    </>
  );
}
