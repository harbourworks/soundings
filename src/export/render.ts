import { renderDocx } from "./docx.js";
import { renderHtml } from "./html.js";

export type ExportFormat = "markdown" | "html" | "docx";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["markdown", "html", "docx"];

export const isExportFormat = (s: string): s is ExportFormat => (EXPORT_FORMATS as readonly string[]).includes(s);

export const extensionFor = (f: ExportFormat) => ({ markdown: "md", html: "html", docx: "docx" })[f];

/** Markdown stays text; HTML is text; Word is a binary file. */
export function renderExport(markdown: string, format: ExportFormat, meta: { title: string; created: string }): string | Buffer {
  if (format === "markdown") return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  if (format === "html") return renderHtml(markdown, meta.title);
  return renderDocx(markdown, meta);
}
