import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DETECTORS } from "../src/scanner/detectors/index.js";

const doc = readFileSync(resolve(__dirname, "../docs/detectors.md"), "utf8");

/** Services are documented as `third-party/<service>` once, with the names listed; everything else by full ID. */
const documented = (id: string) => doc.includes(`\`${id}\``) || (id.startsWith("third-party/") && doc.includes(`\`${id.slice("third-party/".length)}\``));

describe("docs/detectors.md", () => {
  it("mentions every detector, so the docs can't drift from the code", () => {
    expect(DETECTORS.map((d) => d.id).filter((id) => !documented(id))).toEqual([]);
  });
});
