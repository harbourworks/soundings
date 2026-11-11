import { BANK } from "../questions/bank.js";
import type { BankQuestion } from "../questions/types.js";

/**
 * Matches the wording of a client's question to the question bank. It would rather say "no
 * match" than guess: a wrong match produces a confident answer to a question nobody asked.
 */

const STOP = new Set(
  "a an the and or of to in on for with by at from as is are be been being do does did you your yours we our us it its this that these those any all each which what how when where who whom whose please describe provide explain state confirm detail details give list whether if there their they them can could would should will shall may must also than then such into over per via etc ie eg".split(" "),
);

const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, (m, offset: number) => (offset >= 3 ? "" : m));

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match that tolerates a plural ("sub-processors" matches "sub-processor"). */
const hasPhrase = (text: string, phrase: string) => new RegExp(`(?<![\\w])${escape(phrase.toLowerCase())}(?:e?s)?(?![\\w])`).test(text.toLowerCase());

export interface Match {
  question: BankQuestion;
  score: number;
}

export const MIN_SCORE = 0.9;
/** The best match must beat the runner-up by this much, or the row is treated as ambiguous. */
export const MIN_MARGIN = 0.15;

export function score(text: string, q: BankQuestion): number {
  const rowTokens = new Set(tokens(text));
  const bankTokens = new Set(tokens(q.text));
  if (rowTokens.size === 0 || bankTokens.size === 0) return 0;
  const shared = [...rowTokens].filter((t) => bankTokens.has(t)).length;
  const cosine = shared / Math.sqrt(rowTokens.size * bankTokens.size);

  // A keyword starting with * names something unique (MFA, DPIA, ISO 27001): finding it is decisive.
  let phrases = 0;
  for (const k of q.keywords) {
    const strong = k.startsWith("*");
    const phrase = strong ? k.slice(1) : k;
    if (hasPhrase(text, phrase)) phrases += strong ? 2 : phrase.trim().includes(" ") ? 1 : 0.6;
  }
  return Math.min(phrases, 2) * 0.55 + cosine * 1.4;
}

/** The best bank question for `text`, or null when nothing is clearly right. */
export function bestMatch(text: string): Match | null {
  const scored = BANK.map((question) => ({ question, score: score(text, question) })).sort((a, b) => b.score - a.score);
  const [top, next] = scored;
  if (!top || top.score < MIN_SCORE) return null;
  if (next && top.score - next.score < MIN_MARGIN) return null;
  return top;
}
