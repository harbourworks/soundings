import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { join, resolve } from "node:path";
import { crc32, zip } from "../src/export/zip.js";
import { renderDocx } from "../src/export/docx.js";
import { renderHtml } from "../src/export/html.js";
import { inlines, noteOrder, parseMarkdown } from "../src/export/markdown-model.js";
import { buildDocument, DOCUMENTS } from "../src/documents/build.js";
import { emptyAnswers, setAnswer } from "../src/questions/answers-file.js";
import { scan } from "../src/scanner/scan.js";

const FIX = resolve(__dirname, "../fixtures/apps");
const NOW = new Date("2026-11-11T11:30:00Z");

/** Reads a stored ZIP back, checking each entry's CRC: enough to prove the container is sound. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(crc32(data), name).toBe(crc);
    out.set(name, data.toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Every opening tag has a closing tag, in order. Not a full XML parser, but it catches broken writes. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === "/") continue;
    if (m[1] === "/") {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0;
}

const sample = `# Test document

> A draft notice.

## First section

A paragraph with a **bold** word and a source [^EV-aaaa1111] and another [^A-001].

- first bullet [^EV-aaaa1111]
- second bullet

| Service | Purpose |
| --- | --- |
| Stripe [^EV-aaaa1111] | payments |
| OpenAI | summaries |

## Sources

[^EV-aaaa1111]: Code scan, Stripe: Stripe is used for payments.
[^A-001]: Answer from the project team, recorded 2026-11-11.
`;

describe("zip", () => {
  it("round-trips entries with correct checksums, and is deterministic", () => {
    const entries = [{ name: "a.txt", data: "hello" }, { name: "dir/b.xml", data: "<x>é</x>" }];
    const a = zip(entries);
    expect(a.equals(zip(entries))).toBe(true);
    const files = unzip(a);
    expect(files.get("a.txt")).toBe("hello");
    expect(files.get("dir/b.xml")).toBe("<x>é</x>");
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("markdown model", () => {
  it("reads headings, paragraphs, bullets, tables, quotes and footnote definitions", () => {
    const doc = parseMarkdown(sample);
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "quote", "heading", "paragraph", "bullets", "table", "heading"]);
    expect([...doc.footnotes.keys()]).toEqual(["EV-aaaa1111", "A-001"]);
    const table = doc.blocks.find((b) => b.type === "table");
    expect(table && "rows" in table && table.rows).toEqual([["Service", "Purpose"], ["Stripe [^EV-aaaa1111]", "payments"], ["OpenAI", "summaries"]]);
  });

  it("numbers footnotes in reading order", () => {
    expect(noteOrder(parseMarkdown(sample))).toEqual(["EV-aaaa1111", "A-001"]);
    expect(inlines("a **b** c [^X-1]").map((i) => i.kind)).toEqual(["text", "text", "text", "note"]);
  });
});

describe("html", () => {
  const html = renderHtml(sample, "Test document");

  it("is one self-contained page: no scripts, no external files", () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script|<link|<img|src=|https?:\/\//i);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("@media print");
  });

  it("turns markers into numbered links to a sources list", () => {
    expect(html).toContain('href="#fn-EV-aaaa1111"');
    expect(html).toContain('<li id="fn-EV-aaaa1111">Code scan, Stripe');
    expect(html.match(/<h2>Sources<\/h2>/g)).toHaveLength(1);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
  });

  it("escapes anything that looks like markup in a document", () => {
    const evil = renderHtml("# T\n\nAnswer: <script>alert(1)</script> & \"quotes\"\n", "T");
    expect(evil).not.toContain("<script>alert");
    expect(evil).toContain("&lt;script&gt;");
  });
});

describe("docx", () => {
  const files = unzip(renderDocx(sample, { title: "Test document", created: "2026-11-11T11:30:00Z" }));

  it("contains the parts Word needs, all well-formed", () => {
    expect([...files.keys()].sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/footnotes.xml", "word/settings.xml", "word/styles.xml"].sort(),
    );
    for (const [name, xml] of files) expect(balanced(xml), name).toBe(true);
  });

  it("uses real footnotes, one per source, referenced from the text", () => {
    const doc = files.get("word/document.xml")!;
    const notes = files.get("word/footnotes.xml")!;
    expect([...doc.matchAll(/<w:footnoteReference w:id="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2", "1", "1"]);
    expect([...notes.matchAll(/<w:footnote w:id="([1-9]\d*)"/g)]).toHaveLength(2);
    expect(notes).toContain("Stripe is used for payments.");
  });

  it("maps headings, quotes, bullets and tables to Word styles", () => {
    const doc = files.get("word/document.xml")!;
    expect(doc).toContain('w:pStyle w:val="Heading1"');
    expect(doc).toContain('w:pStyle w:val="Heading2"');
    expect(doc).toContain('w:pStyle w:val="Quote"');
    expect(doc).toContain('w:pStyle w:val="ListParagraph"');
    expect(doc).toContain("<w:tbl>");
    expect(doc).not.toContain(">Sources<"); // replaced by real footnotes
  });

  it("is deterministic and carries no external references", () => {
    const again = unzip(renderDocx(sample, { title: "Test document", created: "2026-11-11T11:30:00Z" }));
    expect(again.get("word/document.xml")).toBe(files.get("word/document.xml"));
    expect([...files.values()].join("")).not.toMatch(/TargetMode="External"|https?:\/\/(?!schemas\.|purl\.org|www\.w3\.org)/);
  });

  it("escapes markup in text", () => {
    const f = unzip(renderDocx("# T\n\nA <b>&</b> B\n", { title: "T & Co", created: "2026-11-11T11:30:00Z" }));
    expect(f.get("word/document.xml")).toContain("A &lt;b&gt;&amp;&lt;/b&gt; B");
    expect(f.get("docProps/core.xml")).toContain("T &amp; Co");
  });
});

describe("real documents export cleanly", () => {
  const ev = scan({ root: join(FIX, "notes-saas"), now: NOW }).evidence;
  const answers = setAnswer(emptyAnswers(), "UQ-supabase-region", "London (eu-west-2)", NOW);

  it.each(DOCUMENTS.map((d) => d.id))("%s becomes valid HTML and Word with matching footnote counts", (id) => {
    const md = buildDocument(id, ev, answers, { locations: false }).markdown;
    const refs = noteOrder(parseMarkdown(md));
    expect(refs.length).toBeGreaterThan(0);

    const html = renderHtml(md, id);
    expect([...html.matchAll(/<li id="fn-/g)]).toHaveLength(refs.length);
    expect(html).not.toContain("Source not found");

    const files = unzip(renderDocx(md, { title: id, created: ev.generatedAt }));
    for (const [name, xml] of files) expect(balanced(xml), `${id} ${name}`).toBe(true);
    expect([...files.get("word/footnotes.xml")!.matchAll(/<w:footnote w:id="([1-9]\d*)"/g)]).toHaveLength(refs.length);
  });
});
