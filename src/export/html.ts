import { inlines, noteOrder, parseMarkdown, type Block } from "./markdown-model.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2530;--muted:#5b6673;--line:#d6dce3;--accent:#14507a;--quote:#f3f6f9}
@media (prefers-color-scheme:dark){:root{--bg:#12171d;--fg:#e6ebf0;--muted:#9aa6b2;--line:#2c3540;--accent:#7cb8e0;--quote:#1a222b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.7rem;line-height:1.25;margin:0 0 1rem}
h2{font-size:1.3rem;margin:2.2rem 0 .6rem;padding-top:.4rem;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:1.4rem 0 .4rem}
p,li{margin:.5rem 0}
ul{padding-left:1.3rem}
blockquote{margin:1rem 0;padding:.7rem 1rem;background:var(--quote);border-left:4px solid var(--accent);color:var(--muted);font-size:.93rem}
.table{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.93rem}
th,td{border:1px solid var(--line);padding:.45rem .6rem;text-align:left;vertical-align:top}
th{background:var(--quote)}
sup a{color:var(--accent);text-decoration:none;font-size:.78em}
a{color:var(--accent)}
.sources{font-size:.88rem;color:var(--muted)}
.sources li{margin:.3rem 0}
@media print{main{max-width:none;padding:0}h2{break-after:avoid}blockquote,table,li{break-inside:avoid}a{color:inherit}}
`;

function inlineHtml(text: string, order: string[]): string {
  return inlines(text)
    .map((i) => {
      if (i.kind === "text") return i.bold ? `<strong>${esc(i.text)}</strong>` : esc(i.text);
      const n = order.indexOf(i.id) + 1;
      return `<sup><a href="#fn-${esc(i.id)}" id="ref-${esc(i.id)}" aria-label="Source ${n}">[${n}]</a></sup>`;
    })
    .join("");
}

function blockHtml(b: Block, order: string[]): string {
  switch (b.type) {
    case "heading":
      return `<h${b.level}>${inlineHtml(b.text, order)}</h${b.level}>`;
    case "paragraph":
      return `<p>${inlineHtml(b.text, order)}</p>`;
    case "quote":
      return `<blockquote>${inlineHtml(b.text, order)}</blockquote>`;
    case "bullets":
      return `<ul>${b.items.map((i) => `<li>${inlineHtml(i, order)}</li>`).join("")}</ul>`;
    case "table": {
      const [head, ...body] = b.rows;
      const row = (cells: string[], tag: string) => `<tr>${cells.map((c) => `<${tag}>${inlineHtml(c, order)}</${tag}>`).join("")}</tr>`;
      return `<div class="table"><table><thead>${head ? row(head, "th") : ""}</thead><tbody>${body.map((r) => row(r, "td")).join("")}</tbody></table></div>`;
    }
  }
}

/**
 * A self-contained HTML page: no scripts, no external files, no fonts or images to fetch. It
 * follows the reader's light or dark setting and prints cleanly, so "Print to PDF" gives a PDF.
 */
export function renderHtml(markdown: string, title: string): string {
  const doc = parseMarkdown(markdown);
  const order = noteOrder(doc);
  const body = doc.blocks.map((b) => blockHtml(b, order)).join("\n");
  const sources = order.length
    ? `<h2>Sources</h2>\n<ol class="sources">${order.map((id) => `<li id="fn-${esc(id)}">${esc(doc.footnotes.get(id) ?? "Source not found.")} <a href="#ref-${esc(id)}" aria-label="Back to text">↩</a></li>`).join("")}</ol>`
    : "";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body.replace(/<h2>Sources<\/h2>/, "")}
${sources}
</main>
</body>
</html>
`;
}
