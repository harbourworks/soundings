import { z } from "zod";

/**
 * Soundings evidence schema, v0.2.
 *
 * The evidence file is the contract between scanning and document writing. It must never contain
 * source code or secret values: only file paths, line numbers and short factual claims.
 * See docs/evidence-format.md and docs/SCHEMA-CHANGELOG.md.
 */

export const SCHEMA_VERSION = "0.2" as const;

/**
 * Fact and finding IDs are derived from content, not from position, so adding a fact never
 * renumbers the others. Answers and document footnotes therefore survive a re-scan.
 */
export const factId = z.string().regex(/^EV-[0-9a-f]{6,12}$/, "fact ids look like EV-3fa9c2d1");
export const findingId = z.string().regex(/^F-[0-9a-f]{6,12}$/, "finding ids look like F-3fa9c2d1");
/** Unknown IDs are readable slugs, so people can recognise the question they answered. */
export const unknownId = z.string().regex(/^UQ-[a-z0-9]+(?:-[a-z0-9]+)*$/, "unknown ids look like UQ-supabase-region");
/** Answers are written by the user, one at a time, and never renumbered. */
export const answerId = z.string().regex(/^A-\d{3,}$/, "answer ids look like A-001");

export const FactKind = z.enum([
  "ai_provider", // an AI model provider or SDK is used
  "third_party_service", // payments, analytics, email, error tracking, hosting...
  "data_flow", // user or customer data sent to a destination
  "data_store", // database, storage bucket, cache
  "auth", // how users or services authenticate
  "secret_handling", // where and how keys and secrets are kept
  "logging", // what is logged, and where
  "region", // where a service or store runs, when determinable
  "retention", // how long data is kept, when determinable
  "client_side_exposure", // anything sensitive reachable from browser code
]);
export type FactKind = z.infer<typeof FactKind>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

const Attribute = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const Location = z.object({
  /** Repo-relative path, forward slashes. */
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
});
export type Location = z.infer<typeof Location>;

/**
 * `observed`: the code states it. `not-found`: a pattern search came up empty, which is weaker
 * than the code stating the opposite, so it can never be `high`.
 */
export const ClaimType = z.enum(["observed", "not-found"]);
export type ClaimType = z.infer<typeof ClaimType>;

export const Fact = z
  .object({
    id: factId,
    kind: FactKind,
    /** The thing the fact is about, e.g. "OpenAI", "Supabase", "Stripe". */
    subject: z.string().min(1),
    /** One plain-English sentence. No code, no secret values. */
    claim: z.string().min(1).max(280),
    claimType: ClaimType.default("observed"),
    /**
     * Structured detail used by templates and the question bank. Conventional keys for the
     * subprocessor list: `purpose`, `dataCategories`, `region`.
     */
    attributes: z.record(z.string(), Attribute).default({}),
    confidence: Confidence,
    /** Detector that produced it, e.g. "ai-provider/openai-sdk". */
    detector: z.string().min(1),
    /** Stable discriminator the ID is derived from (usually a file path). Not a line number. */
    key: z.string().default(""),
    locations: z.array(Location).default([]),
  })
  .superRefine((fact, ctx) => {
    if (fact.claimType === "not-found" && fact.confidence === "high") {
      ctx.addIssue({
        code: "custom",
        message: `${fact.id}: a "not-found" claim can't be high confidence; absence of a pattern is not proof`,
      });
    }
  });
export type Fact = z.infer<typeof Fact>;

/** Something the code cannot tell us. Becomes a question for the user. */
export const Unknown = z.object({
  id: unknownId,
  topic: z.string().min(1),
  question: z.string().min(1),
  /** Why the code can't answer it, shown to the user. */
  why: z.string().min(1),
  relatedFacts: z.array(factId).default([]),
});
export type Unknown = z.infer<typeof Unknown>;

/** Optional reference to a Seaworthy finding, when Seaworthy is available. Citable as [F-...]. */
export const FindingRef = z.object({
  id: findingId,
  ruleId: z.string().regex(/^SW-[A-Z]\d{2}$/),
  severity: z.enum(["critical", "high", "medium", "low"]),
  location: Location.optional(),
  /** Facts this finding bears on, so a reader sees when a fact and a finding pull different ways. */
  relatedFacts: z.array(factId).default([]),
});
export type FindingRef = z.infer<typeof FindingRef>;

/** What the scan covered, so a missing fact can be told apart from "not checked". */
export const ScanCoverage = z.object({
  filesScanned: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
  detectorsRun: z.array(z.string()),
  detectorsSkipped: z.array(z.object({ detector: z.string().min(1), reason: z.string().min(1) })),
  /** Source code in languages Soundings doesn't read. What it does is not in this file. */
  unsupported: z.array(z.object({ language: z.string().min(1), files: z.number().int().positive() })).default([]),
});
export type ScanCoverage = z.infer<typeof ScanCoverage>;

export const EvidenceFile = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    tool: z.object({ name: z.string(), version: z.string() }),
    /** Hard privacy guard. A file that sets this to true is invalid. */
    containsSourceCode: z.literal(false),
    project: z.object({
      name: z.string().min(1),
      languages: z.array(z.string()).default([]),
      frameworks: z.array(z.string()).default([]),
    }),
    scan: ScanCoverage,
    facts: z.array(Fact),
    unknowns: z.array(Unknown).default([]),
    findings: z.array(FindingRef).default([]),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    for (const item of [...file.facts, ...file.unknowns, ...file.findings]) {
      if (ids.has(item.id)) ctx.addIssue({ code: "custom", message: `duplicate id ${item.id}` });
      ids.add(item.id);
    }
    const factIds = new Set(file.facts.map((f) => f.id));
    for (const u of file.unknowns) {
      for (const ref of u.relatedFacts) {
        if (!factIds.has(ref)) ctx.addIssue({ code: "custom", message: `${u.id} refers to missing fact ${ref}` });
      }
    }
    for (const f of file.findings) {
      for (const ref of f.relatedFacts) {
        if (!factIds.has(ref)) ctx.addIssue({ code: "custom", message: `${f.id} refers to missing fact ${ref}` });
      }
    }
  });
export type EvidenceFile = z.infer<typeof EvidenceFile>;

/** The user's answers to questions the code could not answer. Kept separate so evidence stays deterministic. */
export const Answer = z.object({
  id: answerId,
  /** Either an unknown id (UQ-...) or a profile key such as "profile.industry". */
  question: z.string().min(1),
  value: z.string().min(1),
  answeredAt: z.string().datetime(),
});
export type Answer = z.infer<typeof Answer>;

export const AnswersFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  answers: z.array(Answer),
});
export type AnswersFile = z.infer<typeof AnswersFile>;
