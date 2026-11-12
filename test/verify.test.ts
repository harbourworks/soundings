import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { scan } from "../src/scanner/scan.js";
import { buildEvidence } from "../src/evidence/build.js";
import { verifyText, sentencesOf, type IssueCode } from "../src/verify/verify.js";
import { emptyAnswers, setAnswer } from "../src/questions/answers-file.js";
import { answerAll } from "../src/questions/engine.js";
import { renderQuestionnaireMarkdown } from "../src/export/questionnaire.js";
import { DRAFT_NOTICE } from "../src/export/notice.js";
import type { EvidenceFile } from "../src/evidence/schema.js";

const FIX = resolve(__dirname, "../fixtures/apps");
const NOW = new Date("2026-11-11T11:30:00Z");
const evidence = (name: string) => scan({ root: join(FIX, name), now: NOW }).evidence;
const idOf = (e: EvidenceFile, pred: (f: EvidenceFile["facts"][number]) => boolean) => e.facts.find(pred)!.id;

const notes = evidence("notes-saas");
const openai = idOf(notes, (f) => f.subject === "OpenAI" && f.kind === "ai_provider");
const logging = idOf(notes, (f) => f.kind === "logging");
const noneFound = idOf(evidence("static-site"), (f) => f.detector === "ai-provider/none-found");
const staticEv = evidence("static-site");

let answers = setAnswer(emptyAnswers(), "UQ-supabase-region", "London (eu-west-2)", NOW);
answers = setAnswer(answers, "profile.log-retention", "Logs are kept for 90 days.", NOW);
answers = setAnswer(answers, "profile.certifications", "We hold ISO 27001 certification.", NOW);

const codes = (text: string, ev = notes, a = answers): IssueCode[] => verifyText(`${DRAFT_NOTICE}\n\n${text}`, ev, a).issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("text Soundings writes itself passes", () => {
  it.each(["notes-saas", "express-pg", "static-site"])("the answers document for %s has no problems at all", (name) => {
    const ev = evidence(name);
    const md = renderQuestionnaireMarkdown(answerAll(ev, answers), ev, answers, { project: name, locations: true });
    const r = verifyText(md, ev, answers);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.sentencesWithReferences).toBeGreaterThan(5);
  });

  it("also passes with the user's own answers filled in and an override", () => {
    const a = setAnswer(answers, "override.ai-use", "We use a self-hosted model only.", NOW);
    const md = renderQuestionnaireMarkdown(answerAll(notes, a), notes, a, { project: "notes-saas", locations: false });
    expect(verifyText(md, notes, a).issues).toEqual([]);
  });
});

describe("each kind of bad output is rejected", () => {
  it("a specific statement with no reference", () => {
    expect(codes("We use Stripe to take payments.")).toEqual(["missing-reference"]);
    expect(codes("Data is kept for 30 days.")).toEqual(["missing-reference"]);
  });

  it("a reference that doesn't exist", () => {
    expect(codes("We use OpenAI for summaries [EV-deadbeef].")).toContain("unknown-reference");
  });

  it("a reference whose source doesn't mention what the sentence names", () => {
    expect(codes(`We use Anthropic for summaries [${openai}].`)).toContain("entity-not-in-source");
  });

  it("a newer AI provider named against a source about a different one, including Bedrock on its own", () => {
    const ticketApi = evidence("express-pg");
    const anthropic = idOf(ticketApi, (f) => f.subject === "Anthropic" && f.kind === "ai_provider");
    const bedrockFlow = idOf(ticketApi, (f) => f.subject === "AWS Bedrock" && f.kind === "data_flow");
    for (const name of ["Mistral", "Cohere", "Groq", "AWS Bedrock", "Bedrock"]) {
      expect(codes(`Ticket text is sent to ${name} [${anthropic}].`, ticketApi), name).toContain("entity-not-in-source");
    }
    expect(codes(`Ticket text is sent to Bedrock to rate urgency [${bedrockFlow}].`, ticketApi)).toEqual([]);
    expect(codes(`Ticket text is sent to AWS Bedrock to rate urgency [${bedrockFlow}].`, ticketApi)).toEqual([]);
  });

  it("a database engine only the Prisma or Drizzle detectors name, uncited or cited against another engine", () => {
    const hono = evidence("hono-drizzle");
    const postgres = idOf(hono, (f) => f.subject === "PostgreSQL" && f.kind === "data_store");
    expect(codes("Customer records are kept in CockroachDB.", hono)).toEqual(["missing-reference"]);
    expect(codes("Backups go to SQL Server.", hono)).toEqual(["missing-reference"]);
    for (const name of ["SQLite", "SQL Server", "CockroachDB", "MongoDB"]) {
      expect(codes(`The app stores data in ${name} [${postgres}].`, hono), name).toContain("entity-not-in-source");
    }
    expect(codes(`The app stores data in PostgreSQL [${postgres}].`, hono)).toEqual([]);
  });

  it("a number the source doesn't contain", () => {
    expect(codes("Logs are kept for 30 days [A-002].")).toContain("number-not-in-source");
    expect(codes("Logs are kept for 90 days [A-002].")).toEqual([]);
  });

  it("a place the source doesn't mention", () => {
    expect(codes("The database is hosted in Ireland [A-001].")).toContain("place-not-in-source");
    expect(codes("The database is hosted in London [A-001].")).toEqual([]);
  });

  it("saying something is absent when the cited fact shows it is present", () => {
    expect(codes(`The system does not use any AI provider [${openai}].`)).toContain("absence-contradicts-source");
  });

  it("saying something is present when the only cited fact is a 'not found' result", () => {
    expect(codes(`The system uses an AI provider [${noneFound}].`, staticEv)).toContain("presence-from-not-found");
    expect(codes(`No AI provider was found in the project [${noneFound}].`, staticEv)).toEqual([]);
  });

  it("stating an inferred fact as plain fact", () => {
    expect(codes(`Request bodies are written to the logs [${logging}].`)).toContain("unqualified-inference");
    expect(codes(`Request bodies appear to be written to the logs [${logging}].`)).toEqual([]);
    expect(codes(`Request bodies are written to the logs (inferred from the code) [${logging}].`)).toEqual([]);
  });

  it("wording that implies legal assurance", () => {
    expect(codes(`The platform is fully secure and compliant [${openai}].`)).toContain("overclaim");
    expect(codes(`Our service is certified to a recognised standard [${openai}].`)).toContain("overclaim");
  });

  it("allows the user to state their own certifications", () => {
    expect(codes("We hold ISO 27001 certification [A-003].")).toEqual([]);
  });

  it("citing a low-confidence fact", () => {
    const low = buildEvidence({
      generatedAt: "2026-11-11T11:30:00Z",
      tool: { name: "soundings", version: "0.0.1" },
      project: { name: "x" },
      scan: { filesScanned: 1, filesSkipped: 0, detectorsRun: [], detectorsSkipped: [] },
      facts: [{ kind: "auth", subject: "Maybe SSO", claim: "SSO might be configured.", confidence: "low", detector: "auth/guess", key: "a" }],
    });
    expect(codes(`SSO appears to be configured [${low.facts[0]!.id}].`, low, emptyAnswers())).toContain("low-confidence-fact");
  });
});

describe("what it deliberately leaves alone", () => {
  it("doesn't flag generic sentences that say nothing about the project", () => {
    expect(codes("Good security practice starts with knowing what your software does.")).toEqual([]);
  });

  it("warns, rather than fails, on project-sounding statements with no source", () => {
    const r = verifyText(`${DRAFT_NOTICE}\n\nOur system is built with care.`, notes, answers);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => [i.severity, i.code])).toEqual([["warning", "unreferenced-statement"]]);
  });

  it("warns when the draft notice is missing", () => {
    const r = verifyText(`The system uses AI services from OpenAI [${openai}].`, notes, answers);
    expect(r.issues.map((i) => i.code)).toEqual(["missing-notice"]);
    expect(r.ok).toBe(true);
  });

  it("skips headings, questions, source lists, code and 'needs your input' lines", () => {
    const text = `${DRAFT_NOTICE}\n\n## We use Stripe and OpenAI?\n\n### Do you use Anthropic?\n\n**Needs your input.** Do you use Stripe in 2026?\n\n\`\`\`\nWe use Stripe in London.\n\`\`\`\n\n## Sources\n\n[^EV-00000000]: Stripe is used in London for 12 reasons.\n`;
    expect(verifyText(text, notes, answers).issues).toEqual([]);
  });

  it("reads footnote marks and bracketed markers the same way", () => {
    expect(codes(`We use OpenAI [^${openai}].`)).toEqual([]);
    expect(codes("We use Stripe [^EV-deadbeef].")).toContain("unknown-reference");
  });

  it("doesn't treat ordinary Markdown links as references", () => {
    const text = `${DRAFT_NOTICE}\n\nSee [the docs](https://example.org) for how we use OpenAI.`;
    expect(verifyText(text, notes, answers).issues.map((i) => i.code)).toEqual(["missing-reference"]);
  });
});

describe("sentence splitting", () => {
  it("keeps abbreviations and decimals together and drops questions", () => {
    const { sentences } = sentencesOf("We store e.g. notes and version 2.5 data [A-001]. Do you use AI? Yes we do.");
    expect(sentences.map((s) => s.text)).toEqual(["We store e.g. notes and version 2.5 data [A-001].", "Yes we do."]);
  });
});
