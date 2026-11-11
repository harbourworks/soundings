import type { FactDraft } from "../../evidence/build.js";
import { REQUEST_BODY, calls, dynamicRoots, isRequestData, requestVariables } from "../ast.js";
import type { Detector } from "../types.js";

const LEVELS = new Set(["log", "info", "debug", "warn", "error", "trace"]);

/** `console.*` and anything called log/logger/*Logger. */
function isLogger(chain: string[] | null): boolean {
  if (!chain || chain.length < 2) return false;
  const level = chain[chain.length - 1]!;
  const root = chain[0]!;
  return LEVELS.has(level) && (root === "console" || /^(?:log|logger|\w*Logger|\w*Log)$/.test(root));
}

const requestBodyLogging: Detector = {
  id: "logging/request-body",
  skipReason: () => null,
  run: (ctx) =>
    ctx.js.flatMap((f): FactDraft[] => {
      const requestVars = requestVariables(f.ast, REQUEST_BODY);
      for (const c of calls(f.ast)) {
        if (!isLogger(c.chain) || c.node.type !== "CallExpression") continue;
        const logsRequest = c.node.arguments.some(
          (a) => isRequestData(a, REQUEST_BODY) || [...dynamicRoots(a)].some((r) => requestVars.has(r)) || containsRequestData(a),
        );
        if (!logsRequest) continue;
        return [
          {
            kind: "logging",
            subject: "Server logs",
            claim: "A request body is written to the logs, so it may include user content.",
            attributes: { logsUserContent: true },
            confidence: "medium",
            detector: "logging/request-body",
            key: f.file,
            locations: [{ file: f.file, ...(c.line ? { line: c.line } : {}) }],
          },
        ];
      }
      return [];
    }),
};

/** `{ body: req.body }` and `[req.body]`: request data nested inside an argument. */
function containsRequestData(node: import("@babel/types").Node): boolean {
  if (isRequestData(node, REQUEST_BODY)) return true;
  if (node.type === "ObjectExpression") return node.properties.some((p) => p.type === "ObjectProperty" && containsRequestData(p.value));
  if (node.type === "ArrayExpression") return node.elements.some((e) => e !== null && containsRequestData(e));
  if (node.type === "TemplateLiteral") return node.expressions.some((e) => containsRequestData(e));
  return false;
}

export const loggingDetectors: Detector[] = [requestBodyLogging];
