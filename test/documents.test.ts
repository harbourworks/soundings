import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { scan } from "../src/scanner/scan.js";
import { DOCUMENTS, buildDocument, documentNeeds, isDocumentId } from "../src/documents/build.js";
import { TEMPLATES, TEMPLATE_SENTENCES, isTemplateSentence } from "../src/documents/templates.js";
import { OVERCLAIM, verifyText } from "../src/verify/verify.js";
import { emptyAnswers, setAnswer } from "../src/questions/answers-file.js";
import { DRAFT_NOTICE } from "../src/export/notice.js";
import { extractRefs } from "../src/evidence/refs.js";
import type { AnswersFile } from "../src/evidence/schema.js";

const FIX = resolve(__dirname, "../fixtures/apps");
const NOW = new Date("2026-11-11T11:30:00Z");
const evidence = (name: string) => scan({ root: join(FIX, name), now: NOW }).evidence;

let full: AnswersFile = emptyAnswers();
for (const [k, v] of [
  ["UQ-supabase-region", "London (eu-west-2)"],
  ["UQ-openai-data-use", "Zero data retention is enabled on our account."],
  ["UQ-retention-deletion", "Notes are deleted 30 days after an account is closed."],
  ["profile.organisation-name", "Acme Notes Ltd"],
  ["profile.service-description", "A notes app for small teams."],
  ["profile.dpo", "The lead engineer is the privacy contact."],
  ["profile.lawful-basis", "Contract."],
  ["profile.ai-processing-region", "United States, with a UK option not yet used"],
] as const) full = setAnswer(full, k, v, NOW);

describe("the documents", () => {
  it("are the five that were promised", () => {
    expect(DOCUMENTS.map((d) => d.id)).toEqual(["privacy-notice", "subprocessors", "dpia", "ai-use", "trust-page"]);
    expect(isDocumentId("dpia")).toBe(true);
    expect(isDocumentId("contract")).toBe(false);
  });

  describe.each(["notes-saas", "express-pg", "static-site"])("for %s", (name) => {
    const ev = evidence(name);
    for (const [label, answers] of [["without answers", emptyAnswers()], ["with answers", full]] as const) {
      it.each(DOCUMENTS.map((d) => d.id))(`%s passes the verifier with no issues, ${label}`, (id) => {
        const doc = buildDocument(id, ev, answers, { locations: true });
        const report = verifyText(doc.markdown, ev, answers);
        expect(report.issues).toEqual([]);
        expect(report.noticePresent).toBe(true);
      });
    }
  });

  it("carry the draft notice and never claim compliance or certification outside it", () => {
    const ev = evidence("notes-saas");
    for (const d of DOCUMENTS) {
      const md = buildDocument(d.id, ev, full, { locations: false }).markdown;
      expect(md).toContain(DRAFT_NOTICE);
      expect(md.replace(DRAFT_NOTICE, "")).not.toMatch(/\b(compliant|certified|guarantee[sd]?)\b/i);
    }
  });

  it("cite only sources that exist, and every footnote has a definition", () => {
    const ev = evidence("notes-saas");
    for (const d of DOCUMENTS) {
      const md = buildDocument(d.id, ev, full, { locations: true }).markdown;
      const marks = new Set([...md.matchAll(/\[\^([A-Za-z0-9-]+)\](?!:)/g)].map((m) => m[1]!));
      const defs = new Set([...md.matchAll(/^\[\^([A-Za-z0-9-]+)\]:/gm)].map((m) => m[1]!));
      expect([...marks].sort(), d.id).toEqual([...defs].sort());
      expect(md).not.toContain("Source not found");
      expect(extractRefs(md)).toEqual([]); // every marker became a footnote mark
    }
  });

  it("list what is missing instead of inventing it", () => {
    const ev = evidence("notes-saas");
    const doc = buildDocument("privacy-notice", ev, emptyAnswers(), { locations: false });
    expect(doc.markdown).toContain("**Needs your input.** What is the legal name of the organisation");
    expect(doc.markdown).toContain("## Open items");
    expect(doc.needs.map((n) => n.key)).toContain("profile.lawful-basis");
    expect(doc.markdown).not.toMatch(/Acme/);
  });

  it("use the team's own words, attributed, once they are given", () => {
    const ev = evidence("notes-saas");
    const md = buildDocument("privacy-notice", ev, full, { locations: false }).markdown;
    expect(md).toMatch(/Responsible organisation: Acme Notes Ltd \[\^A-\d{3}\]/);
    expect(md).toMatch(/Lawful basis: Contract \[\^A-\d{3}\]\./);
  });

  it("builds the subprocessor table from facts, one row per service, with locations from answers", () => {
    const ev = evidence("notes-saas");
    const md = buildDocument("subprocessors", ev, full, { locations: false }).markdown;
    const rows = md.split("\n").filter((l) => /^\| (OpenAI|Stripe|Supabase Postgres|Vercel Analytics)/.test(l));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => /\[\^EV-[0-9a-f]{8}\]/.test(r))).toBe(true);
    expect(rows.find((r) => r.startsWith("| Supabase"))).toMatch(/London \(eu-west-2\) \[\^A-\d{3}\]/);
    expect(rows.find((r) => r.startsWith("| Stripe"))).toContain("Not yet provided");
  });

  it("leaves a low-confidence prompt flow out of the subprocessor table", () => {
    const ev = evidence("mixed-ai");
    const low = ev.facts.filter((f) => f.kind === "data_flow" && f.confidence === "low");
    expect(low.map((f) => f.subject).sort()).toEqual(["Groq", "OpenAI"]);
    const md = buildDocument("subprocessors", ev, emptyAnswers(), { locations: false }).markdown;
    for (const f of low) expect(md).not.toContain(f.id);
    const groq = md.split("\n").find((l) => l.startsWith("| Groq"));
    expect(groq?.split(" | ")[2]).toBe("Not yet provided");
    expect(md.split("\n").find((l) => l.startsWith("| OpenAI"))).toContain("user-supplied content");
    expect(verifyText(md, ev, emptyAnswers()).issues.filter((i) => i.code === "low-confidence-fact")).toEqual([]);
  });

  it("says plainly that no AI is used, from the 'not found' fact, rather than describing a provider", () => {
    const md = buildDocument("ai-use", evidence("static-site"), emptyAnswers(), { locations: false }).markdown;
    expect(md).toMatch(/No AI provider SDK from the supported list was found/);
    expect(md).not.toContain("## Providers and models");
  });

  it("notes what the code shows that bears on risk in the DPIA, qualified as inferred", () => {
    const md = buildDocument("dpia", evidence("notes-saas"), emptyAnswers(), { locations: false }).markdown;
    expect(md).toContain("## 3. What the code shows that bears on risk");
    expect(md).toMatch(/request body is written to the logs.*inferred from the code, not confirmed/);
    expect(md).toContain("## 6. Sign-off");
  });

  it("collects what every document still needs, without duplicates", () => {
    const needs = documentNeeds(evidence("notes-saas"), emptyAnswers());
    expect(new Set(needs.map((n) => n.key)).size).toBe(needs.length);
    expect(needs.map((n) => n.key)).toEqual(expect.arrayContaining(["profile.ai-purpose", "profile.dpia-risk-measures", "profile.dpia-consultation"]));
  });
});

describe("the fixed template wording", () => {
  it("never implies legal assurance", () => {
    for (const s of TEMPLATE_SENTENCES) expect(OVERCLAIM.test(s), s).toBe(false);
  });

  it("is skipped by the verifier only when it matches exactly", () => {
    const ev = evidence("notes-saas");
    expect(isTemplateSentence(TEMPLATES.privacyRights)).toBe(true);
    const exact = verifyText(`${DRAFT_NOTICE}\n\n${TEMPLATES.privacyRights}\n`, ev, emptyAnswers());
    expect(exact.issues).toEqual([]);

    // The same sentence with something added is no longer fixed wording, so it is checked.
    const edited = TEMPLATES.privacyRights.replace("Information Commissioner's Office.", "Information Commissioner's Office, and OpenAI keeps data in Ireland for 30 days.");
    const report = verifyText(`${DRAFT_NOTICE}\n\n${edited}\n`, ev, emptyAnswers());
    expect(report.issues.some((i) => i.code === "missing-reference")).toBe(true);
  });
});
