import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Redaction guard. Run it over any evidence file, log line or generated document: it fails loudly
 * if a known secret pattern shows up, or any value that appears in the project's own .env files.
 *
 * It never reports a secret value, only what kind of leak it found and where. Env values are held
 * in memory only: never logged, never written anywhere.
 */

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { kind: "stripe-key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "llm-api-key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { kind: "credentialed-url", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/i },
];

/** Prefixes that frameworks inline into the browser bundle: those values are public already. */
const PUBLIC_NAME = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_|PUBLIC_)/;
const ENV_FILE = /^\.env(?:\.[\w.-]+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist|defaults|schema|vault)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const MIN_VALUE_LENGTH = 8;

export interface Leak {
  kind: string;
  /** Offset in the checked text. */
  index: number;
}

export class RedactionError extends Error {
  constructor(
    readonly label: string,
    readonly leaks: Leak[],
  ) {
    // Kinds and counts only. The message must never contain the secret itself.
    const kinds = [...new Set(leaks.map((l) => l.kind))].sort().join(", ");
    super(`Possible secret in ${label}: ${leaks.length} match(es) (${kinds})`);
    this.name = "RedactionError";
  }
}

/** True for values worth guarding: long enough, and not an obvious non-secret such as a number or a plain URL. */
function worthGuarding(value: string): boolean {
  if (value.length < MIN_VALUE_LENGTH) return false;
  if (/^(?:true|false|null|undefined)$/i.test(value)) return false;
  if (/^\d+(?:\.\d+)?$/.test(value)) return false;
  if (/^https?:\/\/[^\s@]+$/i.test(value)) return false; // no credentials in it
  if (/^[a-z]+$/.test(value)) return false; // a lowercase word such as "development"
  return true;
}

function parseEnvValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    const [, name, rest] = m;
    let value = rest!;
    const q = value[0];
    if ((q === '"' || q === "'" || q === "`") && value.lastIndexOf(q) > 0) value = value.slice(1, value.lastIndexOf(q));
    else value = value.replace(/\s+#.*$/, "");
    if (PUBLIC_NAME.test(name!) || !worthGuarding(value)) continue;
    out.push(value);
  }
  return out;
}

/** Reads real `.env*` files under `root` (not templates) and returns the values worth guarding. Memory only. */
export function loadEnvValues(root: string, maxDepth = 3): string[] {
  const values = new Set<string>();
  const visit = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name)) visit(join(dir, e.name), depth + 1);
      } else if (e.isFile() && ENV_FILE.test(e.name) && !ENV_TEMPLATE.test(e.name)) {
        try {
          for (const v of parseEnvValues(readFileSync(join(dir, e.name), "utf8"))) values.add(v);
        } catch {
          /* unreadable file: nothing to guard from it */
        }
      }
    }
  };
  visit(root, 0);
  return [...values];
}

export interface Guard {
  /** Exact values from the project's env files. */
  envValues: string[];
}

export function createGuard(envValues: string[] = []): Guard {
  return { envValues: envValues.filter(worthGuarding) };
}

export function findLeaks(text: string, guard: Guard = createGuard()): Leak[] {
  const leaks: Leak[] = [];
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) leaks.push({ kind, index: m.index });
  }
  for (const v of guard.envValues) {
    const index = text.indexOf(v);
    if (index !== -1) leaks.push({ kind: "env-value", index });
  }
  return leaks.sort((a, b) => a.index - b.index);
}

/** Throws RedactionError if `text` contains a secret. `label` says what was checked, e.g. "evidence file". */
export function assertNoLeaks(text: string, guard: Guard, label: string): void {
  const leaks = findLeaks(text, guard);
  if (leaks.length > 0) throw new RedactionError(label, leaks);
}
