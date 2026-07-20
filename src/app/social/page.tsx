import Link from "next/link";
import FeedbackButtons from "@/components/feedback-buttons";
import SiteNav from "@/components/site-nav";
import { isPersistenceEnabled } from "@/lib/db";
import { getSocialItems, type ArchiveItem } from "@/lib/digest-store";
import { socialPlatform } from "@/lib/digest";

export const dynamic = "force-dynamic";

const LABEL_LABELS: Record<string, string> = {
  confirmed_otb: "Confirmed 66 OTB",
  likely_otb: "Likely corridor",
  related: "Operator / industry",
  uncertain_i66_segment: "Uncertain segment",
};

// Display order for platform sections.
const PLATFORM_ORDER = ["X", "Bluesky", "Facebook", "Reddit", "LinkedIn", "Other"];

const DAY_OPTIONS = [7, 14, 30];

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = DAY_OPTIONS.includes(Number(params.days))
    ? Number(params.days)
    : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const enabled = isPersistenceEnabled();
  const items = enabled ? await getSocialItems({ since }) : [];

  const groups = new Map<string, ArchiveItem[]>();
  for (const item of items) {
    const platform = socialPlatform(item.url);
    groups.set(platform, [...(groups.get(platform) ?? []), item]);
  }
  const orderedGroups = PLATFORM_ORDER.filter((p) => groups.has(p)).map(
    (p) => [p, groups.get(p) as ArchiveItem[]] as const,
  );

  return (
    <>
      <SiteNav active="social" />
      <main className="min-h-screen px-5 py-6 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase text-[var(--accent)]">
                  Social Media Pulse
                </p>
                <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
                  Corridor conversation by platform
                </h1>
                <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
                  Relevant public posts about the 66 Express Outside the
                  Beltway from X, Bluesky, Facebook pages, and Reddit —
                  collected continuously, filtered by the same relevance
                  screening as news coverage.
                </p>
              </div>
              <div className="flex gap-2">
                {DAY_OPTIONS.map((option) => (
                  <Link
                    key={option}
                    href={`/social?days=${option}`}
                    aria-current={option === days ? "page" : undefined}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                      option === days
                        ? "bg-[var(--accent)] text-white"
                        : "border border-[var(--line)] hover:bg-[#fbfcfc]"
                    }`}
                  >
                    {option} days
                  </Link>
                ))}
              </div>
            </div>
          </header>

          <section className="metric-grid">
            <Metric label="Total Posts" value={items.length} detail={`Last ${days} days`} />
            {PLATFORM_ORDER.filter((p) => p !== "Other").map((platform) => (
              <Metric
                key={platform}
                label={platform}
                value={groups.get(platform)?.length ?? 0}
                detail={platformDetail(platform)}
              />
            ))}
          </section>

          {!enabled ? (
            <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">
              The social view needs the Supabase archive (SUPABASE_URL +
              SUPABASE_SERVICE_ROLE_KEY).
            </section>
          ) : orderedGroups.length === 0 ? (
            <section className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">
              No relevant social posts captured in the last {days} days.
              Collection is running — corridor chatter will appear here (and in
              the daily digest) as it happens.
            </section>
          ) : (
            orderedGroups.map(([platform, posts]) => (
              <section
                key={platform}
                className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5"
              >
                <h2 className="text-xl font-semibold">
                  {platform}{" "}
                  <span className="text-sm font-semibold text-[var(--muted)]">
                    · {posts.length} {posts.length === 1 ? "post" : "posts"}
                  </span>
                </h2>
                <div className="mt-2 divide-y divide-[var(--line)]">
                  {posts.map((post) => (
                    <Post key={post.id} post={post} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>
    </>
  );
}

function platformDetail(platform: string) {
  switch (platform) {
    case "X":
      return "Official API keyword search";
    case "Bluesky":
      return "Keyword search";
    case "Facebook":
      return "Page watchlist";
    case "Reddit":
      return "Keyword search";
    case "LinkedIn":
      return "Company pages";
    default:
      return "";
  }
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
      <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-sm text-[var(--muted)]">{detail}</p>}
    </div>
  );
}

function Post({ post }: { post: ArchiveItem }) {
  const published = post.publishedAt
    ? new Date(post.publishedAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        {post.priority === "important" && (
          <span className="rounded-full bg-[#f8e8e8] px-2 py-0.5 text-xs font-semibold text-[var(--critical)]">
            Important
          </span>
        )}
        <span className="rounded-full bg-[#e6f3f1] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">
          {LABEL_LABELS[post.label] ?? post.label}
        </span>
        <span className="text-xs font-semibold text-[var(--muted)]">
          {post.source}
          {published ? ` · ${published}` : ""}
        </span>
        <span className="ml-auto">
          <FeedbackButtons id={post.id} initial={post.feedback} />
        </span>
      </div>
      <a
        href={post.url}
        target="_blank"
        rel="noreferrer"
        className="text-wrap mt-1 block font-semibold leading-snug hover:text-[var(--accent-strong)] hover:underline"
      >
        {post.title}
      </a>
      {post.snippet && post.snippet !== post.title && (
        <p className="text-wrap mt-1 text-sm leading-6 text-[var(--muted)]">
          {post.snippet}
        </p>
      )}
    </div>
  );
}
