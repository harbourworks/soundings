import { z } from "zod";
import type { FactDraft, FindingDraft } from "../evidence/build.js";

/** The part of `seaworthy --format json` that Soundings reads. */
const SeaworthyReport = z.object({
  findings: z.array(
    z.object({
      ruleId: z.string().regex(/^SW-[A-Z]\d{2}$/),
      severity: z.enum(["critical", "high", "medium", "low"]),
      file: z.string().optional(),
      line: z.number().int().positive().optional(),
    }),
  ),
});

/** Which kinds of fact a Seaworthy rule family bears on, so conflicts are visible. */
const RELATED_KINDS: Record<string, FactDraft["kind"][]> = {
  D: ["data_store"],
  S: ["secret_handling", "client_side_exposure"],
  A: ["auth"],
  P: ["third_party_service"],
  L: ["ai_provider", "data_flow"],
};

export function readSeaworthyReport(json: unknown, facts: FactDraft[]): FindingDraft[] {
  const report = SeaworthyReport.parse(json);
  return report.findings.map((f) => {
    const kinds = RELATED_KINDS[f.ruleId[3]!] ?? [];
    const related = [...new Map(facts.filter((x) => kinds.includes(x.kind)).map((x) => [`${x.kind}|${x.subject}`, { kind: x.kind, subject: x.subject }])).values()];
    return {
      ruleId: f.ruleId,
      severity: f.severity,
      ...(f.file ? { location: { file: f.file, ...(f.line ? { line: f.line } : {}) } } : {}),
      related,
    };
  });
}
