import type { AnswersFile, EvidenceFile } from "../evidence/schema.js";
import { footnoteLines } from "../export/footnotes.js";
import { answerQuestion, type QuestionResult } from "../questions/engine.js";
import { detectDelimiter, parseCsv, writeCsv } from "./csv.js";
import { bestMatch } from "./match.js";

export type RowStatus = "answered" | "partial" | "needs-input" | "unmatched" | "kept";

export interface RowOutcome {
  /** 1-based row number in the file, header included. */
  row: number;
  question: string;
  status: RowStatus;
  matched?: { id: string; score: number };
}

export interface FillResult {
  csv: string;
  outcomes: RowOutcome[];
  /** Columns used, 0-based, and whether the answer column was added. */
  questionColumn: number;
  answerColumn: number;
  answerColumnAdded: boolean;
}

export class ImportError extends Error {}

const QUESTION_HEADER = /question|requirement|control|query|statement|description/i;
const ANSWER_HEADER = /answer|response|reply|supplier|vendor/i;

function pickColumns(header: string[], body: string[][]): { question: number; answer: number | null } {
  let question = header.findIndex((h) => QUESTION_HEADER.test(h));
  if (question < 0) {
    // No obvious header: the question column is where the longest text is.
    const avg = header.map((_, c) => body.reduce((sum, r) => sum + (r[c]?.length ?? 0), 0) / Math.max(body.length, 1));
    question = avg.indexOf(Math.max(...avg));
  }
  const answer = header.findIndex((h, c) => c !== question && ANSWER_HEADER.test(h));
  return { question, answer: answer >= 0 ? answer : null };
}

function sourceSummary(refs: string[], evidence: EvidenceFile, answers: AnswersFile): string {
  return footnoteLines(refs, evidence, answers, { locations: true })
    .map((l) => l.replace(/^\[\^([^\]]+)\]:\s*/, "$1: "))
    .join("; ");
}

function cell(r: QuestionResult): string {
  const asks = r.needs.map((n) => n.prompt).join(" ");
  if (r.status === "answered") return r.answer;
  if (r.status === "partial") return `${r.answer} NEEDS YOUR INPUT: ${asks}`;
  return `NEEDS YOUR INPUT: ${asks}`;
}

/**
 * Fills a client's questionnaire from the question bank. Rows that clearly match a standard
 * question get its answer; everything else is marked "needs your input" and listed, never guessed.
 * A cell the client already filled is left alone.
 */
export function fillQuestionnaire(text: string, evidence: EvidenceFile, answers: AnswersFile): FillResult {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) throw new ImportError("The file needs a header row and at least one question.");

  const header = rows[0]!;
  const body = rows.slice(1);
  const { question: qCol, answer: foundAnswerCol } = pickColumns(header, body);
  const addedAnswer = foundAnswerCol === null;
  const aCol = foundAnswerCol ?? header.length;
  const width = Math.max(header.length, aCol + 1);
  const sourcesCol = addedAnswer ? aCol + 1 : width;
  const matchCol = sourcesCol + 1;

  const out: string[][] = [];
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
  const headRow = pad(header);
  if (addedAnswer) headRow[aCol] = "Soundings answer";
  headRow[sourcesCol] = "Soundings sources";
  headRow[matchCol] = "Soundings match";
  out.push(headRow);

  const outcomes: RowOutcome[] = [];
  body.forEach((raw, i) => {
    const r = pad(raw);
    const question = (r[qCol] ?? "").trim();
    r[sourcesCol] = "";
    r[matchCol] = "";
    const rowNumber = i + 2;
    if (question === "") {
      out.push(r);
      return;
    }
    if ((r[aCol] ?? "").trim() !== "") {
      outcomes.push({ row: rowNumber, question, status: "kept" });
      r[matchCol] = "kept: already answered";
      out.push(r);
      return;
    }

    const match = bestMatch(question);
    if (!match) {
      r[aCol] = "NEEDS YOUR INPUT: no standard question clearly matches this one, so it has not been answered.";
      r[matchCol] = "no match";
      outcomes.push({ row: rowNumber, question, status: "unmatched" });
      out.push(r);
      return;
    }
    const result = answerQuestion(match.question, evidence, answers);
    r[aCol] = cell(result);
    r[sourcesCol] = sourceSummary(result.refs, evidence, answers);
    r[matchCol] = `${match.question.id} (${match.score.toFixed(2)})`;
    outcomes.push({ row: rowNumber, question, status: result.status, matched: { id: match.question.id, score: match.score } });
    out.push(r);
  });

  return { csv: writeCsv(out, delimiter), outcomes, questionColumn: qCol, answerColumn: aCol, answerColumnAdded: addedAnswer };
}
