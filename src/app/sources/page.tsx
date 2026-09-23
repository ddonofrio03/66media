import Link from "next/link";
import { getSources, summarizeSources } from "@/lib/sources";
import SiteNav from "@/components/site-nav";

export default async function SourcesPage() {
  const sources = await getSources();
  const summary = summarizeSources(sources);

  return (
    <>
    <SiteNav active="sources" />
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b-4 border-[var(--foreground)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/"
              className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]"
            >
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Sources
            </h1>
            <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
              Seeded media list for V1 monitoring. Verification flags preserve
              your spreadsheet notes so questionable outlets can stay visible
              without being treated as fully trusted.
            </p>
          </div>
          <div className="border-t-2 border-[var(--foreground)] bg-[var(--panel)] p-4 text-sm">
            <span className="font-mono text-2xl font-bold tabular-nums">
              {summary.total}
            </span>{" "}
            total sources ·{" "}
            <span className="font-mono text-2xl font-bold tabular-nums">
              {summary.withTwitter}
            </span>{" "}
            social handles
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--panel)]">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th className="w-[18%]">Outlet</th>
                  <th className="w-[10%]">Medium</th>
                  <th className="w-[12%]">Geography</th>
                  <th className="w-[18%]">Website</th>
                  <th className="w-[12%]">Social</th>
                  <th className="w-[12%]">Status</th>
                  <th className="w-[18%]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={`${source.sourceName}-${source.website}-${source.twitterHandle}`}>
                    <td className="font-semibold">{source.sourceName}</td>
                    <td>{source.medium}</td>
                    <td>{source.geography}</td>
                    <td className="text-wrap">
                      {source.website ? (
                        <a
                          className="text-[var(--accent)]"
                          href={source.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-[var(--muted)]">
                          {source.rawWebsiteOrEmail || "Missing"}
                        </span>
                      )}
                    </td>
                    <td>{source.twitterHandle || "—"}</td>
                    <td>
                      <Status value={source.verificationStatus} />
                    </td>
                    <td className="text-wrap text-[var(--muted)]">
                      {source.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
    </>
  );
}

function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    verified: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]",
    needs_verification: "bg-[#fff5df] text-[var(--warning)]",
    likely_inactive: "bg-[var(--accent-soft)] text-[var(--accent)]",
    merged_or_redirect: "bg-[#e9f0f7] text-[var(--info)]",
  };

  return (
    <span
      className={`font-mono inline-flex rounded-sm px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${
        styles[value] ?? "border border-[var(--line)] text-[var(--muted)]"
      }`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
