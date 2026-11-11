/**
 * A small Python tokenizer: enough to read imports, calls, function definitions and string
 * contents reliably, without a parser dependency. Comments are dropped and strings stay as single
 * tokens, so a library named in a comment or a docstring is never mistaken for a use.
 *
 * It tolerates what it doesn't understand: unbalanced brackets or odd syntax produce fewer facts,
 * never a crash.
 */

export interface Tok {
  t: "name" | "op" | "str" | "num";
  /** The token text. For strings, the raw text including prefix and quotes. */
  s: string;
  line: number;
}

/** One logical line: a statement, with any bracketed continuation lines joined. */
export interface PyLine {
  /** Leading whitespace width of its first physical line. */
  indent: number;
  line: number;
  toks: Tok[];
}

const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;
const STR_PREFIX = /^(?:[rRbBuUfF]{1,2})$/;

export function tokenizePython(src: string): PyLine[] {
  const lines: PyLine[] = [];
  let cur: Tok[] = [];
  let curIndent = 0;
  let curLine = 1;
  let line = 1;
  let depth = 0;
  let atStart = true;
  let i = 0;
  const n = src.length;

  const flush = () => {
    if (cur.length > 0) lines.push({ indent: curIndent, line: curLine, toks: cur });
    cur = [];
    atStart = true;
  };

  while (i < n) {
    const c = src[i]!;

    if (atStart && depth === 0) {
      // Measure indentation of a new logical line, skipping blank and comment-only lines.
      let w = 0;
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t")) {
        w += src[j] === "\t" ? 4 : 1;
        j++;
      }
      if (j >= n) break;
      if (src[j] === "\n" || src[j] === "\r") {
        i = j + 1;
        if (src[j] === "\r" && src[i] === "\n") i++;
        line++;
        continue;
      }
      if (src[j] === "#") {
        while (j < n && src[j] !== "\n") j++;
        i = j;
        continue;
      }
      curIndent = w;
      curLine = line;
      i = j;
      atStart = false;
      continue;
    }

    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      i++;
      line++;
      if (depth === 0) flush();
      continue;
    }
    if (c === " " || c === "\t" || c === "\f") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\\" && (src[i + 1] === "\n" || src[i + 1] === "\r")) {
      i += src[i + 1] === "\r" && src[i + 2] === "\n" ? 3 : 2;
      line++;
      continue;
    }

    // Names, and strings with a prefix (f"...", rb'...').
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < n && NAME_PART.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if ((src[j] === '"' || src[j] === "'") && STR_PREFIX.test(word)) {
        const end = readString(src, j);
        cur.push({ t: "str", s: src.slice(i, end), line });
        line += countNewlines(src, i, end);
        i = end;
        continue;
      }
      cur.push({ t: "name", s: word, line });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = readString(src, i);
      cur.push({ t: "str", s: src.slice(i, end), line });
      line += countNewlines(src, i, end);
      i = end;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(src[j]!)) j++;
      cur.push({ t: "num", s: src.slice(i, j), line });
      i = j;
      continue;
    }

    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    cur.push({ t: "op", s: c, line });
    i++;
  }
  flush();
  return lines;
}

/** Index just past the string that opens at `start` (a quote character). */
function readString(src: string, start: number): number {
  const q = src[start]!;
  const triple = src[start + 1] === q && src[start + 2] === q;
  let i = start + (triple ? 3 : 1);
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (triple) {
      if (c === q && src[i + 1] === q && src[i + 2] === q) return i + 3;
    } else {
      if (c === q) return i + 1;
      if (c === "\n") return i; // unterminated: stop at the line end rather than swallow the file
    }
    i++;
  }
  return src.length;
}

function countNewlines(src: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (src[i] === "\n") n++;
  return n;
}

// ---- string helpers

export const isFString = (s: string) => /^[rRbBuU]*[fF][rRbBuU]*["']/.test(s);

/** The text between the quotes of a string token (without prefix). Not unescaped. */
export function stringBody(s: string): string {
  const m = /^[A-Za-z]*("""|'''|"|')([\s\S]*?)\1$/.exec(s);
  return m ? m[2]! : "";
}

/** Names used inside `{...}` of an f-string: the variables the text depends on. */
export function fstringNames(s: string): string[] {
  if (!isFString(s)) return [];
  const out: string[] = [];
  for (const m of stringBody(s).matchAll(/\{([^{}]+)\}/g)) {
    const first = /^\s*([A-Za-z_]\w*)/.exec(m[1]!);
    if (first) out.push(first[1]!);
  }
  return out;
}
