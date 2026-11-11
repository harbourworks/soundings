import type { AnswersFile, EvidenceFile } from "../evidence/schema.js";
import { BANK } from "./bank.js";
import { buildAnswerCtx } from "./context.js";
import { answerSentence } from "./helpers.js";
import type { BankQuestion, Category, Need, Sentence } from "./types.js";

export type Status = "answered" | "partial" | "needs-input";

export interface QuestionResult {
  id: string;
  category: Category;
  question: string;
  status: Status;
  /** The answer text with `[EV-…]` / `[A-…]` markers. Empty when nothing can be said yet. */
  answer: string;
  /** Every reference the answer rests on. */
  refs: string[];
  needs: Need[];
  /** The user replaced what the scan reported; the answer says so. */
  overridden: boolean;
}

/** Puts the markers just before the final full stop: "Uses OpenAI [EV-3acc7131]." */
export function renderSentence(s: Sentence): string {
  const marker = `[${s.refs.join(", ")}]`;
  const m = /^(.*?)([.!?])$/s.exec(s.text);
  return m ? `${m[1]} ${marker}${m[2]}` : `${s.text} ${marker}`;
}

export class EngineError extends Error {}

/** A sentence with no reference, or one that cites something that doesn't exist, is a bug in a question. */
function check(sentences: Sentence[], known: Set<string>, id: string): void {
  for (const s of sentences) {
    if (s.refs.length === 0) throw new EngineError(`Question ${id} produced a sentence with no reference: "${s.text}"`);
    for (const r of s.refs) if (!known.has(r)) throw new EngineError(`Question ${id} cites ${r}, which isn't in the evidence or answers.`);
  }
}

export function answerQuestion(q: BankQuestion, evidence: EvidenceFile, answers: AnswersFile): QuestionResult {
  const ctx = buildAnswerCtx(evidence, answers);
  const known = new Set<string>([...evidence.facts.map((f) => f.id), ...evidence.findings.map((f) => f.id), ...answers.answers.map((a) => a.id)]);
  const built = q.build(ctx);
  let { sentences } = built;
  let needs = built.needs;
  let overridden = false;

  // The user's word beats the scan. The scan's view stays in the answer, so nobody is surprised later.
  const override = ctx.answer(`override.${q.id}`);
  if (override) {
    overridden = true;
    const scanView = built.sentences.map((s) => s.text.replace(/\.\s*$/, "")).join("; ");
    sentences = [answerSentence("Stated by the project team", override.value, override.id)];
    if (scanView) {
      sentences.push({ text: `For reference, the code scan reported something different: ${scanView}.`, refs: [...new Set(built.sentences.flatMap((s) => s.refs))] });
    }
    needs = [];
  }

  check(sentences, known, q.id);
  const refs = [...new Set(sentences.flatMap((s) => s.refs))];
  const status: Status = sentences.length === 0 ? "needs-input" : needs.length === 0 ? "answered" : "partial";
  return {
    id: q.id,
    category: q.category,
    question: q.text,
    status,
    answer: sentences.map(renderSentence).join(" "),
    refs,
    needs,
    overridden,
  };
}

export function answerAll(evidence: EvidenceFile, answers: AnswersFile): QuestionResult[] {
  return BANK.map((q) => answerQuestion(q, evidence, answers));
}

export interface Pending {
  key: string;
  prompt: string;
  /** Bank questions this answer would help with. */
  helps: string[];
}

/** Everything the user still has to supply, scan questions first, deduplicated, in bank order. */
export function pendingNeeds(evidence: EvidenceFile, results: QuestionResult[], answers: AnswersFile): Pending[] {
  const answered = new Set(answers.answers.map((a) => a.question));
  const map = new Map<string, Pending>();
  for (const u of evidence.unknowns) if (!answered.has(u.id)) map.set(u.id, { key: u.id, prompt: u.question, helps: [] });
  for (const r of results) {
    for (const n of r.needs) {
      if (answered.has(n.key)) continue;
      const p = map.get(n.key) ?? { key: n.key, prompt: n.prompt, helps: [] };
      p.helps.push(r.id);
      map.set(n.key, p);
    }
  }
  const unknownFirst = [...map.values()].sort((a, b) => Number(b.key.startsWith("UQ-")) - Number(a.key.startsWith("UQ-")));
  return unknownFirst;
}
