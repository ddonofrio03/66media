"use client";

import { useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; title: string }
  | { kind: "error"; message: string };

const FIELD =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-[#fbfcfc] px-3 py-2 text-sm disabled:opacity-60";
const LABEL = "block text-sm font-semibold text-[var(--foreground)]";
const HINT = "mt-1 text-xs text-[var(--muted)]";

/** Local datetime string for <input type="datetime-local"> defaults. */
function nowLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export default function AddMentionForm({ canEdit }: { canEdit: boolean }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [sourceType, setSourceType] = useState("social");
  const [label, setLabel] = useState("confirmed_otb");
  const [priority, setPriority] = useState("normal");
  const [publishedAt, setPublishedAt] = useState(nowLocal());
  const [snippet, setSnippet] = useState("");
  const [note, setNote] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const disabled = !canEdit || status.kind === "saving";

  function reset() {
    setUrl("");
    setTitle("");
    setSource("");
    setSnippet("");
    setNote("");
    setSentiment("");
    setPublishedAt(nowLocal());
  }

  async function handleSave() {
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/mentions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          title,
          source,
          sourceType,
          label,
          priority,
          publishedAt,
          snippet,
          note,
          sentiment: sentiment || null,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not save the mention.");
      }
      setStatus({ kind: "saved", title });
      reset();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Save failed.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && (
        <p className="rounded-md border border-[var(--line)] bg-[#fbfcfc] p-3 text-sm text-[var(--muted)]">
          Supabase is not configured for this deployment, so mentions cannot be
          saved.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={LABEL} htmlFor="mention-url">
            Link
          </label>
          <input
            id="mention-url"
            className={FIELD}
            type="url"
            inputMode="url"
            placeholder="https://www.facebook.com/groups/.../posts/..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={disabled}
          />
          <p className={HINT}>
            For a private group, the post link still works as a reference — it
            just will not open for anyone who is not a member.
          </p>
        </div>

        <div className="md:col-span-2">
          <label className={LABEL} htmlFor="mention-title">
            Headline or first line of the post
          </label>
          <input
            id="mention-title"
            className={FIELD}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="mention-source">
            Where it appeared
          </label>
          <input
            id="mention-source"
            className={FIELD}
            placeholder="Gainesville VA Community (private group)"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={disabled}
          />
          <p className={HINT}>
            This is the outlet name in the report, so write it the way it should
            be printed.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="mention-type">
            Type
          </label>
          <select
            id="mention-type"
            className={FIELD}
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            disabled={disabled}
          >
            <option value="social">Social</option>
            <option value="news">News</option>
            <option value="broadcast">TV / Radio</option>
          </select>
          <p className={HINT}>
            Social and news are counted as separate universes in the reports.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="mention-published">
            When it was posted
          </label>
          <input
            id="mention-published"
            className={FIELD}
            type="datetime-local"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
            disabled={disabled}
          />
          <p className={HINT}>
            Drives which weekly report it lands in — not today&apos;s date, the
            post&apos;s.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="mention-sentiment">
            Sentiment toward the 66 Express
          </label>
          <select
            id="mention-sentiment"
            className={FIELD}
            value={sentiment}
            onChange={(event) => setSentiment(event.target.value)}
            disabled={disabled}
          >
            <option value="">Leave unscored</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
          <p className={HINT}>
            Toward the road, not the mood of the story: a crash on the corridor
            is neutral. Your call is permanent — the AI never overwrites it.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="mention-label">
            Relevance
          </label>
          <select
            id="mention-label"
            className={FIELD}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={disabled}
          >
            <option value="confirmed_otb">Confirmed — names the facility</option>
            <option value="likely_otb">Likely</option>
            <option value="related">Related (operator / industry)</option>
            <option value="uncertain_i66_segment">Uncertain I-66 segment</option>
          </select>
        </div>

        <div>
          <label className={LABEL} htmlFor="mention-priority">
            Priority
          </label>
          <select
            id="mention-priority"
            className={FIELD}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            disabled={disabled}
          >
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className={LABEL} htmlFor="mention-snippet">
            Quote or excerpt
          </label>
          <textarea
            id="mention-snippet"
            className={FIELD}
            rows={3}
            placeholder="Paste the part worth quoting in the report."
            value={snippet}
            onChange={(event) => setSnippet(event.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="md:col-span-2">
          <label className={LABEL} htmlFor="mention-note">
            Why it matters (optional)
          </label>
          <input
            id="mention-note"
            className={FIELD}
            placeholder="Thread had 40+ comments about toll pricing."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={disabled}
          />
          <p className={HINT}>
            Printed on the report&apos;s &ldquo;Relevance:&rdquo; line, after the
            note that a person added this rather than a collector.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status.kind === "saving" ? "Saving…" : "Add mention"}
        </button>

        {status.kind === "saved" && (
          <span className="text-sm font-semibold text-[var(--accent)]">
            Added “{status.title}” — it is in the archive and this week&apos;s
            report.
          </span>
        )}
        {status.kind === "error" && (
          <span className="text-sm font-semibold text-[#b42318]">
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
