import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AnswerKey, diffAgainstKey } from "../src/evidence/answer-key.js";
import { EvidenceFile } from "../src/evidence/schema.js";
import { assertNoLeaks, createGuard, loadEnvValues } from "../src/evidence/redact.js";
import { scan } from "../src/scanner/scan.js";
import { cleanupProjects, project, rand } from "./helpers.js";

cleanupProjects();

const ROOT = resolve(__dirname, "../fixtures");
const NOW = new Date("2026-11-11T11:30:00Z");
const names = ["notes-saas", "express-pg", "static-site", "fastapi-rag", "next-prisma", "hono-drizzle"];

describe.each(names)("scanning the %s fixture", (name) => {
  const key = AnswerKey.parse(JSON.parse(readFileSync(join(ROOT, "expected", `${name}.json`), "utf8")));
  const run = () => scan({ root: join(ROOT, "apps", name), now: NOW });

  it("matches its answer key exactly, decoys included", () => {
    const d = diffAgainstKey(run().evidence, key);
    expect(d).toEqual({ missing: [], unexpected: [], decoysReported: [], missingUnknowns: [], unexpectedUnknowns: [] });
  });

  it("produces a valid evidence file with the expected stack", () => {
    const { evidence } = run();
    expect(EvidenceFile.safeParse(evidence).success).toBe(true);
    expect(evidence.project.languages).toEqual(key.project.languages);
    expect(evidence.project.frameworks).toEqual(key.project.frameworks);
  });

  it("gives the same file every time", () => {
    expect(JSON.stringify(run().evidence)).toBe(JSON.stringify(run().evidence));
  });

  it("finishes in under 10 seconds", () => {
    expect(run().ms).toBeLessThan(10_000);
  });

  it("records what it ran and what it skipped, with reasons", () => {
    const { scan: s } = run().evidence;
    expect(s.detectorsRun.length).toBeGreaterThan(0);
    expect(s.detectorsSkipped.every((x) => x.reason.length > 0)).toBe(true);
  });
});

describe("OpenAI prompts in the notes-saas fixture", () => {
  // Facts with the same claim merge into one, so the answer key alone can't tell which calls a
  // data-flow fact points to. Pin the locations: the fixed-prompt calls in lib/sample-content.ts are a decoy.
  const flows = () => scan({ root: join(ROOT, "apps", "notes-saas"), now: NOW }).evidence.facts.filter((f) => f.kind === "data_flow");

  it("points at each call that sends user text, at the call line, with high confidence", () => {
    expect(flows().map((f) => ({ subject: f.subject, confidence: f.confidence, locations: f.locations }))).toEqual([
      {
        subject: "OpenAI",
        confidence: "high",
        locations: [
          { file: "app/api/summarise/route.ts", line: 8 },
          { file: "lib/cover-image.ts", line: 7 },
          { file: "lib/note-tags.ts", line: 8 },
        ],
      },
    ]);
  });

  it("does not report the fixed-prompt images.generate and responses.parse calls", () => {
    expect(flows().flatMap((f) => f.locations).filter((l) => l.file === "lib/sample-content.ts")).toEqual([]);
  });
});

describe("privacy", () => {
  it("never lets a secret from the project reach the evidence", () => {
    const envSecret = rand(32);
    const hardcoded = `sk_live_${rand(24)}`;
    const root = project({
      "package.json": JSON.stringify({ name: "leaky", dependencies: { stripe: "1.0.0" } }),
      ".env": `SESSION_SECRET=${envSecret}\n`,
      "lib/pay.ts": `import Stripe from "stripe";\nconst key = "${hardcoded}";\nexport const s = new Stripe(key);\n`,
    });
    const { evidence } = scan({ root, now: NOW });
    const text = JSON.stringify(evidence);
    expect(text).not.toContain(hardcoded);
    expect(text).not.toContain(envSecret);
    const hit = evidence.facts.find((f) => f.subject === "Hard-coded keys");
    expect(hit?.claimType).toBe("observed");
    expect(hit?.locations[0]?.file).toBe("lib/pay.ts");
    expect(() => assertNoLeaks(text, createGuard(loadEnvValues(root)), "evidence")).not.toThrow();
  });

  it("stops loudly if a secret would get into a fact", () => {
    // A project whose own name is an env secret: the final guard must refuse to write it.
    const secret = rand(32);
    const root = project({ "package.json": JSON.stringify({ name: secret }), ".env": `APP_SECRET=${secret}\n` });
    expect(() => scan({ root, now: NOW })).toThrow(/Possible secret in evidence file/);
  });

  it("never reads the network", async () => {
    // test/setup.ts replaces fetch with a function that throws; a scan must not trip it.
    const root = project({ "package.json": JSON.stringify({ name: "quiet" }) });
    expect(() => scan({ root, now: NOW })).not.toThrow();
  });
});

describe("Seaworthy findings", () => {
  it("are linked to the facts they bear on", () => {
    const root = join(ROOT, "apps", "notes-saas");
    const { evidence } = scan({
      root,
      now: NOW,
      seaworthy: { findings: [{ ruleId: "SW-D01", severity: "critical", file: "supabase/migrations/001_init.sql", line: 1 }] },
    });
    const store = evidence.facts.find((f) => f.kind === "data_store");
    expect(evidence.findings[0]?.relatedFacts).toEqual([store!.id]);
    expect(evidence.findings[0]?.id).toMatch(/^F-[0-9a-f]{8}$/);
  });

  it("rejects a malformed report", () => {
    expect(() => scan({ root: join(ROOT, "apps", "static-site"), seaworthy: { findings: [{ ruleId: "nope", severity: "high" }] } })).toThrow();
  });
});
