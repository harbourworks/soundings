import type { EvidenceFile, Fact, FactKind, Unknown } from "../evidence/schema.js";

/**
 * A sentence in an answer, with the evidence or answers it rests on. A sentence with no
 * references is a bug, not a style choice: the engine refuses to build one.
 */
export interface Sentence {
  text: string;
  refs: string[];
}

/** Something only the user can supply: an `UQ-…` question from the scan, or a `profile.…` item. */
export interface Need {
  key: string;
  prompt: string;
}

export interface Draft {
  sentences: Sentence[];
  needs: Need[];
}

export type Category = "ai" | "data" | "access" | "keys" | "logging" | "suppliers" | "organisation";

export const CATEGORY_LABELS: Record<Category, string> = {
  ai: "AI use",
  data: "Data handling",
  access: "Access control",
  keys: "Key management",
  logging: "Logging and monitoring",
  suppliers: "Suppliers and subprocessors",
  organisation: "Organisation and incident response",
};

export interface BankQuestion {
  id: string;
  category: Category;
  /** The canonical wording. */
  text: string;
  /** Words and phrases that identify this question in a client's own questionnaire. */
  keywords: string[];
  build(ctx: AnswerCtx): Draft;
}

export interface UserAnswer {
  id: string;
  value: string;
}

export interface AnswerCtx {
  evidence: EvidenceFile;
  /** Facts the code states, or infers. Never "not found" facts. */
  facts(kind: FactKind): Fact[];
  /** The "not found" fact for a kind, if the scan produced one. */
  absence(kind: FactKind, detector?: string): Fact | undefined;
  /** The single fact from a given detector, if any (observed or not found). */
  byDetector(detector: string): Fact[];
  answer(key: string): UserAnswer | undefined;
  unknownsWithTopic(...topics: string[]): Unknown[];
  factById(id: string): Fact | undefined;
}
