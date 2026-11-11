import { describe, expect, it } from "vitest";
import { cleanupProjects, evidenceOf, factsOf, pkg, rand } from "./helpers.js";

cleanupProjects();

/**
 * Every detector has a case it must flag and a decoy it must not.
 * Decoys are the tempting near-misses: comments, strings, test files, public-by-design values.
 */

describe("AI providers", () => {
  const cases: Array<[string, string, string]> = [
    ["openai", "OpenAI", `import OpenAI from "openai";\nexport const c = new OpenAI();\n`],
    ["@anthropic-ai/sdk", "Anthropic", `import Anthropic from "@anthropic-ai/sdk";\nexport const c = new Anthropic();\n`],
    ["@google/generative-ai", "Google AI", `import { GoogleGenerativeAI } from "@google/generative-ai";\nexport const c = new GoogleGenerativeAI("x");\n`],
    ["ai", "Vercel AI SDK", `import { generateText } from "ai";\nexport const t = generateText;\n`],
  ];
  for (const [dep, subject, code] of cases) {
    it(`flags ${subject} when its SDK is imported`, () => {
      expect(factsOf({ "package.json": pkg([dep]), "src/ai.ts": code })).toContain(`ai_provider|${subject}|${subjectId(subject)}`);
    });
    it(`ignores ${subject} named only in a comment, a string or a test`, () => {
      const files = {
        "package.json": pkg([dep]),
        "src/ai.ts": `// import X from "${dep}"\nexport const note = "we looked at ${dep}";\n`,
        "src/ai.test.ts": code,
        "test/other.ts": code,
      };
      expect(factsOf(files).filter((f) => f.startsWith("ai_provider"))).toEqual([]);
    });
  }

  it("reports the named provider, not the Vercel SDK, when a file uses both", () => {
    const f = factsOf({
      "package.json": pkg(["ai", "@ai-sdk/openai"]),
      "src/ai.ts": `import { generateText } from "ai";\nimport { openai } from "@ai-sdk/openai";\nexport const a = [generateText, openai];\n`,
    });
    expect(f.filter((x) => x.startsWith("ai_provider"))).toEqual(["ai_provider|OpenAI|ai-provider/openai-sdk"]);
  });

  it("says whether the SDK is used in the browser", () => {
    const e = evidenceOf({
      "package.json": pkg(["openai"]),
      "components/Chat.tsx": `"use client";\nimport OpenAI from "openai";\nexport const c = new OpenAI();\n`,
    });
    expect(e.facts.find((f) => f.kind === "ai_provider")?.attributes.runsOn).toBe("browser");
    expect(e.facts.some((f) => f.kind === "client_side_exposure" && f.detector === "client-exposure/ai-sdk-in-browser")).toBe(true);
  });

  it("does not call a server-side SDK use a browser exposure", () => {
    const e = evidenceOf({ "package.json": pkg(["openai"]), "app/api/x/route.ts": `import OpenAI from "openai";\nexport const c = new OpenAI();\n` });
    expect(e.facts.some((f) => f.kind === "client_side_exposure")).toBe(false);
  });
});

function subjectId(subject: string): string {
  return { OpenAI: "ai-provider/openai-sdk", Anthropic: "ai-provider/anthropic-sdk", "Google AI": "ai-provider/google-sdk", "Vercel AI SDK": "ai-provider/vercel-ai-sdk" }[subject]!;
}

describe("data flow to AI providers", () => {
  const head = `import OpenAI from "openai";\nconst client = new OpenAI();\n`;
  const flow = (files: Record<string, string>) => evidenceOf({ "package.json": pkg(["openai"]), ...files }).facts.find((f) => f.kind === "data_flow");

  it("flags request content in a prompt as high confidence", () => {
    const f = flow({
      "route.ts": `${head}export async function POST(req: Request) {\n  const body = await req.json();\n  return client.chat.completions.create({ model: "m", messages: [{ role: "user", content: \`Summarise: \${body.text}\` }] });\n}\n`,
    });
    expect(f?.confidence).toBe("high");
  });

  it("flags a function parameter in a prompt as high confidence", () => {
    const f = flow({ "ai.ts": `${head}export function ask(question: string) {\n  return client.responses.create({ model: "m", input: question });\n}\n` });
    expect(f?.confidence).toBe("high");
  });

  it("flags content of unclear origin as medium", () => {
    const f = flow({ "ai.ts": `${head}import { loadNote } from "./notes";\nconst note = loadNote();\nexport const r = client.chat.completions.create({ model: "m", messages: [{ role: "user", content: note }] });\n` });
    expect(f?.confidence).toBe("medium");
  });

  it("ignores a prompt that is a fixed string", () => {
    const f = flow({ "ai.ts": `${head}export const r = client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "Say hello." }] });\n` });
    expect(f).toBeUndefined();
  });
});

describe("third-party services", () => {
  it("flags Stripe and records how it is integrated", () => {
    const e = evidenceOf({ "package.json": pkg(["stripe"]), "pay.ts": `import Stripe from "stripe";\nconst s = new Stripe("x");\ns.checkout.sessions.create({});\n` });
    expect(e.facts.find((f) => f.subject === "Stripe")?.attributes.integration).toBe("checkout");
  });

  it("ignores a service named in a comment or a markdown file", () => {
    expect(
      factsOf({ "package.json": pkg(["stripe"]), "pay.ts": `// import Stripe from "stripe";\nexport {};\n`, "README.md": "We use Stripe.\n" }).filter((f) =>
        f.startsWith("third_party_service"),
      ),
    ).toEqual([]);
  });

  it("flags an analytics script tag in HTML", () => {
    const f = factsOf({ "index.html": `<script defer src="https://plausible.io/js/script.js"></script>` });
    expect(f).toContain("third_party_service|Plausible Analytics|third-party/plausible-analytics");
  });

  it("ignores a link to an analytics site that is not a script", () => {
    const f = factsOf({ "index.html": `<a href="https://plausible.io">Plausible</a> <p>plausible.io is great</p>` });
    expect(f.filter((x) => x.startsWith("third_party_service"))).toEqual([]);
  });

  it("flags Google Analytics loaded from a script tag, including protocol-relative URLs", () => {
    const f = factsOf({ "index.html": `<script async src="//www.googletagmanager.com/gtag/js?id=G-1"></script>` });
    expect(f).toContain("third_party_service|Google Analytics|third-party/google-analytics");
  });
});

describe("authentication", () => {
  it("flags Supabase sign-in and lists the methods", () => {
    const e = evidenceOf({
      "package.json": pkg(["@supabase/supabase-js"]),
      "auth.ts": `export const a = (s: any) => s.auth.signInWithPassword({});\nexport const b = (s: any) => s.auth.signInWithOAuth({});\n`,
    });
    expect(e.facts.find((f) => f.kind === "auth")?.attributes.methods).toEqual(["email-password", "oauth"]);
  });

  it("ignores Supabase calls that are not sign-in", () => {
    const f = factsOf({ "package.json": pkg(["@supabase/supabase-js"]), "x.ts": `export const u = (s: any) => s.auth.getUser();\nexport const q = (s: any) => s.from("auth_log").select();\n` });
    expect(f.filter((x) => x.startsWith("auth"))).toEqual([]);
  });

  it("flags JWT use, and ignores a commented import", () => {
    expect(factsOf({ "package.json": pkg(["jsonwebtoken"]), "a.ts": `import jwt from "jsonwebtoken";\nexport const v = jwt.verify;\n` })).toContain("auth|JSON Web Tokens|auth/jwt");
    expect(factsOf({ "package.json": pkg(["jsonwebtoken"]), "a.ts": `// import jwt from "jsonwebtoken";\nexport {};\n` }).filter((x) => x.startsWith("auth"))).toEqual([]);
  });
});

describe("data stores", () => {
  const sql = (body: string) => ({ "package.json": pkg(), "supabase/migrations/001.sql": body });
  const rls = (body: string) => evidenceOf(sql(body)).facts.find((f) => f.kind === "data_store")?.attributes.rowLevelSecurity;

  it("reports row-level security enabled on every table", () => {
    expect(rls("create table public.a (id int);\nalter table public.a enable row level security;\n")).toBe("enabled");
  });

  it("reports partial coverage", () => {
    expect(rls("create table a (id int);\ncreate table b (id int);\nalter table a enable row level security;\n")).toBe("partial");
  });

  it("reports row-level security missing", () => {
    expect(rls("create table public.a (id int);\n")).toBe("disabled");
  });

  it("does not count a commented-out statement, or Supabase's own auth tables", () => {
    expect(rls("create table public.a (id int);\n-- alter table public.a enable row level security;\ncreate table auth.extra (id int);\n")).toBe("disabled");
  });

  it("falls back to medium confidence when only the client library is present", () => {
    const e = evidenceOf({ "package.json": pkg(["@supabase/supabase-js"]), "db.ts": `import { createClient } from "@supabase/supabase-js";\nexport const s = createClient;\n` });
    const f = e.facts.find((x) => x.kind === "data_store");
    expect(f?.confidence).toBe("medium");
    expect(f?.attributes.rowLevelSecurity).toBe("unknown");
  });

  it("flags PostgreSQL, MongoDB and Redis clients, and ignores comments", () => {
    const f = factsOf({
      "package.json": pkg(["pg", "mongoose", "ioredis"]),
      "a.ts": `import { Pool } from "pg";\nexport const p = Pool;\n`,
      "b.ts": `import mongoose from "mongoose";\nexport const m = mongoose;\n`,
      "c.ts": `// import Redis from "ioredis";\nexport {};\n`,
    });
    expect(f).toContain("data_store|PostgreSQL|data-store/postgres");
    expect(f).toContain("data_store|MongoDB|data-store/mongodb");
    expect(f.some((x) => x.includes("Redis"))).toBe(false);
  });
});

describe("secret handling", () => {
  it("records secret-named environment variables by name only", () => {
    const e = evidenceOf({ "package.json": pkg(), "a.ts": `export const k = process.env.STRIPE_SECRET_KEY;\nexport const d = process.env.DATABASE_URL;\n` });
    expect(e.facts.find((f) => f.detector === "secrets/env-usage")?.attributes.keyNames).toEqual(["DATABASE_URL", "STRIPE_SECRET_KEY"]);
  });

  it("ignores ordinary and public variables, and env names inside strings", () => {
    const e = evidenceOf({
      "package.json": pkg(),
      "a.ts": `export const a = process.env.NODE_ENV;\nexport const b = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\nexport const c = "process.env.SECRET_KEY";\n`,
    });
    expect(e.facts.some((f) => f.detector === "secrets/env-usage")).toBe(false);
  });

  it("flags a key-shaped value without recording it", () => {
    const key = `ghp_${rand(36)}`;
    const e = evidenceOf({ "package.json": pkg(), "a.ts": `export const t = "${key}";\n` });
    const f = e.facts.find((x) => x.detector === "secrets/hardcoded-patterns");
    expect(f?.claimType).toBe("observed");
    expect(JSON.stringify(e)).not.toContain(key);
  });

  it("reports 'not found' (never 'none exist') when nothing matches", () => {
    const e = evidenceOf({ "package.json": pkg(), "a.ts": `export const a = 1;\n` });
    const f = e.facts.find((x) => x.detector === "secrets/hardcoded-patterns");
    expect(f?.claimType).toBe("not-found");
    expect(f?.confidence).toBe("medium");
  });
});

describe("logging", () => {
  const logs = (code: string) => factsOf({ "package.json": pkg(), "r.ts": code }).includes("logging|Server logs|logging/request-body");

  it("flags a logged request body, directly or through a variable", () => {
    expect(logs(`export async function POST(req: Request) {\n  console.log(await req.json());\n}\n`)).toBe(true);
    expect(logs(`export async function POST(req: Request) {\n  const body = await req.json();\n  console.log("got", body);\n}\n`)).toBe(true);
    expect(logs(`export const h = (req: any, logger: any) => logger.info({ body: req.body }, "in");\n`)).toBe(true);
  });

  it("ignores logs that do not include a body", () => {
    expect(logs(`export const h = (req: any) => console.log("started", req.params.id);\n`)).toBe(false);
    expect(logs(`export const h = (req: any, logger: any) => logger.info({ path: req.url });\n`)).toBe(false);
    expect(logs(`export const h = () => console.log("hello");\n`)).toBe(false);
  });

  it("does not treat an unrelated variable called body as a request", () => {
    expect(logs(`export const h = () => {\n  const body = "static";\n  console.log(body);\n};\n`)).toBe(false);
  });
});

describe("client-side exposure", () => {
  it("flags a secret-named variable with a public prefix", () => {
    const e = evidenceOf({ "package.json": pkg(), "a.tsx": `export const k = process.env.NEXT_PUBLIC_OPENAI_API_KEY;\n` });
    expect(e.facts.some((f) => f.kind === "client_side_exposure")).toBe(true);
  });

  it("does not flag the Supabase anon key or an ordinary public URL (public by design)", () => {
    const e = evidenceOf({
      "package.json": pkg(),
      "a.tsx": `export const a = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\nexport const u = process.env.NEXT_PUBLIC_SITE_URL;\n`,
    });
    expect(e.facts.some((f) => f.kind === "client_side_exposure")).toBe(false);
  });
});

describe("unknowns", () => {
  it("asks only what the facts make relevant", () => {
    const e = evidenceOf({ "package.json": pkg(["openai"]), "a.ts": `import OpenAI from "openai";\nexport const c = new OpenAI();\n` });
    expect(e.unknowns.map((u) => u.id)).toEqual(["UQ-openai-data-use"]);
  });

  it("asks about hosting for a project with no backend signals", () => {
    const e = evidenceOf({ "index.html": "<p>hi</p>" });
    expect(e.unknowns.map((u) => u.id)).toEqual(["UQ-hosting-location"]);
  });
});
