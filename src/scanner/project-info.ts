import { basename } from "node:path";
import type { ScanContext } from "./types.js";

const LANGUAGE_BY_EXT: Array<[RegExp, string]> = [
  [/\.(?:tsx?|mts|cts)$/, "typescript"],
  [/\.(?:jsx?|mjs|cjs)$/, "javascript"],
  [/\.html?$/, "html"],
  [/\.py$/, "python"],
];

const FRAMEWORKS: Array<[string, string]> = [
  ["next", "nextjs"],
  ["react", "react"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["hono", "hono"],
  ["@supabase/supabase-js", "supabase-js"],
  ["stripe", "stripe"],
  ["firebase", "firebase"],
];

export function projectInfo(ctx: ScanContext, root: string): { name: string; languages: string[]; frameworks: string[] } {
  const languages = new Set<string>();
  for (const file of ctx.project.files) {
    const hit = LANGUAGE_BY_EXT.find(([re]) => re.test(file));
    if (hit) languages.add(hit[1]);
  }
  const frameworks = FRAMEWORKS.filter(([dep]) => ctx.hasDep(dep)).map(([, name]) => name);
  for (const name of ["fastapi", "flask", "django"]) {
    if (ctx.hasPyImport(name) && !frameworks.includes(name)) frameworks.push(name);
  }

  const pkg = ctx.project.json("package.json") as { name?: unknown } | null;
  const name = typeof pkg?.name === "string" && pkg.name.length > 0 ? pkg.name : basename(root) || "project";
  return { name, languages: [...languages], frameworks };
}
