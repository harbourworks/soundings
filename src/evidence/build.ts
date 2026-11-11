import { createHash } from "node:crypto";
import {
  EvidenceFile,
  SCHEMA_VERSION,
  type ClaimType,
  type Confidence,
  type FactKind,
  type FindingRef,
  type Location,
  type ScanCoverage,
} from "./schema.js";

/**
 * Detectors hand over drafts without IDs. This module sorts them, derives stable IDs from
 * content, and returns a file that is identical from run to run apart from `generatedAt`.
 */

export interface FactDraft {
  kind: FactKind;
  subject: string;
  claim: string;
  claimType?: ClaimType;
  attributes?: Record<string, string | number | boolean | string[]>;
  confidence: Confidence;
  detector: string;
  /** Stable discriminator, usually the file the fact comes from. Never a line number. */
  key?: string;
  locations?: Location[];
}

export interface UnknownDraft {
  /** Lowercase slug; becomes `UQ-<key>`. */
  key: string;
  topic: string;
  question: string;
  why: string;
  /** Every fact with this kind and subject is linked. */
  related?: Array<{ kind: FactKind; subject: string }>;
}

export interface FindingDraft {
  ruleId: string;
  severity: FindingRef["severity"];
  location?: Location;
  related?: Array<{ kind: FactKind; subject: string }>;
}

export interface EvidenceInput {
  generatedAt: string;
  tool: { name: string; version: string };
  project: { name: string; languages?: string[]; frameworks?: string[] };
  scan: Omit<ScanCoverage, "unsupported"> & { unsupported?: ScanCoverage["unsupported"] };
  facts: FactDraft[];
  unknowns?: UnknownDraft[];
  findings?: FindingDraft[];
}

const ID_HEX = 8;

const hash = (s: string, len: number) => createHash("sha256").update(s).digest("hex").slice(0, len);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * IDs for items sorted by `preimage`. Items with an identical preimage get a numbered suffix in
 * their sorted order. If two different preimages ever share a short hash, the later one gets a
 * longer hash, so IDs never collide.
 */
function allocate(prefix: string, preimages: string[]): string[] {
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  return preimages.map((pre) => {
    const n = seen.get(pre) ?? 0;
    seen.set(pre, n + 1);
    const full = n === 0 ? pre : `${pre}#${n}`;
    for (let len = ID_HEX; len <= 12; len += 2) {
      const id = `${prefix}-${hash(full, len)}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
    throw new Error(`could not allocate a unique id for ${prefix}`);
  });
}

function sortedLocations(locs: Location[] | undefined): Location[] {
  const out = [...(locs ?? [])].sort((a, b) => cmp(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0));
  return out.filter((l, i) => i === 0 || l.file !== out[i - 1]!.file || l.line !== out[i - 1]!.line);
}

function canonicalAttributes(attrs: FactDraft["attributes"]): NonNullable<FactDraft["attributes"]> {
  const out: NonNullable<FactDraft["attributes"]> = {};
  for (const k of Object.keys(attrs ?? {}).sort()) {
    const v = attrs![k]!;
    out[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return out;
}

const factPre = (d: FactDraft) => `${d.kind}|${d.subject}|${d.detector}|${d.key ?? ""}`;

export function buildEvidence(input: EvidenceInput): EvidenceFile {
  const facts = input.facts
    .map((d) => ({ ...d, locations: sortedLocations(d.locations) }))
    .sort(
      (a, b) =>
        cmp(factPre(a), factPre(b)) ||
        cmp(a.locations[0]?.file ?? "", b.locations[0]?.file ?? "") ||
        (a.locations[0]?.line ?? 0) - (b.locations[0]?.line ?? 0),
    );
  const factIds = allocate("EV", facts.map(factPre));

  const idsFor = (related: Array<{ kind: FactKind; subject: string }> | undefined) =>
    facts
      .map((f, i) => ({ f, id: factIds[i]! }))
      .filter(({ f }) => (related ?? []).some((r) => r.kind === f.kind && r.subject === f.subject))
      .map(({ id }) => id)
      .sort();

  const findingsSorted = [...(input.findings ?? [])].sort(
    (a, b) => cmp(a.ruleId, b.ruleId) || cmp(a.location?.file ?? "", b.location?.file ?? "") || (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );
  const findingIds = allocate(
    "F",
    findingsSorted.map((f) => `${f.ruleId}|${f.location?.file ?? ""}`),
  );

  const file = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    tool: input.tool,
    containsSourceCode: false as const,
    project: {
      name: input.project.name,
      languages: [...(input.project.languages ?? [])].sort(),
      frameworks: [...(input.project.frameworks ?? [])].sort(),
    },
    scan: {
      ...input.scan,
      detectorsRun: [...input.scan.detectorsRun].sort(),
      detectorsSkipped: [...input.scan.detectorsSkipped].sort((a, b) => cmp(a.detector, b.detector)),
      unsupported: [...(input.scan.unsupported ?? [])].sort((a, b) => cmp(a.language, b.language)),
    },
    facts: facts.map((f, i) => ({
      id: factIds[i]!,
      kind: f.kind,
      subject: f.subject,
      claim: f.claim,
      claimType: f.claimType ?? "observed",
      attributes: canonicalAttributes(f.attributes),
      confidence: f.confidence,
      detector: f.detector,
      key: f.key ?? "",
      locations: f.locations,
    })),
    unknowns: [...(input.unknowns ?? [])]
      .sort((a, b) => cmp(a.key, b.key))
      .map((u) => ({
        id: `UQ-${u.key}`,
        topic: u.topic,
        question: u.question,
        why: u.why,
        relatedFacts: idsFor(u.related),
      })),
    findings: findingsSorted.map((f, i) => ({
      id: findingIds[i]!,
      ruleId: f.ruleId,
      severity: f.severity,
      ...(f.location ? { location: f.location } : {}),
      relatedFacts: idsFor(f.related),
    })),
  };
  return EvidenceFile.parse(file);
}

/** True when `file` is exactly what `buildEvidence` would write for the same content. */
export function isCanonical(file: EvidenceFile): boolean {
  const rebuilt = buildEvidence({
    generatedAt: file.generatedAt,
    tool: file.tool,
    project: file.project,
    scan: file.scan,
    facts: file.facts.map((f) => ({
      kind: f.kind,
      subject: f.subject,
      claim: f.claim,
      claimType: f.claimType,
      attributes: f.attributes,
      confidence: f.confidence,
      detector: f.detector,
      key: f.key,
      locations: f.locations,
    })),
    // Unknowns and findings are rebuilt from their own fields; related facts are checked by ID below.
    unknowns: file.unknowns.map((u) => ({
      key: u.id.slice(3),
      topic: u.topic,
      question: u.question,
      why: u.why,
    })),
    findings: file.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, ...(f.location ? { location: f.location } : {}) })),
  });
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).join(",");
  return ids(rebuilt.facts) === ids(file.facts) && ids(rebuilt.unknowns) === ids(file.unknowns) && ids(rebuilt.findings) === ids(file.findings);
}
