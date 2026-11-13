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

describe("which provider a prompt is sent to", () => {
  const scanOf = (deps: string[], code: string) => evidenceOf({ "package.json": pkg(deps), "src/both.ts": code });
  const flowsOf = (deps: string[], code: string) =>
    scanOf(deps, code)
      .facts.filter((f) => f.kind === "data_flow")
      .map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`)
      .sort();
  const both = ["openai", "@anthropic-ai/sdk"];
  const head = `import OpenAI from "openai";\nimport Anthropic from "@anthropic-ai/sdk";\nconst o = new OpenAI();\nconst a = new Anthropic();\n`;
  const toAnthropic = (content: string) => `  return a.messages.create({ model: "m", max_tokens: 8, messages: [{ role: "user", content: ${content} }] });\n`;
  const toOpenAI = (content: string) => `  return o.chat.completions.create({ model: "m", messages: [{ role: "user", content: ${content} }] });\n`;

  it("credits a flow only to the provider whose client makes the call, at that call's line", () => {
    const code = `${head}export function health() {\n${toAnthropic(`"fixed health check"`)}}\nexport function ask(question: string) {\n${toOpenAI("question")}}\n`;
    expect(flowsOf(both, code)).toEqual(["OpenAI|high|9"]);
  });

  it("does the same the other way round, and for two dynamic calls gives each provider its own line", () => {
    const swapped = `${head}export function ask(question: string) {\n${toAnthropic("question")}}\nexport function health() {\n${toOpenAI(`"fixed health check"`)}}\n`;
    expect(flowsOf(both, swapped)).toEqual(["Anthropic|high|6"]);
    const two = `${head}import { load } from "./x";\nexport function ask(question: string) {\n${toAnthropic("question")}}\nexport function digest() {\n${toOpenAI("load()")}}\n`;
    expect(flowsOf(both, two)).toEqual(["Anthropic|high|7", "OpenAI|medium|10"]);
  });

  it("follows the client through require, a class field and this.client", () => {
    const req = `const OpenAI = require("openai");\nconst { Anthropic } = require("@anthropic-ai/sdk");\nconst o = new OpenAI();\nconst a = new Anthropic();\nexport function health() {\n${toAnthropic(`"ok"`)}}\nexport function ask(q: string) {\n${toOpenAI("q")}}\n`;
    expect(flowsOf(both, req)).toEqual(["OpenAI|high|9"]);
    const cls = `import OpenAI from "openai";\nimport Anthropic from "@anthropic-ai/sdk";\nexport class Bot {\n  private gpt = new OpenAI();\n  claude: Anthropic;\n  constructor() { this.claude = new Anthropic(); }\n  ask(q: string) {\n    return this.claude.messages.create({ model: "m", max_tokens: 8, messages: [{ role: "user", content: q }] });\n  }\n  ping() {\n    return this.gpt.responses.create({ model: "m", input: "ping" });\n  }\n}\n`;
    expect(flowsOf(both, cls)).toEqual(["Anthropic|high|8"]);
    const cast = `${head}const c = new Anthropic() as Anthropic;\nexport function ask(q: string) {\n  return c.messages.create({ model: "m", max_tokens: 8, messages: [{ role: "user", content: q }] });\n}\n`;
    expect(flowsOf(both, cast)).toEqual(["Anthropic|high|7"]);
    const ns = `import * as oa from "openai";\nimport Anthropic from "@anthropic-ai/sdk";\nconst o = new oa.OpenAI();\nexport const a = new Anthropic();\nexport function ask(q: string) {\n${toOpenAI("q")}}\n`;
    expect(flowsOf(both, ns)).toEqual(["OpenAI|high|6"]);
  });

  it("treats a name given two providers' clients as unclear, not as the first one", () => {
    const code = `${head}let c: any = new OpenAI();\nif (process.env.USE_A) c = new Anthropic();\nexport function ask(q: string) {\n  return c.messages.create({ model: "m", max_tokens: 8, messages: [{ role: "user", content: q }] });\n}\n`;
    expect(flowsOf(both, code)).toEqual(["Anthropic|low|8", "OpenAI|low|8"]);
  });

  it("reads the provider from the model passed to a Vercel AI SDK call", () => {
    const code = `import { generateText } from "ai";\nimport { openai } from "@ai-sdk/openai";\nimport { anthropic } from "@ai-sdk/anthropic";\nconst fast = anthropic("claude-haiku-5-5");\nexport function health() {\n  return generateText({ model: fast, prompt: "fixed health check" });\n}\nexport function ask(question: string) {\n  return generateText({ model: openai("gpt-4o"), prompt: question });\n}\nexport function label(ticket: string) {\n  return generateText({ model: fast, prompt: ticket });\n}\n`;
    expect(flowsOf(["ai", "@ai-sdk/openai", "@ai-sdk/anthropic"], code)).toEqual(["Anthropic|high|12", "OpenAI|high|9"]);
  });

  it("gives a call it can't tie to one provider low confidence for each, and asks which one it is", () => {
    const code = `${head}const client = process.env.USE_A === "1" ? a : o;\nexport function ask(question: string) {\n${toOpenAI("question").replace("o.chat", "client.chat")}}\n`;
    const e = scanOf(both, code);
    const flows = e.facts.filter((f) => f.kind === "data_flow");
    expect(flows.map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`).sort()).toEqual(["Anthropic|low|7", "OpenAI|low|7"]);
    expect(flows.every((f) => f.claim.startsWith("Text taken from a request or function input is included in prompts sent to"))).toBe(true);
    const q = e.unknowns.find((u) => u.id === "UQ-ai-destination-src-both-ts");
    expect(q?.question).toBe("Which AI provider receives the prompt sent from src/both.ts (line 7): Anthropic or OpenAI?");
    expect(q?.relatedFacts.sort()).toEqual(expect.arrayContaining(flows.map((f) => f.id)));
  });

  it("keeps a traced call's confidence when another call in the file is unclear", () => {
    const code = `${head}import { pick } from "./x";\nexport function ask(question: string) {\n${toOpenAI("question")}}\nexport function other(note: string) {\n  return pick().messages.create({ messages: [{ role: "user", content: note }] });\n}\n`;
    const e = scanOf(both, code);
    expect(e.facts.filter((f) => f.kind === "data_flow").map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`).sort()).toEqual(["Anthropic|low|10", "OpenAI|high|7"]);
  });

  it("still credits a single-provider file's flow when the client comes from elsewhere", () => {
    const code = `import OpenAI from "openai";\nimport { client } from "./client";\nexport const c = new OpenAI();\nexport function ask(question: string) {\n  return client.chat.completions.create({ messages: [{ role: "user", content: question }] });\n}\n`;
    expect(flowsOf(["openai"], code)).toEqual(["OpenAI|high|5"]);
    expect(scanOf(["openai"], code).unknowns.some((u) => u.id.startsWith("UQ-ai-destination"))).toBe(false);
  });

  it("does not read another provider's client as Cohere's chat, in a file that imports both", () => {
    const code = `import OpenAI from "openai";\nimport { CohereClientV2 } from "cohere-ai";\nconst bot = new OpenAI();\nconst co = new CohereClientV2({});\nexport function a(q: string) {\n  return bot.chat({ messages: [{ role: "user", content: q }] });\n}\nexport function b(q: string) {\n  return co.chat({ model: "command-r", messages: [{ role: "user", content: q }] });\n}\n`;
    expect(flowsOf(["openai", "cohere-ai"], code)).toEqual(["Cohere|high|9"]);
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

describe("ORMs: Prisma and Drizzle", () => {
  const SCHEMA = [
    "// provider = \"mysql\" was the old setup",
    "generator client {",
    '  provider = "prisma-client-js"',
    "}",
    "",
    "datasource db {",
    '  provider = "postgresql" // moved from sqlite',
    '  url      = env("DATABASE_URL")',
    "}",
    "",
  ].join("\n");
  const client = `import { PrismaClient } from "@prisma/client";\nexport const db = new PrismaClient();\n`;
  const prisma = (files: Record<string, string>, deps: string[] = []) => ({ "package.json": pkg(["@prisma/client", ...deps]), ...files });
  const stores = (files: Record<string, string>) => evidenceOf(files).facts.filter((f) => f.kind === "data_store");

  it("reads the engine from the Prisma schema's datasource, ignoring comments and the generator", () => {
    const [f, ...rest] = stores(prisma({ "prisma/schema.prisma": SCHEMA, "lib/db.ts": client }));
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ subject: "PostgreSQL", detector: "data-store/prisma", confidence: "high", attributes: { engine: "postgresql" } });
    // The schema line is what states the engine, so it is what the fact cites.
    expect(f!.locations).toEqual([{ file: "prisma/schema.prisma", line: 7 }]);
  });

  it("maps each Prisma provider to its engine", () => {
    const cases: Array<[string, string, string]> = [
      ["postgresql", "PostgreSQL", "postgresql"],
      ["postgres", "PostgreSQL", "postgresql"],
      ["mysql", "MySQL", "mysql"],
      ["sqlite", "SQLite", "sqlite"],
      ["mongodb", "MongoDB", "mongodb"],
      ["sqlserver", "SQL Server", "sqlserver"],
      ["cockroachdb", "CockroachDB", "cockroachdb"],
    ];
    for (const [provider, subject, engine] of cases) {
      const schema = `datasource   main{\n\tprovider='${provider}'\n}\n`.replace(/'/g, '"');
      const f = stores(prisma({ "db/schema.prisma": schema, "src/db.ts": client }));
      expect(f.map((x) => [x.subject, x.attributes.engine]), provider).toEqual([[subject, engine]]);
    }
  });

  it("reads a schema with CRLF endings, the url first and extra datasource fields", () => {
    const schema = [
      "datasource db {",
      '  url        = "postgres://app@db.internal/app" // a literal, not env()',
      '  directUrl  = env("DIRECT_URL")',
      '  extensions = [pgvector(map: "vector")]',
      '  provider   = "postgresql"',
      "}",
      "",
    ].join("\r\n");
    const [f, ...rest] = stores(prisma({ "prisma/schema.prisma": schema, "src/db.ts": client }));
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ subject: "PostgreSQL", attributes: { engine: "postgresql" } });
    expect(f!.locations).toContainEqual({ file: "prisma/schema.prisma", line: 5 });
    expect(JSON.stringify(f)).not.toContain("db.internal");
    expect(JSON.stringify(f)).not.toContain("DIRECT_URL");
  });

  it("reads a one-line datasource, with the provider after a url that holds //", () => {
    const cases: Array<[string, string]> = [
      ['datasource db { provider = "postgresql" url = env("DATABASE_URL") }', "PostgreSQL"],
      ['datasource db { url = "file:./dev.db" provider = "sqlite" }', "SQLite"],
      ['datasource db { url = "mongodb+srv://cluster.example/app" provider = "mongodb" }', "MongoDB"],
    ];
    for (const [schema, subject] of cases) {
      const f = stores(prisma({ "prisma/schema.prisma": `${schema}\n`, "src/db.ts": client }));
      expect(f.map((x) => [x.subject, x.detector]), schema).toEqual([[subject, "data-store/prisma"]]);
      expect(f[0]!.locations).toEqual([{ file: "prisma/schema.prisma", line: 1 }]);
      expect(JSON.stringify(f)).not.toContain("cluster.example");
    }
  });

  it("doesn't read a provider written inside a string, or after a // that ends a line", () => {
    const inString = 'datasource db {\n  url = "x provider = \\"mysql\\""\n}\n';
    expect(stores(prisma({ "prisma/schema.prisma": inString, "src/db.ts": client })).map((x) => x.subject)).toEqual(["SQL database (Prisma)"]);
    const afterComment = 'datasource db {\n  url = "file:./dev.db" // provider = "sqlite"\n}\n';
    expect(stores(prisma({ "prisma/schema.prisma": afterComment, "src/db.ts": client })).map((x) => x.subject)).toEqual(["SQL database (Prisma)"]);
  });

  it("reads a multi-file schema, wherever the datasource block is", () => {
    const f = stores(prisma({ "prisma/schema/models.prisma": "model Note {\n  id Int @id\n}\n", "prisma/schema/base.prisma": SCHEMA, "src/db.ts": client }));
    expect(f.map((x) => x.subject)).toEqual(["PostgreSQL"]);
    expect(f[0]!.locations).toEqual([{ file: "prisma/schema/base.prisma", line: 7 }]);
  });

  it("never records the datasource url or the env variable it names", () => {
    // Built from parts so the repo itself holds nothing shaped like a credentialed URL.
    const url = ["postgresql:", "", ["app", rand(12)].join(":") + "@db.internal:5432", "notes"].join("/");
    const literal = SCHEMA.replace('env("DATABASE_URL")', `"${url}"`);
    for (const schema of [SCHEMA, literal]) {
      const text = JSON.stringify(evidenceOf(prisma({ "prisma/schema.prisma": schema, "src/db.ts": client })));
      expect(text).not.toContain(url);
      expect(text).not.toContain("db.internal");
      expect(text).not.toContain("DATABASE_URL");
      expect(text).not.toContain("env(");
    }
  });

  it("falls back to the library when no schema can be read", () => {
    const [f, ...rest] = stores(prisma({ "src/db.ts": client }));
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ subject: "SQL database (Prisma)", detector: "data-store/prisma", confidence: "medium", attributes: { engine: "sql" } });
    // A schema whose provider is commented out, or names something unknown, says nothing either.
    const commented = stores(prisma({ "prisma/schema.prisma": 'datasource db {\n  // provider = "postgresql"\n}\n', "src/db.ts": client }));
    expect(commented.map((x) => x.subject)).toEqual(["SQL database (Prisma)"]);
    const odd = stores(prisma({ "prisma/schema.prisma": 'datasource db {\n  provider = "somethingelse"\n}\n', "src/db.ts": client }));
    expect(odd.map((x) => x.subject)).toEqual(["SQL database (Prisma)"]);
  });

  it("ignores Prisma named in a README, a comment, a string or a test file", () => {
    const files = prisma({
      "README.md": "```prisma\ndatasource db {\n  provider = \"postgresql\"\n}\n```\n",
      "src/db.ts": `// import { PrismaClient } from "@prisma/client";\nexport const note = "@prisma/client";\n`,
      "src/db.test.ts": client,
      "tests/setup.ts": client,
    });
    expect(stores(files).filter((f) => f.claimType !== "not-found")).toEqual([]);
    // A schema file with no client imported in product code is not a use either.
    expect(stores({ ...files, "prisma/schema.prisma": SCHEMA }).filter((f) => f.claimType !== "not-found")).toEqual([]);
  });

  it("reports Prisma plus a pg import for the same database as one PostgreSQL store", () => {
    const f = stores(prisma({ "prisma/schema.prisma": SCHEMA, "src/db.ts": client, "src/raw.ts": `import { Pool } from "pg";\nexport const p = Pool;\n` }, ["pg"]));
    expect(f.map((x) => `${x.subject}|${x.detector}`)).toEqual(["PostgreSQL|data-store/postgres"]);
    // The schema still backs the one fact, so nothing that supported it is lost.
    expect(f[0]!.locations.map((l) => l.file)).toEqual(["prisma/schema.prisma", "src/raw.ts"]);
    const unknowns = evidenceOf(prisma({ "prisma/schema.prisma": SCHEMA, "src/db.ts": client, "src/raw.ts": `import { Pool } from "pg";\n` }, ["pg"])).unknowns;
    expect(unknowns.filter((u) => u.topic === "Database hosting").map((u) => u.id)).toEqual(["UQ-postgresql-hosting"]);
  });

  it("drops the Prisma fallback once a specific SQL engine is known", () => {
    const f = stores(prisma({ "src/db.ts": client, "src/raw.ts": `import mysql from "mysql2";\nexport const m = mysql;\n` }, ["mysql2"]));
    expect(f.map((x) => x.subject)).toEqual(["MySQL"]);
  });

  it("drops a connection string for the engine Prisma already reports, and keeps one for another store", () => {
    const f = stores(prisma({ "prisma/schema.prisma": SCHEMA, "src/db.ts": client, "docker-compose.yml": "a: postgres://app:${PW}@db/app\nb: redis://cache:6379\n" }));
    expect(f.map((x) => `${x.subject}|${x.detector}`).sort()).toEqual(["PostgreSQL|data-store/prisma", "Redis|data-store/connection-string"]);
  });

  it("drops the Prisma fallback when a connection string names the engine", () => {
    const f = stores(prisma({ "src/db.ts": client, "docker-compose.yml": "a: postgresql://app:${PW}@db/app\n" }));
    expect(f.map((x) => `${x.subject}|${x.detector}`)).toEqual(["PostgreSQL|data-store/connection-string"]);
  });

  it("asks where a Prisma store is hosted with the usual question", () => {
    const ev = evidenceOf(prisma({ "prisma/schema.prisma": SCHEMA, "src/db.ts": client }));
    const q = ev.unknowns.find((u) => u.id === "UQ-postgresql-hosting");
    expect(q?.question).toBe("Where is the PostgreSQL database hosted, and by whom?");
    expect(ev.unknowns.map((u) => u.id)).toContain("UQ-retention-deletion");
  });

  const drizzle = (files: Record<string, string>, deps: string[] = []) => ({ "package.json": pkg(["drizzle-orm", ...deps]), ...files });

  it("reads the engine from Drizzle's schema module", () => {
    const cases: Array<[string, string, string]> = [
      ["pg-core", "PostgreSQL", "postgresql"],
      ["mysql-core", "MySQL", "mysql"],
      ["sqlite-core", "SQLite", "sqlite"],
    ];
    for (const [sub, subject, engine] of cases) {
      const f = stores(drizzle({ "db/schema.ts": `import { integer } from "drizzle-orm/${sub}";\nexport const id = integer;\n` }));
      expect(f.map((x) => [x.subject, x.detector, x.attributes.engine, x.confidence, x.locations[0]]), sub).toEqual([
        [subject, "data-store/drizzle", engine, "high", { file: "db/schema.ts", line: 1 }],
      ]);
    }
  });

  it("falls back to Drizzle when no schema module names the engine, and drops the fallback when one does", () => {
    const db = `import { drizzle } from "drizzle-orm/neon-http";\nimport { eq } from "drizzle-orm";\nexport const x = [drizzle, eq];\n`;
    const only = stores(drizzle({ "db/index.ts": db }));
    expect(only.map((x) => [x.subject, x.attributes.engine, x.confidence])).toEqual([["SQL database (Drizzle)", "sql", "high"]]);
    const both = stores(drizzle({ "db/index.ts": db, "db/schema.ts": `const { pgTable } = require("drizzle-orm/pg-core");\nmodule.exports = pgTable;\n` }));
    expect(both.map((x) => x.subject)).toEqual(["PostgreSQL"]);
  });

  it("ignores Drizzle named in a comment, a string or a test file", () => {
    const f = stores(
      drizzle({
        "db/schema.ts": `// import { pgTable } from "drizzle-orm/pg-core";\nexport const s = "drizzle-orm/mysql-core";\n`,
        "db/schema.test.ts": `import { sqliteTable } from "drizzle-orm/sqlite-core";\nexport const t = sqliteTable;\n`,
      }),
    );
    expect(f.filter((x) => x.claimType !== "not-found")).toEqual([]);
  });

  it("reports Drizzle on pg-core with a postgres driver as one PostgreSQL store", () => {
    const f = stores(
      drizzle(
        {
          "db/schema.ts": `import { pgTable } from "drizzle-orm/pg-core";\nexport const t = pgTable;\n`,
          "db/index.ts": `import { drizzle } from "drizzle-orm/postgres-js";\nimport postgres from "postgres";\nexport const db = drizzle(postgres());\n`,
        },
        ["postgres"],
      ),
    );
    expect(f.map((x) => `${x.subject}|${x.detector}`)).toEqual(["PostgreSQL|data-store/postgres"]);
  });

  it("reports Prisma and Drizzle on the same engine as one store, and different engines separately", () => {
    const same = stores({
      "package.json": pkg(["@prisma/client", "drizzle-orm"]),
      "prisma/schema.prisma": SCHEMA,
      "src/db.ts": client,
      "src/schema.ts": `import { pgTable } from "drizzle-orm/pg-core";\nexport const t = pgTable;\n`,
    });
    expect(same.map((x) => `${x.subject}|${x.detector}`)).toEqual(["PostgreSQL|data-store/prisma"]);
    const different = stores({
      "package.json": pkg(["@prisma/client", "drizzle-orm"]),
      "prisma/schema.prisma": SCHEMA,
      "src/db.ts": client,
      "src/cache.ts": `import { sqliteTable } from "drizzle-orm/sqlite-core";\nexport const t = sqliteTable;\n`,
    });
    expect(different.map((x) => x.subject).sort()).toEqual(["PostgreSQL", "SQLite"]);
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
