import { parseCsv } from "@/lib/csv";
import type { ManualMentionInput } from "@/lib/mentions";

/**
 * Turns a pasted spreadsheet or an uploaded CSV into mention rows for the
 * batch upload. Columns are matched by header name, loosely ("Post link",
 * "URL" and "Link" all work), so an analyst's existing tracking sheet can be
 * pasted as is. Without a recognizable header, the template's column order
 * is assumed.
 */

type Field = keyof ManualMentionInput;

export const TEMPLATE_COLUMNS = [
  "Link",
  "Post text",
  "Where it appeared",
  "Date posted",
  "Sentiment",
  "Note",
  "Type",
] as const;

const TEMPLATE_FIELDS: Field[] = [
  "url",
  "snippet",
  "source",
  "publishedAt",
  "sentiment",
  "note",
  "sourceType",
];

// Compared after lowercasing and dropping everything but letters.
const HEADER_ALIASES: Record<Field, string[]> = {
  url: ["link", "url", "postlink", "posturl", "permalink"],
  title: ["title", "headline", "firstline"],
  snippet: ["posttext", "text", "post", "snippet", "quote", "excerpt", "content", "message", "body"],
  source: ["whereitappeared", "where", "source", "account", "page", "group", "outlet", "author", "platform"],
  publishedAt: ["dateposted", "date", "posted", "postedat", "published", "publishedat", "when", "datetime", "time"],
  sentiment: ["sentiment", "tone"],
  note: ["note", "notes", "whyitmatters", "why", "comment", "comments"],
  sourceType: ["type", "mediatype", "sourcetype"],
  priority: ["priority"],
  label: ["relevance", "label"],
};

export type ParsedMentionRows = {
  rows: ManualMentionInput[];
  // Which column fed each field, for the preview ("Link ← Post URL").
  columns: Partial<Record<Field, string>>;
  usedTemplateOrder: boolean;
};

export function parseMentionRows(text: string): ParsedMentionRows {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) {
    return { rows: [], columns: {}, usedTemplateOrder: false };
  }

  // A spreadsheet copy is tab-separated; a CSV file is comma-separated.
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const table = parseCsv(trimmed, firstLine.includes("\t") ? "\t" : ",");
  const [header = [], ...body] = table;

  const fieldIndex = new Map<Field, number>();
  const columns: Partial<Record<Field, string>> = {};
  const normalized = header.map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ""));
  // Alias order is priority order: "Post text" beats a generic "Text" column.
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[Field, string[]]>) {
    for (const alias of aliases) {
      const index = normalized.indexOf(alias);
      if (index !== -1 && ![...fieldIndex.values()].includes(index)) {
        fieldIndex.set(field, index);
        columns[field] = header[index].trim();
        break;
      }
    }
  }

  const usedTemplateOrder = !fieldIndex.has("url");
  const dataRows = usedTemplateOrder ? table : body;
  if (usedTemplateOrder) {
    fieldIndex.clear();
    TEMPLATE_FIELDS.forEach((field, index) => fieldIndex.set(field, index));
  }

  const rows = dataRows.map((cells) => {
    const row: ManualMentionInput = { url: "", title: "", source: "" };
    for (const [field, index] of fieldIndex) {
      const value = (cells[index] ?? "").trim();
      if (value) {
        (row as Record<string, string>)[field] = value;
      }
    }
    return row;
  });

  return {
    rows,
    columns: usedTemplateOrder ? {} : columns,
    usedTemplateOrder,
  };
}

// Headers only: an example row would get uploaded by anyone who forgot to
// delete it.
export function templateCsv(): string {
  return `${TEMPLATE_COLUMNS.join(",")}\n`;
}
