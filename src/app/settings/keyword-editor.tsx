"use client";

import { useState } from "react";

type Props = {
  initialPositiveKeywords: string[];
  initialAvoidPhrases: string[];
  canEdit: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function toLines(values: string[]) {
  return values.join("\n");
}

function toList(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function KeywordEditor({
  initialPositiveKeywords,
  initialAvoidPhrases,
  canEdit,
}: Props) {
  const [positive, setPositive] = useState(toLines(initialPositiveKeywords));
  const [avoid, setAvoid] = useState(toLines(initialAvoidPhrases));
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSave() {
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positiveKeywords: toList(positive),
          avoidPhrases: toList(avoid),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setStatus({
          kind: "error",
          message: data?.error ?? `Save failed (HTTP ${response.status}).`,
        });
        return;
      }
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Save failed.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Field
          label="Positive keywords"
          hint="One per line. Each becomes a search and keeps any matching coverage. Multi-word phrases are matched exactly."
          value={positive}
          onChange={setPositive}
          disabled={!canEdit}
          rows={12}
        />
        <Field
          label="Phrases to avoid"
          hint="One per line. Any item containing one of these is dropped as noise (e.g. other highways, unrelated cities)."
          value={avoid}
          onChange={setAvoid}
          disabled={!canEdit}
          rows={12}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canEdit || status.kind === "saving"}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status.kind === "saving" ? "Saving…" : "Save keywords"}
        </button>

        {status.kind === "saved" && (
          <span className="text-sm font-semibold text-[var(--accent-strong)]">
            Saved. Takes effect on the next digest run.
          </span>
        )}
        {status.kind === "error" && (
          <span className="text-sm font-semibold text-[var(--critical)]">
            {status.message}
          </span>
        )}
        {!canEdit && (
          <span className="text-sm text-[var(--muted)]">
            Editing is disabled until Supabase is configured. Showing the current
            defaults.
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  rows,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  rows: number;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-sm text-[var(--muted)]">{hint}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={rows}
        spellCheck={false}
        className="mt-1 w-full rounded-md border border-[var(--line)] bg-[#fbfcfc] p-3 font-mono text-sm leading-6 disabled:opacity-60"
      />
    </label>
  );
}
