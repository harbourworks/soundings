import pc from "picocolors";
import type { VerifyReport } from "../verify/verify.js";
import type { FillResult } from "../import/fill.js";

export function renderVerify(report: VerifyReport, file: string): string {
  const out: string[] = [""];
  const errors = report.issues.filter((i) => i.severity === "error");
  const warnings = report.issues.filter((i) => i.severity === "warning");

  for (const i of report.issues) {
    const tag = i.severity === "error" ? pc.red("error  ") : pc.yellow("warning");
    out.push(`  ${tag} ${file}:${i.line}  ${pc.dim(i.code)}`);
    out.push(`    ${i.message}`);
    if (i.sentence) out.push(`    ${pc.dim(`"${i.sentence.length > 140 ? `${i.sentence.slice(0, 137)}...` : i.sentence}"`)}`);
    out.push("");
  }

  const summary = `${report.sentencesChecked} sentences checked, ${report.sentencesWithReferences} with references.`;
  if (report.ok) {
    out.push(`  ${pc.green("Passed.")} ${summary}${warnings.length ? ` ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.` : ""}`);
    out.push(`  ${pc.dim("Every statement points to a source that exists and mentions what the sentence mentions. That is not proof the source is right.")}`);
  } else {
    out.push(`  ${pc.red(`Failed: ${errors.length} problem${errors.length === 1 ? "" : "s"}.`)} ${summary}`);
  }
  out.push("");
  return out.join("\n");
}

export function renderFill(result: FillResult, outPath: string): string {
  const n = (s: string) => result.outcomes.filter((o) => o.status === s).length;
  const out: string[] = [""];
  out.push(`  ${pc.bold(`${result.outcomes.length} questions`)}: ${pc.green(`${n("answered")} answered`)}, ${pc.yellow(`${n("partial")} partly answered`)}, ${n("needs-input")} need your input, ${n("unmatched")} not matched, ${n("kept")} left as you had them.`);
  const unmatched = result.outcomes.filter((o) => o.status === "unmatched");
  if (unmatched.length > 0) {
    out.push("", `  ${pc.bold("Not matched (answer these by hand)")}`);
    for (const o of unmatched) out.push(`   row ${o.row}  ${o.question}`);
  }
  out.push("", `  Saved to ${outPath}.${result.answerColumnAdded ? ' A "Soundings answer" column was added.' : ""}`);
  out.push(`  ${pc.dim('Check the "Soundings match" column: it shows which standard question each row was matched to.')}`, "");
  return out.join("\n");
}
