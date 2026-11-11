import { describe, expect, it } from "vitest";
import { buildEvidence, type EvidenceInput, type FactDraft } from "../src/evidence/build.js";

const base = (facts: FactDraft[], extra: Partial<EvidenceInput> = {}): EvidenceInput => ({
  generatedAt: "2026-11-11T11:30:00Z",
  tool: { name: "soundings", version: "0.0.1" },
  project: { name: "demo" },
  scan: { filesScanned: 1, filesSkipped: 0, detectorsRun: [], detectorsSkipped: [] },
  facts,
  ...extra,
});

const openai: FactDraft = {
  kind: "ai_provider",
  subject: "OpenAI",
  claim: "The app calls OpenAI.",
  confidence: "high",
  detector: "ai-provider/openai-sdk",
  key: "a.ts",
  locations: [{ file: "a.ts", line: 3 }],
};
const stripe: FactDraft = {
  kind: "third_party_service",
  subject: "Stripe",
  claim: "Payments use Stripe.",
  confidence: "high",
  detector: "third-party/stripe",
  key: "b.ts",
  locations: [{ file: "b.ts", line: 9 }],
};
const supabase: FactDraft = {
  kind: "data_store",
  subject: "Supabase Postgres",
  claim: "Data is stored in Supabase.",
  confidence: "high",
  detector: "data-store/supabase",
  key: "c.sql",
  locations: [{ file: "c.sql", line: 1 }],
};

const idOf = (file: ReturnType<typeof buildEvidence>, subject: string) => file.facts.find((f) => f.subject === subject)!.id;

describe("buildEvidence", () => {
  it("is deterministic regardless of input order", () => {
    const a = buildEvidence(base([openai, stripe, supabase]));
    const b = buildEvidence(base([supabase, openai, stripe]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps existing ids stable when a fact is added", () => {
    const before = buildEvidence(base([openai, stripe]));
    const after = buildEvidence(base([openai, stripe, supabase]));
    expect(idOf(after, "OpenAI")).toBe(idOf(before, "OpenAI"));
    expect(idOf(after, "Stripe")).toBe(idOf(before, "Stripe"));
  });

  it("keeps ids stable when a line number moves", () => {
    const moved = { ...openai, locations: [{ file: "a.ts", line: 40 }] };
    expect(idOf(buildEvidence(base([moved])), "OpenAI")).toBe(idOf(buildEvidence(base([openai])), "OpenAI"));
  });

  it("gives two facts with the same key different ids", () => {
    const twin: FactDraft = { ...openai, locations: [{ file: "a.ts", line: 90 }] };
    const file = buildEvidence(base([openai, twin]));
    expect(new Set(file.facts.map((f) => f.id)).size).toBe(2);
  });

  it("derives unknown ids from the question key and links related facts", () => {
    const file = buildEvidence(
      base([supabase], {
        unknowns: [
          {
            key: "supabase-region",
            topic: "Region",
            question: "Where?",
            why: "Dashboard setting.",
            related: [{ kind: "data_store", subject: "Supabase Postgres" }],
          },
        ],
      }),
    );
    expect(file.unknowns[0]?.id).toBe("UQ-supabase-region");
    expect(file.unknowns[0]?.relatedFacts).toEqual([idOf(file, "Supabase Postgres")]);
  });

  it("sorts attributes and string lists so output does not depend on detector order", () => {
    const x = buildEvidence(base([{ ...openai, attributes: { b: ["z", "a"], a: 1 } }]));
    expect(Object.keys(x.facts[0]!.attributes)).toEqual(["a", "b"]);
    expect(x.facts[0]!.attributes.b).toEqual(["a", "z"]);
  });

  it("refuses a high-confidence not-found fact", () => {
    expect(() => buildEvidence(base([{ ...openai, claimType: "not-found" }]))).toThrow();
  });
});
