import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run, type CliDeps } from "../src/cli/main.js";
import { AnswersFile } from "../src/evidence/schema.js";
import { extractRefs } from "../src/evidence/refs.js";
import { DRAFT_NOTICE } from "../src/export/notice.js";
import { cleanupProjects, licensed, project, rand } from "./helpers.js";

cleanupProjects();

const FIX = resolve(__dirname, "../fixtures/apps");

function harness(cwd: string, asks?: Array<string | null>) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const queue = asks ? [...asks] : undefined;
  const lic = licensed();
  const deps: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: lic.env,
    provider: lic.provider,
    cwd,
    now: () => new Date("2026-11-11T11:30:00Z"),
    ...(queue ? { ask: async (p) => (asked.push(p.key), queue.shift() ?? null) } : {}),
  };
  return { out, err, asked, deps };
}

/** A working folder that already holds the evidence for a fixture. */
async function withEvidence(fixture: string) {
  const cwd = project({});
  const h = harness(cwd);
  expect(await run(["scan", join(FIX, fixture)], h.deps)).toBe(0);
  return cwd;
}

describe("soundings questions", () => {
  it("needs an evidence file first", async () => {
    const h = harness(project({}));
    expect(await run(["questions"], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain('Run "soundings scan" first');
  });

  it("lists what is left without asking", async () => {
    const cwd = await withEvidence("notes-saas");
    const h = harness(cwd, ["should not be used"]);
    expect(await run(["questions", "--list"], h.deps)).toBe(0);
    expect(h.asked).toEqual([]);
    const text = h.out.join("\n");
    expect(text).toContain("UQ-supabase-region");
    expect(text).toContain("Still to answer");
  });

  it("records --set answers and persists them across runs", async () => {
    const cwd = await withEvidence("notes-saas");
    const h = harness(cwd);
    expect(await run(["questions", "--set", "UQ-supabase-region=London (eu-west-2)", "--set", "profile.mfa=Optional for users, required for admins"], h.deps)).toBe(0);
    const file = AnswersFile.parse(JSON.parse(readFileSync(join(cwd, "soundings-answers.json"), "utf8")));
    expect(file.answers.map((a) => [a.id, a.question])).toEqual([
      ["A-001", "UQ-supabase-region"],
      ["A-002", "profile.mfa"],
    ]);

    const again = harness(cwd);
    expect(await run(["questions", "--list"], again.deps)).toBe(0);
    expect(again.out.join("\n")).not.toContain("UQ-supabase-region ");
  });

  it("asks only what is unanswered, skips blanks, and stops at the end of input", async () => {
    const cwd = await withEvidence("static-site");
    const first = harness(cwd, ["Netlify, Ireland", "", null]);
    expect(await run(["questions"], first.deps)).toBe(0);
    expect(first.asked[0]).toBe("UQ-hosting-location");
    const saved = AnswersFile.parse(JSON.parse(readFileSync(join(cwd, "soundings-answers.json"), "utf8")));
    expect(saved.answers.map((a) => a.question)).toEqual(["UQ-hosting-location"]);

    const second = harness(cwd, [null]);
    await run(["questions"], second.deps);
    expect(second.asked).not.toContain("UQ-hosting-location");
  });

  it("rejects keys it doesn't recognise", async () => {
    const cwd = await withEvidence("static-site");
    for (const bad of ["UQ-nope=x", "profile.nope=x", "override.nope=x", "random=x"]) {
      const h = harness(cwd);
      expect(await run(["questions", "--set", bad], h.deps), bad).toBe(2);
    }
    const h = harness(cwd);
    expect(await run(["questions", "--set", "novalue"], h.deps)).toBe(2);
  });

  it("refuses to save a secret as an answer", async () => {
    const cwd = await withEvidence("static-site");
    const h = harness(cwd);
    expect(await run(["questions", "--set", `profile.secret-storage=token ghp_${rand(36)}`], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("looks like it contains a secret");
    expect(existsSync(join(cwd, "soundings-answers.json"))).toBe(false);
  });
});

describe("soundings answers", () => {
  it("renders a Markdown document with the draft notice, answers and numbered sources", async () => {
    const cwd = await withEvidence("notes-saas");
    const set = harness(cwd);
    await run(["questions", "--set", "UQ-openai-data-use=Zero data retention is enabled."], set.deps);

    const h = harness(cwd);
    expect(await run(["answers"], h.deps)).toBe(0);
    const md = h.out.join("\n");
    expect(md).toContain("# Security and data handling answers: notes-saas");
    expect(md).toContain("Draft prepared with Soundings");
    expect(md).toContain("## Sources");
    expect(md).toMatch(/\[\^EV-[0-9a-f]{8}\]/);
    expect(md).toContain("[^A-001]: Answer from the project team, recorded 2026-11-11.");
    expect(md).toContain("**Needs your input.**");
    // The notice is the one place these words appear, and only to say Soundings never claims them.
    expect(md.replace(DRAFT_NOTICE, "")).not.toMatch(/\b(compliant|certified|guarantee[sd]?)\b/i);
  });

  it("gives every footnote mark a source line, and every source line a mark", async () => {
    const cwd = await withEvidence("notes-saas");
    const h = harness(cwd);
    await run(["answers"], h.deps);
    const md = h.out.join("\n");
    const marks = new Set([...md.matchAll(/\[\^([A-Z]+-[0-9a-f]+)\](?!:)/g)].map((m) => m[1]!));
    const defs = new Set([...md.matchAll(/^\[\^([A-Z]+-[0-9a-f]+)\]:/gm)].map((m) => m[1]!));
    expect(marks.size).toBeGreaterThan(5);
    expect([...marks].sort()).toEqual([...defs].sort());
    expect(md).not.toContain("Source not found");
    expect(extractRefs(md).length).toBe(0); // all markers were converted to footnotes
  });

  it("leaves file paths out of the sources on request", async () => {
    const cwd = await withEvidence("notes-saas");
    const h = harness(cwd);
    await run(["answers", "--no-locations"], h.deps);
    expect(h.out.join("\n")).not.toContain("app/api/summarise/route.ts");
  });

  it("writes to a file and emits JSON", async () => {
    const cwd = await withEvidence("static-site");
    const h = harness(cwd);
    expect(await run(["answers", "--output", "out.md"], h.deps)).toBe(0);
    expect(readFileSync(join(cwd, "out.md"), "utf8")).toContain("Needs your input");
    const j = harness(cwd);
    expect(await run(["answers", "--format", "json"], j.deps)).toBe(0);
    expect(JSON.parse(j.out.join("\n")).results.length).toBeGreaterThanOrEqual(40);
  });

  it("stops if a secret from the project's env files would reach the document", async () => {
    const cwd = await withEvidence("static-site");
    const secret = rand(32);
    writeFileSync(join(cwd, ".env"), `APP_SECRET=${secret}\n`);
    writeFileSync(join(cwd, "soundings-answers.json"), JSON.stringify({ schemaVersion: "0.2", answers: [{ id: "A-001", question: "profile.dpo", value: `Contact ${secret}`, answeredAt: "2026-11-11T11:30:00Z" }] }));
    const h = harness(cwd);
    expect(await run(["answers"], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("Stopped: Possible secret in answers document");
    expect(h.err.join("\n")).not.toContain(secret);
  });
});
