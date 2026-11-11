import { z } from "zod";
import { FactKind, type EvidenceFile } from "./schema.js";

/**
 * An answer key says what a scan of a fixture project must find, and what it must not.
 * Keys live outside the fixture app (fixtures/expected/<name>.json) so the answers never travel
 * with the app.
 */

const ExpectedFact = z.object({
  kind: FactKind,
  subject: z.string().min(1),
  detector: z.string().min(1),
  /** Matches the fact's `key` when given (usually the file it comes from). */
  key: z.string().optional(),
  /** Files the fact must point to. They must exist in the fixture. */
  files: z.array(z.string()).min(1),
  confidence: z.enum(["high", "medium", "low"]).optional(),
});

/** Something that looks like a fact if you only match words, but isn't. A scan must NOT report it. */
const Decoy = z.object({
  kind: FactKind,
  subject: z.string().min(1),
  /** A file in the fixture that contains the tempting text. */
  file: z.string().min(1),
  /** The tempting text itself, so a test can prove the decoy is really there. */
  contains: z.string().min(1),
  why: z.string().min(1),
});

export const AnswerKey = z.object({
  fixture: z.string().min(1),
  project: z.object({ languages: z.array(z.string()), frameworks: z.array(z.string()) }),
  facts: z.array(ExpectedFact),
  /** Unknown keys (without the `UQ-` prefix) the scan must raise. */
  unknowns: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  decoys: z.array(Decoy).min(1),
});
export type AnswerKey = z.infer<typeof AnswerKey>;

export interface KeyDiff {
  missing: string[];
  unexpected: string[];
  decoysReported: string[];
  missingUnknowns: string[];
  unexpectedUnknowns: string[];
}

const label = (kind: string, subject: string, detector: string, key?: string) =>
  `${kind} | ${subject} | ${detector}${key ? ` | ${key}` : ""}`;

/** Compares a scan result with its answer key. An empty diff means an exact match. */
export function diffAgainstKey(evidence: EvidenceFile, key: AnswerKey): KeyDiff {
  const matches = (f: EvidenceFile["facts"][number], e: AnswerKey["facts"][number]) =>
    f.kind === e.kind &&
    f.subject === e.subject &&
    f.detector === e.detector &&
    (e.key === undefined || f.key === e.key) &&
    (e.confidence === undefined || f.confidence === e.confidence);

  const missing = key.facts.filter((e) => !evidence.facts.some((f) => matches(f, e))).map((e) => label(e.kind, e.subject, e.detector, e.key));
  const unexpected = evidence.facts.filter((f) => !key.facts.some((e) => matches(f, e))).map((f) => label(f.kind, f.subject, f.detector, f.key));
  const decoysReported = key.decoys.filter((d) => evidence.facts.some((f) => f.kind === d.kind && f.subject === d.subject)).map((d) => `${d.kind} | ${d.subject}`);

  const have = new Set(evidence.unknowns.map((u) => u.id.slice(3)));
  const want = new Set(key.unknowns);
  return {
    missing,
    unexpected,
    decoysReported,
    missingUnknowns: [...want].filter((u) => !have.has(u)).sort(),
    unexpectedUnknowns: [...have].filter((u) => !want.has(u)).sort(),
  };
}

export const isExactMatch = (d: KeyDiff) => Object.values(d).every((xs) => xs.length === 0);
