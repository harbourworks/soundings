import { inlines, noteOrder, parseMarkdown, type Block } from "./markdown-model.js";
import { zip } from "./zip.js";

/**
 * Writes a Word document (.docx) from a Soundings Markdown document, with real footnotes for the
 * source references. Plain OOXML written by hand: no templates, no macros, no external links.
 */

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const run = (text: string, bold = false) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

function runs(text: string, noteId: (id: string) => number, forceBold = false): string {
  return inlines(text)
    .map((i) =>
      i.kind === "text"
        ? run(i.text, i.bold || forceBold)
        : `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${noteId(i.id)}"/></w:r>`,
    )
    .join("");
}

const para = (inner: string, style?: string, extra = "") =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${inner}</w:p>`;

function blockXml(b: Block, noteId: (id: string) => number): string {
  switch (b.type) {
    case "heading":
      return para(runs(b.text, noteId), `Heading${b.level}`);
    case "paragraph":
      return para(runs(b.text, noteId));
    case "quote":
      return para(runs(b.text, noteId), "Quote");
    case "bullets":
      return b.items.map((i) => para(run("•\t") + runs(i, noteId), "ListParagraph", '<w:ind w:left="567" w:hanging="283"/><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>')).join("");
    case "table": {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      const width = Math.floor(9000 / cols);
      const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
      const rows = b.rows
        .map((cells, ri) => {
          const tcs = Array.from({ length: cols }, (_, ci) => {
            const text = cells[ci] ?? "";
            const shade = ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F6"/>' : "";
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${para(runs(text, noteId, ri === 0))}</w:tc>`;
          }).join("");
          return `<w:tr>${ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${tcs}</w:tr>`;
        })
        .join("");
      return (
        `<w:tbl><w:tblPr><w:tblW w:w="${width * cols}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
        `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>` +
        para("") // Word needs a paragraph after a table
      );
    }
  }
}

const STYLES = `${XML}
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="14507A"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="14507A"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="14507A"/></w:pBdr><w:ind w:left="284"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>`;

const SETTINGS = `${XML}
<w:settings ${NS}><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr></w:settings>`;

const CONTENT_TYPES = `${XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`;

export interface DocxOptions {
  title: string;
  /** ISO timestamp for the document properties. Passed in so the same input gives the same file. */
  created: string;
}

export function renderDocx(markdown: string, opts: DocxOptions): Buffer {
  const doc = parseMarkdown(markdown);
  const order = noteOrder(doc);
  const noteId = (id: string) => order.indexOf(id) + 1;

  // The Markdown's own "Sources" heading is replaced by real footnotes.
  const blocks = doc.blocks.filter((b) => !(b.type === "heading" && b.level === 2 && b.text === "Sources"));
  const body = blocks.map((b) => blockXml(b, noteId)).join("");
  const document = `${XML}
<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1304" w:bottom="1304" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const notes = order
    .map(
      (id, i) =>
        `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(` ${doc.footnotes.get(id) ?? "Source not found."}`)}</w:p></w:footnote>`,
    )
    .join("");
  const footnotes = `${XML}
<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${notes}</w:footnotes>`;

  const core = `${XML}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title)}</dc:title><dc:creator>Soundings</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${esc(opts.created)}</dcterms:created></cp:coreProperties>`;

  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
    { name: "word/styles.xml", data: STYLES },
    { name: "word/settings.xml", data: SETTINGS },
    { name: "word/footnotes.xml", data: footnotes },
    { name: "docProps/core.xml", data: core },
  ]);
}
