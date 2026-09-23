import { isPersistenceEnabled } from "@/lib/db";
import { getMonitoringSettings } from "@/lib/monitoring-settings";
import SiteNav from "@/components/site-nav";
import KeywordEditor from "./keyword-editor";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getMonitoringSettings();
  const canEdit = isPersistenceEnabled();

  return (
    <>
    <SiteNav active="settings" />
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-4 border-b-4 border-[var(--foreground)] pb-5">
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
              Configuration
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Keywords
            </h1>
            <p className="mt-2 max-w-3xl text-base text-[var(--muted)]">
              Control what the monitor searches for and what it ignores. Positive
              keywords drive the news and social searches and keep any matching
              coverage; avoid phrases filter out noise. Changes apply on the next
              digest run.
            </p>
          </div>
        </header>

        <section className="mt-6 rounded-sm border border-[var(--line)] bg-[var(--panel)] p-5">
          <KeywordEditor
            initialPositiveKeywords={settings.positiveKeywords}
            initialAvoidPhrases={settings.avoidPhrases}
            canEdit={canEdit}
          />
        </section>
      </div>
    </main>
    </>
  );
}
