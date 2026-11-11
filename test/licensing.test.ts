import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FEATURE_LABELS, TIER_INFO, hasFeature, requiredTier, type Feature } from "../src/core/entitlements.js";
import { MockProvider } from "../src/licensing/mock.js";
import { LicenceStore } from "../src/licensing/store.js";
import { resolveLicence } from "../src/licensing/licence.js";
import { PolarProvider } from "../src/licensing/polar.js";
import { POLAR_SERVERS, PURCHASE_URL, isConfigured, purchasingOpen, type PolarSettings } from "../src/licensing/config.js";
import { run, type CliDeps } from "../src/cli/main.js";
import { cleanupProjects, LICENCE_NOW as now, licensed, project, TEST_KEY, unlicensed } from "./helpers.js";

cleanupProjects();

const DAY = 86_400_000;
/** Output as a person reads it, without terminal colour codes. */
const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const FIX = resolve(__dirname, "../fixtures/apps");

describe("entitlements", () => {
  it("matches the plan table exactly", () => {
    expect([...TIER_INFO.free.features]).toEqual([]);
    expect([...TIER_INFO.pro.features].sort()).toEqual(["answers", "documents", "exports", "questionnaire-import"]);
  });

  it("keeps scanning, questions and verification free", () => {
    const paid = Object.keys(FEATURE_LABELS) as Feature[];
    for (const f of paid) {
      expect(hasFeature("free", f)).toBe(false);
      expect(requiredTier(f)).toBe("pro");
    }
    expect(paid.join(" ")).not.toMatch(/scan|question |verify/);
  });
});

describe("licence resolution", () => {
  const setup = () => {
    const l = unlicensed();
    return { ...l, loginAs: async (at = now) => {
      const a = await l.provider.activate(TEST_KEY, "test-machine");
      if (!a.ok) throw new Error(a.detail);
      l.store.save({ version: 1, key: TEST_KEY, activationId: a.value.activationId, machineLabel: "test-machine", tier: a.value.tier, displayKey: a.value.displayKey, lastValidatedAt: at.toISOString() });
      l.provider.calls.length = 0;
    } };
  };

  it("no licence: Free, and no licence call at all", async () => {
    const { provider, store } = setup();
    const s = await resolveLicence({ provider, store, env: {}, now });
    expect(s).toMatchObject({ tier: "free", state: "none" });
    expect(provider.calls).toEqual([]);
  });

  it("a recent check (under 24h) is trusted without calling the server", async () => {
    const t = setup();
    await t.loginAs(new Date(now.getTime() - 3_600_000));
    const s = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now });
    expect(s).toMatchObject({ tier: "pro", state: "active", checkedOnline: false });
    expect(t.provider.calls).toEqual([]);
  });

  it("a stale check validates online, sending only the key and the activation id", async () => {
    const t = setup();
    await t.loginAs(new Date(now.getTime() - 2 * DAY));
    const s = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now });
    expect(s).toMatchObject({ tier: "pro", state: "active", checkedOnline: true });
    expect(t.provider.calls).toHaveLength(1);
    expect(Object.keys(t.provider.calls[0]!).sort()).toEqual(["activationId", "key", "op"]);
    expect(t.store.load()!.lastValidatedAt).toBe(now.toISOString());
  });

  it("works offline for 14 days after the last check, then pauses paid features", async () => {
    const t = setup();
    await t.loginAs(new Date(now.getTime() - 10 * DAY));
    t.provider.offline = true;
    expect(await resolveLicence({ provider: t.provider, store: t.store, env: {}, now })).toMatchObject({ tier: "pro", state: "grace" });

    const later = new Date(now.getTime() + 5 * DAY);
    const lapsed = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now: later });
    expect(lapsed).toMatchObject({ tier: "free", state: "lapsed", licensedTier: "pro" });
    expect(lapsed.message).toMatch(/14 days/);
  });

  it("--offline never calls the server, and still honours the grace period", async () => {
    const t = setup();
    await t.loginAs(new Date(now.getTime() - 3 * DAY));
    const s = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now, offline: true });
    expect(s).toMatchObject({ tier: "pro", state: "grace" });
    expect(t.provider.calls).toEqual([]);
  });

  it("a revoked key drops to Free and stays there until the person logs in again", async () => {
    const t = setup();
    await t.loginAs(new Date(now.getTime() - 2 * DAY));
    t.provider.revoke(TEST_KEY);
    const first = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now });
    expect(first).toMatchObject({ tier: "free", state: "ended" });
    expect(first.message).toMatch(/no longer active/);
    t.provider.calls.length = 0;
    const second = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now });
    expect(second.state).toBe("ended");
    expect(t.provider.calls).toEqual([]);
  });

  it("a key from another Polar organisation is not a Soundings licence", async () => {
    const t = setup();
    t.provider.addKey("FOREIGN-KEY-0001", "pro", { foreign: true });
    t.store.save({ version: 1, key: "FOREIGN-KEY-0001", activationId: null, machineLabel: "m", tier: "pro", displayKey: "****", lastValidatedAt: new Date(now.getTime() - 2 * DAY).toISOString() });
    const s = await resolveLicence({ provider: t.provider, store: t.store, env: {}, now });
    expect(s).toMatchObject({ tier: "free", state: "ended" });
  });

  it("ignores a wound-back clock or a tampered future date", async () => {
    const t = setup();
    await t.loginAs(new Date(now.getTime() + 30 * DAY));
    t.provider.offline = true;
    expect((await resolveLicence({ provider: t.provider, store: t.store, env: {}, now })).tier).toBe("free");
  });

  it("SOUNDINGS_LICENCE (for CI) validates without using up a machine slot and never stores the raw key", async () => {
    const t = setup();
    const s = await resolveLicence({ provider: t.provider, store: t.store, env: { SOUNDINGS_LICENCE: TEST_KEY }, now });
    expect(s).toMatchObject({ tier: "pro", state: "active", source: "env" });
    expect(t.provider.calls.map((c) => c.op)).toEqual(["validate"]);
    expect(t.provider.calls[0]!.activationId).toBeNull();
    const cache = readFileSync(join(t.store.dir, "env-licence-cache.json"), "utf8");
    expect(cache).not.toContain(TEST_KEY);
  });
});

describe("Polar", () => {
  const settings: PolarSettings = { apiBase: "https://api.example.test", organizationId: "org-1", benefits: { "benefit-pro": "pro" } };
  const reply = (status: number, body: unknown) => (async () => new Response(status === 204 ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
  const record = (status: number, body: unknown) => {
    const seen: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { seen, f };
  };
  const good = { organization_id: "org-1", benefit_id: "benefit-pro", status: "granted", display_key: "SD-1234", expires_at: null };

  it("production starts switched off, so no call can be made until a Soundings benefit is added", () => {
    expect(isConfigured(POLAR_SERVERS.production)).toBe(false);
    expect(isConfigured(POLAR_SERVERS.sandbox)).toBe(false);
    expect(PURCHASE_URL).toBeNull();
    expect(purchasingOpen()).toBe(false);
  });

  it("makes no network call at all while unconfigured", async () => {
    // test/setup.ts makes any real fetch throw; the unconfigured provider must not reach it.
    const p = new PolarProvider(POLAR_SERVERS.production);
    expect(await p.activate("k", "m")).toMatchObject({ ok: false, reason: "not-configured" });
    expect(await p.validate("k", null)).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("sends only the key, organisation, label and activation id, to Polar's customer-portal endpoints", async () => {
    const { seen, f } = record(200, good);
    const p = new PolarProvider(settings, f);
    await p.validate("KEY-1", "act-1");
    expect(seen[0]!.url).toBe("https://api.example.test/v1/customer-portal/license-keys/validate");
    expect(seen[0]!.body).toEqual({ key: "KEY-1", organization_id: "org-1", activation_id: "act-1" });
    expect(seen[0]!.headers["user-agent"]).toMatch(/^soundings-cli\//);
    expect(JSON.stringify(seen)).not.toMatch(/\/Users\/|C:\\\\|\.ts"/);
  });

  it("validates a good key to the Pro plan", async () => {
    expect(await new PolarProvider(settings, reply(200, good)).validate("K", null)).toMatchObject({ ok: true, value: { tier: "pro", displayKey: "SD-1234" } });
  });

  it("rejects another organisation's key and a product that isn't a Soundings plan", async () => {
    expect(await new PolarProvider(settings, reply(200, { ...good, organization_id: "other" })).validate("K", null)).toMatchObject({ reason: "not-soundings" });
    expect(await new PolarProvider(settings, reply(200, { ...good, benefit_id: "some-other-product" })).validate("K", null)).toMatchObject({ reason: "not-soundings" });
  });

  it("treats 404 as a revoked key, and tells a removed machine apart from a dead key", async () => {
    expect(await new PolarProvider(settings, reply(404, {})).validate("K", null)).toMatchObject({ reason: "revoked" });
    let n = 0;
    const f = (async () => new Response(JSON.stringify(n++ === 0 ? {} : good), { status: n === 1 ? 404 : 200 })) as unknown as typeof fetch;
    expect(await new PolarProvider(settings, f).validate("K", "act")).toMatchObject({ reason: "activation-removed" });
  });

  it("maps activation failures to clear reasons", async () => {
    expect(await new PolarProvider(settings, reply(403, { detail: "License key activation limit reached." })).activate("K", "m")).toMatchObject({ reason: "machine-limit" });
    expect(await new PolarProvider(settings, reply(403, { detail: "revoked" })).activate("K", "m")).toMatchObject({ reason: "revoked" });
    expect(await new PolarProvider(settings, reply(404, {})).activate("K", "m")).toMatchObject({ reason: "invalid" });
  });

  it("treats a server error, a rate limit or no network as 'unreachable', which says nothing about the key", async () => {
    expect(await new PolarProvider(settings, reply(500, {})).validate("K", null)).toMatchObject({ reason: "unreachable" });
    expect(await new PolarProvider(settings, reply(429, {})).validate("K", null)).toMatchObject({ reason: "unreachable" });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await new PolarProvider(settings, down).validate("K", null)).toMatchObject({ reason: "unreachable" });
  });

  it("frees a slot an activation had taken if the key turns out not to be a Soundings plan", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url.split("/").pop()!);
      if (url.endsWith("/activate")) return new Response(JSON.stringify({ id: "act-9", license_key: { limit_activations: 3 } }), { status: 200 });
      if (url.endsWith("/validate")) return new Response(JSON.stringify({ ...good, benefit_id: "other" }), { status: 200 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await new PolarProvider(settings, f).activate("K", "m")).toMatchObject({ reason: "not-soundings" });
    expect(calls).toEqual(["activate", "validate", "deactivate"]);
  });
});

describe("the licence commands", () => {
  function harness(cwd: string, l: ReturnType<typeof unlicensed>, extra: Partial<CliDeps> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps = { out: (s) => out.push(s), err: (s) => err.push(s), env: l.env, cwd, now: () => now, provider: l.provider, ...extra };
    return { out, err, deps };
  }

  it("buy says purchasing isn't open yet, rather than printing a dead link", async () => {
    const l = unlicensed();
    const h = harness(project({}), l);
    expect(await run(["buy"], h.deps)).toBe(0);
    const text = plain(h.out);
    expect(text).toContain("aren't open for purchase yet");
    expect(text).not.toMatch(/https:\/\/buy\./);
  });

  it("status on a machine with no licence shows Free and the free features", async () => {
    const l = unlicensed();
    const h = harness(project({}), l);
    expect(await run(["status"], h.deps)).toBe(0);
    expect(plain(h.out)).toContain("Soundings Free");
    expect(l.provider.calls).toEqual([]);
  });

  it("login saves the licence, status confirms it online, logout frees the slot", async () => {
    const l = unlicensed();
    const cwd = project({});
    const login = harness(cwd, l);
    expect(await run(["login", TEST_KEY, "--label", "my laptop"], login.deps)).toBe(0);
    expect(plain(login.out)).toContain("Logged in: Soundings Pro on my laptop");
    expect(existsSync(l.store.path)).toBe(true);
    expect(readFileSync(l.store.path, "utf8")).not.toContain("my laptop (");

    const st = harness(cwd, l);
    expect(await run(["status"], st.deps)).toBe(0);
    expect(plain(st.out)).toMatch(/Soundings Pro.*active/);

    const out = harness(cwd, l);
    expect(await run(["logout"], out.deps)).toBe(0);
    expect(plain(out.out)).toContain("free again");
    expect(existsSync(l.store.path)).toBe(false);
    expect(l.provider.calls.map((c) => c.op)).toEqual(["activate", "validate", "validate", "deactivate"]);
  });

  it("login explains each way it can fail", async () => {
    const cases: Array<[string, (l: ReturnType<typeof unlicensed>) => void, RegExp, number]> = [
      ["NOPE-KEY", () => {}, /wasn't recognised/, 1],
      [TEST_KEY, (l) => l.provider.revoke(TEST_KEY), /no longer active/, 1],
      [TEST_KEY, (l) => (l.provider.offline = true), /could not be reached.*Free features keep working/s, 1],
      [TEST_KEY, (l) => l.provider.keys.get(TEST_KEY)!.activations.set("a", "b") && (l.provider.keys.get(TEST_KEY)!.limit = 1), /as many machines as your plan allows/, 1],
    ];
    for (const [key, arrange, message, code] of cases) {
      const l = unlicensed();
      arrange(l);
      const h = harness(project({}), l);
      expect(await run(["login", key], h.deps), message.source).toBe(code);
      expect(plain(h.err)).toMatch(message);
    }
  });

  it("login without a key shows where to find it, and refuses --offline", async () => {
    const l = unlicensed();
    const h = harness(project({}), l);
    expect(await run(["login"], h.deps)).toBe(2);
    expect(plain(h.err)).toContain("customer portal");
    const o = harness(project({}), l);
    expect(await run(["login", TEST_KEY, "--offline"], o.deps)).toBe(2);
    expect(l.provider.calls).toEqual([]);
  });

  it("switching keys frees the old slot first", async () => {
    const l = unlicensed();
    l.provider.addKey("SECOND-KEY-0002", "pro");
    const cwd = project({});
    await run(["login", TEST_KEY], harness(cwd, l).deps);
    await run(["login", "SECOND-KEY-0002"], harness(cwd, l).deps);
    expect(l.provider.keys.get(TEST_KEY)!.activations.size).toBe(0);
    expect(l.provider.keys.get("SECOND-KEY-0002")!.activations.size).toBe(1);
  });
});

describe("gating", () => {
  function harness(cwd: string, l: ReturnType<typeof unlicensed>) {
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps = { out: (s) => out.push(s), err: (s) => err.push(s), env: l.env, cwd, now: () => now, provider: l.provider };
    return { out, err, deps };
  }

  async function withEvidence(l: ReturnType<typeof unlicensed>) {
    const cwd = project({});
    expect(await run(["scan", join(FIX, "notes-saas")], harness(cwd, l).deps)).toBe(0);
    return cwd;
  }

  it("free commands never make a licence call", async () => {
    const l = unlicensed();
    const cwd = await withEvidence(l);
    await run(["questions", "--list"], harness(cwd, l).deps);
    await run(["verify", "nothing.md"], harness(cwd, l).deps);
    await run(["status"], harness(cwd, l).deps);
    expect(l.provider.calls).toEqual([]);
  });

  it("answers and answer stop with exit 3 and a clear message when there is no plan", async () => {
    const l = unlicensed();
    const cwd = await withEvidence(l);
    const a = harness(cwd, l);
    expect(await run(["answers"], a.deps)).toBe(3);
    const text = plain(a.err);
    expect(text).toContain("soundings answers");
    expect(text).toContain("part of Soundings Pro");
    expect(text).toContain("Free, with no licence needed: scanning, the report, the questions and verifying any text");
    expect(text).toContain("aren't open for purchase yet");

    const b = harness(cwd, l);
    expect(await run(["answer", "client.csv"], b.deps)).toBe(3);
    expect(l.provider.calls).toEqual([]);
  });

  it("explains a lapsed or ended licence instead of just refusing", async () => {
    const l = unlicensed();
    const cwd = await withEvidence(l);
    l.store.save({ version: 1, key: TEST_KEY, activationId: "a", machineLabel: "m", tier: "pro", displayKey: "****", lastValidatedAt: new Date(now.getTime() - 40 * DAY).toISOString() });
    l.provider.offline = true;
    const h = harness(cwd, l);
    expect(await run(["answers"], h.deps)).toBe(3);
    expect(plain(h.err)).toMatch(/hasn't been confirmed for over 14 days/);
  });

  it("a Pro licence unlocks them", async () => {
    const l = licensed();
    const cwd = project({});
    expect(await run(["scan", join(FIX, "notes-saas")], { out: () => {}, err: () => {}, env: l.env, cwd, now: () => now, provider: l.provider })).toBe(0);
    const h = { out: [] as string[], err: [] as string[] };
    expect(await run(["answers"], { out: (s) => h.out.push(s), err: (s) => h.err.push(s), env: l.env, cwd, now: () => now, provider: l.provider })).toBe(0);
    expect(h.out.join("\n")).toContain("# Security and data handling answers");
    expect(l.provider.calls).toEqual([]); // the saved check was fresh
  });

  it("never lets scanning be blocked, whatever the licence state", async () => {
    const l = unlicensed();
    l.provider.offline = true;
    l.store.save({ version: 1, key: TEST_KEY, activationId: "a", machineLabel: "m", tier: "pro", displayKey: "****", lastValidatedAt: new Date(now.getTime() - 99 * DAY).toISOString() });
    const cwd = project({});
    expect(await run(["scan", join(FIX, "static-site")], harness(cwd, l).deps)).toBe(0);
    expect(l.provider.calls).toEqual([]);
  });
});
