import type { Node } from "@babel/types";
import type { ProjectFiles } from "../core/project.js";
import type { FactDraft } from "../evidence/build.js";
import type { PyCall, PyFunc, PyImport } from "./python/parse.js";
import type { PyLine } from "./python/tokenize.js";

export interface ImportInfo {
  /** The module named, e.g. "openai" or "@supabase/supabase-js". */
  source: string;
  line?: number;
}

/** A JavaScript or TypeScript source file, parsed once and shared by every detector. */
export interface JsFile {
  file: string;
  ast: Node;
  imports: ImportInfo[];
  /** Starts with a "use client" directive: it runs in the browser. */
  isClient: boolean;
}

/** A Python source file, tokenized once and shared by every detector. */
export interface PyFile {
  file: string;
  lines: PyLine[];
  imports: PyImport[];
  calls: PyCall[];
  funcs: PyFunc[];
}

export interface ScanContext {
  project: ProjectFiles;
  /** Every dependency named in any package.json in the project. */
  deps: ReadonlySet<string>;
  /** Source files that run in the product (tests, specs and fixtures are left out). */
  js: readonly JsFile[];
  /** Python source files that run in the product. */
  py: readonly PyFile[];
  /** Some Python file imports one of these modules (or something inside them). */
  hasPyImport(...modules: string[]): boolean;
  hasDep(...names: string[]): boolean;
  hasDepPrefix(prefix: string): boolean;
  /** The project has significant code in languages Soundings doesn't read, so "not found" can't be claimed. */
  hasUnanalysedCode: boolean;
}

/**
 * One detector reports facts of one family. `skipReason` returns why it doesn't apply (shown in
 * the scan coverage block), or null when it should run.
 */
export interface Detector {
  id: string;
  skipReason(ctx: ScanContext): string | null;
  run(ctx: ScanContext): FactDraft[];
}
