import type { Node } from "@babel/types";
import { JS_FILE_RE, parseJs, walkAst } from "../core/js.js";
import type { ProjectFiles } from "../core/project.js";
import { isSignificant, unsupportedCode } from "./coverage.js";
import type { ImportInfo, JsFile, ScanContext } from "./types.js";

/** Tests, specs and fixtures describe how code is checked, not how the product runs. */
const NON_PRODUCT = /(^|\/)(tests?|__tests__|specs?|e2e|fixtures|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
export const isProductFile = (file: string): boolean => !NON_PRODUCT.test(file);

function importsOf(ast: Node): ImportInfo[] {
  const out: ImportInfo[] = [];
  const add = (source: string, node: Node) => {
    const line = node.loc?.start.line;
    out.push({ source, ...(line !== undefined ? { line } : {}) });
  };
  walkAst(ast, (n) => {
    if ((n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && n.source) {
      add(n.source.value, n);
    } else if (n.type === "CallExpression") {
      const [arg] = n.arguments;
      const isRequire = n.callee.type === "Identifier" && n.callee.name === "require";
      const isDynamicImport = n.callee.type === "Import";
      if ((isRequire || isDynamicImport) && arg?.type === "StringLiteral") add(arg.value, n);
    }
  });
  return out;
}

function isClientFile(ast: Node): boolean {
  return ast.type === "Program" && ast.directives.some((d) => d.value.value === "use client");
}

export function buildContext(project: ProjectFiles): ScanContext {
  const deps = new Set<string>();
  for (const file of project.files) {
    if (file !== "package.json" && !file.endsWith("/package.json")) continue;
    const pkg = project.json(file) as Record<string, Record<string, string> | undefined> | null;
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(pkg?.[key] ?? {})) deps.add(name);
    }
  }

  const js: JsFile[] = [];
  for (const file of project.files) {
    if (!JS_FILE_RE.test(file) || !isProductFile(file)) continue;
    const text = project.read(file);
    if (text === null) continue;
    const ast = parseJs(file, text);
    if (ast) js.push({ file, ast, imports: importsOf(ast), isClient: isClientFile(ast) });
  }

  return {
    project,
    deps,
    js,
    hasDep: (...names) => names.some((n) => deps.has(n)),
    hasDepPrefix: (prefix) => [...deps].some((d) => d.startsWith(prefix)),
    hasUnanalysedCode: isSignificant(unsupportedCode(project.files)),
  };
}

/** True when the file imports `source`, or any module under it (`@sentry/` matches `@sentry/nextjs`). */
export const importsModule = (f: JsFile, source: string): ImportInfo | undefined =>
  f.imports.find((i) => i.source === source || (source.endsWith("/") && i.source.startsWith(source)) || i.source.startsWith(`${source}/`));
