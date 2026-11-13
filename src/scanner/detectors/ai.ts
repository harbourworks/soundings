import type { FactDraft } from "../../evidence/build.js";
import { walkAst } from "../../core/js.js";
import type { Node } from "@babel/types";
import { boundNames, calls, chainOf, dynamicRoots, endsWith, firstStringProperty, lineOf, paramNames, requestVariables } from "../ast.js";
import { importsModule, importsPy } from "../context.js";
import { aiSends, assignments, callEndsWith, firstStringKwarg, importBindings, withinModule } from "../python/parse.js";
import type { Detector, JsFile, PyFile, ScanContext } from "../types.js";

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
const CONTENT_KEYS = new Set(["content", "prompt", "input", "contents", "text", "system", "messages"]);

/** A model call whose prompt is not a fixed string, and the providers it may go to: one when the scan can tell. */
interface Send {
  /** High when the prompt traces to a request or a function parameter (a caller supplies it), medium when it is dynamic but unclear. */
  source: "high" | "medium";
  line?: number;
  providers: ProviderSpec[];
}

/** Root of the value a name is bound to: `new OpenAI()` and `openai("gpt-4o")` give their callee, `a.b` gives itself. */
function valueChain(n: Node | null | undefined): string[] | null {
  if (!n) return null;
  if (n.type === "AwaitExpression") return valueChain(n.argument);
  if (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "TSNonNullExpression" || n.type === "ParenthesizedExpression") return valueChain(n.expression);
  if (n.type === "NewExpression") return chainOf(n.callee);
  return chainOf(n);
}

/** The module a `require("x")` or `import("x")` call loads. */
function loaded(n: Node | null | undefined): string | null {
  if (n?.type === "AwaitExpression") return loaded(n.argument);
  if (n?.type !== "CallExpression") return null;
  const [arg] = n.arguments;
  const isLoad = (n.callee.type === "Identifier" && n.callee.name === "require") || n.callee.type === "Import";
  return isLoad && arg?.type === "StringLiteral" ? arg.value : null;
}

const ownsPackage = (p: ProviderSpec, source: string) => p.packages.some((pkg) => source === pkg || source.startsWith(`${pkg}/`));

/**
 * Which provider each name in the file stands for: names imported from a provider's package, and
 * clients made from them (`const o = new OpenAI()`, `this.claude = new Anthropic()`, `const fast = anthropic("…")`).
 * A name given clients of two different providers anywhere in the file stands for neither.
 */
function jsBindings(f: JsFile): (chain: string[] | null) => ProviderSpec | undefined {
  const bound = new Map<string, ProviderSpec | null>();
  const resolve = (chain: string[] | null) => {
    if (!chain) return undefined;
    for (let n = chain.length; n > 0; n--) {
      const p = bound.get(chain.slice(0, n).join("."));
      if (p !== undefined) return p ?? undefined;
    }
    return undefined;
  };
  const bind = (names: string[], p: ProviderSpec | undefined) => {
    if (p) for (const name of names) bound.set(name, bound.has(name) && bound.get(name) !== p ? null : p);
  };
  walkAst(f.ast, (n) => {
    if (n.type === "ImportDeclaration") bind(n.specifiers.map((s) => s.local.name), AI_PROVIDERS.find((p) => ownsPackage(p, n.source.value)));
    if (n.type === "VariableDeclarator") {
      const source = loaded(n.init);
      if (source) bind(boundNames(n.id), AI_PROVIDERS.find((p) => ownsPackage(p, source)));
    }
    return undefined;
  });
  // Clients, in two passes so that a client made from another client (`const c = o`) is followed.
  for (let pass = 0; pass < 2; pass++) {
    walkAst(f.ast, (n) => {
      if (n.type === "VariableDeclarator" && n.id.type === "Identifier") bind([n.id.name], resolve(valueChain(n.init)));
      if (n.type === "AssignmentExpression" && n.operator === "=") {
        const target = chainOf(n.left);
        if (target) bind([target.join(".")], resolve(valueChain(n.right)));
      }
      if ((n.type === "ClassProperty" || n.type === "ClassPrivateProperty") && n.key.type === "Identifier") bind([`this.${n.key.name}`], resolve(valueChain(n.value)));
      return undefined;
    });
  }
  return resolve;
}

/** The value of property `name` in the first argument, if it is an object literal. */
function argProperty(args: Node[], name: string): Node | undefined {
  const [first] = args;
  if (first?.type !== "ObjectExpression") return undefined;
  for (const p of first.properties) {
    if (p.type === "ObjectProperty" && !p.computed && ((p.key.type === "Identifier" && p.key.name === name) || (p.key.type === "StringLiteral" && p.key.value === name))) return p.value as Node;
  }
  return undefined;
}

/**
 * The provider a call goes to. A call through a client made from one provider's import goes to that
 * provider; an AI SDK call (`generateText`) goes to the provider of its `model`. When that can't be
 * read, a file with one possible provider sends to it, and a file with several gives them all, unresolved.
 * `owners` limits a provider-specific call shape (Cohere's `chat`) to the providers that have it.
 */
function destination(resolved: ProviderSpec | undefined, candidates: ProviderSpec[], owners?: ProviderSpec[]): ProviderSpec[] {
  const possible = owners ? candidates.filter((p) => owners.includes(p)) : candidates;
  if (resolved && candidates.includes(resolved)) return possible.includes(resolved) ? [resolved] : [];
  return possible;
}

/** Model calls whose prompt content comes from somewhere other than a fixed string, each with where it goes. */
function sendsIn(f: JsFile, providers: ProviderSpec[]): Send[] {
  const requestVars = requestVariables(f.ast);
  const params = paramNames(f.ast);
  const resolve = jsBindings(f);
  const owning = (match: (p: ProviderSpec) => boolean) => providers.filter(match);

  const sends: Array<{ args: Node[]; line?: number; to: ProviderSpec[] }> = [];
  for (const call of calls(f.ast)) {
    if (call.chain === null || call.node.type !== "CallExpression") continue;
    const chain = call.chain;
    const line = call.line !== undefined ? { line: call.line } : {};
    if (chain.length === 1 && AI_CALL_FUNCTIONS.has(chain[0]!)) {
      const model = resolve(valueChain(argProperty(call.node.arguments, "model")));
      sends.push({ args: call.node.arguments, ...line, to: destination(model, providers) });
    } else if (AI_CALL_TAILS.some((t) => endsWith(chain, t))) {
      sends.push({ args: call.node.arguments, ...line, to: destination(resolve(chain), providers) });
    } else {
      const owners = owning((p) => (p.calls?.js ?? []).some((t) => chain.length > t.length && endsWith(chain, t)));
      if (owners.length > 0) sends.push({ args: call.node.arguments, ...line, to: destination(resolve(chain), providers, owners) });
    }
  }
  walkAst(f.ast, (n) => {
    if (n.type !== "NewExpression") return undefined;
    const chain = chainOf(n.callee);
    const owners = chain ? owning((p) => (p.commands ?? []).includes(chain[chain.length - 1]!)) : [];
    const line = lineOf(n);
    if (owners.length > 0) sends.push({ args: n.arguments, ...(line ? { line } : {}), to: destination(resolve(chain), providers, owners) });
    return undefined;
  });

  const out: Send[] = [];
  for (const call of sends) {
    if (call.to.length === 0) continue;
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
    if (roots.size === 0) continue;
    // `role` and `model` identifiers aren't content; only roots that carry data matter.
    const traced = [...roots].some((r) => requestVars.has(r) || params.has(r) || r === "req" || r === "request");
    out.push({ source: traced ? "high" : "medium", ...(call.line ? { line: call.line } : {}), providers: call.to });
  }
  return out;
}

/** Which provider each dotted name in a Python file stands for: imported names and the clients made from them. A name given two providers' clients stands for neither. */
function pyBindings(f: PyFile): (chain: string[]) => ProviderSpec | undefined {
  const modules = importBindings(f.lines);
  const clients = new Map<string, ProviderSpec | null>();
  const resolve = (chain: string[]) => {
    for (let n = chain.length; n > 0; n--) {
      const p = clients.get(chain.slice(0, n).join("."));
      if (p !== undefined) return p ?? undefined;
    }
    const base = modules.get(chain[0]!);
    if (base === undefined) return undefined;
    const full = [base, ...chain.slice(1)].join(".");
    return AI_PROVIDERS.find((p) => p.pyModules.some((m) => withinModule(full, m)));
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const a of assignments(f.lines)) {
      const p = resolve(a.value);
      if (p) clients.set(a.target, clients.has(a.target) && clients.get(a.target) !== p ? null : p);
    }
  }
  return resolve;
}

function pySendsIn(f: PyFile, providers: ProviderSpec[]): Send[] {
  const resolve = pyBindings(f);
  return aiSends(f.lines, f.calls, f.funcs, providers.flatMap((p) => p.calls?.py ?? [])).map((s) => {
    const owners = s.ownTail ? providers.filter((p) => (p.calls?.py ?? []).some((t) => s.chain.length > t.length && callEndsWith(s.chain, t))) : undefined;
    return { source: s.confidence, line: s.line, providers: destination(resolve(s.chain), providers, owners) };
  });
}

/**
 * One flow fact per provider per file, at the best call that goes to it. A call tied to one provider
 * is reported at the confidence its source gives. A call that could go to several is reported for each
 * at low confidence, with the other possibilities, so the user is asked rather than told.
 */
function flowFacts(file: string, sends: Send[]): FactDraft[] {
  const rank = (s: Send) => (s.providers.length === 1 ? 2 : 0) + (s.source === "high" ? 1 : 0);
  const best = new Map<ProviderSpec, Send>();
  for (const s of [...sends].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
    for (const p of s.providers) {
      const prev = best.get(p);
      if (!prev || rank(s) > rank(prev)) best.set(p, s);
    }
  }
  return [...best].map(([p, s]): FactDraft => {
    const unclear = s.providers.length > 1;
    return {
      kind: "data_flow",
      subject: p.subject,
      claim:
        s.source === "high"
          ? `Text taken from a request or function input is included in prompts sent to ${p.subject}.`
          : `Variable content is included in prompts sent to ${p.subject}; its source isn't clear from the code.`,
      attributes: {
        dataCategories: ["user-supplied content"],
        destination: p.subject,
        direction: "outbound",
        ...(unclear ? { possibleDestinations: s.providers.map((x) => x.subject).sort() } : {}),
      },
      confidence: unclear ? "low" : s.source,
      detector: "data-flow/ai-request-payload",
      key: file,
      locations: [{ file, ...(s.line ? { line: s.line } : {}) }],
    };
  });
}

const dataFlowDetector: Detector = {
  id: "data-flow/ai-request-payload",
  skipReason: (ctx: ScanContext) => (AI_PROVIDERS.some((p) => ctx.hasDep(...p.packages) || (p.pyModules.length > 0 && ctx.hasPyImport(...p.pyModules))) ? null : "no AI SDK in dependencies"),
  run: (ctx) => {
    const facts: FactDraft[] = [];
    for (const f of ctx.py) {
      const providers = AI_PROVIDERS.filter((p) => p.pyModules.length > 0 && importsPy(f, ...p.pyModules));
      if (providers.length > 0) facts.push(...flowFacts(f.file, pySendsIn(f, providers)));
    }
    for (const f of ctx.js) {
      const providers = providersIn(f);
      if (providers.length > 0) facts.push(...flowFacts(f.file, sendsIn(f, providers)));
    }
    return facts;
  },
};

export const aiDetectors: Detector[] = [...AI_PROVIDERS.map(aiProviderDetector), dataFlowDetector];
