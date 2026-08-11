"use client";

import { useState } from "react";

/**
 * Analyst override for a story's coverage sentiment toward the 66 Express.
 * Clicking the active value clears it back to unscored (the AI will re-score
 * it on a later run); any other click locks in a manual call that the AI
 * pass will never overwrite.
 *
 * Unlike the thumbs buttons, this reverts and shows a failure marker when the
 * save doesn't land — these values are summed into a client-facing meter, so a
 * silently-lost edit would misstate the week.
 */

type Sentiment = "positive" | "neutral" | "negative";

const OPTIONS: Array<{ value: Sentiment; label: string; title: string }> = [
  { value: "positive", label: "+", title: "Positive toward the 66 Express" },
  { value: "neutral", label: "○", title: "Neutral / factual coverage" },
  { value: "negative", label: "−", title: "Negative toward the 66 Express" },
];

const ACTIVE_CLASS: Record<Sentiment, string> = {
  positive: "border-[#1a7f4b] bg-[#1a7f4b] text-white",
  neutral: "border-[#8a8580] bg-[#8a8580] text-white",
  negative: "border-[#c0392b] bg-[#c0392b] text-white",
};

/** The 0–100 value each bucket stands for; mirrors BUCKET_SCORE in lib/report. */
const BUCKET_SCORE: Record<Sentiment, number> = {
  positive: 100,
  neutral: 50,
  negative: 0,
};

/** Which bucket a typed score falls into, by thirds. */
function bucketFor(score: number): Sentiment {
  if (score >= 67) return "positive";
  if (score > 33) return "neutral";
  return "negative";
}

export default function SentimentControl({
  id,
  initial,
  initialSource,
  initialScore,
  onChange,
}: {
  id: string;
  initial?: string | null;
  initialSource?: string | null;
  initialScore?: number | null;
  /** Fired only after the change is persisted, so callers can update totals. */
  onChange?: (value: Sentiment | null, score: number | null) => void;
}) {
  const [value, setValue] = useState<Sentiment | null>(
    (initial as Sentiment | null) ?? null,
  );
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [score, setScore] = useState<number | null>(initialScore ?? null);
  const [draft, setDraft] = useState<string>(
    initialScore === null || initialScore === undefined ? "" : String(initialScore),
  );
  const [failed, setFailed] = useState(false);

  /** Shared save path for both the buckets and the typed score. */
  async function persist(
    nextValue: Sentiment | null,
    nextScore: number | null,
  ) {
    const prev = { value, source, score, draft };

    setValue(nextValue);
    setSource(nextValue ? "manual" : null);
    setScore(nextScore);
    setDraft(nextScore === null ? "" : String(nextScore));
    setFailed(false);

    try {
      const response = await fetch("/api/sentiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          sentiment: nextValue,
          score: nextScore,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      onChange?.(nextValue, nextScore);
    } catch {
      // Put the old values back rather than showing a score that isn't stored.
      setValue(prev.value);
      setSource(prev.source);
      setScore(prev.score);
      setDraft(prev.draft);
      setFailed(true);
    }
  }

  function choose(next: Sentiment) {
    // Clicking the active bucket clears back to unscored; otherwise the bucket
    // sets its preset value, replacing any previously typed score.
    const newValue = value === next ? null : next;
    void persist(newValue, newValue ? BUCKET_SCORE[newValue] : null);
  }

  /** Commit the typed score on blur or Enter. */
  function commitDraft() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (score !== null) void persist(null, null);
      return;
    }
    const parsed = Math.round(Number(trimmed));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setDraft(score === null ? "" : String(score)); // reject, restore
      return;
    }
    if (parsed === score) return;
    void persist(bucketFor(parsed), parsed);
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 print:hidden">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.title}
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => choose(option.value)}
          className={`h-5 w-5 rounded-md border text-xs leading-none ${
            value === option.value
              ? ACTIVE_CLASS[option.value]
              : "border-[var(--line)] text-[var(--muted)] opacity-60 hover:opacity-100"
          }`}
        >
          {option.label}
        </button>
      ))}
      {/* Fine-grained score. The buckets are presets on this same 0–100 scale,
          so typing 72 and clicking "+" are the same kind of edit. */}
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        value={draft}
        placeholder="—"
        aria-label="Sentiment score, 0 to 100"
        title="Score 0–100 (0 negative, 50 neutral, 100 positive). Blank to clear."
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className="h-5 w-11 rounded-md border border-[var(--line)] px-1 text-center text-[11px] tabular-nums text-[var(--muted)] outline-none focus:border-[#105cae] focus:text-[#141413]"
      />
      {source === "manual" && !failed ? (
        <span
          title="Set by an analyst — the AI will not change it"
          className="text-[10px] uppercase tracking-wide text-[var(--muted)]"
        >
          set
        </span>
      ) : null}
      {failed ? (
        <span
          title="Could not save — the score was not changed"
          className="text-[10px] uppercase tracking-wide text-[#c0392b]"
        >
          unsaved
        </span>
      ) : null}
    </span>
  );
}
