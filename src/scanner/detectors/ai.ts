import type { FactDraft } from "../../evidence/build.js";
import { walkAst } from "../../core/js.js";
import { calls, dynamicRoots, endsWith, firstStringProperty, paramNames, requestVariables } from "../ast.js";
import { importsModule } from "../context.js";
import type { Detector, JsFile, ScanContext } from "../types.js";

interface ProviderSpec {
  id: string;
  subject: string;
  /** Importing any of these means the provider's SDK is in use. */
  packages: string[];
}

export const AI_PROVIDERS: ProviderSpec[] = [
  { id: "ai-provider/openai-sdk", subject: "OpenAI", packages: ["openai", "@ai-sdk/openai"] },
  { id: "ai-provider/anthropic-sdk", subject: "Anthropic", packages: ["@anthropic-ai/sdk", "@ai-sdk/anthropic"] },
  { id: "ai-provider/google-sdk", subject: "Google AI", packages: ["@google/generative-ai", "@google/genai", "@ai-sdk/google"] },
  { id: "ai-provider/vercel-ai-sdk", subject: "Vercel AI SDK", packages: ["ai"] },
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
    skipReason: (ctx) => (ctx.hasDep(...spec.packages) ? null : `no ${spec.subject} package in dependencies`),
    run: (ctx) =>
      ctx.js
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
];
const AI_CALL_FUNCTIONS = new Set(["generateText", "streamText", "generateObject", "streamObject", "embed", "embedMany"]);
const CONTENT_KEYS = new Set(["content", "prompt", "input", "contents", "text", "system", "messages"]);

/**
 * Finds model calls whose prompt content comes from somewhere other than a fixed string.
 * "high" when that content traces to a request or a function parameter (a caller supplies it),
 * "medium" when it is dynamic but its source isn't clear.
 */
function payloadIn(f: JsFile): { confidence: "high" | "medium"; line?: number } | null {
  const requestVars = requestVariables(f.ast);
  const params = paramNames(f.ast);
  let best: { confidence: "high" | "medium"; line?: number } | null = null;

  for (const call of calls(f.ast)) {
    const isAiCall =
      (call.chain !== null && AI_CALL_TAILS.some((t) => endsWith(call.chain, t))) ||
      (call.chain !== null && call.chain.length === 1 && AI_CALL_FUNCTIONS.has(call.chain[0]!));
    if (!isAiCall || call.node.type !== "CallExpression") continue;

    const roots = new Set<string>();
    for (const arg of call.node.arguments) {
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
  skipReason: (ctx: ScanContext) => (AI_PROVIDERS.some((p) => ctx.hasDep(...p.packages)) ? null : "no AI SDK in dependencies"),
  run: (ctx) => {
    const facts: FactDraft[] = [];
    for (const f of ctx.js) {
      const providers = providersIn(f);
      if (providers.length === 0) continue;
      const payload = payloadIn(f);
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
