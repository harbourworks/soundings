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

/** The module of a `require("m")` or `await import("m")`, or null. */
function loadedModule(n: Node | null | undefined): string | null {
  const call = n?.type === "AwaitExpression" ? n.argument : n;
  if (call?.type !== "CallExpression") return null;
  const isRequire = call.callee.type === "Identifier" && call.callee.name === "require";
  if (!isRequire && !(n?.type === "AwaitExpression" && call.callee.type === "Import")) return null;
  const [arg] = call.arguments;
  return arg?.type === "StringLiteral" ? arg.value : null;
}

/**
 * Named imports from `modules`, as local name to imported name: `import { generateText as gt } from "ai"`
 * maps `gt` to `generateText`, and `import { generateText } from "ai"` maps `generateText` to itself.
 * Destructuring a `require` or an awaited `import()` without renaming counts too: `const { generateText } = require("ai")`.
 * Default and namespace imports are not included, and neither is a renamed `require` (`{ generateText: gt }`).
 */
export function namedImports(ast: Node, modules: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (modules.size === 0) return out;
  walkAst(ast, (n) => {
    if (n.type === "ImportDeclaration" && modules.has(n.source.value)) {
      for (const s of n.specifiers) {
        if (s.type === "ImportSpecifier") out.set(s.local.name, s.imported.type === "Identifier" ? s.imported.name : s.imported.value);
      }
    } else if (n.type === "VariableDeclarator" && n.id.type === "ObjectPattern" && modules.has(loadedModule(n.init) ?? "")) {
      for (const prop of n.id.properties) {
        if (prop.type === "ObjectProperty" && !prop.computed && prop.shorthand && prop.value.type === "Identifier") out.set(prop.value.name, prop.value.name);
      }
    }
    return undefined;
  });
  return out;
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

/** Modules whose `require` or `await import()` destructuring counts as an import, so it isn't a local binding. */
type Required = ReadonlySet<string>;

/** Names a `const`/`let`/`var` declares, leaving out destructuring of a `require` or `await import()` of a module in `required`. */
const declaratorNames = (s: Node & { type: "VariableDeclaration" }, required: Required): string[] =>
  s.declarations.flatMap((d) => (d.id.type === "ObjectPattern" && required.has(loadedModule(d.init) ?? "") ? [] : boundNames(d.id)));

/** Names a statement declares in the block that holds it: `const a`, `function a`, `class a`, `enum a`, and exported forms. */
function declaredBy(s: Node, required: Required): string[] {
  switch (s.type) {
    case "VariableDeclaration":
      return declaratorNames(s, required);
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSEnumDeclaration":
      return s.id ? [s.id.name] : [];
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration":
      return s.declaration ? declaredBy(s.declaration, required) : [];
    default:
      return [];
  }
}

/** Every `var` name inside a function body, which hoists to the function. Nested functions are not entered. */
function varNames(body: Node, required: Required): string[] {
  const out: string[] = [];
  walkAst(body, (n) => {
    if (FUNCTION_TYPES.has(n.type)) return false;
    if (n.type === "VariableDeclaration" && n.kind === "var") out.push(...declaratorNames(n, required));
    return undefined;
  });
  return out;
}

/**
 * Value names a scope node binds for the code inside it. Import specifiers, and `require` or `await import()`
 * destructuring of a module in `required`, are left out: they are what is being resolved.
 */
function scopeBindings(n: Node, required: Required): string[] {
  const declared = (s: Node) => declaredBy(s, required);
  switch (n.type) {
    case "Program":
    case "BlockStatement":
    case "StaticBlock":
    case "TSModuleBlock":
      return n.body.flatMap(declared);
    case "SwitchStatement":
      return n.cases.flatMap((c) => c.consequent.flatMap(declared));
    case "ForStatement":
      return n.init ? declared(n.init) : [];
    case "ForInStatement":
    case "ForOfStatement":
      return declared(n.left);
    case "CatchClause":
      return boundNames(n.param);
    case "ClassExpression":
      return n.id ? [n.id.name] : [];
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ObjectMethod":
    case "ClassMethod":
    case "ClassPrivateMethod":
      return [
        ...n.params.flatMap((p) => boundNames(p)),
        ...(n.type === "FunctionExpression" && n.id ? [n.id.name] : []),
        ...varNames(n.body, required),
      ];
    default:
      return [];
  }
}

/**
 * Returns a check for whether `name`, used at node `at`, is bound by something in the file other than an import:
 * a parameter, a local `const`/`let`/`var`, a function, a class or a catch parameter in any enclosing scope.
 * Used so that `import { generateText as gt } from "ai"` doesn't make a local `gt` a model call. Destructuring a
 * `require` or `await import()` of a module in `required` counts as an import, as in `namedImports`.
 */
export function localBinding(ast: Node, required: Required = new Set()): (at: Node, name: string) => boolean {
  const parents = new Map<Node, Node>();
  walkAst(ast, (n, parent) => {
    if (parent) parents.set(n, parent);
  });
  const cache = new Map<Node, Set<string>>();
  return (at, name) => {
    for (let p = parents.get(at); p; p = parents.get(p)) {
      let names = cache.get(p);
      if (!names) cache.set(p, (names = new Set(scopeBindings(p, required))));
      if (names.has(name)) return true;
    }
    return false;
  };
}

export const endsWith =(chain: string[] | null, tail: string[]): boolean =>
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

/**
 * Whether the file sets a property called `name` anywhere, whatever its value: `{ name: … }`,
 * the shorthand `{ name }`, `{ "name": … }` or `x.name = …`.
 */
export function setsProperty(ast: Node, name: string): boolean {
  let found = false;
  walkAst(ast, (n) => {
    if (found) return false;
    if ((n.type === "ObjectProperty" || n.type === "ObjectMethod") && !n.computed) {
      const key = n.key.type === "Identifier" ? n.key.name : n.key.type === "StringLiteral" ? n.key.value : null;
      if (key === name) found = true;
    }
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression") {
      const p = n.left.property;
      if ((!n.left.computed && p.type === "Identifier" && p.name === name) || (p.type === "StringLiteral" && p.value === name)) found = true;
    }
    return undefined;
  });
  return found;
}
