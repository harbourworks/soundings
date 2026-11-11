import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run, type CliDeps } from "../src/cli/main.js";
import { cleanupProjects, licensed, project, unlicensed } from "./helpers.js";

cleanupProjects();

const FIX = resolve(__dirname, "../fixtures/apps");
const NOW = new Date("2026-11-11T11:30:00Z");
const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

function harness(cwd: string, l: ReturnType<typeof licensed>, asks?: Array<string | null>) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const queue = asks ? [...asks] : undefined;
  const deps: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: l.env,
    provider: l.provider,
    cwd,
    now: () => NOW,
    ...(queue ? { ask: async (p) => (asked.push(p.key), queue.shift() ?? null) } : {}),
  };
  return { out, err, asked, deps };
}

async function workspace(l = licensed()) {
  const cwd = project({});
  expect(await run(["scan", join(FIX, "notes-saas")], harness(cwd, l).deps)).toBe(0);
  return { cwd, l };
}

describe("soundings document", () => {
  it("lists the five documents without needing a plan", async () => {
    const l = unlicensed();
    const h = harness(project({}), l);
    expect(await run(["document"], h.deps)).toBe(0);
    const text = plain(h.out);
    for (const id of ["privacy-notice", "subprocessors", "dpia", "ai-use", "trust-page"]) expect(text).toContain(id);
    expect(l.provider.calls).toEqual([]);
  });

  it("prints a document as Markdown with sources", async () => {
    const { cwd, l } = await workspace();
    const h = harness(cwd, l);
    expect(await run(["document", "privacy-notice"], h.deps)).toBe(0);
    const md = h.out.join("\n");
    expect(md).toContain("# Privacy notice: notes-saas (draft, 2026-11-11)");
    expect(md).toContain("## Your rights");
    expect(md).toContain("## Sources");
  });

  it("accepts short names", async () => {
    const { cwd, l } = await workspace();
    for (const alias of ["privacy", "subprocessor", "ai", "trust"]) {
      expect(await run(["document", alias], harness(cwd, l).deps), alias).toBe(0);
    }
  });

  it("writes HTML and Word files, and keeps file paths out with --no-locations", async () => {
    const { cwd, l } = await workspace();
    expect(await run(["document", "trust-page", "--format", "html", "--output", "trust.html", "--no-locations"], harness(cwd, l).deps)).toBe(0);
    const html = readFileSync(join(cwd, "trust.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("app/api/summarise/route.ts");

    expect(await run(["document", "dpia", "--format", "docx", "--output", "dpia.docx"], harness(cwd, l).deps)).toBe(0);
    const docx = readFileSync(join(cwd, "dpia.docx"));
    expect(docx.subarray(0, 2).toString()).toBe("PK");
  });

  it("won't print a Word file to the screen", async () => {
    const { cwd, l } = await workspace();
    const h = harness(cwd, l);
    expect(await run(["document", "dpia", "--format", "docx"], h.deps)).toBe(2);
    expect(plain(h.err)).toContain("--output <file.docx>");
  });

  it("rejects an unknown document or format", async () => {
    const { cwd, l } = await workspace();
    expect(await run(["document", "contract"], harness(cwd, l).deps)).toBe(2);
    expect(await run(["document", "dpia", "--format", "pdf"], harness(cwd, l).deps)).toBe(2);
  });

  it("needs Soundings Pro", async () => {
    const free = unlicensed();
    const { cwd } = await workspace(licensed());
    const h = harness(cwd, free);
    expect(await run(["document", "privacy-notice"], h.deps)).toBe(3);
    expect(plain(h.err)).toContain("soundings document");
    expect(free.provider.calls).toEqual([]);
  });

  it("answers can be exported as HTML and Word too", async () => {
    const { cwd, l } = await workspace();
    expect(await run(["answers", "--format", "html", "--output", "a.html"], harness(cwd, l).deps)).toBe(0);
    expect(readFileSync(join(cwd, "a.html"), "utf8")).toContain("Security and data handling answers");
    expect(await run(["answers", "--format", "docx", "--output", "a.docx"], harness(cwd, l).deps)).toBe(0);
    expect(existsSync(join(cwd, "a.docx"))).toBe(true);
  });
});

describe("soundings questions --documents", () => {
  it("also asks what the documents need, and a document then uses the answer", async () => {
    const { cwd, l } = await workspace();
    const plainList = harness(cwd, l);
    await run(["questions", "--list"], plainList.deps);
    expect(plain(plainList.out)).not.toContain("profile.ai-purpose");

    const withDocs = harness(cwd, l);
    await run(["questions", "--list", "--documents"], withDocs.deps);
    expect(plain(withDocs.out)).toContain("profile.ai-purpose");

    await run(["questions", "--set", "profile.organisation-name=Acme Notes Ltd"], harness(cwd, l).deps);
    const doc = harness(cwd, l);
    await run(["document", "privacy-notice"], doc.deps);
    expect(doc.out.join("\n")).toMatch(/Responsible organisation: Acme Notes Ltd/);
  });
});
