import { parseArgs } from "node:util";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import pc from "picocolors";
import { ConfigError, loadConfig } from "../core/config.js";
import { RedactionError } from "../evidence/redact.js";
import { renderTerminal } from "../reporters/terminal.js";
import { scan } from "../scanner/scan.js";
import { VERSION } from "../version.js";

export interface CliDeps {
  out: (s: string) => void;
  err: (s: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: () => Date;
}

const HELP = `
  ${pc.bold("soundings")}: evidence-backed answers to security questionnaires, run locally.

  ${pc.bold("Usage")}
    soundings [scan] [path]     Scan a project (default: current folder) and save its evidence

  ${pc.bold("Options")}
    --output <file>             Where to save the evidence (default: ./soundings-evidence.json)
    --no-write                  Print the report but don't save the evidence file
    --format terminal|json      Report format (default: terminal)
    --seaworthy <file>          Include findings from a Seaworthy JSON report
    --config <file>             Config file (default: <path>/soundings.config.json)
    -h, --help    -v, --version

  ${pc.bold("Exit codes")}  0 done · 2 error
  ${pc.dim("Scanning makes no network calls. Soundings produces drafts, not legal advice.")}
`;

const COMMANDS = new Set(["scan"]);

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string" },
        "no-write": { type: "boolean" },
        format: { type: "string" },
        seaworthy: { type: "string" },
        config: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    deps.err(`${(err as Error).message}\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    deps.out(VERSION);
    return 0;
  }
  if (values.help) {
    deps.out(HELP);
    return 0;
  }

  const [first, ...rest] = positionals;
  const command = first !== undefined && COMMANDS.has(first) ? first : "scan";
  const target = command === first ? rest[0] : first;

  const format = values.format ?? "terminal";
  if (format !== "terminal" && format !== "json") {
    deps.err(`Unknown format "${format}". Use terminal or json.`);
    return 2;
  }

  const root = resolve(deps.cwd, target ?? ".");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    deps.err(`Not a folder: ${root}`);
    return 2;
  }

  try {
    const config = loadConfig(root, values.config ? resolve(deps.cwd, values.config) : undefined);
    const seaworthy = values.seaworthy ? JSON.parse(readFileSync(resolve(deps.cwd, values.seaworthy), "utf8")) : undefined;
    const { evidence, ms } = scan({ root, ignore: config.ignore, seaworthy, now: deps.now() });

    let savedTo: string | null = null;
    if (!values["no-write"]) {
      const path = resolve(deps.cwd, values.output ?? "soundings-evidence.json");
      writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
      savedTo = relative(deps.cwd, path) || path;
    }

    deps.out(format === "json" ? JSON.stringify(evidence, null, 2) : renderTerminal(evidence, ms, savedTo));
    return 0;
  } catch (err) {
    if (err instanceof RedactionError) {
      // The message names the kind of leak and a count, never the value.
      deps.err(`Stopped: ${err.message}. Nothing was written.`);
      return 2;
    }
    if (err instanceof ConfigError) {
      deps.err(err.message);
      return 2;
    }
    deps.err(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
