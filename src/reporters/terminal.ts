import pc from "picocolors";
import type { EvidenceFile, Fact, FactKind } from "../evidence/schema.js";

const SECTIONS: Array<[FactKind, string]> = [
  ["ai_provider", "AI providers"],
  ["data_flow", "Data sent to other services"],
  ["third_party_service", "Third-party services"],
  ["data_store", "Where data is stored"],
  ["auth", "How users sign in"],
  ["secret_handling", "Keys and secrets"],
  ["logging", "Logging"],
  ["client_side_exposure", "Reachable from the browser"],
  ["region", "Regions"],
  ["retention", "Retention"],
];

function tag(f: Fact): string {
  if (f.claimType === "not-found") return pc.dim("[not found by the scan]");
  if (f.confidence === "high") return pc.green("[stated by the code]");
  if (f.confidence === "medium") return pc.yellow("[inferred]");
  return pc.red("[unconfirmed, needs your check]");
}

const where = (f: Fact) => {
  const l = f.locations[0];
  const more = f.locations.length > 1 ? ` (+${f.locations.length - 1} more)` : "";
  return l ? pc.dim(`${l.file}${l.line ? `:${l.line}` : ""}${more}`) : "";
};

export function renderTerminal(e: EvidenceFile, ms: number, evidencePath: string | null): string {
  const out: string[] = [];
  const stack = [...e.project.frameworks].join(", ");
  out.push("");
  out.push(`  ${pc.bold(`Soundings ${e.tool.version}`)}  ·  ${e.project.name}${stack ? `  ·  ${stack}` : ""}`);
  out.push(
    `  ${e.scan.filesScanned} files, ${e.scan.detectorsRun.length} detectors, ${ms} ms. ${pc.dim("Your code never left this machine.")}`,
  );

  if (e.scan.unsupported.length > 0) {
    const n = e.scan.unsupported.map((x) => `${x.files} ${x.language} file${x.files === 1 ? "" : "s"}`).join(", ");
    out.push("");
    out.push(`  ${pc.yellow("Not analysed:")} ${n}. Soundings reads JavaScript and TypeScript, so what that code does is not in this report.`);
  }

  if (e.facts.length === 0) {
    out.push("");
    out.push("  Nothing in the supported list was found. Soundings reads JavaScript and TypeScript projects");
    out.push("  (Next.js, Node/Express, Supabase, Firebase, Stripe and the main AI SDKs); anything else it");
    out.push("  reports as \"couldn't determine\".");
  }

  for (const [kind, title] of SECTIONS) {
    const facts = e.facts.filter((f) => f.kind === kind);
    if (facts.length === 0) continue;
    out.push("");
    out.push(`  ${pc.bold(title)}`);
    for (const f of facts) {
      out.push(`   ${pc.cyan(f.id)}  ${f.subject}  ${tag(f)}`);
      out.push(`     ${f.claim}`);
      const loc = where(f);
      if (loc) out.push(`     ${loc}`);
    }
  }

  if (e.findings.length > 0) {
    out.push("");
    out.push(`  ${pc.bold("Seaworthy findings")} ${pc.dim("(from the report you supplied)")}`);
    for (const f of e.findings) {
      const loc = f.location ? ` ${pc.dim(`${f.location.file}${f.location.line ? `:${f.location.line}` : ""}`)}` : "";
      out.push(`   ${pc.cyan(f.id)}  ${f.severity.toUpperCase()}  ${f.ruleId}${loc}`);
    }
  }

  if (e.unknowns.length > 0) {
    out.push("");
    out.push(`  ${pc.bold(`Only you can answer these (${e.unknowns.length})`)}`);
    for (const u of e.unknowns) {
      out.push(`   ${pc.cyan(u.id)}  ${u.question}`);
      out.push(`     ${pc.dim(u.why)}`);
    }
  }

  const skipped = e.scan.detectorsSkipped.length;
  out.push("");
  if (evidencePath) out.push(`  Evidence saved to ${evidencePath}. It holds paths, line numbers and short claims, never code or secrets.`);
  out.push(`  ${pc.dim(`${skipped} detector${skipped === 1 ? "" : "s"} skipped because their technology isn't in this project.`)}`);
  out.push(`  ${pc.dim("This is a draft record of what the code shows. It is not an audit or legal advice.")}`);
  out.push("");
  return out.join("\n");
}
