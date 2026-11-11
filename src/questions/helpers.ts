import { documentUse } from "../evidence/refs.js";
import type { Fact, Unknown } from "../evidence/schema.js";
import { profileByKey } from "./profile.js";
import type { AnswerCtx, Draft, Need, Sentence } from "./types.js";

export const draft = (): Draft => ({ sentences: [], needs: [] });

export const S = (text: string, ...refs: string[]): Sentence => ({ text, refs });

/** "A, B and C". */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const stripStop = (s: string) => s.replace(/\.\s*$/, "");

/**
 * A fact as a sentence, worded by how sure the scan is: stated plainly if the code states it,
 * with a visible qualifier if it is inferred, as-is for a "not found" claim (which already says so),
 * and not at all if confidence is low.
 */
export function factSentence(f: Fact): Sentence | null {
  switch (documentUse(f)) {
    case "never":
      return null;
    case "qualified":
      return f.claimType === "not-found" ? S(f.claim, f.id) : S(`${stripStop(f.claim)} (inferred from the code, not confirmed).`, f.id);
    default:
      return S(f.claim, f.id);
  }
}

/** Adds each fact's sentence to the draft. Returns how many were added. */
export function addFacts(d: Draft, facts: Fact[]): number {
  let n = 0;
  for (const f of facts) {
    const s = factSentence(f);
    if (s) {
      d.sentences.push(s);
      n++;
    }
  }
  return n;
}

/** User text goes into documents, so it can't carry anything that looks like an evidence marker. */
export const plainText = (value: string) => value.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim();

const ensureStop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** The user's own words, attributed to them. */
export function answerSentence(lead: string, value: string, answerId: string): Sentence {
  return S(ensureStop(`${lead}: ${plainText(value)}`), answerId);
}

/** A profile item: the user's answer if given, otherwise a need. */
export function profile(ctx: AnswerCtx, d: Draft, short: string): void {
  const item = profileByKey(`profile.${short}`);
  if (!item) throw new Error(`unknown profile item ${short}`);
  const a = ctx.answer(item.key);
  if (a) d.sentences.push(answerSentence(item.lead, a.value, a.id));
  else d.needs.push({ key: item.key, prompt: item.prompt });
}

/** A scan question: the user's answer if given, otherwise a need. */
export function unknownAnswer(ctx: AnswerCtx, d: Draft, u: Unknown, lead?: string): void {
  const a = ctx.answer(u.id);
  if (a) {
    const subjects = u.relatedFacts.map((id) => ctx.factById(id)?.subject).filter((s): s is string => Boolean(s));
    const label = lead ?? `${u.topic}${subjects.length ? ` (${list([...new Set(subjects)])})` : ""}`;
    d.sentences.push(answerSentence(label, a.value, a.id));
  } else {
    d.needs.push({ key: u.id, prompt: u.question } satisfies Need);
  }
}

/** The "not found" fact from a detector, as a sentence. */
export function absenceSentence(ctx: AnswerCtx, detector: string): Sentence | null {
  const f = ctx.byDetector(detector).find((x) => x.claimType === "not-found");
  return f ? factSentence(f) : null;
}

export const subjectsOf = (facts: Fact[]) => [...new Set(facts.map((f) => f.subject))];
export const refsOf = (facts: Fact[]) => facts.map((f) => f.id);
