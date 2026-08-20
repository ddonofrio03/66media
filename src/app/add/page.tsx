import { isPersistenceEnabled } from "@/lib/db";
import SiteNav from "@/components/site-nav";
import AddMentionForm from "@/components/add-mention-form";

export const dynamic = "force-dynamic";

export default function AddMentionPage() {
  const canEdit = isPersistenceEnabled();

  return (
    <>
      <SiteNav active="add" />
      <main className="min-h-screen px-5 py-6 md:px-8">
        <div className="mx-auto max-w-5xl">
          <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5">
            <div>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal md:text-4xl">
                Add a mention
              </h1>
              <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
                For coverage the collectors structurally cannot reach: private
                Facebook groups you belong to, LinkedIn, a segment you saw on
                air, a print clip. Facebook removed public keyword search when
                CrowdTangle closed and LinkedIn never had one, so these are
                gaps no amount of engineering closes — but you can close them
                in ten seconds.
              </p>
              <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
                What you add is an ordinary story from here on: it appears in
                the archive, counts in the weekly report, and feeds the
                sentiment dials. It is marked as analyst-added, so a report
                never implies a machine found something a person did.
              </p>
            </div>
          </header>

          <section className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
            <AddMentionForm canEdit={canEdit} />
          </section>
        </div>
      </main>
    </>
  );
}
