import type { AnswersFile, EvidenceFile } from "../evidence/schema.js";
import type { QuestionResult } from "../questions/engine.js";
import { CATEGORY_LABELS, type Category } from "../questions/types.js";
import { footnoteLines, usedRefs, withFootnoteMarks, type FootnoteOptions } from "./footnotes.js";
import { DRAFT_NOTICE, NEEDS_INPUT } from "./notice.js";

const ORDER: Category[] = ["ai", "data", "access", "keys", "logging", "suppliers", "organisation"];

export interface QuestionnaireOptions extends FootnoteOptions {
  project: string;
}

/** The bank answers as a Markdown document with numbered sources. */
export function renderQuestionnaireMarkdown(results: QuestionResult[], evidence: EvidenceFile, answers: AnswersFile, opts: QuestionnaireOptions): string {
  const out: string[] = [];
  out.push(`# Security and data handling answers: ${opts.project}`, "", `> ${DRAFT_NOTICE}`, "");

  const done = results.filter((r) => r.status === "answered").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const open = results.length - done - partial;
  out.push(`${done} of ${results.length} questions are answered from evidence. ${partial} are partly answered and ${open} need input from the project team.`, "");

  for (const category of ORDER) {
    const inCategory = results.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    out.push(`## ${CATEGORY_LABELS[category]}`, "");
    for (const r of inCategory) {
      out.push(`### ${r.question}`, "");
      if (r.answer) out.push(withFootnoteMarks(r.answer), "");
      if (r.status !== "answered") {
        const asks = r.needs.map((n) => n.prompt);
        out.push(`**${NEEDS_INPUT}**${asks.length ? ` ${asks.join(" ")}` : ""}`, "");
      }
    }
  }

  const refs = usedRefs(results.map((r) => r.answer));
  if (refs.length > 0) {
    out.push("## Sources", "", ...footnoteLines(refs, evidence, answers, opts), "");
  }
  return out.join("\n");
}
