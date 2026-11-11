import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AnswerKey, diffAgainstKey, isExactMatch } from "../src/evidence/answer-key.js";
import { buildEvidence, type FactDraft } from "../src/evidence/build.js";
import { createGuard, findLeaks } from "../src/evidence/redact.js";

const ROOT = resolve(__dirname, "../fixtures");
const keyFiles = readdirSync(join(ROOT, "expected")).filter((f) => f.endsWith(".json"));

const walkFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });

/** What a perfect scan would produce, built from the key itself. */
function perfectScan(key: AnswerKey) {
  const facts: FactDraft[] = key.facts.map((e) => ({
    kind: e.kind,
    subject: e.subject,
    claim: `Expected: ${e.subject}.`,
    confidence: e.confidence ?? "high",
    detector: e.detector,
    key: e.key ?? "",
    locations: e.files.map((file) => ({ file })),
  }));
  return {
    generatedAt: "2026-11-11T11:30:00Z",
    tool: { name: "soundings", version: "0.0.1" },
    project: { name: key.fixture, ...key.project },
    scan: { filesScanned: 1, filesSkipped: 0, detectorsRun: [], detectorsSkipped: [] },
    facts,
    unknowns: key.unknowns.map((u) => ({ key: u, topic: u, question: `${u}?`, why: "test" })),
  };
}

it("has the four planned fixtures", () => {
  expect([...keyFiles].sort()).toEqual(["express-pg.json", "fastapi-rag.json", "notes-saas.json", "static-site.json"]);
});

describe.each(keyFiles)("answer key %s", (file) => {
  const key = AnswerKey.parse(JSON.parse(readFileSync(join(ROOT, "expected", file), "utf8")));
  const appDir = join(ROOT, "apps", key.fixture);

  it("belongs to a fixture app that exists", () => {
    expect(existsSync(appDir)).toBe(true);
    expect(file).toBe(`${key.fixture}.json`);
  });

  it("points only at files that exist in the fixture", () => {
    for (const f of key.facts) for (const p of f.files) expect(existsSync(join(appDir, p)), p).toBe(true);
  });

  it("has decoys that are really in the fixture", () => {
    for (const d of key.decoys) {
      const p = join(appDir, d.file);
      expect(existsSync(p), d.file).toBe(true);
      expect(readFileSync(p, "utf8"), `${d.file} should contain ${d.contains}`).toContain(d.contains);
    }
  });

  it("never lists a decoy as an expected fact", () => {
    for (const d of key.decoys) {
      expect(key.facts.some((f) => f.kind === d.kind && f.subject === d.subject), `${d.kind} ${d.subject}`).toBe(false);
    }
  });

  it("round-trips through the evidence schema with an empty diff", () => {
    const built = buildEvidence(perfectScan(key));
    expect(isExactMatch(diffAgainstKey(built, key))).toBe(true);
  });

  it("reports a missing fact", () => {
    const input = perfectScan(key);
    const built = buildEvidence({ ...input, facts: input.facts.slice(1) });
    expect(diffAgainstKey(built, key).missing).toHaveLength(1);
  });

  it("reports an unexpected fact", () => {
    const input = perfectScan(key);
    const extra: FactDraft = { kind: "auth", subject: "Imaginary SSO", claim: "x", confidence: "high", detector: "auth/imaginary", key: "z" };
    const built = buildEvidence({ ...input, facts: [...input.facts, extra] });
    expect(diffAgainstKey(built, key).unexpected).toHaveLength(1);
  });

  it("reports every decoy a scan wrongly reports", () => {
    const input = perfectScan(key);
    const decoyFacts: FactDraft[] = key.decoys.map((d) => ({
      kind: d.kind,
      subject: d.subject,
      claim: "x",
      confidence: "high",
      detector: "test/decoy",
      key: d.file,
    }));
    const built = buildEvidence({ ...input, facts: [...input.facts, ...decoyFacts] });
    expect(diffAgainstKey(built, key).decoysReported).toHaveLength(key.decoys.length);
  });

  it("reports missing and unexpected unknowns", () => {
    const input = perfectScan(key);
    const unknowns = [...input.unknowns.slice(1), { key: "surprise", topic: "t", question: "q?", why: "w" }];
    const d = diffAgainstKey(buildEvidence({ ...input, unknowns }), key);
    expect(d.missingUnknowns).toHaveLength(1);
    expect(d.unexpectedUnknowns).toEqual(["surprise"]);
  });
});

describe("fixtures stay clean", () => {
  it("contain no key-shaped secrets", () => {
    for (const p of walkFiles(ROOT)) {
      expect(findLeaks(readFileSync(p, "utf8"), createGuard()), p).toEqual([]);
    }
  });
});
