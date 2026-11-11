import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { assertNoLeaks, createGuard, findLeaks, loadEnvValues, RedactionError } from "../src/evidence/redact.js";

/** Key-shaped fake secrets are made at run time, so none are committed. */
const rand = (n: number) => randomBytes(n * 2).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, n);
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

const dirs: string[] = [];
function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "soundings-"));
  dirs.push(root);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("pattern checks", () => {
  const cases: Array<[string, string]> = [
    ["llm-api-key", `sk-${rand(48)}`],
    ["aws-access-key", `AKIA${rand(16).toUpperCase()}`],
    ["github-token", `ghp_${rand(36)}`],
    ["stripe-key", `sk_live_${rand(24)}`],
    ["jwt", `${b64url({ alg: "HS256" })}.${b64url({ sub: "1234567890" })}.${rand(43)}`],
    ["private-key", ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ")],
    ["credentialed-url", ["postgres://app", rand(20)].join(":") + "@db.internal.example/app"],
  ];
  for (const [kind, secret] of cases) {
    it(`flags a ${kind}`, () => {
      const leaks = findLeaks(`The app talks to ${secret} directly.`);
      expect(leaks.map((l) => l.kind)).toContain(kind);
    });
  }

  it("passes ordinary prose and ids", () => {
    expect(findLeaks("The app calls OpenAI [EV-3acc7131] and stores notes in Supabase.")).toEqual([]);
  });
});

describe("env value checks", () => {
  it("catches a value from the project's own .env even when it matches no pattern", () => {
    const secret = rand(32);
    const root = project({ ".env": `SESSION_SECRET=${secret}\nPORT=3000\nNODE_ENV=development\n` });
    const guard = createGuard(loadEnvValues(root));
    const claim = `Sessions are signed with ${secret}.`;
    expect(findLeaks(claim, guard).map((l) => l.kind)).toEqual(["env-value"]);
  });

  it("does not guard numbers, plain words, public-prefixed names or template files", () => {
    const publicValue = rand(30);
    const templateValue = rand(30);
    const root = project({
      ".env": `PORT=3000\nNODE_ENV=development\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${publicValue}\n`,
      ".env.example": `API_TOKEN=${templateValue}\n`,
    });
    expect(loadEnvValues(root)).toEqual([]);
  });

  it("finds env files in subfolders but not inside node_modules", () => {
    const deep = rand(24);
    const skipped = rand(24);
    const root = project({ "apps/web/.env.local": `TOKEN=${deep}\n`, "node_modules/x/.env": `TOKEN=${skipped}\n` });
    const values = loadEnvValues(root);
    expect(values).toContain(deep);
    expect(values).not.toContain(skipped);
  });
});

describe("assertNoLeaks", () => {
  it("throws without repeating the secret in the message", () => {
    const secret = rand(32);
    const guard = createGuard([secret]);
    let caught: unknown;
    try {
      assertNoLeaks(`log line: token=${secret}`, guard, "log line");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RedactionError);
    const err = caught as RedactionError;
    expect(err.message).toContain("log line");
    expect(err.message).not.toContain(secret);
    expect(JSON.stringify(err.leaks)).not.toContain(secret);
  });

  it("stays quiet on clean text", () => {
    expect(() => assertNoLeaks("Nothing to see.", createGuard([rand(32)]), "document")).not.toThrow();
  });

  it("passes the committed example evidence file", () => {
    const text = readFileSync(resolve(__dirname, "../examples/acme-notes.evidence.json"), "utf8");
    expect(() => assertNoLeaks(text, createGuard(), "example evidence")).not.toThrow();
  });
});

describe("placeholder credentials in examples", () => {
  it("are not reported: documentation is not a leak", () => {
    for (const example of [
      "smtps://user:password@smtp.example.com:465",
      "smtps://user:pass@smtp.example.com",
      "postgres://admin:YOUR_PASSWORD@db.internal/app",
      "scheme://user:password@host",
      "postgres://app:${DB_PASSWORD}@db/app",
      "postgres://app:<password>@db/app",
      "redis://default:changeme@cache:6379",
      "mysql://root:xxxxxxxx@localhost/db",
    ]) {
      expect(findLeaks(`Connect with ${example} in your config.`), example).toEqual([]);
    }
  });

  it("still reports a real-looking password", () => {
    const real = ["postgres://app", rand(20)].join(":") + "@db.internal.example/app";
    expect(findLeaks(`Use ${real}`).map((l) => l.kind)).toEqual(["credentialed-url"]);
  });

  it("does not let a placeholder earlier in the text hide a real secret later in it", () => {
    const real = ["postgres://app", rand(20)].join(":") + "@db.internal.example/app";
    const text = `Example: smtps://user:password@smtp.example.com.\n\nThe actual one: ${real}`;
    expect(findLeaks(text).map((l) => l.kind)).toEqual(["credentialed-url"]);
  });
});
