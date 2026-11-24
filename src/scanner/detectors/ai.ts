import type { FactDraft } from "../../evidence/build.js";
import { walkAst } from "../../core/js.js";
import type { Node } from "@babel/types";
import { calls, chainOf, dynamicRoots, endsWith, firstStringProperty, lineOf, localBinding, namedImports, paramNames, requestVariables } from "../ast.js";
import { importsModule, importsPy, packageRoot } from "../context.js";
import { aiPayload, firstStringKwarg, withinModule } from "../python/parse.js";
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
  /** What the claim calls the package. Defaults to "SDK". */
  library?: string;
  /** A sentence added to the claim when the code alone can't say where the data goes. */
  caveat?: string;
  /** A question this provider raises besides its data-use one, linked to its facts. */
  question?: { key: string; topic: string; question: string; why: string };
}

const routerQuestion = (subject: string): ProviderSpec["question"] => ({
  key: `${subject.toLowerCase()}-routed-vendors`,
  topic: "AI routing",
  question: `Which model vendors does ${subject} route this app's requests to?`,
  why: `${subject} picks the vendor from model names and configuration, so the scan can't tell which vendors receive the data.`,
});

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
  {
    id: "ai-provider/ollama-sdk",
    subject: "Ollama",
    packages: ["ollama"],
    pyModules: ["ollama", "langchain_ollama"],
    calls: { js: [["chat"], ["generate"]], py: [["chat"], ["generate"]] },
    library: "client library",
    // Ollama's server can run on this machine or anywhere else, so the claim never says the data stays local.
    caveat: "The scan doesn't read where the Ollama server it talks to runs: it can be this machine or another one.",
    question: {
      key: "ollama-server-location",
      topic: "AI model hosting",
      question: "Where does the Ollama server that this code calls run (on the same machine, on a server you run, or at a hosting provider), and who operates it?",
      why: "The scan doesn't read the server's address, and an address alone doesn't show who runs the server.",
    },
  },
  {
    id: "ai-provider/litellm",
    subject: "LiteLLM",
    packages: [],
    pyModules: ["litellm"],
    calls: { py: [["completion"], ["acompletion"]] },
    caveat: "LiteLLM sends requests on to model vendors chosen by model name and configuration, which the scan doesn't identify.",
    question: routerQuestion("LiteLLM"),
  },
  {
    id: "ai-provider/openrouter",
    subject: "OpenRouter",
    packages: ["@openrouter/sdk", "@openrouter/ai-sdk-provider"],
    pyModules: [],
    calls: { js: [["chat", "send"]] },
    caveat: "OpenRouter forwards requests to model vendors chosen by model name and its routing settings, which the scan doesn't identify.",
    question: routerQuestion("OpenRouter"),
  },
  { id: "ai-provider/vercel-ai-sdk", subject: "Vercel AI SDK", packages: ["ai"], pyModules: [] },
];

const withCaveat = (spec: ProviderSpec, claim: string) => (spec.caveat ? `${claim} ${spec.caveat}` : claim);

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

/**
 * A file that imports the SDK but names no model (the file that makes the client) is the same use
 * of it as the file that does. When the files using one SDK from one place name a single model
 * between them, the others get it too, so they merge into one fact. Two different models stay apart.
 */
function shareModel(drafts: FactDraft[]): FactDraft[] {
  const use = (d: FactDraft) => `${String(d.attributes?.sdk)}|${String(d.attributes?.runsOn)}|${d.claim}`;
  const models = new Map<string, Set<string>>();
  for (const d of drafts) if (typeof d.attributes?.model === "string") models.set(use(d), (models.get(use(d)) ?? new Set()).add(d.attributes.model));
  return drafts.map((d) => {
    const named = models.get(use(d));
    return d.attributes?.model === undefined && named?.size === 1 ? { ...d, attributes: { ...d.attributes, model: [...named][0]! } } : d;
  });
}

function aiProviderDetector(spec: ProviderSpec): Detector {
  const library = spec.library ?? "SDK";
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
            claim: withCaveat(spec, `The app uses the ${spec.subject} ${library} from server code.`),
            attributes: { sdk: imp?.module ?? spec.pyModules[0]!, runsOn: "server", ...(model ? { model } : {}) },
            confidence: "high",
            detector: spec.id,
            key: f.file,
            locations: [{ file: f.file, ...(imp?.line ? { line: imp.line } : {}) }],
          };
        }),
      ...shareModel(
        ctx.js
          .filter((f) => providersIn(f).includes(spec))
          .map((f): FactDraft => {
            const imp = spec.packages.map((p) => importsModule(f, p)).find(Boolean);
            const model = firstStringProperty(f.ast, "model");
            const where = runsOn(f);
            return {
              kind: "ai_provider",
              subject: spec.subject,
              claim: withCaveat(
                spec,
                where === "browser"
                  ? `The browser code imports the ${spec.subject} ${library}.`
                  : `The app uses the ${spec.subject} ${library}${where === "server" ? " from server code" : ""}.`,
              ),
              attributes: { sdk: (imp && packageRoot(imp.source)) ?? spec.packages[0]!, runsOn: where, ...(model ? { model } : {}) },
              confidence: "high",
              detector: spec.id,
              key: f.file,
              locations: [{ file: f.file, ...(imp?.line ? { line: imp.line } : {}) }],
            };
          }),
      ),
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
/**
 * Calls whose method names (`parse`, `generate`, `edit`) are common in ordinary code, so they count
 * only on a receiver (`client.images.generate(…)`): a bare `images.generate(…)` is the project's own object.
 */
const AI_CALL_TAILS_ON_CLIENT: string[][] = [
  ["chat", "completions", "parse"],
  ["responses", "parse"],
  ["images", "generate"],
  ["images", "edit"],
];
const AI_CALL_FUNCTIONS = new Set(["generateText", "streamText", "generateObject", "streamObject", "embed", "embedMany"]);
/**
 * The module that exports `AI_CALL_FUNCTIONS`. A bare call counts only when its name is imported from it:
 * `import { generateText } from "ai"` makes `generateText(...)` a model call, `import { generateText as gt } from "ai"`
 * makes `gt(...)` one, and a `generateText` defined in the file or imported from elsewhere is not.
 */
const AI_CALL_MODULES = new Set(["ai"]);
const CONTENT_KEYS = new Set(["content", "prompt", "input", "contents", "text", "system", "messages"]);
/**
 * Calls that take the prompt itself as their first argument (`model.generateContent(prompt)`), read only
 * on a receiver and only in files that import Google's own SDK (`POSITIONAL_PROMPT_SDKS`). Other SDKs take
 * an options object there, and other objects have methods of the same name, so elsewhere it is not read.
 */
const POSITIONAL_PROMPT_TAILS: string[][] = [["generateContent"], ["generateContentStream"]];
/** Google's own SDKs, whose `generateContent` takes the prompt positionally. */
const POSITIONAL_PROMPT_SDKS = { js: ["@google/generative-ai", "@google/genai"], py: ["google.generativeai", "google.genai"] };
/** Argument shapes that can carry text: a fixed string has no roots, so it still gives nothing. */
const POSITIONAL_PROMPT_TYPES = new Set(["Identifier", "TemplateLiteral", "BinaryExpression", "ArrayExpression"]);

/**
 * What a bare name used at a node was imported as from `modules`, or null when it isn't imported from them or
 * something closer re-binds it (a parameter, a local `const`, `let` or `var`, a function, a class).
 */
function sdkScope(f: JsFile, modules: ReadonlySet<string>): (name: string, at: Node) => string | null {
  const imported = namedImports(f.ast, modules);
  let bound: ReturnType<typeof localBinding> | undefined;
  return (name, at) => {
    const original = imported.get(name);
    if (original === undefined) return null;
    return (bound ??= localBinding(f.ast, modules))(at, name) ? null : original;
  };
}

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
  // A bare name is the SDK's only when imported from the SDK's own module; it resolves to the name it was imported as.
  const fnScope = sdkScope(f, AI_CALL_MODULES);
  const commandScope = sdkScope(f, new Set(providers.flatMap((p) => (p.commands ? p.packages : []))));
  let best: { confidence: "high" | "medium"; line?: number } | null = null;
  const positionalSdk = POSITIONAL_PROMPT_SDKS.js.some((m) => importsModule(f, m));

  const sends: Array<{ args: Node[]; line?: number; positional?: boolean }> = [];
  for (const call of calls(f.ast)) {
    const isAiCall =
      (call.chain !== null && AI_CALL_TAILS.some((t) => endsWith(call.chain, t))) ||
      (call.chain !== null && AI_CALL_TAILS_ON_CLIENT.some((t) => call.chain!.length > t.length && endsWith(call.chain, t))) ||
      (call.chain !== null && call.chain.length === 1 && call.node.type === "CallExpression" && AI_CALL_FUNCTIONS.has(fnScope(call.chain[0]!, call.node.callee) ?? "")) ||
      (call.chain !== null && ownTails.some((t) => call.chain!.length > t.length && endsWith(call.chain, t)));
    if (isAiCall && call.node.type === "CallExpression") {
      const positional = positionalSdk && call.chain!.length > 1 && POSITIONAL_PROMPT_TAILS.some((t) => endsWith(call.chain, t));
      sends.push({ args: call.node.arguments, ...(call.line ? { line: call.line } : {}), ...(positional ? { positional } : {}) });
    }
  }
  if (commands.size > 0) {
    walkAst(f.ast, (n) => {
      if (n.type !== "NewExpression") return undefined;
      const chain = chainOf(n.callee);
      const line = lineOf(n);
      const name = chain?.length === 1 ? commandScope(chain[0]!, n.callee) : chain?.[chain.length - 1];
      if (name && commands.has(name)) sends.push({ args: n.arguments, ...(line ? { line } : {}) });
      return undefined;
    });
  }

  sends.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  for (const call of sends) {
    const roots = new Set<string>();
    const first = call.args[0];
    if (call.positional && first && POSITIONAL_PROMPT_TYPES.has(first.type)) for (const r of dynamicRoots(first)) roots.add(r);
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
      const modules = providers.flatMap((p) => p.pyModules);
      // Names imported from the SDK (`from google.generativeai import generate_text`): only these count as bare calls.
      const sdkNames = new Set(f.imports.filter((i) => modules.some((m) => withinModule(i.module, m))).flatMap((i) => i.names));
      const payload = aiPayload(f.lines, f.calls, f.funcs, providers.flatMap((p) => p.calls?.py ?? []), !!importsPy(f, ...POSITIONAL_PROMPT_SDKS.py), sdkNames);
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
