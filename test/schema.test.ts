import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EvidenceFile, AnswersFile, SCHEMA_VERSION } from "../src/evidence/schema.js";
import { isCanonical } from "../src/evidence/build.js";
import { VERSION } from "../src/version.js";

const example = JSON.parse(readFileSync(resolve(__dirname, "../examples/acme-notes.evidence.json"), "utf8"));
const clone = () => structuredClone(example) as typeof example;

describe("example evidence file", () => {
  it("validates against the schema", () => {
    expect(EvidenceFile.safeParse(example).success).toBe(true);
    expect(example.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("is canonical: IDs and order are exactly what the builder produces", () => {
    expect(isCanonical(EvidenceFile.parse(example))).toBe(true);
  });

  it("rejects a file that says it contains source code", () => {
    const bad = clone();
    bad.containsSourceCode = true;
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const bad = clone();
    bad.facts[1].id = bad.facts[0].id;
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown that points at a missing fact", () => {
    const bad = clone();
    bad.unknowns[0].relatedFacts = ["EV-00000000"];
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("rejects a finding that points at a missing fact", () => {
    const bad = clone();
    bad.findings[0].relatedFacts = ["EV-00000000"];
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("rejects a high-confidence not-found claim", () => {
    const bad = clone();
    const f = bad.facts.find((x: { claimType: string }) => x.claimType === "not-found");
    f.confidence = "high";
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("rejects position-based ids, which would renumber when facts are added", () => {
    const bad = clone();
    bad.facts[0].id = "EV-001";
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("rejects a fact claim over 280 characters", () => {
    const bad = clone();
    bad.facts[0].claim = "x".repeat(281);
    expect(EvidenceFile.safeParse(bad).success).toBe(false);
  });

  it("records what the scan covered", () => {
    const parsed = EvidenceFile.parse(example);
    expect(parsed.scan.detectorsRun.length).toBeGreaterThan(0);
    expect(parsed.scan.detectorsSkipped[0]?.reason).toBeTruthy();
  });
});

describe("answers file", () => {
  it("accepts answers keyed by unknown id", () => {
    const ok = AnswersFile.safeParse({
      schemaVersion: SCHEMA_VERSION,
      answers: [{ id: "A-001", question: "UQ-supabase-region", value: "London (eu-west-2)", answeredAt: "2026-11-11T12:00:00Z" }],
    });
    expect(ok.success).toBe(true);
  });
});

describe("package", () => {
  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
