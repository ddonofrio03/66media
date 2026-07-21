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

export default function SentimentControl({
  id,
  initial,
  initialSource,
  onChange,
}: {
  id: string;
  initial?: string | null;
  initialSource?: string | null;
  /** Fired only after the change is persisted, so callers can update totals. */
  onChange?: (value: Sentiment | null) => void;
}) {
  const [value, setValue] = useState<Sentiment | null>(
    (initial as Sentiment | null) ?? null,
  );
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [failed, setFailed] = useState(false);

  async function choose(next: Sentiment) {
    const previous = value;
    const previousSource = source;
    const newValue = value === next ? null : next;

    setValue(newValue);
    setSource(newValue ? "manual" : null);
    setFailed(false);

    try {
      const response = await fetch("/api/sentiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sentiment: newValue }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      onChange?.(newValue);
    } catch {
      // Put the old value back rather than showing a score that isn't stored.
      setValue(previous);
      setSource(previousSource);
      setFailed(true);
    }
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
