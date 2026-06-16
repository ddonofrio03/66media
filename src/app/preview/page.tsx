import { loadDashboardSnapshot, renderDigestHtml } from "@/lib/digest";
import SiteNav from "@/components/site-nav";

export const dynamic = "force-dynamic";

export default async function PreviewPage() {
  const snapshot = await loadDashboardSnapshot();
  const html = renderDigestHtml(snapshot);

  return (
    <>
      <SiteNav active="preview" />
      <main className="min-h-screen px-5 py-6 md:px-8">
        <div className="mx-auto max-w-3xl">
          <header className="flex flex-col gap-2 border-b border-[var(--line)] pb-5">
            <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
              Digest Preview
            </h1>
            <p className="max-w-2xl text-base text-[var(--muted)]">
              The email exactly as recipients receive it. Raw versions:{" "}
              <a className="text-[var(--accent)]" href="/api/digest/preview">
                HTML
              </a>
              {" · "}
              <a
                className="text-[var(--accent)]"
                href="/api/digest/preview?format=text"
              >
                text
              </a>
              {" · "}
              <a
                className="text-[var(--accent)]"
                href="/api/digest/preview?format=json"
              >
                JSON
              </a>
            </p>
          </header>

          <section className="mt-6 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
            <iframe
              title="Digest email preview"
              srcDoc={html}
              className="h-[1400px] w-full border-0"
            />
          </section>
        </div>
      </main>
    </>
  );
}
