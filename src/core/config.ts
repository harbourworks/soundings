import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Config = z.object({
  /** Extra .gitignore-style patterns to leave out of the scan. */
  ignore: z.array(z.string()).default([]),
});
export type Config = z.infer<typeof Config>;

export class ConfigError extends Error {}

/** Reads soundings.config.json from the scanned folder, or `file` if given. Missing file means defaults. */
export function loadConfig(root: string, file?: string): Config {
  const path = file ?? join(root, "soundings.config.json");
  if (!existsSync(path)) {
    if (file) throw new ConfigError(`Config file not found: ${file}`);
    return Config.parse({});
  }
  try {
    return Config.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new ConfigError(`Couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
