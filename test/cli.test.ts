import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run, type CliDeps } from "../src/cli/main.js";
import { EvidenceFile } from "../src/evidence/schema.js";
import { VERSION } from "../src/version.js";
import { cleanupProjects, project } from "./helpers.js";

cleanupProjects();

const FIXTURES = resolve(__dirname, "../fixtures/apps");

function harness(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = { out: (s) => out.push(s), err: (s) => err.push(s), env: {}, cwd, now: () => new Date("2026-11-11T11:30:00Z") };
  return { out, err, deps };
}

describe("soundings scan", () => {
  it("prints the version", async () => {
    const h = harness(process.cwd());
    expect(await run(["--version"], h.deps)).toBe(0);
    expect(h.out).toEqual([VERSION]);
  });

  it("writes a valid evidence file to the current folder and prints a report", async () => {
    const cwd = project({});
    const h = harness(cwd);
    expect(await run(["scan", join(FIXTURES, "notes-saas")], h.deps)).toBe(0);
    const file = join(cwd, "soundings-evidence.json");
    expect(existsSync(file)).toBe(true);
    expect(EvidenceFile.safeParse(JSON.parse(readFileSync(file, "utf8"))).success).toBe(true);
    const report = h.out.join("\n");
    expect(report).toContain("Your code never left this machine");
    expect(report).toContain("Only you can answer these (3)");
  });

  it("scans the given folder when the command word is left out", async () => {
    const h = harness(project({}));
    expect(await run([join(FIXTURES, "static-site"), "--no-write"], h.deps)).toBe(0);
    expect(h.out.join("\n")).toContain("Plausible Analytics");
  });

  it("prints JSON without saving when asked", async () => {
    const cwd = project({});
    const h = harness(cwd);
    expect(await run([join(FIXTURES, "static-site"), "--format", "json", "--no-write"], h.deps)).toBe(0);
    expect(EvidenceFile.safeParse(JSON.parse(h.out.join("\n"))).success).toBe(true);
    expect(existsSync(join(cwd, "soundings-evidence.json"))).toBe(false);
  });

  it("never says a project is compliant or certified", async () => {
    const h = harness(project({}));
    await run([join(FIXTURES, "notes-saas"), "--no-write"], h.deps);
    expect(h.out.join("\n")).not.toMatch(/\b(compliant|certified|certification|guarantee)\b/i);
  });

  it("exits 2 with a clear message for a missing folder or a bad option", async () => {
    const h = harness(project({}));
    expect(await run(["scan", "/definitely/not/here"], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("Not a folder");
    const h2 = harness(project({}));
    expect(await run(["--format", "pdf"], h2.deps)).toBe(2);
    const h3 = harness(project({}));
    expect(await run(["--nonsense"], h3.deps)).toBe(2);
  });

  it("honours the ignore list in soundings.config.json", async () => {
    const root = project({
      "package.json": JSON.stringify({ name: "x", dependencies: { openai: "1.0.0" } }),
      "keep/a.ts": `export {};\n`,
      "skip/ai.ts": `import OpenAI from "openai";\nexport const c = new OpenAI();\n`,
      "soundings.config.json": JSON.stringify({ ignore: ["skip/"] }),
    });
    const h = harness(project({}));
    expect(await run([root, "--format", "json", "--no-write"], h.deps)).toBe(0);
    const e = EvidenceFile.parse(JSON.parse(h.out.join("\n")));
    expect(e.facts.some((f) => f.kind === "ai_provider" && f.claimType === "observed")).toBe(false);
    expect(e.facts.some((f) => f.detector === "ai-provider/none-found")).toBe(true);
  });
});
