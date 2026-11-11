import { isProductFile } from "./context.js";

/** Languages whose code Soundings does not read. Their files are counted, never analysed. */
const UNSUPPORTED: Record<string, string> = {
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  rs: "Rust",
  swift: "Swift",
  scala: "Scala",
  ex: "Elixir",
  exs: "Elixir",
  dart: "Dart",
};

/**
 * A project with this much code the scan can't read can't be described by a scan that only
 * reads JavaScript and TypeScript: an empty result then says "didn't look", not "isn't there".
 */
export const SIGNIFICANT_UNSUPPORTED_FILES = 3;

export interface Unsupported {
  language: string;
  files: number;
}

export function unsupportedCode(files: readonly string[]): Unsupported[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!isProductFile(file)) continue;
    const language = UNSUPPORTED[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
    if (language && file.includes(".")) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts].map(([language, n]) => ({ language, files: n })).sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

export const totalUnsupported = (u: readonly Unsupported[]) => u.reduce((n, x) => n + x.files, 0);
export const isSignificant = (u: readonly Unsupported[]) => totalUnsupported(u) >= SIGNIFICANT_UNSUPPORTED_FILES;

/** "58 Python files and 4 Go files". */
export function describeUnsupported(u: readonly Unsupported[]): string {
  const parts = u.map((x) => `${x.files} ${x.language} file${x.files === 1 ? "" : "s"}`);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
