/**
 * The small subset of Markdown that Soundings documents use, parsed into blocks so the HTML and
 * Word writers share one reading of it: headings, paragraphs, bullet lists, tables, quotes,
 * bold text, footnote marks and footnote definitions.
 */

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "quote"; text: string };

export interface ParsedDocument {
  blocks: Block[];
  /** Footnote definitions by ID, in the order they were defined. */
  footnotes: Map<string, string>;
}

const FOOTNOTE_DEF = /^\[\^([A-Za-z0-9-]+)\]:\s*(.*)$/;
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && /-/.test(l);

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function parseMarkdown(source: string): ParsedDocument {
  const blocks: Block[] = [];
  const footnotes = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  let para: string[] = [];
  let bullets: string[] | null = null;
  let table: string[][] | null = null;
  let quote: string[] | null = null;

  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ") });
    if (bullets) blocks.push({ type: "bullets", items: bullets });
    if (table) blocks.push({ type: "table", rows: table });
    if (quote) blocks.push({ type: "quote", text: quote.join(" ") });
    para = [];
    bullets = null;
    table = null;
    quote = null;
  };

  for (const line of lines) {
    const def = FOOTNOTE_DEF.exec(line);
    if (def) {
      flush();
      footnotes.set(def[1]!, def[2]!.trim());
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]!.trim() });
    } else if (line.trim() === "") {
      flush();
    } else if (isTableRow(line)) {
      if (!table) {
        flush();
        table = [];
      }
      if (!isSeparator(line)) table.push(cells(line));
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!bullets) {
        flush();
        bullets = [];
      }
      bullets.push(line.replace(/^\s*[-*]\s+/, "").trim());
    } else if (/^>\s?/.test(line)) {
      if (!quote) {
        flush();
        quote = [];
      }
      quote.push(line.replace(/^>\s?/, "").trim());
    } else {
      if (bullets || table || quote) flush();
      para.push(line.trim());
    }
  }
  flush();
  return { blocks, footnotes };
}

export type Inline = { kind: "text"; text: string; bold: boolean } | { kind: "note"; id: string };

/** Splits one line into bold/plain runs and footnote marks `[^EV-1]`. */
export function inlines(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[\^([A-Za-z0-9-]+)\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index), bold: false });
    if (m[1] !== undefined) out.push({ kind: "text", text: m[1], bold: true });
    else out.push({ kind: "note", id: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last), bold: false });
  return out;
}

/** Footnote IDs in the order they first appear in the body, so numbering follows the reading order. */
export function noteOrder(doc: ParsedDocument): string[] {
  const seen: string[] = [];
  const visit = (text: string) => {
    for (const i of inlines(text)) if (i.kind === "note" && !seen.includes(i.id)) seen.push(i.id);
  };
  for (const b of doc.blocks) {
    if (b.type === "paragraph" || b.type === "quote" || b.type === "heading") visit(b.text);
    else if (b.type === "bullets") b.items.forEach(visit);
    else if (b.type === "table") b.rows.forEach((r) => r.forEach(visit));
  }
  return seen;
}
