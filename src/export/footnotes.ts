import { extractRefs, replaceRefGroups } from "../evidence/refs.js";
import type { AnswersFile, EvidenceFile } from "../evidence/schema.js";

export interface FootnoteOptions {
  /** Include file paths and line numbers in the sources. Turn off for documents leaving the team. */
  locations: boolean;
}

/** Turns `[EV-3acc7131, A-001]` into `[^EV-3acc7131][^A-001]`. */
export const withFootnoteMarks = (text: string): string => replaceRefGroups(text, (ids) => ids.map((id) => `[^${id}]`).join(""));

/** The references used across some text, in the order they first appear. */
export function usedRefs(texts: string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const r of extractRefs(t)) seen.add(r.id);
  return [...seen];
}

/** One footnote definition per reference. The text is built from the source itself, never invented. */
export function footnoteLines(refs: string[], evidence: EvidenceFile, answers: AnswersFile, opts: FootnoteOptions): string[] {
  const facts = new Map(evidence.facts.map((f) => [f.id, f]));
  const findings = new Map(evidence.findings.map((f) => [f.id, f]));
  const given = new Map(answers.answers.map((a) => [a.id, a]));

  return refs.map((id) => {
    const f = facts.get(id);
    if (f) {
      const loc = f.locations[0];
      const where = opts.locations && loc ? ` (${loc.file}${loc.line ? `:${loc.line}` : ""})` : "";
      const how = f.claimType === "not-found" ? " Not found by the scan's pattern search." : f.confidence === "medium" ? " Inferred from the code." : "";
      return `[^${id}]: Code scan, ${f.subject}${where}: ${f.claim}${how}`;
    }
    const finding = findings.get(id);
    if (finding) return `[^${id}]: Seaworthy finding ${finding.ruleId} (${finding.severity}).`;
    const a = given.get(id);
    if (a) return `[^${id}]: Answer from the project team, recorded ${a.answeredAt.slice(0, 10)}.`;
    return `[^${id}]: Source not found.`;
  });
}
