import { fstringNames, isFString, stringBody, type PyLine, type Tok } from "./tokenize.js";

export interface PyImport {
  /** The module, e.g. "openai" or "fastapi.security". Relative imports are left out. */
  module: string;
  /** Names imported from it (`from x import a, b`). */
  names: string[];
  line: number;
}

const isName = (t: Tok | undefined, s?: string) => t?.t === "name" && (s === undefined || t.s === s);
const isOp = (t: Tok | undefined, s: string) => t?.t === "op" && t.s === s;

export function importsOf(lines: PyLine[]): PyImport[] {
  const out: PyImport[] = [];
  for (const l of lines) {
    const t = l.toks;
    if (isName(t[0], "import")) {
      // import a.b as c, d
      let i = 1;
      while (i < t.length) {
        const parts: string[] = [];
        while (isName(t[i])) {
          parts.push(t[i]!.s);
          i++;
          if (isOp(t[i], ".")) i++;
          else break;
        }
        if (parts.length) out.push({ module: parts.join("."), names: [], line: l.line });
        while (i < t.length && !isOp(t[i], ",")) i++;
        i++;
      }
    } else if (isName(t[0], "from")) {
      let i = 1;
      const parts: string[] = [];
      let relative = false;
      while (isOp(t[i], ".")) {
        relative = true;
        i++;
      }
      while (isName(t[i]) && !isName(t[i], "import")) {
        parts.push(t[i]!.s);
        i++;
        if (isOp(t[i], ".")) i++;
        else break;
      }
      if (!isName(t[i], "import")) continue;
      const names: string[] = [];
      for (i++; i < t.length; i++) {
        if (isName(t[i]) && !isName(t[i], "as")) {
          names.push(t[i]!.s);
          // skip the alias
          if (isName(t[i + 1], "as")) i += 2;
        }
      }
      if (!relative || parts.length > 0) out.push({ module: parts.join("."), names, line: l.line });
    }
  }
  return out;
}

/** Every dotted name an import brings in: `from google import genai` is also `google.genai`. */
export function importCandidates(imp: PyImport): string[] {
  return [imp.module, ...imp.names.map((n) => `${imp.module}.${n}`)].filter(Boolean);
}

/** True if `module` is `name` or something inside it. */
export const withinModule = (module: string, name: string) => module === name || module.startsWith(`${name}.`);

// ---- functions

export interface PyFunc {
  name: string;
  params: string[];
  decorators: string[];
  line: number;
}

const SKIP_PARAMS = new Set(["self", "cls"]);

export function functionsOf(lines: PyLine[]): PyFunc[] {
  const out: PyFunc[] = [];
  let pending: string[] = [];
  for (const l of lines) {
    const t = l.toks;
    if (isOp(t[0], "@")) {
      pending.push(t.slice(1).map((x) => x.s).join(""));
      continue;
    }
    const start = isName(t[0], "async") && isName(t[1], "def") ? 2 : isName(t[0], "def") ? 1 : -1;
    if (start < 0 || !isName(t[start])) {
      pending = [];
      continue;
    }
    const name = t[start]!.s;
    const params: string[] = [];
    if (isOp(t[start + 1], "(")) {
      let depth = 0;
      let expectName = true;
      for (let i = start + 1; i < t.length; i++) {
        const x = t[i]!;
        if (x.t === "op" && "([{".includes(x.s)) depth++;
        else if (x.t === "op" && ")]}".includes(x.s)) {
          depth--;
          if (depth === 0) break;
        } else if (depth === 1 && isOp(x, ",")) expectName = true;
        else if (depth === 1 && expectName && x.t === "name" && !SKIP_PARAMS.has(x.s)) {
          params.push(x.s);
          expectName = false;
        } else if (depth === 1 && x.t === "op" && (x.s === "*" || x.s === "/")) continue;
        else if (depth === 1 && expectName) expectName = false;
      }
    }
    out.push({ name, params, decorators: pending, line: l.line });
    pending = [];
  }
  return out;
}

const ROUTE_DECORATOR = /^\w+(?:\.\w+)*\.(?:get|post|put|patch|delete|route|api_route|websocket)\(/;
export const isRouteHandler = (f: PyFunc) => f.decorators.some((d) => ROUTE_DECORATOR.test(d));

/** Parameters that carry the caller's request: not the framework's own plumbing. */
const PLUMBING = new Set(["request", "req", "response", "db", "session", "current_user", "user", "background_tasks", "background", "settings", "config", "websocket"]);

/** Handler parameters that hold request content: the parsed body, query and form values. */
export function handlerInputs(funcs: PyFunc[]): Set<string> {
  const out = new Set<string>();
  for (const f of funcs) if (isRouteHandler(f)) for (const p of f.params) if (!PLUMBING.has(p)) out.add(p);
  return out;
}

// ---- calls

export interface PyCall {
  chain: string[];
  /** The argument tokens, without the outer parentheses. */
  args: Tok[];
  line: number;
}

/** Every `a.b.c(...)` call, nested ones included. */
export function callsOf(lines: PyLine[]): PyCall[] {
  const out: PyCall[] = [];
  for (const l of lines) {
    const t = l.toks;
    for (let i = 0; i < t.length - 1; i++) {
      if (t[i]!.t !== "name" || !isOp(t[i + 1], "(")) continue;
      if (i > 0 && isName(t[i - 1]) && (t[i - 1]!.s === "def" || t[i - 1]!.s === "class")) continue;
      const chain = [t[i]!.s];
      let j = i - 1;
      while (j >= 1 && isOp(t[j], ".") && isName(t[j - 1])) {
        chain.unshift(t[j - 1]!.s);
        j -= 2;
      }
      let depth = 0;
      let end = t.length;
      for (let k = i + 1; k < t.length; k++) {
        if (t[k]!.t === "op" && "([{".includes(t[k]!.s)) depth++;
        else if (t[k]!.t === "op" && ")]}".includes(t[k]!.s)) {
          depth--;
          if (depth === 0) {
            end = k;
            break;
          }
        }
      }
      out.push({ chain, args: t.slice(i + 2, end), line: t[i]!.line });
    }
  }
  return out;
}

export const callEndsWith = (chain: string[], tail: string[]) => chain.length >= tail.length && tail.every((x, i) => chain[chain.length - tail.length + i] === x);

// ---- request data

const REQUEST_ROOTS = new Set(["request", "req"]);
const BODY_PARTS = new Set(["json", "body", "get_json", "data", "form", "POST", "get_data", "stream", "text"]);

/** Chain of dotted names starting at token `i`, e.g. `request.json` from `request . json (`. */
function dottedAt(t: Tok[], i: number): string[] {
  const chain: string[] = [];
  while (isName(t[i])) {
    chain.push(t[i]!.s);
    if (isOp(t[i + 1], ".") && isName(t[i + 2])) i += 2;
    else break;
  }
  return chain;
}

const isRequestBodyChain = (c: string[]) => c.length >= 2 && REQUEST_ROOTS.has(c[0]!) && c.slice(1).some((p) => BODY_PARTS.has(p));

/** True if the tokens read the request body anywhere: `await request.json()`, `request.form`. */
export function readsRequestBody(toks: Tok[]): boolean {
  for (let i = 0; i < toks.length; i++) if (isName(toks[i]) && isRequestBodyChain(dottedAt(toks, i))) return true;
  return false;
}

/** Variables assigned from the request body: `payload = await request.json()`. */
export function requestVariables(lines: PyLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    const t = l.toks;
    if (isName(t[0]) && isOp(t[1], "=") && !isOp(t[2], "=") && readsRequestBody(t.slice(2))) out.add(t[0]!.s);
  }
  return out;
}

// ---- environment

const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|DSN|DATABASE_URL|CONNECTION_STRING/i;
export const isSecretName = (n: string) => SECRET_NAME.test(n);

/** `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")`, `getenv("X")`. */
export function envReadsPy(lines: PyLine[]): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  for (const l of lines) {
    const t = l.toks;
    for (let i = 0; i < t.length; i++) {
      const chain = isName(t[i]) ? dottedAt(t, i) : [];
      if (chain.length === 0) continue;
      const tail = chain.join(".");
      let at = -1;
      if (/(?:^|\.)(?:os\.)?environ$/.test(tail) && isOp(t[i + chain.length * 2 - 1], "[")) at = i + chain.length * 2;
      else if (/(?:^|\.)(?:environ\.get|getenv)$/.test(tail) && isOp(t[i + chain.length * 2 - 1], "(")) at = i + chain.length * 2;
      if (at >= 0 && t[at]?.t === "str") out.push({ name: stringBody(t[at]!.s), line: l.line });
    }
  }
  return out;
}

/** Fields of a pydantic `BaseSettings` class: they are read from the environment of the same name. */
export function settingsFields(lines: PyLine[]): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!isName(l.toks[0], "class") || !l.toks.some((t) => isName(t, "BaseSettings"))) continue;
    for (let j = i + 1; j < lines.length && lines[j]!.indent > l.indent; j++) {
      const f = lines[j]!;
      if (isName(f.toks[0]) && isOp(f.toks[1], ":")) out.push({ name: f.toks[0]!.s.toUpperCase(), line: f.line });
    }
  }
  return out;
}

// ---- what a call's arguments depend on

const KEYWORDS = new Set(["True", "False", "None", "and", "or", "not", "if", "else", "for", "in", "is", "lambda", "await", "async", "yield", "from", "import", "as"]);

/** Names the tokens depend on: variables read, f-string interpolations, `.format()` arguments. Attribute names and callee names are skipped. */
export function dependsOn(toks: Tok[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    if (x.t === "str") {
      for (const n of fstringNames(x.s)) out.add(n);
    } else if (x.t === "name" && !KEYWORDS.has(x.s) && !isOp(toks[i - 1], ".") && !isOp(toks[i + 1], "(") && !isOp(toks[i + 1], "=")) {
      out.add(x.s);
    }
  }
  return out;
}

/** The value of `key=` or `"key":` in a call's arguments: tokens up to the next comma at the same depth. */
function valuesOf(args: Tok[], keys: ReadonlySet<string>): Tok[][] {
  const out: Tok[][] = [];
  for (let i = 0; i < args.length; i++) {
    const x = args[i]!;
    const isKwarg = x.t === "name" && keys.has(x.s) && isOp(args[i + 1], "=") && !isOp(args[i + 2], "=");
    const isDictKey = x.t === "str" && keys.has(stringBody(x.s)) && isOp(args[i + 1], ":");
    if (!isKwarg && !isDictKey) continue;
    const value: Tok[] = [];
    let depth = 0;
    for (let k = i + 2; k < args.length; k++) {
      const y = args[k]!;
      if (y.t === "op" && "([{".includes(y.s)) depth++;
      else if (y.t === "op" && ")]}".includes(y.s)) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && isOp(y, ",")) break;
      value.push(y);
    }
    out.push(value);
  }
  return out;
}

const AI_CALL_TAILS: string[][] = [
  ["chat", "completions", "create"],
  ["chat", "completions", "parse"],
  ["responses", "create"],
  ["completions", "create"],
  ["embeddings", "create"],
  ["messages", "create"],
  ["messages", "stream"],
  ["generate_content"],
  ["generate_content_async"],
  ["generate_text"],
];
const CONTENT_KEYS: ReadonlySet<string> = new Set(["content", "prompt", "input", "contents", "text", "system", "messages", "query"]);

/**
 * Model calls whose prompt comes from somewhere other than a fixed string. High when it traces to a
 * request or a function parameter (a caller supplies it), medium when it is dynamic but unclear.
 */
export function aiPayload(lines: PyLine[], calls: PyCall[], funcs: PyFunc[]): { confidence: "high" | "medium"; line: number } | null {
  const params = new Set(funcs.flatMap((f) => f.params));
  for (const n of handlerInputs(funcs)) params.add(n);
  const reqVars = requestVariables(lines);
  let best: { confidence: "high" | "medium"; line: number } | null = null;

  for (const c of calls) {
    if (!AI_CALL_TAILS.some((t) => callEndsWith(c.chain, t))) continue;
    const roots = new Set<string>();
    for (const v of valuesOf(c.args, CONTENT_KEYS)) {
      if (v.length === 1 && v[0]!.t === "str" && !isFString(v[0]!.s)) continue; // a fixed string
      for (const n of dependsOn(v)) roots.add(n);
    }
    if (roots.size === 0) continue;
    const traced = [...roots].some((r) => params.has(r) || reqVars.has(r) || REQUEST_ROOTS.has(r));
    const candidate = { confidence: traced ? ("high" as const) : ("medium" as const), line: c.line };
    if (!best || (candidate.confidence === "high" && best.confidence !== "high")) best = candidate;
  }
  return best;
}

const LOG_LEVELS = new Set(["debug", "info", "warning", "warn", "error", "exception", "critical", "log"]);

/** `logger.info(...)`, `logging.error(...)`, `print(...)`. */
function isLogCall(c: PyCall): boolean {
  if (c.chain.length === 1) return c.chain[0] === "print";
  const level = c.chain[c.chain.length - 1]!;
  const root = c.chain[0]!;
  return LOG_LEVELS.has(level) && (root === "logging" || /^(?:log|logger|\w*_logger|\w*_log|self)$/.test(root) || root.toLowerCase().includes("log"));
}

/** The first log call that writes request content, or null. */
export function loggedRequestBody(lines: PyLine[], calls: PyCall[], funcs: PyFunc[]): { line: number } | null {
  const inputs = handlerInputs(funcs);
  const reqVars = requestVariables(lines);
  for (const c of calls) {
    if (!isLogCall(c)) continue;
    if (readsRequestBody(c.args)) return { line: c.line };
    const used = dependsOn(c.args);
    if ([...used].some((n) => reqVars.has(n) || inputs.has(n))) return { line: c.line };
  }
  return null;
}

/** The first string literal assigned to `name=` in any call in the file, e.g. `model="gpt-4o-mini"`. */
export function firstStringKwarg(lines: PyLine[], name: string): string | undefined {
  for (const l of lines) {
    const t = l.toks;
    for (let i = 0; i < t.length - 2; i++) {
      if (isName(t[i], name) && isOp(t[i + 1], "=") && !isOp(t[i + 2], "=") && t[i + 2]!.t === "str" && !isFString(t[i + 2]!.s)) return stringBody(t[i + 2]!.s);
    }
  }
  return undefined;
}
