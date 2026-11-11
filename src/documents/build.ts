import type { AnswersFile, EvidenceFile, Fact } from "../evidence/schema.js";
import { footnoteLines, usedRefs, withFootnoteMarks } from "../export/footnotes.js";
import { DRAFT_NOTICE, NOT_YET_PROVIDED } from "../export/notice.js";
import { BANK } from "../questions/bank.js";
import { buildAnswerCtx } from "../questions/context.js";
import { renderSentence } from "../questions/engine.js";
import { addFacts, draft, profile, refsOf } from "../questions/helpers.js";
import type { AnswerCtx, Draft, Need } from "../questions/types.js";
import { TEMPLATES } from "./templates.js";

export type DocumentId = "privacy-notice" | "subprocessors" | "dpia" | "ai-use" | "trust-page";

export const DOCUMENTS: Array<{ id: DocumentId; title: string; about: string }> = [
  { id: "privacy-notice", title: "Privacy notice", about: "what personal data is handled, why, where, for how long, and who receives it" },
  { id: "subprocessors", title: "Subprocessor list", about: "the external services the code integrates with, and what the team has said about each" },
  { id: "dpia", title: "Data protection impact assessment", about: "the processing, what the code shows that bears on risk, and what is left to the people responsible" },
  { id: "ai-use", title: "AI-use statement", about: "which AI providers are used, for what, with what data, and with what oversight" },
  { id: "trust-page", title: "Trust page", about: "a short, client-facing summary of security and data handling" },
];

export interface BuiltDocument {
  id: DocumentId;
  title: string;
  /** Markdown with `[EV-…]` markers and footnote definitions. */
  markdown: string;
  needs: Need[];
}

export interface BuildOptions {
  /** Put file paths in the sources. Off for anything leaving the team. */
  locations: boolean;
}

// ---- building blocks

/** The answers to several bank questions, merged into one draft. */
function fromBank(ctx: AnswerCtx, ...ids: string[]): Draft {
  const out = draft();
  for (const id of ids) {
    const q = BANK.find((b) => b.id === id);
    if (!q) throw new Error(`unknown bank question ${id}`);
    const d = q.build(ctx);
    out.sentences.push(...d.sentences);
    for (const n of d.needs) if (!out.needs.some((x) => x.key === n.key)) out.needs.push(n);
  }
  return out;
}

class Doc {
  readonly lines: string[] = [];
  readonly needs: Need[] = [];
  constructor(
    readonly title: string,
    private readonly date: string,
  ) {}

  heading(text: string) {
    this.lines.push(`## ${text}`, "");
  }
  text(s: string) {
    this.lines.push(s, "");
  }
  /** A draft as a paragraph, with its missing items noted underneath. */
  draft(d: Draft) {
    if (d.sentences.length) this.lines.push(d.sentences.map(renderSentence).join(" "), "");
    this.noteNeeds(d.needs);
  }
  /** A draft as a bullet list, one bullet per sentence. */
  bullets(d: Draft) {
    if (d.sentences.length) this.lines.push(...d.sentences.map((s) => `- ${renderSentence(s)}`), "");
    this.noteNeeds(d.needs);
  }
  private noteNeeds(needs: Need[]) {
    for (const n of needs) {
      this.lines.push(`**Needs your input.** ${n.prompt}`, "");
      if (!this.needs.some((x) => x.key === n.key)) this.needs.push(n);
    }
  }
  render(): string {
    const head = [`# ${this.title} (draft, ${this.date})`, "", `> ${DRAFT_NOTICE}`, ""];
    const open = this.needs.length
      ? ["## Open items", "", ...this.needs.map((n) => `- Needs your input: ${n.prompt}`), ""]
      : [];
    return [...head, ...this.lines, ...open].join("\n");
  }
}

const factsBy = (ctx: AnswerCtx, detector: string): Fact[] => ctx.byDetector(detector);

/** Facts for one subject, merged into one table row. */
function serviceRows(ctx: AnswerCtx): string[][] {
  type Row = { subject: string; kind: Fact["kind"]; facts: Fact[] };
  const by = new Map<string, Row>();
  for (const kind of ["third_party_service", "ai_provider", "data_store"] as const) {
    for (const f of ctx.facts(kind)) {
      const key = `${kind}|${f.subject}`;
      const row = by.get(key) ?? { subject: f.subject, kind, facts: [] };
      row.facts.push(f);
      by.set(key, row);
    }
  }

  const NOT_YET = NOT_YET_PROVIDED;
  const rows: string[][] = [];
  for (const { subject, kind, facts } of by.values()) {
    const ids = refsOf(facts);
    const cite = (text: string, extra: string[] = []) => `${text} [${[...ids, ...extra].join(", ")}]`;
    const purpose = kind === "ai_provider" ? "AI model provider" : kind === "data_store" ? "Data storage" : String(facts[0]!.attributes.purpose ?? "External service");

    const flows = kind === "ai_provider" ? ctx.facts("data_flow").filter((f) => f.subject === subject) : [];
    const categories = [...new Set(flows.flatMap((f) => (Array.isArray(f.attributes.dataCategories) ? f.attributes.dataCategories : [])))];
    const data = flows.length ? `${categories.join(", ") || "Content sent in prompts"} [${refsOf(flows).join(", ")}]` : kind === "data_store" ? cite("Application data") : NOT_YET;

    let location = NOT_YET;
    if (kind === "data_store") {
      const u = ctx.unknownsWithTopic("Data region", "Database hosting").find((x) => x.relatedFacts.some((id) => ids.includes(id)));
      const a = u ? ctx.answer(u.id) : undefined;
      if (a) location = `${a.value.replace(/[|\[\]]/g, " ").replace(/\s+/g, " ").trim()} [${a.id}]`;
    } else if (kind === "ai_provider") {
      const a = ctx.answer("profile.ai-processing-region");
      if (a) location = `${a.value.replace(/[|\[\]]/g, " ").replace(/\s+/g, " ").trim()} [${a.id}]`;
    }
    rows.push([cite(subject), cite(purpose), data, location]);
  }
  return rows.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`), ""];
}

// ---- the documents

function privacyNotice(d: Doc, ctx: AnswerCtx) {
  d.text(TEMPLATES.privacyIntro);

  d.heading("Who is responsible");
  const who = draft();
  profile(ctx, who, "organisation-name");
  profile(ctx, who, "service-description");
  profile(ctx, who, "dpo");
  d.bullets(who);

  d.heading("What personal data is handled");
  const data = fromBank(ctx, "data-categories");
  addFacts(data, ctx.facts("data_flow"));
  d.draft(data);

  d.heading("Why it is used");
  const why = draft();
  profile(ctx, why, "lawful-basis");
  d.draft(why);

  d.heading("Who receives it");
  d.draft(fromBank(ctx, "data-recipients"));

  d.heading("Where it is stored");
  d.draft(fromBank(ctx, "data-stores", "data-region"));

  d.heading("How long it is kept");
  d.draft(fromBank(ctx, "data-retention", "data-deletion"));

  d.heading("How it is protected");
  d.draft(fromBank(ctx, "auth-methods", "data-encryption-rest", "data-encryption-transit", "data-separation", "keys-storage"));

  d.heading("Use of artificial intelligence");
  d.draft(fromBank(ctx, "ai-use", "ai-providers", "ai-training"));

  d.heading("Your rights");
  d.text(TEMPLATES.privacyRights);
  d.text(TEMPLATES.privacyContact);

  d.heading("Changes to this notice");
  d.text(TEMPLATES.privacyChanges);
}

function subprocessors(d: Doc, ctx: AnswerCtx) {
  d.text(TEMPLATES.subprocessorsIntro);
  d.heading("External services");
  const rows = serviceRows(ctx);
  if (rows.length) d.lines.push(...table(["Service", "Purpose", "Data", "Location"], rows));
  else {
    const none = draft();
    for (const id of ["ai-provider/none-found", "data-store/none-found"]) {
      const f = factsBy(ctx, id)[0];
      if (f) addFacts(none, [f]);
    }
    d.draft(none);
  }
  d.heading("Other suppliers");
  const other = draft();
  profile(ctx, other, "other-suppliers");
  d.draft(other);
}

function dpia(d: Doc, ctx: AnswerCtx) {
  d.text(TEMPLATES.dpiaIntro);

  d.heading("1. Description of the processing");
  const desc = draft();
  profile(ctx, desc, "service-description");
  d.draft(desc);
  d.bullets(fromBank(ctx, "data-categories", "data-stores", "data-recipients", "ai-use"));

  d.heading("2. Necessity and proportionality");
  const basis = draft();
  profile(ctx, basis, "lawful-basis");
  d.draft(basis);
  d.draft(fromBank(ctx, "data-retention", "data-deletion"));

  d.heading("3. What the code shows that bears on risk");
  const obs = draft();
  addFacts(obs, factsBy(ctx, "logging/request-body"));
  addFacts(obs, factsBy(ctx, "secrets/hardcoded-patterns"));
  addFacts(obs, ctx.byDetector("client-exposure/public-secret-name"));
  addFacts(obs, ctx.byDetector("client-exposure/ai-sdk-in-browser"));
  addFacts(obs, ctx.facts("data_store").filter((f) => f.attributes.rowLevelSecurity !== undefined));
  const serious = ctx.evidence.findings.filter((f) => f.severity === "critical" || f.severity === "high");
  for (const f of serious) obs.sentences.push({ text: `A Seaworthy scan reported a ${f.severity}-severity finding (${f.ruleId}).`, refs: [f.id] });
  d.bullets(obs);
  d.bullets(fromBank(ctx, "ai-training"));

  d.heading("4. Measures to reduce risk");
  const measures = draft();
  profile(ctx, measures, "dpia-risk-measures");
  d.draft(measures);
  d.bullets(fromBank(ctx, "auth-mfa", "access-admin", "data-encryption-rest", "data-encryption-transit", "org-incident", "org-breach"));

  d.heading("5. Consultation");
  const consult = draft();
  profile(ctx, consult, "dpia-consultation");
  d.draft(consult);

  d.heading("6. Sign-off");
  d.text(TEMPLATES.dpiaSignoff);
}

function aiUse(d: Doc, ctx: AnswerCtx) {
  d.text(TEMPLATES.aiIntro);
  const used = ctx.facts("ai_provider").length > 0;
  d.heading("Whether AI is used");
  d.draft(fromBank(ctx, "ai-use"));
  if (!used) return;

  d.heading("Purpose");
  const purpose = draft();
  profile(ctx, purpose, "ai-purpose");
  d.draft(purpose);
  d.heading("Providers and models");
  d.draft(fromBank(ctx, "ai-providers"));
  d.heading("Data sent to AI providers");
  d.draft(fromBank(ctx, "ai-data-sent"));
  d.heading("How providers may use that data");
  d.draft(fromBank(ctx, "ai-training"));
  d.heading("Human oversight");
  d.draft(fromBank(ctx, "ai-oversight"));
  d.heading("Where processing happens");
  d.draft(fromBank(ctx, "ai-region"));
  d.heading("Access and credentials");
  d.draft(fromBank(ctx, "ai-keys", "ai-browser"));
}

function trustPage(d: Doc, ctx: AnswerCtx) {
  d.text(TEMPLATES.trustIntro);
  d.heading("Security at a glance");
  d.bullets(fromBank(ctx, "auth-methods", "data-stores", "data-region", "data-encryption-rest", "data-encryption-transit", "keys-storage", "keys-hardcoded", "keys-browser"));
  d.heading("Use of AI");
  d.bullets(fromBank(ctx, "ai-use", "ai-providers", "ai-training"));
  d.heading("Suppliers");
  const rows = serviceRows(ctx);
  if (rows.length) d.lines.push(...table(["Service", "Purpose", "Data", "Location"], rows));
  d.heading("Contact and incidents");
  d.bullets(fromBank(ctx, "org-dpo", "org-incident", "org-breach"));
}

const BUILDERS: Record<DocumentId, (d: Doc, ctx: AnswerCtx) => void> = {
  "privacy-notice": privacyNotice,
  subprocessors,
  dpia,
  "ai-use": aiUse,
  "trust-page": trustPage,
};

export function isDocumentId(s: string): s is DocumentId {
  return s in BUILDERS;
}

/** Builds one document as Markdown with footnotes. Everything about the project comes from evidence or answers. */
export function buildDocument(id: DocumentId, evidence: EvidenceFile, answers: AnswersFile, opts: BuildOptions): BuiltDocument {
  const meta = DOCUMENTS.find((x) => x.id === id)!;
  const ctx = buildAnswerCtx(evidence, answers);
  const d = new Doc(`${meta.title}: ${evidence.project.name}`, evidence.generatedAt.slice(0, 10));
  BUILDERS[id](d, ctx);

  const body = d.render();
  const refs = usedRefs([body]);
  const sources = refs.length ? ["", "## Sources", "", ...footnoteLines(refs, evidence, answers, opts), ""] : [];
  const markdown = [withFootnoteMarks(body), ...sources].join("\n");
  return { id, title: meta.title, markdown, needs: d.needs };
}

/** What each document still needs from the user, for `soundings questions --documents`. */
export function documentNeeds(evidence: EvidenceFile, answers: AnswersFile): Need[] {
  const all = new Map<string, Need>();
  for (const { id } of DOCUMENTS) for (const n of buildDocument(id, evidence, answers, { locations: false }).needs) all.set(n.key, n);
  return [...all.values()];
}

