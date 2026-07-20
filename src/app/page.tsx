import Link from "next/link";
import { loadDashboardSnapshot, socialPlatform } from "@/lib/digest";
import { monitoringConfig } from "@/lib/monitoring-config";
import { getReport, lastNDaysRange, type ReportItem } from "@/lib/report";
import { getSources, summarizeSources } from "@/lib/sources";
import SiteNav from "@/components/site-nav";

export const dynamic = "force-dynamic";

const STORY_LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed 66 OTB",
  likely_otb: "Likely corridor",
  related: "Operator / industry",
  uncertain_i66_segment: "Uncertain segment",
};

export default async function DashboardPage() {
  const sources = await getSources();
  const summary = summarizeSources(sources);
  const digest = await loadDashboardSnapshot();
  // Top stories over the rolling last 7 days, straight from the archive —
  // report.items is already ranked important -> confirmed -> likely. Up to two
  // slots are reserved for high-signal SOCIAL posts (important/confirmed/
  // likely) so corridor chatter surfaces alongside press coverage.
  const weekReport = await getReport(lastNDaysRange(7));
  const ranked = weekReport.items;
  const topSocial = ranked
    .filter(
      (item) =>
        item.sourceType === "social" &&
        (item.priority === "important" ||
          item.label === "confirmed_otb" ||
          item.label === "likely_otb"),
    )
    .slice(0, 2);
  const picked = new Set(topSocial.map((item) => item.id));
  for (const item of ranked) {
    if (picked.size >= 5) break;
    if (item.sourceType !== "social") {
      picked.add(item.id);
    }
  }
  const topStories = ranked.filter((item) => picked.has(item.id)).slice(0, 5);
  const highPriority = sources.filter((source) => source.priority === "high");

  return (
    <>
      <SiteNav active="dashboard" />
      <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <p className="text-sm font-semibold uppercase text-[var(--accent)]">
              66 Media Monitor
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal md:text-4xl">
              Daily coverage control room
            </h1>
            <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
              Monitoring 66 Outside the Beltway, 66 EMP, 66 Express Lanes,
              broadcast sources, public social/search-visible mentions, and
              priority local media.
            </p>
          </div>
        </header>

        {weekReport.available && (
          <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  Top Stories — Last 7 Days
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {weekReport.totalMentions} relevant{" "}
                  {pluralize("mention", weekReport.totalMentions)} across{" "}
                  {weekReport.uniqueOutlets}{" "}
                  {pluralize("outlet", weekReport.uniqueOutlets)}
                  {weekReport.importantCount > 0
                    ? ` · ${weekReport.importantCount} flagged important`
                    : ""}
                </p>
              </div>
              <Link
                href="/reports"
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
              >
                Full report →
              </Link>
            </div>

            {topStories.length > 0 ? (
              <div className="mt-3 divide-y divide-[var(--line)]">
                {topStories.map((story) => (
                  <TopStory key={story.id} story={story} />
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-dashed border-[var(--line)] bg-[#fbfcfc] p-4 text-sm text-[var(--muted)]">
                No relevant coverage captured in the last 7 days. Monitoring is
                active — quiet stretches are normal.
              </p>
            )}
          </section>
        )}

        <section className="metric-grid">
          <Metric label="Sources" value={summary.total} detail={`${summary.included} in V1`} />
          <Metric label="High Priority" value={highPriority.length} detail="TV, radio, and core local outlets" />
          <Metric label="Websites" value={summary.withWebsite} detail="Seeded from media list" />
          <Metric label="Social Handles" value={summary.withTwitter} detail="Public/search-visible monitoring" />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Next Digest</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  6:30 AM Eastern, work days. Weekend sends only for critical
                  items.
                </p>
              </div>
              <span className="rounded-full bg-[#e6f3f1] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                Email active
              </span>
            </div>

            <div className="mt-5 rounded-md border border-[var(--line)] bg-[#fbfcfc] p-4">
              {digest.noRelevantCoverage ? (
                <>
                  <h3 className="font-semibold">No relevant coverage found</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    The live digest collector checked free news and public
                    social/search-visible sources. The email will still send a
                    short no-news digest when nothing turns up.
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  {digest.totalRelevantCount} relevant{" "}
                  {pluralize("item", digest.totalRelevantCount)} found,
                  including {digest.important.length} important{" "}
                  {pluralize("item", digest.important.length)}.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <h2 className="text-xl font-semibold">Delivery Setup</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Recipients" value={monitoringConfig.recipients.join(", ")} />
              <Row label="Sender" value={monitoringConfig.sender} />
              <Row label="Timezone" value={monitoringConfig.timezone} />
              <Row label="Cron route" value="/api/cron/daily-digest" />
            </dl>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Seeded Source Mix</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                These came from the uploaded media spreadsheet and will become
                editable once database-backed source management is connected.
              </p>
            </div>
            <Link
              href="/sources"
              className="rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold"
            >
              View all sources
            </Link>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Breakdown title="Medium" data={summary.byMedium} />
            <Breakdown title="Priority" data={summary.byPriority} />
            <Breakdown title="Verification" data={summary.byStatus} />
          </div>
        </section>
      </div>
    </main>
    </>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function pluralize(word: string, count: number) {
  return count === 1 ? word : `${word}s`;
}

function TopStory({ story }: { story: ReportItem }) {
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
          {STORY_LABELS[story.label] ?? story.label}
        </span>
        {story.sourceType === "social" && (
          <span className="rounded-full bg-[#e8edf6] px-2 py-0.5 text-xs font-semibold text-[var(--info)]">
            {socialPlatform(story.url)}
          </span>
        )}
        <span className="text-xs font-semibold text-[var(--muted)]">
          {story.source}
          {published ? ` · ${published}` : ""}
        </span>
      </div>
      <a
        href={story.url}
        target="_blank"
        rel="noreferrer"
        className="text-wrap mt-1 block font-semibold leading-snug hover:text-[var(--accent-strong)] hover:underline"
      >
        {story.title}
      </a>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="text-wrap mt-1">{value}</dd>
    </div>
  );
}

function Breakdown({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] p-4">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {Object.entries(data).map(([key, value]) => (
          <li key={key} className="flex items-center justify-between gap-3">
            <span className="text-wrap text-[var(--muted)]">{key}</span>
            <span className="font-semibold">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
