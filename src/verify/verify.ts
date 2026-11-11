import { extractRefs } from "../evidence/refs.js";
import type { AnswersFile, EvidenceFile } from "../evidence/schema.js";
import { DRAFT_NOTICE, NOT_YET_PROVIDED, TALLY_LINE } from "../export/notice.js";
import { isTemplateSentence } from "../documents/templates.js";
import { PROFILE } from "../questions/profile.js";
import { entitiesIn } from "./entities.js";

/**
 * The claim validator. It reads any text (a document Soundings wrote, or a draft from another
 * tool) and checks each sentence about the project against the evidence it cites.
 *
 * It is deliberately string-level and deterministic: no model, no network. It can prove a sentence
 * is *unsupported*; it cannot prove one is *true*. Passing means every statement points to a
 * source that exists and mentions what the sentence mentions, not that the source is right.
 */

export type Severity = "error" | "warning";

export type IssueCode =
  | "missing-reference"
  | "unreferenced-statement"
  | "unknown-reference"
  | "entity-not-in-source"
  | "number-not-in-source"
  | "place-not-in-source"
  | "absence-contradicts-source"
  | "presence-from-not-found"
  | "unqualified-inference"
  | "low-confidence-fact"
  | "overclaim"
  | "missing-notice";

export interface Issue {
  severity: Severity;
  code: IssueCode;
  line: number;
  sentence: string;
  message: string;
}

export interface VerifyReport {
  issues: Issue[];
  sentencesChecked: number;
  sentencesWithReferences: number;
  noticePresent: boolean;
  /** No errors. Warnings are advice. */
  ok: boolean;
}

const PLACES = /\b(london|ireland|dublin|frankfurt|paris|amsterdam|stockholm|us-east-\d|us-west-\d|eu-west-\d|eu-central-\d|eu-north-\d|uk|united kingdom|eu|europe|usa|united states|asia|australia)\b/gi;
const NUMBERS = /(?<![\w.-])\d+(?:[.,]\d+)?(?![\w-])/g;
const ABSENCE = /\b(no|not|never|without|none|neither|nor|doesn't|does not|do not|don't|isn't|aren't|cannot|can't|nothing)\b/i;
const QUALIFIER = /\b(inferred|appears?|appeared|suggests?|may|might|likely|probably|not confirmed|possibly)\b/i;
export const OVERCLAIM =/\b(compliant|certified|guarantee[sd]?|guaranteeing|fully secure|100% secure|bank-grade|military-grade|complies with|meets the requirements of)\b/i;
const PROJECT_LANGUAGE = /\b(we|our|ours|the (?:app|application|system|service|platform|product|project|code|codebase)|this (?:app|application|system|service|platform|product))\b/i;

interface Block {
  line: number;
  text: string;
}

/** Splits text into the sentences worth checking, skipping headings, notices, sources and prompts. */
export function sentencesOf(source: string): { sentences: Block[]; noticePresent: boolean } {
  const noticePresent = /not legal advice/i.test(source);
  const sentences: Block[] = [];
  const lines = source.split(/\r?\n/);
  let inCode = false;
  let inSources = false;

  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    if (/^\s{0,3}#{1,6}\s*sources\s*$/i.test(raw)) inSources = true;
    else if (/^\s{0,3}#{1,6}\s/.test(raw)) inSources = false;
    if (inSources || /^\s*\[\^[^\]]+\]:/.test(raw)) return;
    if (/^\s{0,3}#{1,6}\s/.test(raw)) return; // headings, including the questions themselves
    if (/^\s*\|?[\s:-]+\|[\s|:-]*$/.test(raw)) return; // table separator rows
    if (/needs your input/i.test(raw)) return;

    let line = raw.replace(/^\s*>\s?/, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
    line = line.replace(/\*\*|__|`/g, "");
    // Footnote marks [^EV-1][^A-1] are markers too.
    line = line.replace(/(?:\[\^[A-Za-z0-9-]+\])+/g, (m) => `[${[...m.matchAll(/\[\^([A-Za-z0-9-]+)\]/g)].map((x) => x[1]).join(", ")}]`);
    if (line.includes(DRAFT_NOTICE.slice(0, 40))) return;
    if (line.trim() === "") return;
    // The document's own tally of answered questions: tested as a whole line, before it is split.
    if (TALLY_LINE.test(line.trim())) return;

    // Fixed wording that ships with Soundings (and is reviewed by its owner) is skipped, but only on an exact match.
    if (isTemplateSentence(line)) return;

    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)) {
      const text = s.trim();
      if (text.length > 0 && !text.endsWith("?") && !isTemplateSentence(text)) sentences.push({ line: i + 1, text });
    }
  });
  return { sentences, noticePresent };
}

const lower = (s: string) => s.toLowerCase();

/** Everything a source says, in one lowercase string, for string-level support checks. */
function sourceTexts(evidence: EvidenceFile, answers: AnswersFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of evidence.facts) {
    const attrs = Object.values(f.attributes).flatMap((v) => (Array.isArray(v) ? v : [String(v)]));
    m.set(f.id, lower([f.subject, f.claim, ...attrs, ...f.locations.map((l) => l.file)].join(" ")));
  }
  for (const f of evidence.findings) m.set(f.id, lower(`${f.ruleId} ${f.severity} seaworthy ${f.location?.file ?? ""}`));
  const leads = new Map(Object.values(PROFILE).map((p) => [p.key, p.lead]));
  const unknowns = new Map(evidence.unknowns.map((u) => [u.id, u]));
  const subjectOf = new Map(evidence.facts.map((f) => [f.id, f.subject]));
  for (const a of answers.answers) {
    // An answer to a scan question carries that question's context: the user replied to a
    // question that named the subject, so a sentence about that subject is supported.
    const u = unknowns.get(a.question);
    const asked = u ? `${u.topic} ${u.question} ${u.relatedFacts.map((id) => subjectOf.get(id) ?? "").join(" ")}` : "";
    m.set(a.id, lower(`${leads.get(a.question) ?? ""} ${asked} ${a.value} ${a.question}`));
  }
  return m;
}

const stripMarkers = (s: string) => s.replace(/\[(?:EV|F|KB|A)-[0-9a-f]+(?:\s*,\s*(?:EV|F|KB|A)-[0-9a-f]+)*\]/gi, " ").replace(/\[(?:A-\d+)(?:\s*,\s*[A-Za-z0-9-]+)*\]/g, " ");

export function verifyText(source: string, evidence: EvidenceFile, answers: AnswersFile): VerifyReport {
  const issues: Issue[] = [];
  const texts = sourceTexts(evidence, answers);
  const facts = new Map(evidence.facts.map((f) => [f.id, f]));
  const subjectNames = evidence.facts.filter((f) => f.claimType === "observed").map((f) => f.subject);
  const { sentences, noticePresent } = sentencesOf(source);
  let withRefs = 0;

  const add = (severity: Severity, code: IssueCode, b: Block, message: string) => issues.push({ severity, code, line: b.line, sentence: b.text, message });

  for (const b of sentences) {
    const refs = extractRefs(b.text);
    const body = stripMarkers(b.text);
    const mentioned = entitiesIn(body, subjectNames);
    const numbers = [...body.matchAll(NUMBERS)].map((m) => m[0]);
    const places = [...body.matchAll(PLACES)].map((m) => m[0].toLowerCase());
    const citesUser = refs.some((r) => r.kind === "A");

    if (OVERCLAIM.test(body) && !citesUser) {
      add("error", "overclaim", b, `Wording that implies legal assurance ("${body.match(OVERCLAIM)![0]}"). Soundings documents describe what the code shows and never claim compliance, certification or guarantees.`);
    }

    if (refs.length === 0) {
      if (mentioned.length > 0 || numbers.length > 0 || places.length > 0) {
        const what = [...mentioned, ...numbers, ...places].slice(0, 3).join(", ");
        add("error", "missing-reference", b, `States something specific (${what}) with no evidence or answer reference.`);
      } else if (PROJECT_LANGUAGE.test(body)) {
        add("warning", "unreferenced-statement", b, "Reads as a statement about the project but cites no source.");
      }
      continue;
    }
    withRefs++;

    // 1. Every reference must exist.
    const missing = refs.filter((r) => !texts.has(r.id));
    for (const r of missing) add("error", "unknown-reference", b, `${r.id} doesn't exist in the evidence or answers file.`);
    const cited = refs.filter((r) => texts.has(r.id));
    if (cited.length === 0) continue;
    const support = cited.map((r) => texts.get(r.id)!).join(" ");

    // 2. What the sentence names must appear in what it cites.
    for (const e of mentioned) {
      if (!support.includes(e)) add("error", "entity-not-in-source", b, `Mentions "${e}", but none of the cited sources do.`);
    }
    for (const n of numbers) {
      if (!support.includes(n)) add("error", "number-not-in-source", b, `Uses the number ${n}, which none of the cited sources contain.`);
    }
    for (const p of places) {
      if (!new RegExp(`(?<![\\w])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(support)) {
        add("error", "place-not-in-source", b, `Names a place ("${p}") that none of the cited sources mention.`);
      }
    }

    // 3. Presence and absence must agree with the cited facts.
    const citedFacts = cited.map((r) => facts.get(r.id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
    if (citedFacts.length > 0 && cited.every((r) => r.kind === "EV")) {
      const bodyForAbsence = body.replace(new RegExp(NOT_YET_PROVIDED, "gi"), " ").replace(/\(inferred[^)]*\)/gi, " ").replace(/\bnot confirmed\b/gi, " ");
      const saysAbsent = ABSENCE.test(bodyForAbsence);
      const allObserved = citedFacts.every((f) => f.claimType === "observed" && !ABSENCE.test(f.claim));
      const allNotFound = citedFacts.every((f) => f.claimType === "not-found");
      if (saysAbsent && allObserved) add("error", "absence-contradicts-source", b, "Says something is absent or not done, but the cited fact shows it is present.");
      if (!saysAbsent && allNotFound) add("error", "presence-from-not-found", b, 'States something is present, but the only cited fact is a "not found" result.');
    }

    // 4. How sure the source is must show in the wording.
    if (citedFacts.some((f) => f.confidence === "low")) {
      add("error", "low-confidence-fact", b, "Cites a low-confidence fact. Those are for the user to confirm and must stay out of documents.");
    }
    const onlyInferred = citedFacts.length > 0 && cited.every((r) => r.kind === "EV") && citedFacts.every((f) => f.claimType === "observed" && f.confidence === "medium");
    if (onlyInferred && !QUALIFIER.test(body)) {
      add("error", "unqualified-inference", b, 'Relies only on an inferred (medium-confidence) fact without saying so. Add wording such as "appears to" or "(inferred from the code)".');
    }
  }

  if (!noticePresent) {
    issues.push({ severity: "warning", code: "missing-notice", line: 1, sentence: "", message: 'No draft notice found. Every document should say it is a draft and not legal advice.' });
  }

  return {
    issues,
    sentencesChecked: sentences.length,
    sentencesWithReferences: withRefs,
    noticePresent,
    ok: !issues.some((i) => i.severity === "error"),
  };
}
