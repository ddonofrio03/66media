"use client";

import { useMemo, useState } from "react";
import {
  TEMPLATE_COLUMNS,
  parseMentionRows,
  templateCsv,
} from "@/lib/mention-rows";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | {
      kind: "saved";
      added: number;
      duplicates: number;
      errors: Array<{ row: number; error: string }>;
    }
  | { kind: "error"; message: string };

const FIELD =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-[#fbfcfc] px-3 py-2 text-sm disabled:opacity-60";
const HINT = "mt-1 text-xs text-[var(--muted)]";
const PREVIEW_ROWS = 8;

const FIELD_NAMES: Record<string, string> = {
  url: "Link",
  title: "Headline",
  snippet: "Post text",
  source: "Where it appeared",
  publishedAt: "Date posted",
  sentiment: "Sentiment",
  note: "Note",
  sourceType: "Type",
  priority: "Priority",
  label: "Relevance",
};

export default function BatchMentionUpload({ canEdit }: { canEdit: boolean }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const parsed = useMemo(() => parseMentionRows(text), [text]);
  const missingLinks = parsed.rows.filter((row) => !row.url).length;
  const disabled = !canEdit || status.kind === "saving";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
    setStatus({ kind: "idle" });
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv()], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "66-mentions-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function handleSave() {
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/mentions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentions: parsed.rows }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        added?: number;
        duplicates?: number;
        errors?: Array<{ row: number; error: string }>;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not save the mentions.");
      }
      setStatus({
        kind: "saved",
        added: data.added ?? 0,
        duplicates: data.duplicates ?? 0,
        errors: data.errors ?? [],
      });
      // Clear the box so a second click can't resubmit the same batch.
      setText("");
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Save failed.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-[var(--foreground)]">
          Copy the rows from your spreadsheet (header row included) and paste
          them below, or choose a CSV file. Columns are matched by name, so an
          existing tracking sheet usually works as is. Only a{" "}
          <strong>link</strong> and the <strong>post text</strong> are needed;
          blank &ldquo;where it appeared&rdquo; becomes the platform (Facebook,
          X, LinkedIn...), and a blank date means today.
        </p>
        <p className={HINT}>
          Recognized columns: {TEMPLATE_COLUMNS.join(", ")}. Type defaults to
          Social; sentiment is positive, neutral or negative.{" "}
          <button
            type="button"
            onClick={downloadTemplate}
            className="font-semibold text-[var(--accent)] underline"
          >
            Download a blank template
          </button>
          .
        </p>
      </div>

      <textarea
        className={`${FIELD} font-mono`}
        rows={8}
        placeholder={TEMPLATE_COLUMNS.join("\t")}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setStatus({ kind: "idle" });
        }}
        disabled={disabled}
        aria-label="Pasted mention rows"
      />

      <label className="text-sm font-semibold text-[var(--foreground)]">
        Or choose a CSV file
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="mt-1 block text-sm"
          onChange={(event) => handleFile(event.target.files?.[0])}
          disabled={disabled}
        />
      </label>

      {parsed.rows.length > 0 && (
        <div className="rounded-md border border-[var(--line)] bg-white p-3 text-sm">
          <p className="font-semibold">
            {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} found
            {missingLinks > 0 && (
              <span className="text-[#b42318]">
                {" "}
                · {missingLinks} without a link will be skipped
              </span>
            )}
          </p>
          <p className={HINT}>
            {parsed.usedTemplateOrder
              ? "No header row recognized, so columns are read in template order: " +
                TEMPLATE_COLUMNS.join(", ") +
                "."
              : "Columns used: " +
                Object.entries(parsed.columns)
                  .map(([field, column]) => `${FIELD_NAMES[field]} ← "${column}"`)
                  .join(", ") +
                "."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">Link</th>
                  <th className="py-1 pr-3">Post text</th>
                  <th className="py-1 pr-3">Where</th>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  <tr key={index} className="border-b border-[var(--line)] align-top">
                    <td className="py-1 pr-3">{index + 1}</td>
                    <td className="max-w-[14rem] truncate py-1 pr-3">
                      {row.url || <span className="text-[#b42318]">missing</span>}
                    </td>
                    <td className="max-w-[20rem] truncate py-1 pr-3">
                      {row.title || row.snippet}
                    </td>
                    <td className="py-1 pr-3">{row.source || "(platform)"}</td>
                    <td className="py-1 pr-3">{row.publishedAt || "(today)"}</td>
                    <td className="py-1 pr-3">{row.sentiment || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > PREVIEW_ROWS && (
              <p className={HINT}>
                …and {parsed.rows.length - PREVIEW_ROWS} more.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || parsed.rows.length === 0}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status.kind === "saving"
            ? "Adding…"
            : `Add ${parsed.rows.length || ""} mention${parsed.rows.length === 1 ? "" : "s"}`}
        </button>

        {status.kind === "saved" && (
          <span className="text-sm font-semibold text-[var(--accent)]">
            Added {status.added} mention{status.added === 1 ? "" : "s"} to the
            archive and reports.
            {status.duplicates > 0 &&
              ` ${status.duplicates} duplicate${status.duplicates === 1 ? " was" : "s were"} listed once.`}
          </span>
        )}
        {status.kind === "error" && (
          <span className="text-sm font-semibold text-[#b42318]">
            {status.message}
          </span>
        )}
      </div>

      {status.kind === "saved" && status.errors.length > 0 && (
        <div className="rounded-md border border-[#f3c1bd] bg-[#fdf3f2] p-3 text-sm text-[#b42318]">
          <p className="font-semibold">
            {status.errors.length} row{status.errors.length === 1 ? " was" : "s were"}{" "}
            skipped:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {status.errors.map((error) => (
              <li key={error.row}>
                Row {error.row}: {error.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
