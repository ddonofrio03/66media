import { isPersistenceEnabled } from "@/lib/db";
import { getArchiveItems, type ArchiveItem } from "@/lib/digest-store";
import { monitoringConfig } from "@/lib/monitoring-config";
import FeedbackButtons from "@/components/feedback-buttons";
import SiteNav from "@/components/site-nav";

export const dynamic = "force-dynamic";

type Range = "week" | "month" | "all";

const RANGE_DAYS: Record<Range, number | null> = {
  week: 7,
  month: 31,
  all: null,
};

const LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed",
  likely_otb: "Likely",
  uncertain_i66_segment: "Uncertain",
};

function parseRange(value: string | undefined): Range {
  return value === "week" || value === "all" ? value : "month";
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: monitoringConfig.timezone,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: monitoringConfig.timezone,
  hour: "numeric",
  minute: "2-digit",
});

function dayLabel(item: ArchiveItem) {
  const value = item.publishedAt ?? item.firstSeenAt;
  if (!value) return "Undated";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Undated" : dayFormatter.format(date);
}

function groupByDay(items: ArchiveItem[]) {
  const groups = new Map<string, ArchiveItem[]>();
  for (const item of items) {
    const key = dayLabel(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; range?: string }>;
}) {
  const { q = "", range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const enabled = isPersistenceEnabled();

  const days = RANGE_DAYS[range];
  // Server component: reading the current time here is intentional and safe.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const since =
    days === null
      ? undefined
      : new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

  const { items, truncated } = enabled
    ? await getArchiveItems({ q: q.trim(), since, limit: 500 })
    : { items: [], truncated: false };
  const grouped = groupByDay(items);

  const rangeHref = (value: Range) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("range", value);
    return `/archive?${params.toString()}`;
  };

  return (
    <>
      <SiteNav active="archive" />
      <main className="min-h-screen px-5 py-6 md:px-8">
        <div className="mx-auto max-w-4xl">
          <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
                News
              </h1>
              <p className="mt-2 max-w-2xl text-base text-[var(--muted)]">
                Every relevant story the monitor has collected, grouped by day.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <form method="get" className="flex flex-1 gap-2">
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search titles, sources, snippets…"
                  className="w-full rounded-md border border-[var(--line)] bg-[#fbfcfc] px-3 py-2 text-sm"
                />
                <input type="hidden" name="range" value={range} />
                <button
                  type="submit"
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Search
                </button>
              </form>

              <div className="flex gap-2">
                {(["week", "month", "all"] as Range[]).map((value) => (
                  <a
                    key={value}
                    href={rangeHref(value)}
                    aria-current={value === range ? "page" : undefined}
                    className={`rounded-md px-3 py-2 text-sm font-semibold capitalize ${
                      value === range
                        ? "bg-[var(--accent)] text-white"
                        : "border border-[var(--line)]"
                    }`}
                  >
                    {value}
                  </a>
                ))}
              </div>
            </div>
          </header>

          {!enabled ? (
            <Notice>
              The archive reads from Supabase. Set <code>SUPABASE_URL</code> and{" "}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> to enable it.
            </Notice>
          ) : grouped.length === 0 ? (
            <Notice>
              {q.trim()
                ? `No stories match “${q.trim()}” in this range.`
                : "No stories collected for this range yet. The archive fills as the daily digest runs."}
            </Notice>
          ) : (
            <div className="mt-6 flex flex-col gap-6">
              <p className="text-sm text-[var(--muted)]">
                {items.length} {items.length === 1 ? "story" : "stories"}
                {truncated ? " (showing the most recent 500)" : ""}
              </p>
              {grouped.map(([day, dayItems]) => (
                <section key={day}>
                  <h2 className="sticky top-0 bg-[var(--background)] py-2 text-lg font-semibold">
                    {day}{" "}
                    <span className="text-sm font-normal text-[var(--muted)]">
                      · {dayItems.length}
                    </span>
                  </h2>
                  <div className="flex flex-col gap-3">
                    {dayItems.map((item) => (
                      <StoryCard key={item.id} item={item} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function StoryCard({ item }: { item: ArchiveItem }) {
  const time = item.publishedAt ? new Date(item.publishedAt) : null;
  const timeLabel =
    time && !Number.isNaN(time.getTime()) ? timeFormatter.format(time) : "";

  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)]"
          >
            {item.title}
          </a>
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {item.priority === "important" && (
            <span className="rounded-full bg-[#fdecec] px-2 py-1 text-xs font-semibold text-[var(--critical)]">
              Important
            </span>
          )}
          <FeedbackButtons id={item.id} initial={item.feedback} />
        </div>
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {item.source}
        {timeLabel ? ` · ${timeLabel}` : ""}
        {LABELS[item.label] ? ` · ${LABELS[item.label]}` : ""}
      </p>
      {item.snippet && (
        <p className="mt-2 text-sm leading-6">{item.snippet}</p>
      )}
    </article>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}
