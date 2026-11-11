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
    ["@mistralai/mistralai", "Mistral", `import { Mistral } from "@mistralai/mistralai";\nexport const c = new Mistral();\n`],
    ["@ai-sdk/mistral", "Mistral", `import { mistral } from "@ai-sdk/mistral";\nexport const m = mistral("mistral-small-latest");\n`],
    ["cohere-ai", "Cohere", `import { CohereClientV2 } from "cohere-ai";\nexport const c = new CohereClientV2();\n`],
    ["@ai-sdk/cohere", "Cohere", `import { cohere } from "@ai-sdk/cohere";\nexport const m = cohere("command-r");\n`],
    ["groq-sdk", "Groq", `import Groq from "groq-sdk";\nexport const c = new Groq();\n`],
    ["@ai-sdk/groq", "Groq", `import { groq } from "@ai-sdk/groq";\nexport const m = groq("llama-3.1-8b-instant");\n`],
    ["@aws-sdk/client-bedrock-runtime", "AWS Bedrock", `import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";\nexport const c = new BedrockRuntimeClient({});\n`],
    ["@ai-sdk/amazon-bedrock", "AWS Bedrock", `import { bedrock } from "@ai-sdk/amazon-bedrock";\nexport const m = bedrock("amazon.nova-micro-v1:0");\n`],
  ];
  for (const [dep, subject, code] of cases) {
    it(`flags ${subject} when ${dep} is imported`, () => {
      expect(factsOf({ "package.json": pkg([dep]), "src/ai.ts": code })).toContain(`ai_provider|${subject}|${subjectId(subject)}`);
    });
    it(`ignores ${subject} (${dep}) named only in a comment, a string or a test`, () => {
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

  it.each([
    ["@mistralai/mistralai", "Mistral", "ai-provider/mistral-sdk"],
    ["@ai-sdk/cohere", "Cohere", "ai-provider/cohere-sdk"],
    ["@ai-sdk/groq", "Groq", "ai-provider/groq-sdk"],
    ["@ai-sdk/amazon-bedrock", "AWS Bedrock", "ai-provider/bedrock-sdk"],
  ])("reports %s, not the Vercel SDK, when a file uses both", (dep, subject, id) => {
    const f = factsOf({
      "package.json": pkg(["ai", dep]),
      "src/ai.ts": `import { generateText } from "ai";\nimport * as p from "${dep}";\nexport const a = [generateText, p];\n`,
    });
    expect(f.filter((x) => x.startsWith("ai_provider"))).toEqual([`ai_provider|${subject}|${id}`]);
  });

  it("places a new provider's fact at its import line", () => {
    const e = evidenceOf({
      "package.json": pkg(["groq-sdk"]),
      "src/ai.ts": `// Groq is used for quick labels.\nconst LABELS = ["a", "b"];\nimport Groq from "groq-sdk";\nexport const c = new Groq();\nexport { LABELS };\n`,
    });
    const f = e.facts.find((x) => x.detector === "ai-provider/groq-sdk");
    expect(f?.locations).toEqual([{ file: "src/ai.ts", line: 3 }]);
    expect(f?.attributes.sdk).toBe("groq-sdk");
  });

  it("does not report a decoy file that names groq-sdk and @mistralai/mistralai only in a comment and a string", () => {
    const f = factsOf({
      "package.json": pkg(["groq-sdk", "@mistralai/mistralai"]),
      "src/options.ts": `// import Groq from "groq-sdk";\n/* import { Mistral } from "@mistralai/mistralai"; */\nexport const CANDIDATES = ["groq-sdk", "@mistralai/mistralai"];\nexport const note = 'require("groq-sdk")';\n`,
    });
    expect(f.filter((x) => x.startsWith("ai_provider") || x.startsWith("data_flow"))).toEqual([]);
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
    expect(e.facts.some((f) => f.kind === "client_side_exposure" && f.claimType === "observed")).toBe(false);
  });
});

function subjectId(subject: string): string {
  return {
    OpenAI: "ai-provider/openai-sdk",
    Anthropic: "ai-provider/anthropic-sdk",
    "Google AI": "ai-provider/google-sdk",
    "Vercel AI SDK": "ai-provider/vercel-ai-sdk",
    Mistral: "ai-provider/mistral-sdk",
    Cohere: "ai-provider/cohere-sdk",
    Groq: "ai-provider/groq-sdk",
    "AWS Bedrock": "ai-provider/bedrock-sdk",
  }[subject]!;
}

describe("data flow to the newer AI providers", () => {
  const flowOf = (dep: string, code: string) => {
    const facts = evidenceOf({ "package.json": pkg([dep]), "src/ai.ts": code }).facts.filter((f) => f.kind === "data_flow");
    return facts.map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`);
  };

  it("flags request text sent through Mistral's chat.complete and chat.stream", () => {
    const head = `import { Mistral } from "@mistralai/mistralai";\nconst client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });\n`;
    expect(flowOf("@mistralai/mistralai", `${head}export function ask(text: string) {\n  return client.chat.complete({ model: "mistral-small-latest", messages: [{ role: "user", content: text }] });\n}\n`)).toEqual(["Mistral|high|4"]);
    expect(flowOf("@mistralai/mistralai", `${head}export function ask(text: string) {\n  return client.chat.stream({ model: "m", messages: [{ role: "user", content: text }] });\n}\n`)).toEqual(["Mistral|high|4"]);
  });

  it("flags request text sent through Cohere's chat", () => {
    const code = `import { CohereClientV2 } from "cohere-ai";\nconst cohere = new CohereClientV2({});\nexport async function POST(req: Request) {\n  const body = await req.json();\n  return cohere.chat({ model: "command-r", messages: [{ role: "user", content: body.text }] });\n}\n`;
    expect(flowOf("cohere-ai", code)).toEqual(["Cohere|high|5"]);
  });

  it("flags request text sent through Groq's OpenAI-shaped client", () => {
    const code = `import Groq from "groq-sdk";\nconst groq = new Groq();\nexport function label(ticket: string) {\n  return groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: ticket }] });\n}\n`;
    expect(flowOf("groq-sdk", code)).toEqual(["Groq|high|4"]);
  });

  it("flags request text sent to Bedrock in a ConverseCommand, and through the AI SDK provider", () => {
    const code = `import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";\nconst client = new BedrockRuntimeClient({ region: "eu-west-2" });\nexport function ask(question: string) {\n  return client.send(new ConverseCommand({ modelId: "amazon.nova-micro-v1:0", messages: [{ role: "user", content: [{ text: question }] }] }));\n}\n`;
    expect(flowOf("@aws-sdk/client-bedrock-runtime", code)).toEqual(["AWS Bedrock|high|4"]);
    const viaAiSdk = `import { generateText } from "ai";\nimport { bedrock } from "@ai-sdk/amazon-bedrock";\nexport function ask(question: string) {\n  return generateText({ model: bedrock("amazon.nova-micro-v1:0"), prompt: question });\n}\n`;
    expect(flowOf("@ai-sdk/amazon-bedrock", viaAiSdk)).toEqual(["AWS Bedrock|high|4"]);
  });

  it("ignores a fixed prompt in the new call shapes", () => {
    const mistral = `import { Mistral } from "@mistralai/mistralai";\nconst client = new Mistral();\nexport const r = client.chat.complete({ model: "m", messages: [{ role: "user", content: "Say hello." }] });\n`;
    expect(flowOf("@mistralai/mistralai", mistral)).toEqual([]);
    const bedrock = `import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";\nexport const c = new ConverseCommand({ modelId: "m", messages: [{ role: "user", content: [{ text: "Say hello." }] }] });\n`;
    expect(flowOf("@aws-sdk/client-bedrock-runtime", bedrock)).toEqual([]);
  });

  it("reads Cohere's bare chat call and Bedrock's command only in files that import those SDKs", () => {
    const openaiChat = `import OpenAI from "openai";\nconst bot = new OpenAI();\nexport function ask(text: string) {\n  return bot.chat({ messages: [{ role: "user", content: text }] });\n}\n`;
    expect(flowOf("openai", openaiChat)).toEqual([]);
    const openaiCommand = `import OpenAI from "openai";\nimport { ConverseCommand } from "./local";\nexport const o = new OpenAI();\nexport function ask(text: string) {\n  return new ConverseCommand({ messages: [{ role: "user", content: text }] });\n}\n`;
    expect(flowOf("openai", openaiCommand)).toEqual([]);
  });

  it("reads a Bedrock stream command through a namespace import, at medium when the source is unclear", () => {
    const code = `import * as br from "@aws-sdk/client-bedrock-runtime";\nimport { load } from "./x";\nconst note = load();\nexport const cmd = new br.ConverseStreamCommand({ modelId: "m", messages: [{ role: "user", content: [{ text: note }] }] });\n`;
    expect(flowOf("@aws-sdk/client-bedrock-runtime", code)).toEqual(["AWS Bedrock|medium|4"]);
  });

  it("does not mistake packages whose names only start with a provider's for that provider", () => {
    const f = factsOf({ "package.json": pkg(["groq-sdk-extra", "cohere-ai-tools"]), "src/a.ts": `import x from "groq-sdk-extra";\nimport y from "cohere-ai-tools";\nexport const z = [x, y];\n` });
    expect(f.filter((x) => x.startsWith("ai_provider"))).toEqual([]);
  });

  it("does not take a local function called chat for Cohere's client method", () => {
    const code = `import { CohereClientV2 } from "cohere-ai";\nexport const c = new CohereClientV2({});\nfunction chat(x: unknown) { return x; }\nexport function ask(text: string) {\n  return chat({ messages: [{ role: "user", content: text }] });\n}\n`;
    expect(flowOf("cohere-ai", code)).toEqual([]);
  });
});

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
    expect(e.facts.some((f) => f.kind === "client_side_exposure" && f.claimType === "observed")).toBe(true);
  });

  it("does not flag the Supabase anon key or an ordinary public URL (public by design)", () => {
    const e = evidenceOf({
      "package.json": pkg(),
      "a.tsx": `export const a = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\nexport const u = process.env.NEXT_PUBLIC_SITE_URL;\n`,
    });
    expect(e.facts.some((f) => f.kind === "client_side_exposure" && f.claimType === "observed")).toBe(false);
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
