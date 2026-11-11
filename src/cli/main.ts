import { parseArgs } from "node:util";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import pc from "picocolors";
import { ConfigError, loadConfig } from "../core/config.js";
import { RedactionError, assertNoLeaks, createGuard, loadEnvValues } from "../evidence/redact.js";
import { renderQuestionnaireMarkdown } from "../export/questionnaire.js";
import { DOCUMENTS, buildDocument, documentNeeds, isDocumentId } from "../documents/build.js";
import { EXPORT_FORMATS, isExportFormat, renderExport, type ExportFormat } from "../export/render.js";
import { ImportError, fillQuestionnaire } from "../import/fill.js";
import { verifyText } from "../verify/verify.js";
import { renderFill, renderVerify } from "../reporters/verify.js";
import { AnswersError, loadAnswers } from "../questions/answers-file.js";
import { answerAll, type Pending } from "../questions/engine.js";
import { QuestionsError, loadEvidence, runQuestions } from "../questions/flow.js";
import { renderQuestionsSummary } from "../reporters/questions.js";
import { renderTerminal } from "../reporters/terminal.js";
import { scan } from "../scanner/scan.js";
import { VERSION } from "../version.js";
import { polarSettings } from "../licensing/config.js";
import type { LicenceProvider } from "../licensing/provider.js";
import { PolarProvider } from "../licensing/polar.js";
import { LicenceStore, userConfigDir } from "../licensing/store.js";
import { buy, login, logout, requireFeature, status, type LicenceCtx } from "./licence.js";

export interface CliDeps {
  out: (s: string) => void;
  err: (s: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: () => Date;
  /** Asks one question at a terminal. Absent when nobody can answer (piped input, CI). */
  ask?: (pending: Pending, index: number, total: number) => Promise<string | null>;
  /** Defaults to Polar. Tests pass a MockProvider. */
  provider?: LicenceProvider;
  /** A person at a terminal (not CI, not piped): links may be opened in the browser. */
  interactive?: boolean;
  /** Opens a link in the browser; false if it couldn't. Tests pass a fake. */
  openUrl?: (url: string) => boolean;
}

const HELP = `
  ${pc.bold("soundings")}: evidence-backed answers to security questionnaires, run locally.

  ${pc.bold("Usage")}
    soundings [scan] [path]     Scan a project (default: current folder) and save its evidence
    soundings questions         Ask only what the code can't answer, and save your answers
    soundings verify <file>     Check any text against the evidence: every statement needs a source

  ${pc.bold("Pro")}
    soundings answers           Answer the standard question bank from evidence and your answers
    soundings answer <file.csv> Fill in a client questionnaire from the bank (never guesses)
    soundings document <type>   Privacy notice, subprocessors, dpia, ai-use or trust-page
                                (run with no type to list them)

  ${pc.bold("Plans")}
    soundings buy               See the plans and open the checkout
    soundings login <key>       Turn on your licence on this machine
    soundings logout            Turn it off and free this machine's slot
    soundings status            Show your plan and licence state

  ${pc.bold("Options")}
    --output <file>             Where to save the evidence or the answers document
                                (scan: ./soundings-evidence.json; answers: print to screen)
    --no-write                  Scan: print the report but don't save the evidence file
    --format terminal|json      Scan report format (default: terminal)
    --format markdown|html|docx Answers and documents format (default: markdown; html and
                                docx need --output; to make a PDF, print the HTML to PDF).
                                Answers also accept json.
    --seaworthy <file>          Scan: include findings from a Seaworthy JSON report
    --config <file>             Scan: config file (default: <path>/soundings.config.json)
    --evidence <file>           Evidence file (default: ./soundings-evidence.json)
    --answers <file>            Answers file (default: ./soundings-answers.json)
    --list                      Questions: show what is left, without asking
    --documents                 Questions: also ask what the documents need
    --set <key>=<value>         Questions: record an answer (repeatable). Keys: UQ-…,
                                profile.… or override.<question-id> to replace what the scan says
    --no-locations              Answers: leave file paths out of the sources
    --strict                    Verify: treat warnings as failures
    --offline                   Never call the licence server (uses the saved check)
    --no-open                   Don't open links in the browser
    -h, --help    -v, --version

  ${pc.bold("Exit codes")}  0 done · 1 verify found problems · 2 error · 3 needs a paid plan
  ${pc.dim("Free commands make no network calls. In CI, set SOUNDINGS_LICENCE to your key instead of logging in.")}
  ${pc.dim("Soundings produces drafts, not legal advice.")}
`;

const COMMANDS = new Set(["scan", "questions", "answers", "answer", "document", "verify", "buy", "login", "logout", "status"]);

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
        evidence: { type: "string" },
        answers: { type: "string" },
        list: { type: "boolean" },
        documents: { type: "boolean" },
        set: { type: "string", multiple: true },
        "no-locations": { type: "boolean" },
        strict: { type: "boolean" },
        offline: { type: "boolean" },
        "no-open": { type: "boolean" },
        label: { type: "string" },
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

  try {
    if (command === "questions") return await runQuestionsCommand(values, deps);
    if (["buy", "login", "logout", "status", "answers", "answer", "document"].includes(command)) {
      const lic = licenceCtx(values, deps);
      if (command === "buy") return buy(lic);
      if (command === "login") return await login(target, lic);
      if (command === "logout") return await logout(lic);
      if (command === "status") return await status(lic);
      if (command === "document" && !target) return runDocumentList(deps);
      const feature = command === "answers" ? "answers" : command === "document" ? "documents" : "questionnaire-import";
      const gate = await requireFeature(feature, command, lic);
      if (gate !== null) return gate;
      const fmt = (values.format as string | undefined) ?? "markdown";
      if (fmt === "html" || fmt === "docx") {
        const exportGate = await requireFeature("exports", `${command} --format ${fmt}`, lic);
        if (exportGate !== null) return exportGate;
      }
      if (command === "answers") return runAnswersCommand(values, deps);
      if (command === "document") return runDocumentCommand(values, target!, deps);
      return runAnswerCommand(values, target, deps);
    }
    if (command === "verify") return runVerifyCommand(values, target, deps);
    return runScanCommand(values, target, deps);
  } catch (err) {
    if (err instanceof RedactionError) {
      // The message names the kind of leak and a count, never the value.
      deps.err(`Stopped: ${err.message}. Nothing was written.`);
    } else if (err instanceof ConfigError || err instanceof QuestionsError || err instanceof AnswersError || err instanceof ImportError) {
      deps.err(err.message);
    } else {
      deps.err(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 2;
  }
}

type Values = Record<string, string | boolean | string[] | undefined>;

function licenceCtx(values: Values, deps: CliDeps): LicenceCtx {
  return {
    out: deps.out,
    err: deps.err,
    env: deps.env,
    now: deps.now,
    provider: deps.provider ?? new PolarProvider(polarSettings(deps.env)),
    store: new LicenceStore(userConfigDir(deps.env)),
    offline: Boolean(values.offline),
    ...(values.label ? { label: values.label as string } : {}),
    noOpen: Boolean(values["no-open"]),
    interactive: Boolean(deps.interactive),
    ...(deps.openUrl ? { openUrl: deps.openUrl } : {}),
  };
}

function runScanCommand(values: Values, target: string | undefined, deps: CliDeps): number {
  const format = (values.format as string | undefined) ?? "terminal";
  if (format !== "terminal" && format !== "json") {
    deps.err(`Unknown format "${format}". Use terminal or json.`);
    return 2;
  }
  const root = resolve(deps.cwd, target ?? ".");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    deps.err(`Not a folder: ${root}`);
    return 2;
  }

  const config = loadConfig(root, values.config ? resolve(deps.cwd, values.config as string) : undefined);
  const seaworthy = values.seaworthy ? JSON.parse(readFileSync(resolve(deps.cwd, values.seaworthy as string), "utf8")) : undefined;
  const { evidence, ms } = scan({ root, ignore: config.ignore, seaworthy, now: deps.now() });

  let savedTo: string | null = null;
  if (!values["no-write"]) {
    const path = resolve(deps.cwd, (values.output as string | undefined) ?? "soundings-evidence.json");
    writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
    savedTo = relative(deps.cwd, path) || path;
  }
  deps.out(format === "json" ? JSON.stringify(evidence, null, 2) : renderTerminal(evidence, ms, savedTo));
  return 0;
}

const evidencePath = (v: Values, deps: CliDeps) => resolve(deps.cwd, (v.evidence as string | undefined) ?? "soundings-evidence.json");
const answersPath = (v: Values, deps: CliDeps) => resolve(deps.cwd, (v.answers as string | undefined) ?? "soundings-answers.json");

async function runQuestionsCommand(values: Values, deps: CliDeps): Promise<number> {
  const set: Array<[string, string]> = [];
  for (const item of (values.set as string[] | undefined) ?? []) {
    const eq = item.indexOf("=");
    if (eq < 1) {
      deps.err(`--set needs key=value, got "${item}".`);
      return 2;
    }
    set.push([item.slice(0, eq).trim(), item.slice(eq + 1)]);
  }

  const aPath = answersPath(values, deps);
  const outcome = await runQuestions({
    evidencePath: evidencePath(values, deps),
    answersPath: aPath,
    now: deps.now(),
    set,
    documents: Boolean(values.documents),
    ...(values.list || !deps.ask ? {} : { ask: deps.ask }),
  });
  for (const r of outcome.rejected) deps.err(`Skipped ${r.key}: ${r.reason}`);
  deps.out(renderQuestionsSummary(outcome.state, relative(deps.cwd, aPath) || aPath, outcome.saved));
  return 0;
}

function runAnswersCommand(values: Values, deps: CliDeps): number {
  const format = (values.format as string | undefined) ?? "markdown";
  if (format !== "json" && !isExportFormat(format)) {
    deps.err(`Unknown format "${format}". Use markdown, html, docx or json.`);
    return 2;
  }
  const evidence = loadEvidence(evidencePath(values, deps));
  const answers = loadAnswers(answersPath(values, deps));
  const results = answerAll(evidence, answers);

  const markdown = renderQuestionnaireMarkdown(results, evidence, answers, { project: evidence.project.name, locations: !values["no-locations"] });
  const output =
    format === "json"
      ? JSON.stringify({ project: evidence.project.name, results }, null, 2)
      : renderExport(markdown, format as ExportFormat, { title: `Security and data handling answers: ${evidence.project.name}`, created: evidence.generatedAt });
  return emit(output, values, deps, "answers document", `Saved ${results.length} answers to`);
}

/** Writes or prints a finished document. Binary output needs a file. Text gets the secret check first. */
function emit(output: string | Buffer, values: Values, deps: CliDeps, label: string, savedPrefix: string): number {
  if (typeof output === "string") assertNoLeaks(output, createGuard(loadEnvValues(deps.cwd)), label);
  else assertNoLeaks(output.toString("latin1"), createGuard(loadEnvValues(deps.cwd)), label);

  if (values.output) {
    const path = resolve(deps.cwd, values.output as string);
    writeFileSync(path, output);
    deps.out(`${savedPrefix} ${relative(deps.cwd, path) || path}.`);
    return 0;
  }
  if (typeof output !== "string") {
    deps.err("Word files can't be printed to the screen. Add --output <file.docx>.");
    return 2;
  }
  deps.out(output);
  return 0;
}

function runDocumentList(deps: CliDeps): number {
  const lines = ["", "  Documents (each built only from the scan and your answers):", ""];
  for (const d of DOCUMENTS) lines.push(`    ${d.id.padEnd(15)}${d.title}: ${d.about}`);
  lines.push("", "  soundings document <type> [--format markdown|html|docx] [--output <file>]", "");
  deps.out(lines.join("\n"));
  return 0;
}

function runDocumentCommand(values: Values, type: string, deps: CliDeps): number {
  const aliases: Record<string, string> = { privacy: "privacy-notice", subprocessor: "subprocessors", ai: "ai-use", trust: "trust-page" };
  const id = aliases[type] ?? type;
  if (!isDocumentId(id)) {
    deps.err(`Unknown document "${type}". Choose one of: ${DOCUMENTS.map((d) => d.id).join(", ")}.`);
    return 2;
  }
  const format = (values.format as string | undefined) ?? "markdown";
  if (!isExportFormat(format)) {
    deps.err(`Unknown format "${format}". Use ${EXPORT_FORMATS.join(", ")}.`);
    return 2;
  }
  const evidence = loadEvidence(evidencePath(values, deps));
  const answers = loadAnswers(answersPath(values, deps));
  const built = buildDocument(id, evidence, answers, { locations: !values["no-locations"] });
  const output = renderExport(built.markdown, format, { title: `${built.title}: ${evidence.project.name}`, created: evidence.generatedAt });
  const code = emit(output, values, deps, `${built.title.toLowerCase()}`, `Saved the ${built.title.toLowerCase()} to`);
  if (code === 0 && built.needs.length > 0 && values.output) {
    deps.out(`${built.needs.length} item${built.needs.length === 1 ? "" : "s"} still need your input; they are listed under "Open items". Run: soundings questions --documents`);
  }
  return code;
}

function runVerifyCommand(values: Values, file: string | undefined, deps: CliDeps): number {
  if (!file) {
    deps.err("Which file? Usage: soundings verify <file>");
    return 2;
  }
  const format = (values.format as string | undefined) ?? "terminal";
  if (format !== "terminal" && format !== "json") {
    deps.err(`Unknown format "${format}". Use terminal or json.`);
    return 2;
  }
  const path = resolve(deps.cwd, file);
  if (!existsSync(path)) {
    deps.err(`File not found: ${path}`);
    return 2;
  }
  const evidence = loadEvidence(evidencePath(values, deps));
  const answers = loadAnswers(answersPath(values, deps));
  const report = verifyText(readFileSync(path, "utf8"), evidence, answers);
  deps.out(format === "json" ? JSON.stringify(report, null, 2) : renderVerify(report, relative(deps.cwd, path) || file));
  const failed = !report.ok || (Boolean(values.strict) && report.issues.length > 0);
  return failed ? 1 : 0;
}

function runAnswerCommand(values: Values, file: string | undefined, deps: CliDeps): number {
  if (!file) {
    deps.err("Which questionnaire? Usage: soundings answer <file.csv>");
    return 2;
  }
  const path = resolve(deps.cwd, file);
  if (!existsSync(path)) {
    deps.err(`File not found: ${path}`);
    return 2;
  }
  if (/\.xlsx?$/i.test(path)) {
    deps.err("Excel files aren't supported yet. In Excel, use File > Save As > CSV UTF-8, then run this again on the CSV.");
    return 2;
  }
  const evidence = loadEvidence(evidencePath(values, deps));
  const answers = loadAnswers(answersPath(values, deps));
  const result = fillQuestionnaire(readFileSync(path, "utf8"), evidence, answers);

  assertNoLeaks(result.csv, createGuard(loadEnvValues(deps.cwd)), "filled questionnaire");
  const outPath = resolve(deps.cwd, (values.output as string | undefined) ?? file.replace(/\.csv$/i, "") + ".answered.csv");
  if (outPath === path) {
    deps.err("The output file would overwrite the questionnaire. Choose another with --output.");
    return 2;
  }
  writeFileSync(outPath, result.csv);
  deps.out(renderFill(result, relative(deps.cwd, outPath) || outPath));
  return 0;
}
