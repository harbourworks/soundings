import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { scan } from "../src/scanner/scan.js";
import { buildEvidence } from "../src/evidence/build.js";
import { readFileSync, writeFileSync } from "node:fs";
import { verifyText, verifyFailed, sentencesOf, type IssueCode } from "../src/verify/verify.js";
import { renderVerify } from "../src/reporters/verify.js";
import { run, type CliDeps } from "../src/cli/main.js";
import { cleanupProjects, evidenceOf, pkg, project } from "./helpers.js";
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

cleanupProjects();

/** Warnings about the sentences themselves (the draft notice is always present here). */
const warnings = (text: string, ev = notes, a = answers): IssueCode[] => verifyText(`${DRAFT_NOTICE}\n\n${text}`, ev, a).issues.filter((i) => i.severity === "warning").map((i) => i.code);

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
    for (const name of ["Mistral", "Cohere", "Groq", "AWS Bedrock", "Bedrock", "Ollama", "LiteLLM", "OpenRouter"]) {
      expect(codes(`Ticket text is sent to ${name} [${anthropic}].`, ticketApi), name).toContain("entity-not-in-source");
    }
    expect(codes(`Ticket text is sent to Bedrock to rate urgency [${bedrockFlow}].`, ticketApi)).toEqual([]);
    expect(codes(`Ticket text is sent to AWS Bedrock to rate urgency [${bedrockFlow}].`, ticketApi)).toEqual([]);
  });

  describe("saying data is sent to a provider when the cited facts only show its SDK is used", () => {
    // Recorded bad output (issue #34): two providers called with fixed strings, so the scan has no
    // data_flow fact, yet this passed --strict.
    const fixedStrings = evidenceOf({
      "package.json": pkg(["openai", "@anthropic-ai/sdk"]),
      "server.ts": [
        'import OpenAI from "openai";',
        'import Anthropic from "@anthropic-ai/sdk";',
        "const openai = new OpenAI();",
        "const anthropic = new Anthropic();",
        "export async function ping() {",
        '  await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Say hello." }] });',
        '  await anthropic.messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "Say hello." }] });',
        "}",
      ].join("\n"),
    });
    const sdkOnly = idOf(fixedStrings, (f) => f.subject === "Anthropic" && f.kind === "ai_provider");
    const ticketApi = evidence("express-pg");
    const anthropic = idOf(ticketApi, (f) => f.subject === "Anthropic" && f.kind === "ai_provider");
    const anthropicFlow = idOf(ticketApi, (f) => f.subject === "Anthropic" && f.kind === "data_flow");
    const cohereFlow = idOf(ticketApi, (f) => f.subject === "Cohere" && f.kind === "data_flow");
    const rag = evidence("fastapi-rag");
    const bedrock = idOf(rag, (f) => f.subject === "AWS Bedrock" && f.kind === "ai_provider");

    it("fails the recorded sentence with flow-not-in-source", () => {
      expect(fixedStrings.facts.some((f) => f.kind === "data_flow")).toBe(false);
      const r = verifyText(`${DRAFT_NOTICE}\n\nThe app sends user questions to Anthropic [${sdkOnly}].`, fixedStrings, emptyAnswers());
      expect(r.issues.map((i) => i.code)).toEqual(["flow-not-in-source"]);
      expect(r.issues[0]!.message).toBe("Says data is sent to Anthropic, but the cited facts only show that Anthropic's SDK is used, not that data flows to it.");
      expect(r.ok).toBe(false);
    });

    it("catches the other sent-to wordings", () => {
      for (const s of [
        "User questions are sent to Anthropic",
        "The app sends each ticket to Anthropic",
        "Ticket text is shared with Anthropic",
        "The ticket body is passed to Anthropic",
        "Ticket text is transmitted to Anthropic",
        "Ticket text is included in prompts to Anthropic",
        "Ticket text is forwarded to Anthropic",
        "Customer files are uploaded to Anthropic",
        "USER QUESTIONS ARE SENT TO ANTHROPIC",
      ]) expect(codes(`${s} [${anthropic}].`, ticketApi), s).toEqual(["flow-not-in-source"]);
    });

    it("names the provider by a single word of a longer subject (Bedrock for AWS Bedrock)", () => {
      expect(codes(`Search queries are sent to Bedrock [${bedrock}].`, rag)).toEqual(["flow-not-in-source"]);
      expect(codes(`Search queries are sent to AWS Bedrock [${bedrock}].`, rag)).toEqual(["flow-not-in-source"]);
    });

    it("still fails when the only cited flow is to a different provider", () => {
      expect(codes(`Ticket text is sent to Anthropic and Cohere [${anthropic}, ${cohereFlow}].`, ticketApi)).toEqual(["flow-not-in-source"]);
    });

    it("passes when a data_flow fact for that provider is cited", () => {
      expect(codes(`The app sends user questions to Anthropic [${anthropicFlow}].`, ticketApi)).toEqual([]);
      expect(codes(`The app sends user questions to Anthropic [${anthropic}, ${anthropicFlow}].`, ticketApi)).toEqual([]);
    });

    it("leaves sentences that only say the SDK is used", () => {
      expect(codes(`The app uses the Anthropic SDK [${sdkOnly}].`, fixedStrings, emptyAnswers())).toEqual([]);
      expect(codes(`Anthropic is used to rate ticket urgency [${anthropic}].`, ticketApi)).toEqual([]);
      // The provider comes before the sending: what is sent goes to the users, not to Anthropic.
      expect(codes(`Replies drafted with Anthropic are sent to customers [${anthropic}].`, ticketApi)).toEqual([]);
      // The provider sits between the verb and "to": the client object is passed, not data to Anthropic.
      expect(codes(`The app passes the Anthropic client to each route handler [${anthropic}].`, ticketApi)).toEqual([]);
      expect(codes(`Ticket text is sent to Anthropic's API for triage [${anthropic}].`, ticketApi)).toEqual(["flow-not-in-source"]);
      expect(codes(`Ticket text is sent to the model hosted by Anthropic [${anthropic}].`, ticketApi)).toEqual(["flow-not-in-source"]);
    });

    it("leaves a sentence that also cites the user's own answer", () => {
      const a = setAnswer(emptyAnswers(), "profile.log-retention", "Ticket text is sent to Anthropic.", NOW);
      expect(codes(`Ticket text is sent to Anthropic [${anthropic}, A-001].`, ticketApi, a)).toEqual([]);
    });

    it("keeps the existing absence error, not this one, for a negative sentence", () => {
      expect(codes(`No ticket text is sent to Anthropic [${anthropic}].`, ticketApi)).toEqual(["absence-contradicts-source"]);
    });
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

describe("uncited statements beyond the built-in vendor list (recorded bad outputs)", () => {
  // From a field-test draft: each of these passed --strict with no message before.
  const ISSUE_DRAFT = [
    "Payments are handled by PayPal.",
    "Call audio is transcribed by Deepgram.",
    "No user content is ever sent to an AI provider.",
    "Customer records are stored in Snowflake.",
  ];

  it.each(ISSUE_DRAFT)("flags %j as an uncited statement, as a warning", (sentence) => {
    const r = verifyText(`${DRAFT_NOTICE}\n\n${sentence}`, notes, answers);
    expect(r.issues.map((i) => [i.severity, i.code])).toEqual([["warning", "unreferenced-statement"]]);
    expect(r.ok).toBe(true);
    expect(verifyFailed(r, true)).toBe(true);
    expect(verifyFailed(r, false)).toBe(false);
  });

  it("names the vendor it could not find in the evidence", () => {
    const [issue] = verifyText(`${DRAFT_NOTICE}\n\nPayments are handled by PayPal.`, notes, answers).issues;
    expect(issue!.message).toContain('"PayPal"');
    const [neg] = verifyText(`${DRAFT_NOTICE}\n\nNo user content is ever sent to an AI provider.`, notes, answers).issues;
    expect(neg!.message).toMatch(/never|absent|not done/i);
  });

  it("flags the whole issue draft line by line", () => {
    const text = `Draft, not legal advice.\n\nThe app uses the OpenAI SDK [${openai}].\n${ISSUE_DRAFT.join("\n")}\nThe app stores customer records in Snowflake.\n`;
    const r = verifyText(text, notes, answers);
    expect(r.issues.map((i) => [i.line, i.severity, i.code])).toEqual([4, 5, 6, 7, 8].map((l) => [l, "warning", "unreferenced-statement"]));
  });

  it("catches other negative claims about data and other vendor positions", () => {
    for (const s of [
      "Personal data is never shared with third parties.",
      "Nothing is logged.",
      "Prompts are not stored after the request.",
      "Files are uploaded without being collected for training.",
      "None of the transcripts are transmitted outside the region.",
      "Error reports are sent to Rollbar.",
      "Accounts are managed with Okta Workforce.",
      "Usage events are stored in Amazon Redshift.",
      'Payments are handled by "PayPal".',
      "User content isn't stored anywhere.",
      "Audio files aren\u2019t sent to any third party.",
      "Prompts won't be logged.",
      "Data is NEVER sent to an AI provider.",
      "No personal data leaves the server.",
      "Images are processed by Cloudinary's API.",
    ]) expect(warnings(s), s).toEqual(["unreferenced-statement"]);
  });

  it("catches every form of each data verb the docs list (recorded bad outputs)", () => {
    // From the gatekeeper review: these three passed --strict with only the missing-notice warning.
    for (const s of [
      "The company does not sell personal data.",
      "The server does not log prompts.",
      "Personal data does not leave the server.",
    ]) expect(warnings(s), s).toEqual(["unreferenced-statement"]);

    const forms: Record<string, string[]> = {
      send: ["send", "sends", "sent", "sending"],
      share: ["share", "shares", "shared", "sharing"],
      store: ["store", "stores", "stored", "storing"],
      log: ["log", "logs", "logged", "logging"],
      transmit: ["transmit", "transmits", "transmitted", "transmitting"],
      collect: ["collect", "collects", "collected", "collecting"],
      upload: ["upload", "uploads", "uploaded", "uploading"],
      retain: ["retain", "retains", "retained", "retaining"],
      sell: ["sell", "sells", "sold", "selling"],
      leave: ["leave", "leaves", "left", "leaving"],
    };
    for (const [verb, list] of Object.entries(forms)) {
      for (const f of list) {
        const s = `Personal data is never ${f} here.`;
        expect(warnings(s), `${verb}: ${s}`).toEqual(["unreferenced-statement"]);
      }
    }

    // docs/verify.md must list exactly these verbs, in this order.
    const doc = readFileSync(resolve(__dirname, "../docs/verify.md"), "utf8");
    const listed = doc.match(/with one of the verbs ([a-z, ]+) or ([a-z]+), in any form/);
    expect(listed, "verb list in docs/verify.md").not.toBeNull();
    expect([...listed![1]!.split(", "), listed![2]]).toEqual(Object.keys(forms));
  });

  it("keeps the existing errors for the built-in vendors, numbers and places", () => {
    expect(codes("Payments are handled by Stripe.")).toEqual(["missing-reference"]);
    expect(codes("No data is ever sent to OpenAI.")).toEqual(["missing-reference"]);
    expect(codes("No backups are stored in Ireland.")).toEqual(["missing-reference"]);
  });
});

describe("decoys the new checks must leave alone", () => {
  it("headings and questions", () => {
    expect(warnings("## Payments handled by PayPal\n\n### No data is sent to Snowflake\n\nAre payments handled by PayPal?\n\nIs any user content ever sent to an AI provider?")).toEqual([]);
  });

  it("sentences that already cite a source", () => {
    expect(codes(`Summaries are generated by OpenAI [${openai}].`)).toEqual([]);
    expect(warnings(`Summaries are generated by OpenAI [${openai}].`)).toEqual([]);
    expect(warnings("Payments are handled by PayPal [A-001].")).toEqual([]);
    expect(warnings(`No user content is ever stored in the logs, according to [${logging}].`)).not.toContain("unreferenced-statement");
  });

  it("a name that is in the evidence", () => {
    const api = evidence("express-pg");
    expect(warnings("Sessions are signed with JSON Web Tokens.", api)).toEqual([]);
    expect(warnings("Requests are written to Server logs.", api)).toEqual([]);
  });

  it("capitals at the start of a sentence", () => {
    expect(warnings("Overview.\n\nHowever, this section is a summary.\n\nEverything below comes from the scan.\n\nSecurity is a shared job.")).toEqual([]);
  });

  it("product, document and format names that aren't vendors", () => {
    for (const s of [
      "Draft, not legal advice.",
      "Soundings by Dynamo.",
      "This draft was written by Soundings.",
      "Findings come from Seaworthy.",
      "The answers can be exported to Word.",
      "Save the evidence in JSON and the report in Markdown.",
      "The steps are described in Section 4 of the guide.",
      "Reviews happen in January.",
    ]) expect(warnings(s), s).toEqual([]);
  });

  it("ordinary prose with no data claim", () => {
    for (const s of [
      "This is not a complete list of every risk.",
      "Good security practice starts with knowing what your software does.",
      "No document can replace a careful review.",
      "Nothing here is legal advice.",
      "Read it with your own lawyer in mind.",
    ]) expect(warnings(s), s).toEqual([]);
  });
});

describe("the summary line follows the exit code", () => {
  const draft = `${DRAFT_NOTICE}\n\nPayments are handled by PayPal.`;
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  it("says Failed under --strict when there are only warnings", () => {
    const out = plain(renderVerify(verifyText(draft, notes, answers), "draft.md", { strict: true }));
    expect(out).toContain("Failed: 1 warning, counted as a failure with --strict.");
    expect(out).not.toContain("Passed.");
    expect(out).not.toContain("Every statement points to a source");
  });

  it("says Passed with the warning count without --strict", () => {
    const out = plain(renderVerify(verifyText(draft, notes, answers), "draft.md"));
    expect(out).toContain("Passed. 1 sentences checked, 0 with references. 1 warning.");
    expect(out).toContain("Every statement points to a source");
  });

  it("the CLI exit codes are unchanged: 1 with --strict, 0 without", async () => {
    const cwd = project({});
    writeFileSync(`${cwd}/draft.md`, draft);
    writeFileSync(`${cwd}/soundings-evidence.json`, JSON.stringify(notes));
    const go = async (args: string[]) => {
      const out: string[] = [];
      const deps: CliDeps = { out: (s) => out.push(s), err: (s) => out.push(s), env: {}, cwd, now: () => NOW };
      return { code: await run(args, deps), text: plain(out.join("\n")) };
    };
    const strict = await go(["verify", "draft.md", "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.text).toContain("Failed");
    expect(strict.text).not.toContain("Passed.");
    const lax = await go(["verify", "draft.md"]);
    expect(lax.code).toBe(0);
    expect(lax.text).toContain("Passed.");
    writeFileSync(`${cwd}/draft.md`, `${draft}\n\nWe use Stripe to take payments.`);
    for (const args of [["verify", "draft.md"], ["verify", "draft.md", "--strict"]]) {
      const errs = await go(args);
      expect(errs.code, args.join(" ")).toBe(1);
      expect(errs.text).toContain("Failed: 1 problem.");
    }
  });
});
