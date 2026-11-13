import type { Node } from "@babel/types";
import { walkAst } from "../core/js.js";

/**
 * Small helpers over the Babel AST. Detectors read structure (imports, calls, property names),
 * never raw text, so a package named in a comment or a string is not mistaken for a real use.
 */

/** `a.b.c()` becomes ["a", "b", "c", "()"]. Null for anything that isn't a plain chain. */
export function chainOf(n: Node): string[] | null {
  switch (n.type) {
    case "Identifier":
      return [n.name];
    case "ThisExpression":
      return ["this"];
    case "AwaitExpression":
      return chainOf(n.argument);
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const base = chainOf(n.object);
      if (!base) return null;
      if (!n.computed && n.property.type === "Identifier") return [...base, n.property.name];
      if (n.computed && n.property.type === "StringLiteral") return [...base, n.property.value];
      return null;
    }
    case "CallExpression":
    case "OptionalCallExpression": {
      const base = chainOf(n.callee);
      return base ? [...base, "()"] : null;
    }
    default:
      return null;
  }
}

export const lineOf = (n: Node): number | undefined => n.loc?.start.line;

/** Every call in the file, with the chain of its callee (null if it isn't a plain chain). */
export function calls(ast: Node): Array<{ node: Node; chain: string[] | null; line?: number }> {
  const out: Array<{ node: Node; chain: string[] | null; line?: number }> = [];
  walkAst(ast, (n) => {
    if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
      const line = lineOf(n);
      out.push({ node: n, chain: chainOf(n.callee), ...(line !== undefined ? { line } : {}) });
    }
  });
  return out;
}

/**
 * Named imports from `modules`, as local name to imported name: `import { generateText as gt } from "ai"`
 * maps `gt` to `generateText`. Default and namespace imports are not included.
 */
export function namedImports(ast: Node, modules: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (modules.size === 0) return out;
  walkAst(ast, (n) => {
    if (n.type !== "ImportDeclaration" || !modules.has(n.source.value)) return undefined;
    for (const s of n.specifiers) {
      if (s.type === "ImportSpecifier") out.set(s.local.name, s.imported.type === "Identifier" ? s.imported.name : s.imported.value);
    }
    return undefined;
  });
  return out;
}

export const endsWith = (chain: string[] | null, tail: string[]): boolean =>
  chain !== null && chain.length >= tail.length && tail.every((t, i) => chain[chain.length - tail.length + i] === t);

/** Names bound by a pattern: `a`, `{ a, b: c }`, `[a, ...rest]`, `a = 1`. */
export function boundNames(p: Node | null | undefined): string[] {
  if (!p) return [];
  switch (p.type) {
    case "Identifier":
      return [p.name];
    case "AssignmentPattern":
      return boundNames(p.left);
    case "RestElement":
      return boundNames(p.argument);
    case "ObjectPattern":
      return p.properties.flatMap((prop) => (prop.type === "RestElement" ? boundNames(prop.argument) : boundNames(prop.value)));
    case "ArrayPattern":
      return p.elements.flatMap((e) => boundNames(e));
    case "TSParameterProperty":
      return boundNames(p.parameter);
    default:
      return [];
  }
}

/** Every function parameter name in the file. Values that arrive as parameters come from a caller. */
export function paramNames(ast: Node): Set<string> {
  const out = new Set<string>();
  walkAst(ast, (n) => {
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression" ||
      n.type === "ObjectMethod" ||
      n.type === "ClassMethod"
    ) {
      for (const p of n.params) for (const name of boundNames(p)) out.add(name);
    }
  });
  return out;
}

const REQUEST_ROOTS = new Set(["req", "request"]);
/** Everything a caller can send. */
export const REQUEST_ANY: ReadonlySet<string> = new Set(["body", "json", "text", "formData", "query", "params", "searchParams"]);
/** Only the content of the request. */
export const REQUEST_BODY: ReadonlySet<string> = new Set(["body", "json", "text", "formData"]);

/** True for `req.body`, `await req.json()`, `request.formData()` and similar. */
export function isRequestData(n: Node, parts: ReadonlySet<string> = REQUEST_ANY): boolean {
  const chain = chainOf(n);
  return chain !== null && REQUEST_ROOTS.has(chain[0]!) && chain.slice(1).some((c) => parts.has(c));
}

/** Names of variables initialised from request data: `const body = await req.json()`. */
export function requestVariables(ast: Node, parts: ReadonlySet<string> = REQUEST_ANY): Set<string> {
  const out = new Set<string>();
  walkAst(ast, (n) => {
    if (n.type === "VariableDeclarator" && n.init && isRequestData(n.init, parts)) {
      for (const name of boundNames(n.id)) out.add(name);
    }
  });
  return out;
}

/** Root identifiers of every non-literal expression inside `n` (template parts, variables, member chains). */
export function dynamicRoots(n: Node): Set<string> {
  const out = new Set<string>();
  walkAst(n, (node) => {
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const chain = chainOf(node);
      if (chain) {
        out.add(chain[0]!);
        return false;
      }
    }
    // `{ role: "user" }`: the key is a label, not a variable. Only the value can carry data.
    if (node.type === "ObjectProperty" && !node.computed) {
      for (const r of dynamicRoots(node.value)) out.add(r);
      return false;
    }
    if (node.type === "Identifier") out.add(node.name);
    return undefined;
  });
  return out;
}

/** The first string literal assigned to a property called `name` anywhere in the file. */
export function firstStringProperty(ast: Node, name: string): string | undefined {
  let found: string | undefined;
  walkAst(ast, (n) => {
    if (found !== undefined) return false;
    if (n.type === "ObjectProperty" && !n.computed) {
      const key = n.key.type === "Identifier" ? n.key.name : n.key.type === "StringLiteral" ? n.key.value : null;
      if (key === name && n.value.type === "StringLiteral") found = n.value.value;
    }
    return undefined;
  });
  return found;
}
