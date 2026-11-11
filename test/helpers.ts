import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach } from "vitest";
import { scan } from "../src/scanner/scan.js";

const dirs: string[] = [];

/** Builds a throwaway project, so no key-shaped strings are ever committed. Cleaned up after each test. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "soundings-"));
  dirs.push(root);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

export function cleanupProjects(): void {
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
}

export const rand = (n: number) => randomBytes(n * 2).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, n);

export const pkg = (deps: string[] = []) =>
  JSON.stringify({ name: "demo", dependencies: Object.fromEntries(deps.map((d) => [d, "1.0.0"])) });

/** Scans a project made from `files` and returns the facts as "kind|subject|detector" strings. */
export function factsOf(files: Record<string, string>): string[] {
  const { evidence } = scan({ root: project(files), now: new Date("2026-11-11T11:30:00Z") });
  return evidence.facts.filter((f) => f.claimType === "observed" && f.detector !== "secrets/hardcoded-patterns").map((f) => `${f.kind}|${f.subject}|${f.detector}`);
}

export function evidenceOf(files: Record<string, string>) {
  return scan({ root: project(files), now: new Date("2026-11-11T11:30:00Z") }).evidence;
}

import { LicenceStore } from "../src/licensing/store.js";
import { MockProvider } from "../src/licensing/mock.js";

export const LICENCE_NOW = new Date("2026-11-11T11:30:00Z");
export const TEST_KEY = "SOUNDINGS-TEST-PRO-0001";

/** A machine that is already logged in with a fresh Pro licence: no licence call is needed to use it. */
export function licensed(): { env: NodeJS.ProcessEnv; provider: MockProvider; store: LicenceStore } {
  const dir = project({});
  const provider = new MockProvider().addKey(TEST_KEY, "pro");
  const store = new LicenceStore(dir);
  store.save({
    version: 1,
    key: TEST_KEY,
    activationId: "act-test",
    machineLabel: "test-machine",
    tier: "pro",
    displayKey: "****-000001",
    lastValidatedAt: LICENCE_NOW.toISOString(),
  });
  return { env: { SOUNDINGS_CONFIG_DIR: dir }, provider, store };
}

/** A machine with no licence at all, using a mock server so any call is visible. */
export function unlicensed(): { env: NodeJS.ProcessEnv; provider: MockProvider; store: LicenceStore } {
  const dir = project({});
  return { env: { SOUNDINGS_CONFIG_DIR: dir }, provider: new MockProvider().addKey(TEST_KEY, "pro"), store: new LicenceStore(dir) };
}
