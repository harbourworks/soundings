import type { FactDraft } from "../../evidence/build.js";
import { walkAst } from "../../core/js.js";
import type { Node } from "@babel/types";
import { calls, chainOf, dynamicRoots, endsWith, firstStringProperty, lineOf, namedImports, paramNames, requestVariables } from "../ast.js";
import { importsModule, importsPy } from "../context.js";
import { aiPayload, firstStringKwarg } from "../python/parse.js";
import type { Detector, JsFile, ScanContext } from "../types.js";

interface ProviderSpec {
  id: string;
  subject: string;
  /** Importing any of these means the provider's SDK is in use. */
  packages: string[];
  /** Python modules that mean the same provider. */
  pyModules: string[];
  /**
   * Call shapes too generic to read in every AI file (`co.chat(...)`), read only in files that import
   * this provider, and only as a method on an object. `js` and `py` are dotted-name tails.
   */
  calls?: { js?: string[][]; py?: string[][] };
  /** Command classes whose constructor takes the prompt: `new ConverseCommand({ messages })`. */
  commands?: string[];
}

export const AI_PROVIDERS: ProviderSpec[] = [
  { id: "ai-provider/openai-sdk", subject: "OpenAI", packages: ["openai", "@ai-sdk/openai"], pyModules: ["openai", "langchain_openai"] },
  { id: "ai-provider/anthropic-sdk", subject: "Anthropic", packages: ["@anthropic-ai/sdk", "@ai-sdk/anthropic"], pyModules: ["anthropic", "langchain_anthropic"] },
  { id: "ai-provider/google-sdk", subject: "Google AI", packages: ["@google/generative-ai", "@google/genai", "@ai-sdk/google"], pyModules: ["google.generativeai", "google.genai", "langchain_google_genai", "vertexai"] },
  { id: "ai-provider/mistral-sdk", subject: "Mistral", packages: ["@mistralai/mistralai", "@ai-sdk/mistral"], pyModules: ["mistralai", "langchain_mistralai"] },
  {
    id: "ai-provider/cohere-sdk",
    subject: "Cohere",
    packages: ["cohere-ai", "@ai-sdk/cohere"],
    pyModules: ["cohere", "langchain_cohere"],
    calls: { js: [["chat"], ["chatStream"]], py: [["chat"], ["chat_stream"]] },
  },
  { id: "ai-provider/groq-sdk", subject: "Groq", packages: ["groq-sdk", "@ai-sdk/groq"], pyModules: ["groq"] },
  {
    id: "ai-provider/bedrock-sdk",
    subject: "AWS Bedrock",
    packages: ["@aws-sdk/client-bedrock-runtime", "@ai-sdk/amazon-bedrock"],
    pyModules: ["langchain_aws"],
    commands: ["ConverseCommand", "ConverseStreamCommand"],
  },
  { id: "ai-provider/vercel-ai-sdk", subject: "Vercel AI SDK", packages: ["ai"], pyModules: [] },
];

/** The provider(s) a file uses. A file using a named provider plus the Vercel SDK reports only the named provider. */
function providersIn(f: JsFile): ProviderSpec[] {
  const used = AI_PROVIDERS.filter((p) => p.packages.some((pkg) => importsModule(f, pkg)));
  const named = used.filter((p) => p.subject !== "Vercel AI SDK");
  return named.length > 0 ? named : used;
}

/** Where the code runs, as far as the file shows. Honest about not knowing. */
function runsOn(f: JsFile): "browser" | "server" | "unclear" {
  if (f.isClient) return "browser";
  if (/(^|\/)(api|server|routes?|actions)(\/|\.)|route\.[cm]?[jt]s$/.test(f.file) || !/\.[jt]sx$/.test(f.file)) return "server";
  return "unclear";
}

function aiProviderDetector(spec: ProviderSpec): Detector {
  return {
    id: spec.id,
    skipReason: (ctx) => (ctx.hasDep(...spec.packages) || (spec.pyModules.length > 0 && ctx.hasPyImport(...spec.pyModules)) ? null : `no ${spec.subject} package in dependencies`),
    run: (ctx) => [
      ...ctx.py
        .filter((f) => spec.pyModules.length > 0 && importsPy(f, ...spec.pyModules))
        .map((f): FactDraft => {
          const imp = importsPy(f, ...spec.pyModules);
          const model = firstStringKwarg(f.lines, "model");
          return {
            kind: "ai_provider",
            subject: spec.subject,
            claim: `The app uses the ${spec.subject} SDK from server code.`,
            attributes: { sdk: imp?.module ?? spec.pyModules[0]!, runsOn: "server", ...(model ? { model } : {}) },
            confidence: "high",
            detector: spec.id,
            key: f.file,
            locations: [{ file: f.file, ...(imp?.line ? { line: imp.line } : {}) }],
          };
        }),
      ...ctx.js
        .filter((f) => providersIn(f).includes(spec))
        .map((f): FactDraft => {
          const imp = spec.packages.map((p) => importsModule(f, p)).find(Boolean);
          const model = firstStringProperty(f.ast, "model");
          const where = runsOn(f);
          return {
            kind: "ai_provider",
            subject: spec.subject,
            claim:
              where === "browser"
                ? `The browser code imports the ${spec.subject} SDK.`
                : `The app uses the ${spec.subject} SDK${where === "server" ? " from server code" : ""}.`,
            attributes: { sdk: imp?.source ?? spec.packages[0]!, runsOn: where, ...(model ? { model } : {}) },
            confidence: "high",
            detector: spec.id,
            key: f.file,
            locations: [{ file: f.file, ...(imp?.line ? { line: imp.line } : {}) }],
          };
        }),
    ],
  };
}

/** Calls that send a prompt or input to a model. */
const AI_CALL_TAILS: string[][] = [
  ["chat", "completions", "create"],
  ["chat", "completions", "stream"],
  ["responses", "create"],
  ["completions", "create"],
  ["embeddings", "create"],
  ["messages", "create"],
  ["messages", "stream"],
  ["generateContent"],
  ["generateContentStream"],
  ["chat", "complete"],
  ["chat", "stream"],
];
const AI_CALL_FUNCTIONS = new Set(["generateText", "streamText", "generateObject", "streamObject", "embed", "embedMany"]);
/** The module that exports `AI_CALL_FUNCTIONS`, so `import { generateText as gt } from "ai"` makes `gt(...)` a model call. */
const AI_CALL_MODULES = new Set(["ai"]);
const CONTENT_KEYS = new Set(["content", "prompt", "input", "contents", "text", "system", "messages"]);

/**
 * Finds model calls whose prompt content comes from somewhere other than a fixed string.
 * "high" when that content traces to a request or a function parameter (a caller supplies it),
 * "medium" when it is dynamic but its source isn't clear.
 */
function payloadIn(f: JsFile, providers: ProviderSpec[]): { confidence: "high" | "medium"; line?: number } | null {
  const requestVars = requestVariables(f.ast);
  const params = paramNames(f.ast);
  const ownTails = providers.flatMap((p) => p.calls?.js ?? []);
  const commands = new Set(providers.flatMap((p) => p.commands ?? []));
  // Aliased names resolve to what they were imported as, only when imported from the SDK's own module.
  const fnNames = namedImports(f.ast, AI_CALL_MODULES);
  const commandNames = namedImports(f.ast, new Set(providers.flatMap((p) => (p.commands ? p.packages : []))));
  let best: { confidence: "high" | "medium"; line?: number } | null = null;

  const sends: Array<{ args: Node[]; line?: number }> = [];
  for (const call of calls(f.ast)) {
    const isAiCall =
      (call.chain !== null && AI_CALL_TAILS.some((t) => endsWith(call.chain, t))) ||
      (call.chain !== null && call.chain.length === 1 && AI_CALL_FUNCTIONS.has(fnNames.get(call.chain[0]!) ?? call.chain[0]!)) ||
      (call.chain !== null && ownTails.some((t) => call.chain!.length > t.length && endsWith(call.chain, t)));
    if (isAiCall && call.node.type === "CallExpression") sends.push({ args: call.node.arguments, ...(call.line ? { line: call.line } : {}) });
  }
  if (commands.size > 0) {
    walkAst(f.ast, (n) => {
      if (n.type !== "NewExpression") return undefined;
      const chain = chainOf(n.callee);
      const line = lineOf(n);
      const name = chain?.length === 1 ? (commandNames.get(chain[0]!) ?? chain[0]!) : chain?.[chain.length - 1];
      if (name && commands.has(name)) sends.push({ args: n.arguments, ...(line ? { line } : {}) });
      return undefined;
    });
  }

  sends.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  for (const call of sends) {
    const roots = new Set<string>();
    for (const arg of call.args) {
      walkAst(arg, (n) => {
        if (n.type === "ObjectProperty" && !n.computed) {
          const key = n.key.type === "Identifier" ? n.key.name : n.key.type === "StringLiteral" ? n.key.value : null;
          if (key && CONTENT_KEYS.has(key) && n.value.type !== "StringLiteral") for (const r of dynamicRoots(n.value)) roots.add(r);
        }
        return undefined;
      });
    }
    // `role` and `model` identifiers aren't content; only roots that carry data matter.
    const traced = [...roots].some((r) => requestVars.has(r) || params.has(r) || r === "req" || r === "request");
    if (roots.size === 0) continue;
    const candidate = { confidence: traced ? ("high" as const) : ("medium" as const), ...(call.line ? { line: call.line } : {}) };
    if (!best || (candidate.confidence === "high" && best.confidence !== "high")) best = candidate;
  }
  return best;
}

const dataFlowDetector: Detector = {
  id: "data-flow/ai-request-payload",
  skipReason: (ctx: ScanContext) => (AI_PROVIDERS.some((p) => ctx.hasDep(...p.packages) || (p.pyModules.length > 0 && ctx.hasPyImport(...p.pyModules))) ? null : "no AI SDK in dependencies"),
  run: (ctx) => {
    const facts: FactDraft[] = [];
    for (const f of ctx.py) {
      const providers = AI_PROVIDERS.filter((p) => p.pyModules.length > 0 && importsPy(f, ...p.pyModules));
      if (providers.length === 0) continue;
      const payload = aiPayload(f.lines, f.calls, f.funcs, providers.flatMap((p) => p.calls?.py ?? []));
      if (!payload) continue;
      for (const p of providers) {
        facts.push({
          kind: "data_flow",
          subject: p.subject,
          claim:
            payload.confidence === "high"
              ? `Text taken from a request or function input is included in prompts sent to ${p.subject}.`
              : `Variable content is included in prompts sent to ${p.subject}; its source isn't clear from the code.`,
          attributes: { dataCategories: ["user-supplied content"], destination: p.subject, direction: "outbound" },
          confidence: payload.confidence,
          detector: "data-flow/ai-request-payload",
          key: f.file,
          locations: [{ file: f.file, line: payload.line }],
        });
      }
    }
    for (const f of ctx.js) {
      const providers = providersIn(f);
      if (providers.length === 0) continue;
      const payload = payloadIn(f, providers);
      if (!payload) continue;
      for (const p of providers) {
        facts.push({
          kind: "data_flow",
          subject: p.subject,
          claim:
            payload.confidence === "high"
              ? `Text taken from a request or function input is included in prompts sent to ${p.subject}.`
              : `Variable content is included in prompts sent to ${p.subject}; its source isn't clear from the code.`,
          attributes: { dataCategories: ["user-supplied content"], destination: p.subject, direction: "outbound" },
          confidence: payload.confidence,
          detector: "data-flow/ai-request-payload",
          key: f.file,
          locations: [{ file: f.file, ...(payload.line ? { line: payload.line } : {}) }],
        });
      }
    }
    return facts;
  },
};

export const aiDetectors: Detector[] = [...AI_PROVIDERS.map(aiProviderDetector), dataFlowDetector];
