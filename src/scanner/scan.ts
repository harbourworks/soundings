import { buildEvidence, type FactDraft, type FindingDraft } from "../evidence/build.js";
import { assertNoLeaks, createGuard, loadEnvValues } from "../evidence/redact.js";
import type { EvidenceFile } from "../evidence/schema.js";
import { ProjectFiles } from "../core/project.js";
import { excluder, walk } from "../core/walk.js";
import { VERSION } from "../version.js";
import { buildContext } from "./context.js";
import { DETECTORS } from "./detectors/index.js";
import { projectInfo } from "./project-info.js";
import { unknownsFor } from "./unknowns.js";
import { readSeaworthyReport } from "./seaworthy.js";

const ABSENCES: Array<{ kind: FactDraft["kind"]; subject: string; detector: string; claim: string }> = [
  { kind: "ai_provider", subject: "No AI provider found", detector: "ai-provider/none-found", claim: "No AI provider SDK from the supported list was found in the project's dependencies or code." },
  { kind: "data_store", subject: "No database found", detector: "data-store/none-found", claim: "No database client or migrations from the supported list were found in the project." },
  { kind: "auth", subject: "No sign-in found", detector: "auth/none-found", claim: "No sign-in library or provider call from the supported list was found in the project." },
];

function absences(found: FactDraft[]): FactDraft[] {
  return ABSENCES.filter((a) => !found.some((f) => f.kind === a.kind && f.claimType !== "not-found")).map((a) => ({
    kind: a.kind,
    subject: a.subject,
    claim: a.claim,
    claimType: "not-found" as const,
    confidence: "medium" as const,
    detector: a.detector,
    key: "project",
  }));
}

export interface ScanOptions {
  root: string;
  /** Extra ignore patterns, from the config file. */
  ignore?: string[];
  /** Parsed `seaworthy --format json` output, if the user supplied one. */
  seaworthy?: unknown;
  now?: Date;
}

export interface ScanOutcome {
  evidence: EvidenceFile;
  ms: number;
}

/**
 * Scans a project folder and returns its evidence. Local only: it reads files and makes no
 * network calls. Before returning, the evidence is checked against the project's own .env values
 * and known secret formats, and the scan fails loudly if anything secret got in.
 */
export function scan(opts: ScanOptions): ScanOutcome {
  const started = Date.now();
  const { files, skippedLarge } = walk(opts.root, opts.ignore ?? []);
  const project = new ProjectFiles(opts.root, files, excluder(opts.ignore ?? []));
  const ctx = buildContext(project);

  const detectorsRun: string[] = [];
  const detectorsSkipped: Array<{ detector: string; reason: string }> = [];
  const facts: FactDraft[] = [];
  for (const d of DETECTORS) {
    const reason = d.skipReason(ctx);
    if (reason) {
      detectorsSkipped.push({ detector: d.id, reason });
      continue;
    }
    detectorsRun.push(d.id);
    facts.push(...d.run(ctx));
  }

  // Absence is reported too, so a later answer ("we don't use AI") has something honest to cite.
  // These are "not found" facts at medium confidence: the supported list is all the scan can rule out.
  for (const a of absences(facts)) {
    detectorsRun.push(a.detector);
    facts.push(a);
  }

  const findings: FindingDraft[] = opts.seaworthy === undefined ? [] : readSeaworthyReport(opts.seaworthy, facts);
  const info = projectInfo(ctx, opts.root);

  const evidence = buildEvidence({
    generatedAt: (opts.now ?? new Date()).toISOString(),
    tool: { name: "soundings", version: VERSION },
    project: info,
    scan: { filesScanned: files.length, filesSkipped: skippedLarge.length, detectorsRun, detectorsSkipped },
    facts,
    unknowns: unknownsFor(facts),
    findings,
  });

  assertNoLeaks(JSON.stringify(evidence), createGuard(loadEnvValues(opts.root)), "evidence file");
  return { evidence, ms: Date.now() - started };
}
