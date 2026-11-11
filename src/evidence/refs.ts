import type { Confidence, Fact } from "./schema.js";

/** Every kind of marker a generated sentence may carry. */
const REF_ID = /^(?:EV-[0-9a-f]{6,12}|F-[0-9a-f]{6,12}|KB-[0-9a-f]{6,12}|A-\d{3,})$/;

export interface ClaimRef {
  id: string;
  kind: "EV" | "F" | "KB" | "A";
  /** Offset of the opening bracket in the text. */
  index: number;
}

/**
 * Finds markers such as `[EV-3fa9c2d1]` or `[EV-3fa9c2d1, A-001]`. A bracket group counts only if
 * every item in it is a valid ID, so ordinary Markdown like `[a link](url)` is ignored.
 * A fresh regex per call: a shared global regex keeps `lastIndex` between uses and misses matches.
 */
export function extractRefs(text: string): ClaimRef[] {
  const out: ClaimRef[] = [];
  const group = /\[([^\[\]\n]{1,200})\]/g;
  for (let m = group.exec(text); m; m = group.exec(text)) {
    const tokens = m[1]!.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0 || !tokens.every((t) => REF_ID.test(t))) continue;
    for (const id of tokens) out.push({ id, kind: id.slice(0, id.indexOf("-")) as ClaimRef["kind"], index: m.index });
  }
  return out;
}

/**
 * Rewrites every valid marker group, e.g. `[EV-3acc7131, A-001]`, with `fn(ids)`. Anything else in
 * square brackets is left alone.
 */
export function replaceRefGroups(text: string, fn: (ids: string[]) => string): string {
  return text.replace(/\[([^\[\]\n]{1,200})\]/g, (whole, inner: string) => {
    const tokens = inner.split(/[\s,]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((t) => REF_ID.test(t)) ? fn(tokens) : whole;
  });
}

export type DocumentUse = "plain" | "qualified" | "never";

/**
 * How a fact may appear in a document.
 * - plain: state it as fact.
 * - qualified: state it only with a visible "inferred" or "not found by the scan" qualifier.
 * - never: show it to the user as unconfirmed, and keep it out of documents.
 */
export function documentUse(fact: Pick<Fact, "confidence" | "claimType">): DocumentUse {
  if (fact.confidence === "low") return "never";
  if (fact.claimType === "not-found" || fact.confidence === "medium") return "qualified";
  return "plain";
}

export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
