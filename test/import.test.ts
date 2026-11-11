import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCsv, writeCsv, detectDelimiter } from "../src/import/csv.js";
import { bestMatch } from "../src/import/match.js";
import { fillQuestionnaire } from "../src/import/fill.js";
import { scan } from "../src/scanner/scan.js";
import { emptyAnswers, setAnswer } from "../src/questions/answers-file.js";
import { verifyText } from "../src/verify/verify.js";
import { DRAFT_NOTICE } from "../src/export/notice.js";
import { run, type CliDeps } from "../src/cli/main.js";
import { cleanupProjects, licensed, project } from "./helpers.js";

cleanupProjects();

const Q = resolve(__dirname, "../fixtures/questionnaires");
const FIX = resolve(__dirname, "../fixtures/apps");
const NOW = new Date("2026-11-11T11:30:00Z");
const sample = readFileSync(join(Q, "sample-client.csv"), "utf8");
const expected = JSON.parse(readFileSync(join(Q, "sample-client.expected.json"), "utf8")) as Record<string, string | null>;
const evidence = scan({ root: join(FIX, "notes-saas"), now: NOW }).evidence;

describe("CSV", () => {
  it("reads quotes, doubled quotes, delimiters and newlines inside cells", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi""\nthere"\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["1", "x, y", 'say "hi"\nthere']]);
  });

  it("strips a byte-order mark and detects semicolons", () => {
    const text = "﻿Question;Answer\nDo you?;Yes\n";
    expect(detectDelimiter(text)).toBe(";");
    expect(parseCsv(text)[0]).toEqual(["Question", "Answer"]);
  });

  it("round-trips awkward cells", () => {
    const rows = [["q", "a"], ['has "quotes", commas', "multi\nline"]];
    expect(parseCsv(writeCsv(rows))).toEqual(rows);
  });
});

describe("matching a client's wording to the bank", () => {
  it("matches every row of the sample questionnaire correctly and leaves the rest unmatched", () => {
    const rows = parseCsv(sample).slice(1);
    for (const [ref, text] of rows) {
      expect(bestMatch(text!)?.question.id ?? null, `${ref}: ${text}`).toBe(expected[ref!]);
    }
  });

  /**
   * Held out: written after the keywords were tuned, in different words. A match, if made, must be
   * right, and commercial questions that merely share a word must stay unmatched.
   */
  const holdout: Array<[string, string[] | null]> = [
    ["Do you use any generative AI tools in providing this service?", ["ai-use"]],
    ["Which large language models do you use?", ["ai-providers", "ai-use"]],
    ["Is customer content used for model training by your AI vendor?", ["ai-training"]],
    ["Do you encrypt the database at rest?", ["data-encryption-rest"]],
    ["Is HTTPS used for all connections to the service?", ["data-encryption-transit"]],
    ["How do you handle a deletion request from an individual?", ["data-deletion", "data-retention"]],
    ["List all third-party suppliers that process our data.", ["suppliers-list", "data-recipients"]],
    ["Do admins use two-factor authentication?", ["auth-mfa"]],
    ["Are secrets stored in environment variables or a vault?", ["keys-storage"]],
    ["Do you rotate API keys regularly?", ["keys-rotation"]],
    ["Describe your process for responding to security incidents.", ["org-incident"]],
    ["How are vulnerabilities in dependencies managed?", ["org-vulnerabilities"]],
    ["What are your recovery time and recovery point objectives?", ["org-backup"]],
    ["Describe your approach to staff security awareness training.", ["org-training"]],
    ["Please confirm the registered office address of your company.", null],
    ["What insurance cover do you hold?", null],
    ["How many employees do you have?", null],
    ["Do you accept our standard payment terms?", null],
    ["Will you sign our data processing agreement?", null],
    ["What is your complaints procedure for customers?", null],
  ];

  it("never makes a wrong match on held-out wording", () => {
    const wrong = holdout.flatMap(([text, ok]) => {
      const got = bestMatch(text)?.question.id ?? null;
      return got !== null && (ok === null || !ok.includes(got)) ? [`"${text}" matched ${got}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  /**
   * A second set, written after all tuning and never used to adjust a keyword. It is the honest
   * measure of how well matching copes with wording it has not seen.
   */
  const unseen: Array<[string, string[] | null]> = [
    ["Is any artificial intelligence used within the product?", ["ai-use"]],
    ["Name the AI vendors you rely on.", ["ai-providers"]],
    ["Do you permit your AI vendors to retain our prompts for training?", ["ai-training", "ai-data-sent"]],
    ["Where is our information physically located?", ["data-region", "data-stores"]],
    ["Are stored records encrypted?", ["data-encryption-rest"]],
    ["Is TLS used between the user and your servers?", ["data-encryption-transit"]],
    ["How long do you retain customer records after contract end?", ["data-retention"]],
    ["How do users log in?", ["auth-methods"]],
    ["Is two-factor login offered?", ["auth-mfa"]],
    ["Who can administer your production environment?", ["access-admin"]],
    ["How do you store credentials and tokens used by the service?", ["keys-storage"]],
    ["Is any password or key embedded in your codebase?", ["keys-hardcoded"]],
    ["Do application logs include personal information?", ["logging-content"]],
    ["What is your process if a security incident occurs?", ["org-incident"]],
    ["Do you maintain Cyber Essentials Plus certification?", ["org-certifications"]],
    ["Are staff screened before they get access to client data?", ["org-vetting"]],
    ["Do you use Google Analytics or similar?", ["suppliers-analytics"]],
    ["Is the service backed up and how quickly can it be restored?", ["org-backup"]],
    ["What is your company registration number?", null],
    ["Please attach your latest audited accounts.", null],
    ["Do you agree to our terms and conditions?", null],
    ["How would you describe your company culture?", null],
    ["Is your organisation a small or medium enterprise?", null],
    ["Which payment methods do you accept from customers?", null],
    ["What are the hours of your support desk?", null],
  ];

  it("never makes a wrong match on wording it has not seen, and never matches a commercial question", () => {
    const wrong = unseen.flatMap(([text, ok]) => {
      const got = bestMatch(text)?.question.id ?? null;
      return got !== null && (ok === null || !ok.includes(got)) ? [`"${text}" matched ${got}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  it("matches a useful share of unseen questions, and leaves the rest for a person", () => {
    const should = unseen.filter(([, ok]) => ok !== null);
    const hit = should.filter(([text, ok]) => ok!.includes(bestMatch(text)?.question.id ?? "")).length;
    // Measured when this set was written: 7 of 18 (39%). The matcher is deliberately cautious: an
    // unmatched row costs a person a minute; a wrong match is a confident answer to the wrong
    // question. This floor guards against the matcher getting worse, and is not a quality claim.
    expect(hit / should.length, `matched ${hit} of ${should.length}`).toBeGreaterThanOrEqual(0.35);
  });
});

describe("filling a client questionnaire", () => {
  const result = fillQuestionnaire(sample, evidence, emptyAnswers());
  const rows = parseCsv(result.csv);

  it("uses the existing answer column and adds sources and match columns", () => {
    expect(result.answerColumnAdded).toBe(false);
    expect(rows[0]).toEqual(["Ref", "Question", "Supplier Response", "Notes", "Soundings sources", "Soundings match"]);
  });

  it("matches the rows it should and lists the rest as not matched", () => {
    const byRef = new Map(rows.slice(1).map((r) => [r[0]!, r]));
    for (const [ref, id] of Object.entries(expected)) {
      const row = byRef.get(ref)!;
      if (id === null) {
        expect(row[2], ref).toMatch(/^NEEDS YOUR INPUT: no standard question clearly matches/);
        expect(row[5]).toBe("no match");
      } else {
        expect(row[5], ref).toMatch(new RegExp(`^${id} \\(`));
      }
    }
    expect(result.outcomes.filter((o) => o.status === "unmatched").map((o) => o.row)).toEqual([28, 29, 30]);
  });

  it("answers from evidence, marks the rest 'needs your input', and cites sources", () => {
    const row = (ref: string) => rows.find((r) => r[0] === ref)!;
    expect(row("1.1")[2]).toMatch(/OpenAI \[EV-[0-9a-f]{8}\]/);
    expect(row("1.1")[4]).toMatch(/EV-[0-9a-f]{8}: Code scan, OpenAI/);
    expect(row("1.4")[2]).toBe("NEEDS YOUR INPUT: Is OpenAI's data-retention or training opt-out configured on your account?");
    expect(row("6.1")[2]).toMatch(/^NEEDS YOUR INPUT: Do you have an incident response process/);
  });

  it("uses the user's answers once they are given", () => {
    const a = setAnswer(emptyAnswers(), "UQ-openai-data-use", "Zero data retention is on.", NOW);
    const r = parseCsv(fillQuestionnaire(sample, evidence, a).csv);
    const cell = r.find((x) => x[0] === "1.4")![2]!;
    expect(cell).toContain("Zero data retention is on");
    expect(cell).toContain("[A-001]");
    expect(cell).not.toContain("NEEDS YOUR INPUT");
  });

  it("leaves a cell the client already filled alone", () => {
    const text = 'Ref,Question,Answer\n1,Is data encrypted at rest?,"Yes, AES-256"\n2,Is data encrypted in transit?,\n';
    const r = fillQuestionnaire(text, evidence, emptyAnswers());
    const out = parseCsv(r.csv);
    expect(out[1]![2]).toBe("Yes, AES-256");
    expect(out[1]![4]).toBe("kept: already answered");
    expect(r.outcomes.map((o) => o.status)).toEqual(["kept", "needs-input"]);
  });

  it("adds an answer column when there is none, and copes with quoted multi-line questions", () => {
    const text = 'Requirement\n"Does your solution use\nartificial intelligence?"\n';
    const r = fillQuestionnaire(text, evidence, emptyAnswers());
    expect(r.answerColumnAdded).toBe(true);
    const out = parseCsv(r.csv);
    expect(out[0]).toEqual(["Requirement", "Soundings answer", "Soundings sources", "Soundings match"]);
    expect(out[1]![1]).toMatch(/OpenAI/);
  });

  it("refuses a file with no questions", () => {
    expect(() => fillQuestionnaire("Question,Answer\n", evidence, emptyAnswers())).toThrow(/header row and at least one question/);
  });

  it("produces answers that pass verification, cell by cell", () => {
    for (const r of rows.slice(1)) {
      const cellText = r[2]!;
      if (cellText.startsWith("NEEDS YOUR INPUT")) continue;
      const report = verifyText(`${DRAFT_NOTICE}\n\n${cellText.replace(/ NEEDS YOUR INPUT:.*/s, "")}`, evidence, emptyAnswers());
      expect(report.issues.filter((i) => i.severity === "error"), `${r[0]}: ${cellText}`).toEqual([]);
    }
  });
});

describe("soundings answer / verify commands", () => {
  function harness(cwd: string) {
    const out: string[] = [];
    const err: string[] = [];
    const lic = licensed();
    const deps: CliDeps = { out: (s) => out.push(s), err: (s) => err.push(s), env: lic.env, provider: lic.provider, cwd, now: () => NOW };
    return { out, err, deps };
  }
  async function workspace() {
    const cwd = project({});
    writeFileSync(join(cwd, "client.csv"), sample);
    const h = harness(cwd);
    expect(await run(["scan", join(FIX, "notes-saas")], h.deps)).toBe(0);
    return cwd;
  }

  it("fills a questionnaire to a new file and never overwrites the original", async () => {
    const cwd = await workspace();
    const h = harness(cwd);
    expect(await run(["answer", "client.csv"], h.deps)).toBe(0);
    expect(existsSync(join(cwd, "client.answered.csv"))).toBe(true);
    expect(readFileSync(join(cwd, "client.csv"), "utf8")).toBe(sample);
    expect(h.out.join("\n")).toContain("Not matched (answer these by hand)");

    const clash = harness(cwd);
    expect(await run(["answer", "client.csv", "--output", "client.csv"], clash.deps)).toBe(2);
  });

  it("explains how to handle Excel files", async () => {
    const cwd = await workspace();
    writeFileSync(join(cwd, "client.xlsx"), "not really");
    const h = harness(cwd);
    expect(await run(["answer", "client.xlsx"], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("Save As > CSV UTF-8");
  });

  it("verify exits 0 for good text, 1 for bad text, 2 for a missing file", async () => {
    const cwd = await workspace();
    const md = harness(cwd);
    await run(["answers", "--output", "good.md"], md.deps);
    writeFileSync(join(cwd, "bad.md"), `${DRAFT_NOTICE}\n\nWe use Stripe and Anthropic in Ireland for 30 days.\n`);

    expect(await run(["verify", "good.md"], harness(cwd).deps)).toBe(0);
    const bad = harness(cwd);
    expect(await run(["verify", "bad.md"], bad.deps)).toBe(1);
    expect(bad.out.join("\n")).toContain("missing-reference");
    expect(await run(["verify", "nope.md"], harness(cwd).deps)).toBe(2);
    expect(await run(["verify"], harness(cwd).deps)).toBe(2);
  });

  it("verify --strict fails on warnings and --format json is parseable", async () => {
    const cwd = await workspace();
    writeFileSync(join(cwd, "w.md"), `${DRAFT_NOTICE}\n\nOur system is built with care.\n`);
    expect(await run(["verify", "w.md"], harness(cwd).deps)).toBe(0);
    expect(await run(["verify", "w.md", "--strict"], harness(cwd).deps)).toBe(1);
    const j = harness(cwd);
    await run(["verify", "w.md", "--format", "json"], j.deps);
    expect(JSON.parse(j.out.join("\n")).issues[0].code).toBe("unreferenced-statement");
  });
});
