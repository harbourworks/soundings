import pc from "picocolors";
import type { QuestionsState } from "../questions/flow.js";
import { BANK } from "../questions/bank.js";

export function renderQuestionsSummary(state: QuestionsState, answersPath: string, saved: string[]): string {
  const { results, pending, stale } = state;
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const out: string[] = [""];
  if (saved.length) out.push(`  Saved ${saved.length} answer${saved.length === 1 ? "" : "s"} to ${answersPath}.`, "");
  out.push(
    `  ${pc.bold(`${results.length} questions`)}: ${pc.green(`${count("answered")} answered`)}, ${pc.yellow(`${count("partial")} partly answered`)}, ${count("needs-input")} need your input.`,
  );

  if (pending.length > 0) {
    out.push("", `  ${pc.bold(`Still to answer (${pending.length})`)}`);
    for (const p of pending) {
      const helps = p.helps.length ? pc.dim(` helps with ${p.helps.length} question${p.helps.length === 1 ? "" : "s"}`) : "";
      out.push(`   ${pc.cyan(p.key)}  ${p.prompt}${helps}`);
    }
    out.push("", `  ${pc.dim('Answer with: soundings questions --set <key>="your answer"   (or run it in a terminal and answer as asked)')}`);
  } else {
    out.push("", "  Nothing left to ask.");
  }

  if (stale.length > 0) {
    out.push("", `  ${pc.dim(`Kept but no longer asked by the scan: ${stale.join(", ")}`)}`);
  }
  out.push("", `  ${pc.dim(`${BANK.length} questions in the bank. Answers live in ${answersPath} and are reused for every questionnaire.`)}`, "");
  return out.join("\n");
}
