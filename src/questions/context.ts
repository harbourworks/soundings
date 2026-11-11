import type { AnswersFile, EvidenceFile, FactKind } from "../evidence/schema.js";
import type { AnswerCtx } from "./types.js";

export function buildAnswerCtx(evidence: EvidenceFile, answers: AnswersFile): AnswerCtx {
  const byQuestion = new Map(answers.answers.map((a) => [a.question, a]));
  const byId = new Map(evidence.facts.map((f) => [f.id, f]));
  return {
    evidence,
    facts: (kind: FactKind) => evidence.facts.filter((f) => f.kind === kind && f.claimType === "observed"),
    absence: (kind, detector) => evidence.facts.find((f) => f.kind === kind && f.claimType === "not-found" && (!detector || f.detector === detector)),
    byDetector: (detector) => evidence.facts.filter((f) => f.detector === detector),
    answer: (key) => {
      const a = byQuestion.get(key);
      return a ? { id: a.id, value: a.value } : undefined;
    },
    unknownsWithTopic: (...topics) => evidence.unknowns.filter((u) => topics.includes(u.topic)),
    factById: (id) => byId.get(id),
  };
}
