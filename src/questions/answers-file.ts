import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AnswersFile, SCHEMA_VERSION } from "../evidence/schema.js";
import { findLeaks } from "../evidence/redact.js";

export class AnswersError extends Error {}

export const emptyAnswers = (): AnswersFile => ({ schemaVersion: SCHEMA_VERSION, answers: [] });

export function loadAnswers(path: string): AnswersFile {
  if (!existsSync(path)) return emptyAnswers();
  try {
    return AnswersFile.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new AnswersError(`Couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function saveAnswers(path: string, file: AnswersFile): void {
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
}

/**
 * Records an answer. A new question gets the next A-number; re-answering keeps the same ID, so
 * documents that already cite it stay valid. Values that look like secrets are refused: an
 * answer ends up in documents sent to clients.
 */
export function setAnswer(file: AnswersFile, question: string, value: string, now: Date): AnswersFile {
  const text = value.trim();
  if (text.length === 0) throw new AnswersError("An answer can't be empty.");
  if (findLeaks(text).length > 0) {
    throw new AnswersError("That answer looks like it contains a secret (a key, token or password). Answers go into documents, so describe it instead of pasting it.");
  }
  const existing = file.answers.find((a) => a.question === question);
  if (existing) {
    return {
      ...file,
      answers: file.answers.map((a) => (a === existing ? { ...a, value: text, answeredAt: now.toISOString() } : a)),
    };
  }
  const next = file.answers.reduce((max, a) => Math.max(max, Number(a.id.slice(2))), 0) + 1;
  const id = `A-${String(next).padStart(3, "0")}`;
  return { ...file, answers: [...file.answers, { id, question, value: text, answeredAt: now.toISOString() }] };
}
