"use client";

import { useState } from "react";

/**
 * Thumbs up/down on a story. Optimistic toggle (clicking the active thumb
 * clears it); persists via POST /api/feedback. Votes feed the AI relevance
 * classifier as analyst examples, so the monitor learns what "relevant"
 * means over time.
 */
export default function FeedbackButtons({
  id,
  initial,
}: {
  id: string;
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial ?? null);

  async function send(next: "up" | "down") {
    const newValue = value === next ? null : next;
    setValue(newValue);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, feedback: newValue }),
      });
    } catch {
      // Keep the optimistic state; a lost vote is not worth an error dialog.
    }
  }

  return (
    <span className="inline-flex shrink-0 gap-1 print:hidden">
      <button
        type="button"
        aria-label="Relevant — more like this"
        title="Relevant — more like this"
        aria-pressed={value === "up"}
        onClick={() => send("up")}
        className={`rounded-md border px-1.5 py-0.5 text-xs leading-none ${
          value === "up"
            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
            : "border-[var(--line)] text-[var(--muted)] opacity-60 hover:opacity-100"
        }`}
      >
        👍
      </button>
      <button
        type="button"
        aria-label="Not relevant — fewer like this"
        title="Not relevant — fewer like this"
        aria-pressed={value === "down"}
        onClick={() => send("down")}
        className={`rounded-md border px-1.5 py-0.5 text-xs leading-none ${
          value === "down"
            ? "border-[var(--critical)] bg-[var(--critical)] text-white"
            : "border-[var(--line)] text-[var(--muted)] opacity-60 hover:opacity-100"
        }`}
      >
        👎
      </button>
    </span>
  );
}
