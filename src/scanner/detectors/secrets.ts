import { envReads } from "../../core/js.js";
import type { FactDraft } from "../../evidence/build.js";
import { createGuard, findLeaks } from "../../evidence/redact.js";
import type { Detector } from "../types.js";

const PUBLIC_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_|PUBLIC_)/;
/** Names that hold a credential. Only the names are ever recorded, never values. */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|DSN|DATABASE_URL|CONNECTION_STRING/i;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/;

const envUsage: Detector = {
  id: "secrets/env-usage",
  skipReason: () => null,
  run: (ctx) => {
    const names = new Set<string>();
    const locations: Array<{ file: string; line: number }> = [];
    for (const f of ctx.js) {
      const text = ctx.project.read(f.file);
      if (text === null) continue;
      for (const r of envReads(f.ast)) {
        if (PUBLIC_PREFIX.test(r.name) || !SECRET_NAME.test(r.name)) continue;
        names.add(r.name);
        locations.push({ file: f.file, line: ctx.project.position(f.file, r.offset).line });
      }
    }
    if (names.size === 0) return [];
    return [
      {
        kind: "secret_handling",
        subject: "Environment variables",
        claim: "Keys and secrets are read from environment variables.",
        attributes: { mechanism: "env", keyNames: [...names] },
        confidence: "high",
        detector: "secrets/env-usage",
        key: "env",
        locations: locations.slice(0, 5),
      },
    ];
  },
};

/**
 * Looks for values shaped like real keys. Finding none is reported as "not found", never as
 * "none exist": a pattern search can only rule out the formats it knows.
 */
const hardcoded: Detector = {
  id: "secrets/hardcoded-patterns",
  skipReason: () => null,
  run: (ctx) => {
    const facts: FactDraft[] = [];
    const guard = createGuard();
    for (const file of ctx.project.files) {
      if (LOCKFILE.test(file)) continue;
      const text = ctx.project.read(file);
      if (text === null) continue;
      const leaks = findLeaks(text, guard);
      if (leaks.length === 0) continue;
      const kinds = [...new Set(leaks.map((l) => l.kind))].sort();
      facts.push({
        kind: "secret_handling",
        subject: "Hard-coded keys",
        claim: `A value shaped like a credential (${kinds.join(", ")}) was found in the scanned files. The value is not recorded.`,
        attributes: { patternKinds: kinds },
        confidence: "medium",
        detector: "secrets/hardcoded-patterns",
        key: file,
        locations: [{ file, line: ctx.project.position(file, leaks[0]!.index).line }],
      });
    }
    if (facts.length > 0) return facts;
    return [
      {
        kind: "secret_handling",
        subject: "Hard-coded keys",
        claim: "No hard-coded keys matching known credential formats were found in the scanned files.",
        claimType: "not-found",
        attributes: { patternsChecked: 8 },
        confidence: "medium",
        detector: "secrets/hardcoded-patterns",
        key: "project",
      },
    ];
  },
};

export const secretDetectors: Detector[] = [envUsage, hardcoded];
