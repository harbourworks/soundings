import { existsSync, readFileSync } from "node:fs";
import { EvidenceFile } from "../evidence/schema.js";
import { BANK } from "./bank.js";
import { PROFILE_KEYS } from "./profile.js";
import { AnswersError, loadAnswers, saveAnswers, setAnswer } from "./answers-file.js";
import { answerAll, pendingNeeds, type Pending, type QuestionResult } from "./engine.js";
import type { AnswersFile } from "../evidence/schema.js";
import { documentNeeds } from "../documents/build.js";

export class QuestionsError extends Error {}

export function loadEvidence(path: string): EvidenceFile {
  if (!existsSync(path)) throw new QuestionsError(`No evidence file at ${path}. Run "soundings scan" first.`);
  try {
    return EvidenceFile.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new QuestionsError(`Couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A key is valid if it names a scan question, a profile item, or an override for a bank question. */
export function checkKey(key: string, evidence: EvidenceFile): void {
  if (key.startsWith("UQ-")) {
    if (!evidence.unknowns.some((u) => u.id === key)) throw new QuestionsError(`${key} isn't a question in this evidence file. Run "soundings questions --list" to see them.`);
  } else if (key.startsWith("profile.")) {
    if (!PROFILE_KEYS.has(key)) throw new QuestionsError(`${key} isn't a known profile question.`);
  } else if (key.startsWith("override.")) {
    if (!BANK.some((b) => `override.${b.id}` === key)) throw new QuestionsError(`${key} doesn't match a question in the bank.`);
  } else {
    throw new QuestionsError(`"${key}" isn't a valid answer key. Use UQ-…, profile.… or override.<question-id>.`);
  }
}

export interface QuestionsState {
  results: QuestionResult[];
  pending: Pending[];
  /** Answers to scan questions that no longer appear in the evidence. They are kept, not deleted. */
  stale: string[];
}

export function stateOf(evidence: EvidenceFile, answers: AnswersFile, includeDocuments = false): QuestionsState {
  const results = answerAll(evidence, answers);
  const known = new Set(evidence.unknowns.map((u) => u.id));
  const stale = answers.answers.filter((a) => a.question.startsWith("UQ-") && !known.has(a.question)).map((a) => a.question);
  const pending = pendingNeeds(evidence, results, answers);
  if (includeDocuments) {
    const answered = new Set(answers.answers.map((a) => a.question));
    for (const n of documentNeeds(evidence, answers)) {
      if (answered.has(n.key)) continue;
      const existing = pending.find((p) => p.key === n.key);
      if (existing) existing.helps.push("documents");
      else pending.push({ key: n.key, prompt: n.prompt, helps: ["documents"] });
    }
  }
  return { results, pending, stale };
}

export interface RunOptions {
  evidencePath: string;
  answersPath: string;
  now: Date;
  /** Also ask what the documents need. */
  documents?: boolean;
  /** Answers given on the command line, applied before anything is asked. */
  set: Array<[string, string]>;
  /** Asks one question. Returns null to stop, "" to skip. Absent when nobody can answer (piped input, CI). */
  ask?: (pending: Pending, index: number, total: number) => Promise<string | null>;
}

export interface RunOutcome {
  state: QuestionsState;
  saved: string[];
  rejected: Array<{ key: string; reason: string }>;
}

/** Applies `--set` answers, then asks the rest one at a time, saving after each so nothing is lost. */
export async function runQuestions(opts: RunOptions): Promise<RunOutcome> {
  const evidence = loadEvidence(opts.evidencePath);
  let answers = loadAnswers(opts.answersPath);
  const saved: string[] = [];
  const rejected: Array<{ key: string; reason: string }> = [];

  const apply = (key: string, value: string) => {
    checkKey(key, evidence);
    answers = setAnswer(answers, key, value, opts.now);
    saveAnswers(opts.answersPath, answers);
    saved.push(key);
  };

  for (const [key, value] of opts.set) apply(key, value);

  if (opts.ask) {
    const pending = stateOf(evidence, answers, opts.documents).pending;
    for (let i = 0; i < pending.length; i++) {
      const reply = await opts.ask(pending[i]!, i, pending.length);
      if (reply === null) break;
      if (reply.trim() === "") continue;
      try {
        apply(pending[i]!.key, reply);
      } catch (err) {
        // A refused answer (for example one that looks like a secret) is reported, and the rest carry on.
        if (!(err instanceof AnswersError)) throw err;
        rejected.push({ key: pending[i]!.key, reason: err.message });
      }
    }
  }
  return { state: stateOf(evidence, answers, opts.documents), saved, rejected };
}
