import { describe, expect, it } from "vitest";
import { extractRefs, documentUse } from "../src/evidence/refs.js";

describe("extractRefs", () => {
  it("finds single and multiple markers", () => {
    const refs = extractRefs("We use OpenAI [EV-3acc7131]. Data stays in the UK [EV-f979a4be, A-001].");
    expect(refs.map((r) => r.id)).toEqual(["EV-3acc7131", "EV-f979a4be", "A-001"]);
    expect(refs.map((r) => r.kind)).toEqual(["EV", "EV", "A"]);
  });

  it("gives the same answer on repeated calls (no shared regex state)", () => {
    const text = "One [EV-3acc7131] and two [A-002].";
    expect(extractRefs(text).length).toBe(2);
    expect(extractRefs(text).length).toBe(2);
    expect(extractRefs(text).length).toBe(2);
  });

  it("ignores ordinary Markdown links and brackets", () => {
    expect(extractRefs("See [the docs](https://example.org) and [note].")).toEqual([]);
  });

  it("ignores a group that mixes an id with other words", () => {
    expect(extractRefs("[EV-3acc7131 and more]")).toEqual([]);
  });

  it("recognises finding and knowledge-base markers", () => {
    expect(extractRefs("[F-1a2b3c4d] [KB-0f1e2d3c]").map((r) => r.kind)).toEqual(["F", "KB"]);
  });
});

describe("documentUse", () => {
  it("states high-confidence observed facts plainly", () => {
    expect(documentUse({ confidence: "high", claimType: "observed" })).toBe("plain");
  });
  it("qualifies medium confidence and not-found claims", () => {
    expect(documentUse({ confidence: "medium", claimType: "observed" })).toBe("qualified");
    expect(documentUse({ confidence: "medium", claimType: "not-found" })).toBe("qualified");
  });
  it("never puts low confidence in a document", () => {
    expect(documentUse({ confidence: "low", claimType: "observed" })).toBe("never");
  });
});
