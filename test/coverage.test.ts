import { describe, expect, it } from "vitest";
import { EvidenceFile } from "../src/evidence/schema.js";
import { isCanonical, type FactDraft } from "../src/evidence/build.js";
import { mergeFacts, scan } from "../src/scanner/scan.js";
import { renderTerminal } from "../src/reporters/terminal.js";
import { answerQuestion } from "../src/questions/engine.js";
import { BANK } from "../src/questions/bank.js";
import { emptyAnswers, setAnswer } from "../src/questions/answers-file.js";
import { DOCUMENTS, buildDocument } from "../src/documents/build.js";
import { verifyText } from "../src/verify/verify.js";
import { cleanupProjects, project } from "./helpers.js";

cleanupProjects();

const NOW = new Date("2026-11-11T11:30:00Z");
const py = (n: number, dir = "backend") => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${dir}/m${i}.py`, "x = 1\n"]));
const nextAuth = (file: string) => `import { getServerSession } from "next-auth";\nexport const s = getServerSession;\n`;

/** The shape that went wrong on real code: a Python back end behind a Next.js front end. */
const mixed = () =>
  project({
    "package.json": JSON.stringify({ name: "mixed", dependencies: { next: "15.0.0", "next-auth": "4.0.0" } }),
    "frontend/a.ts": nextAuth("a"),
    "frontend/b.ts": nextAuth("b"),
    "frontend/c.ts": nextAuth("c"),
    ...py(5),
  });

const run = (root: string) => scan({ root, now: NOW }).evidence;
const get = (id: string) => BANK.find((b) => b.id === id)!;

describe("code the scan can't read", () => {
  const ev = run(mixed());

  it("is counted and recorded in the coverage block", () => {
    expect(ev.scan.unsupported).toEqual([{ language: "Python", files: 5 }]);
    expect(EvidenceFile.safeParse(ev).success).toBe(true);
    expect(isCanonical(ev)).toBe(true);
  });

  it("never claims something was 'not found' when it couldn't have seen it", () => {
    for (const d of ["ai-provider/none-found", "data-store/none-found", "auth/none-found"]) {
      expect(ev.facts.some((f) => f.detector === d), d).toBe(false);
    }
    expect(ev.facts.some((f) => f.detector === "logging/request-body")).toBe(false);
  });

  it("asks what the unread code does, instead", () => {
    const u = ev.unknowns.find((x) => x.id === "UQ-unanalysed-code");
    expect(u?.question).toMatch(/5 Python files, which Soundings doesn't read/);
    expect(u?.question).toMatch(/AI services, databases, sign-in methods and logging/);
  });

  it("doesn't guess that the project has no back end", () => {
    expect(ev.unknowns.some((x) => x.id === "UQ-hosting-location")).toBe(false);
  });

  it("says so at the top of the report", () => {
    const text = renderTerminal(ev, 1, null).replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toContain("Not analysed: 5 Python files. Soundings reads JavaScript and TypeScript, so what that code does is not in this report.");
  });

  it("leaves the question bank asking, not answering 'no'", () => {
    for (const id of ["ai-use", "data-stores", "auth-methods", "logging-content"]) {
      if (id === "auth-methods") continue; // this project does have a sign-in fact
      const r = answerQuestion(get(id), ev, emptyAnswers());
      expect(r.status, id).toBe("needs-input");
      expect(r.needs.map((n) => n.key), id).toContain("UQ-unanalysed-code");
      expect(r.answer, id).not.toMatch(/No .* (was|were) found/);
    }
  });

  it("uses the team's answer about the unread code, attributed to them", () => {
    const a = setAnswer(emptyAnswers(), "UQ-unanalysed-code", "The Python API uses PostgreSQL and calls an LLM provider.", NOW);
    const r = answerQuestion(get("data-stores"), ev, a);
    expect(r.status).toBe("answered");
    expect(r.answer).toMatch(/Parts of the project the scan did not read: The Python API uses PostgreSQL/);
    expect(r.refs).toEqual(["A-001"]);
  });

  it("produces documents that still pass the verifier", () => {
    for (const answers of [emptyAnswers(), setAnswer(emptyAnswers(), "UQ-unanalysed-code", "The Python API uses PostgreSQL and an LLM provider.", NOW)]) {
      for (const d of DOCUMENTS) {
        const doc = buildDocument(d.id, ev, answers, { locations: true });
        expect(verifyText(doc.markdown, ev, answers).issues, d.id).toEqual([]);
      }
    }
  });
});

describe("a few stray files in another language", () => {
  it("are noted, but don't stop the scan describing what it can see", () => {
    const e = run(project({ "package.json": JSON.stringify({ name: "x" }), "a.ts": "export {};\n", ...py(2, "scripts") }));
    expect(e.scan.unsupported).toEqual([{ language: "Python", files: 2 }]);
    expect(e.facts.some((f) => f.detector === "ai-provider/none-found")).toBe(true);
    expect(e.unknowns.some((u) => u.id === "UQ-unanalysed-code")).toBe(false);
  });

  it("don't count when they are tests", () => {
    const e = run(project({ "package.json": JSON.stringify({ name: "x" }), "a.ts": "export {};\n", ...py(6, "tests") }));
    expect(e.scan.unsupported).toEqual([]);
  });
});

describe("one fact per thing found", () => {
  it("merges the same finding in several files into one fact with several locations", () => {
    const auth = run(mixed()).facts.filter((f) => f.subject === "Auth.js");
    expect(auth).toHaveLength(1);
    expect(auth[0]!.locations.map((l) => l.file)).toEqual(["frontend/a.ts", "frontend/b.ts", "frontend/c.ts"]);
  });

  const base: FactDraft = { kind: "auth", subject: "X", claim: "c", confidence: "high", detector: "auth/x", key: "a.ts", locations: [{ file: "a.ts" }] };

  it("never merges facts that differ in what they say", () => {
    const out = mergeFacts([base, { ...base, key: "b.ts", claim: "different", locations: [{ file: "b.ts" }] }, { ...base, key: "c.ts", confidence: "medium", locations: [{ file: "c.ts" }] }]);
    expect(out).toHaveLength(3);
  });

  it("keeps a bounded list of locations", () => {
    const many = Array.from({ length: 30 }, (_, i): FactDraft => ({ ...base, key: `f${String(i).padStart(2, "0")}.ts`, locations: [{ file: `f${String(i).padStart(2, "0")}.ts` }] }));
    const [one] = mergeFacts(many);
    expect(one!.locations).toHaveLength(10);
    expect(one!.key).toBe("f00.ts");
  });
});
