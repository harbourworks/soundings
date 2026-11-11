import { buildEvidence, type FactDraft, type FindingDraft, type UnknownDraft } from "../evidence/build.js";
import { assertNoLeaks, createGuard, loadEnvValues } from "../evidence/redact.js";
import type { EvidenceFile } from "../evidence/schema.js";
import { ProjectFiles } from "../core/project.js";
import { excluder, walk } from "../core/walk.js";
import { VERSION } from "../version.js";
import { buildContext } from "./context.js";
import { describeUnsupported, isSignificant, unsupportedCode } from "./coverage.js";
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

/** How many locations one merged fact lists. Enough to find it; the report isn't a file index. */
const MAX_LOCATIONS = 10;

/**
 * One fact per thing found, not one per file: eight files importing the same sign-in library are
 * one fact with eight locations. Facts merge only when everything but where they were found is
 * identical, so nothing different is ever folded together.
 */
export function mergeFacts(facts: FactDraft[]): FactDraft[] {
  const groups = new Map<string, FactDraft[]>();
  for (const f of facts) {
    const attrs = JSON.stringify(Object.entries(f.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const id = [f.kind, f.subject, f.detector, f.claim, f.claimType ?? "observed", f.confidence, attrs].join("|");
    groups.set(id, [...(groups.get(id) ?? []), f]);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const sorted = [...group].sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""));
    const locations = sorted.flatMap((f) => f.locations ?? []);
    return { ...sorted[0]!, locations: locations.slice(0, MAX_LOCATIONS) };
  });
}

function unanalysedQuestion(unsupported: ReturnType<typeof unsupportedCode>): UnknownDraft {
  return {
    key: "unanalysed-code",
    topic: "Code not analysed",
    question: `This project also contains ${describeUnsupported(unsupported)}, which Soundings doesn't read. What AI services, databases, sign-in methods and logging do those parts use?`,
    why: "Soundings reads JavaScript and TypeScript only, so what the other code does is not in this scan.",
  };
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
  const unsupported = unsupportedCode(files);
  const unanalysed = isSignificant(unsupported);
  if (!unanalysed) {
    for (const a of absences(facts)) {
      detectorsRun.push(a.detector);
      facts.push(a);
    }
  }

  const merged = mergeFacts(facts);
  const findings: FindingDraft[] = opts.seaworthy === undefined ? [] : readSeaworthyReport(opts.seaworthy, merged);
  const info = projectInfo(ctx, opts.root);

  const evidence = buildEvidence({
    generatedAt: (opts.now ?? new Date()).toISOString(),
    tool: { name: "soundings", version: VERSION },
    project: info,
    scan: { filesScanned: files.length, filesSkipped: skippedLarge.length, detectorsRun, detectorsSkipped, unsupported },
    facts: merged,
    unknowns: [...unknownsFor(merged, unanalysed), ...(unanalysed ? [unanalysedQuestion(unsupported)] : [])],
    findings,
  });

  assertNoLeaks(JSON.stringify(evidence), createGuard(loadEnvValues(opts.root)), "evidence file");
  return { evidence, ms: Date.now() - started };
}
