import Link from "next/link";
import { getSources, summarizeSources } from "@/lib/sources";

export default async function SourcesPage() {
  const sources = await getSources();
  const summary = summarizeSources(sources);

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/"
              className="text-sm font-semibold text-[var(--accent)]"
            >
              Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal md:text-4xl">
              Sources
            </h1>
            <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
              Seeded media list for V1 monitoring. Verification flags preserve
              your spreadsheet notes so questionable outlets can stay visible
              without being treated as fully trusted.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm">
            <strong>{summary.total}</strong> total sources ·{" "}
            <strong>{summary.withTwitter}</strong> social handles
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
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
  );
}

function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    verified: "bg-[#e6f3f1] text-[var(--accent-strong)]",
    needs_verification: "bg-[#fff5df] text-[var(--warning)]",
    likely_inactive: "bg-[#fdecec] text-[var(--critical)]",
    merged_or_redirect: "bg-[#e9f0f7] text-[var(--info)]",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
        styles[value] ?? "bg-[#eceff1] text-[var(--muted)]"
      }`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
