import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { extractRefs } from "../src/evidence/refs.js";
import { scan } from "../src/scanner/scan.js";
import { BANK } from "../src/questions/bank.js";
import { emptyAnswers, setAnswer, AnswersError } from "../src/questions/answers-file.js";
import { answerAll, answerQuestion, pendingNeeds, renderSentence } from "../src/questions/engine.js";
import { PROFILE } from "../src/questions/profile.js";
import { stateOf } from "../src/questions/flow.js";
import type { AnswersFile } from "../src/evidence/schema.js";
import { cleanupProjects, rand } from "./helpers.js";

cleanupProjects();

const FIX = resolve(__dirname, "../fixtures/apps");
const NOW = new Date("2026-11-11T11:30:00Z");
const evidence = (name: string) => scan({ root: join(FIX, name), now: NOW }).evidence;
const answered = (file: AnswersFile, key: string, value: string) => setAnswer(file, key, value, NOW);
const result = (name: string, id: string, answers = emptyAnswers()) => answerQuestion(BANK.find((b) => b.id === id)!, evidence(name), answers);

describe("the question bank", () => {
  it("has about 40 questions with unique ids across every category", () => {
    expect(BANK.length).toBeGreaterThanOrEqual(40);
    expect(new Set(BANK.map((b) => b.id)).size).toBe(BANK.length);
    expect(new Set(BANK.map((b) => b.category)).size).toBe(7);
  });

  it("only asks profile items that exist", () => {
    for (const b of BANK) {
      for (const e of ["notes-saas", "static-site", "express-pg"]) {
        const r = answerQuestion(b, evidence(e), emptyAnswers());
        for (const n of r.needs) {
          if (n.key.startsWith("profile.")) expect(Object.values(PROFILE).some((p) => p.key === n.key), n.key).toBe(true);
        }
      }
    }
  });

  it.each(["notes-saas", "express-pg", "static-site"])("never states anything without a real reference (%s)", (name) => {
    const ev = evidence(name);
    const known = new Set([...ev.facts.map((f) => f.id), ...ev.findings.map((f) => f.id)]);
    for (const r of answerAll(ev, emptyAnswers())) {
      if (r.answer === "") continue;
      expect(r.refs.length, r.id).toBeGreaterThan(0);
      for (const ref of extractRefs(r.answer)) expect(known.has(ref.id), `${r.id} cites ${ref.id}`).toBe(true);
    }
  });
});

describe("answers from evidence", () => {
  it("says an AI provider is used, and cites the fact", () => {
    const r = result("notes-saas", "ai-use");
    expect(r.status).toBe("answered");
    expect(r.answer).toMatch(/OpenAI/);
    expect(r.answer).toMatch(/\[EV-[0-9a-f]{8}\]/);
  });

  it("says no AI provider was found, as a 'not found' statement", () => {
    const r = result("static-site", "ai-use");
    expect(r.status).toBe("answered");
    expect(r.answer).toMatch(/No AI provider SDK from the supported list was found/);
  });

  it("states row-level security from the fact", () => {
    expect(result("notes-saas", "data-separation").answer).toMatch(/row-level security on every table/);
  });

  it("qualifies inferred facts instead of stating them plainly", () => {
    const r = result("notes-saas", "logging-content");
    expect(r.answer).toMatch(/inferred from the code, not confirmed/);
  });

  it("reports a hard-coded key as found, without the value", () => {
    const r = result("notes-saas", "keys-hardcoded");
    expect(r.answer).toMatch(/No hard-coded keys matching known credential formats were found/);
  });
});

describe("what only the user can answer", () => {
  it("asks for the provider's data-use setting, then uses the answer and cites it", () => {
    const before = result("notes-saas", "ai-training");
    expect(before.status).toBe("needs-input");
    expect(before.needs.map((n) => n.key)).toEqual(["UQ-openai-data-use"]);

    const answers = answered(emptyAnswers(), "UQ-openai-data-use", "Zero data retention is enabled on our account.");
    const after = result("notes-saas", "ai-training", answers);
    expect(after.status).toBe("answered");
    expect(after.answer).toContain("Zero data retention is enabled on our account");
    expect(after.answer).toContain("[A-001]");
  });

  it("is partly answered when evidence covers one half and the user the other", () => {
    const r = result("notes-saas", "ai-data-sent");
    expect(r.status).toBe("partial");
    expect(r.needs.map((n) => n.key)).toEqual(["profile.ai-data-categories"]);
  });

  it("answers profile questions once for every questionnaire", () => {
    const answers = answered(emptyAnswers(), "profile.incident-response", "Our lead engineer runs a written playbook.");
    const r = result("express-pg", "org-incident", answers);
    expect(r.status).toBe("answered");
    expect(r.answer).toMatch(/^Incident response: Our lead engineer runs a written playbook \[A-001\]\.$/);
  });

  it("lists scan questions first, without duplicates, and drops them once answered", () => {
    const ev = evidence("notes-saas");
    const none = emptyAnswers();
    const p1 = pendingNeeds(ev, answerAll(ev, none), none);
    expect(p1.slice(0, 3).every((p) => p.key.startsWith("UQ-"))).toBe(true);
    expect(new Set(p1.map((p) => p.key)).size).toBe(p1.length);

    const a = answered(none, "UQ-supabase-region", "London");
    const p2 = pendingNeeds(ev, answerAll(ev, a), a);
    expect(p2.some((p) => p.key === "UQ-supabase-region")).toBe(false);
  });
});

describe("conflicting evidence and answers", () => {
  it("lets the user's answer win and notes what the scan reported", () => {
    const answers = answered(emptyAnswers(), "override.ai-use", "We use a self-hosted model only.");
    const r = result("notes-saas", "ai-use", answers);
    expect(r.overridden).toBe(true);
    expect(r.status).toBe("answered");
    expect(r.answer).toMatch(/^Stated by the project team: We use a self-hosted model only \[A-001\]\./);
    expect(r.answer).toMatch(/the code scan reported something different: The system uses AI services from OpenAI/);
    expect(r.refs).toContain("A-001");
    expect(r.refs.some((x) => x.startsWith("EV-"))).toBe(true);
  });
});

describe("answers file", () => {
  it("keeps an answer's id when it is changed, and numbers new ones in order", () => {
    let f = answered(emptyAnswers(), "UQ-a", "one");
    f = answered(f, "UQ-b", "two");
    f = answered(f, "UQ-a", "one, revised");
    expect(f.answers.map((a) => [a.id, a.question, a.value])).toEqual([
      ["A-001", "UQ-a", "one, revised"],
      ["A-002", "UQ-b", "two"],
    ]);
  });

  it("refuses an answer that looks like a secret", () => {
    expect(() => answered(emptyAnswers(), "profile.secret-storage", `We use ghp_${rand(36)} for deploys`)).toThrow(AnswersError);
    expect(() => answered(emptyAnswers(), "profile.secret-storage", "   ")).toThrow(AnswersError);
  });

  it("can't be used to forge an evidence marker", () => {
    const answers = answered(emptyAnswers(), "profile.dpo", "Ask [EV-3acc7131] and [A-009]");
    const r = result("notes-saas", "org-dpo", answers);
    expect(r.answer).toContain("Ask (EV-3acc7131) and (A-009)");
    expect(extractRefs(r.answer).map((x) => x.id)).toEqual(["A-001"]);
  });

  it("keeps answers to scan questions that are no longer asked, and says so", () => {
    const ev = evidence("static-site");
    const f = answered(emptyAnswers(), "UQ-supabase-region", "London");
    expect(stateOf(ev, f).stale).toEqual(["UQ-supabase-region"]);
  });
});

describe("rendering", () => {
  it("puts the marker before the final full stop", () => {
    expect(renderSentence({ text: "Uses OpenAI.", refs: ["EV-3acc7131"] })).toBe("Uses OpenAI [EV-3acc7131].");
    expect(renderSentence({ text: "Uses OpenAI", refs: ["EV-3acc7131", "A-001"] })).toBe("Uses OpenAI [EV-3acc7131, A-001]");
  });

  it("the committed fixtures produce stable answers (snapshot of one)", () => {
    const text = readFileSync(resolve(__dirname, "../fixtures/expected/notes-saas.json"), "utf8");
    expect(text).toContain("notes-saas");
    expect(result("notes-saas", "ai-providers").answer).toMatch(/^AI providers in use: OpenAI \(model gpt-4o-mini\)/);
  });
});
