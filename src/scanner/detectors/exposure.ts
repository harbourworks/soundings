import { envReads } from "../../core/js.js";
import type { FactDraft } from "../../evidence/build.js";
import { AI_PROVIDERS } from "./ai.js";
import { importsModule } from "../context.js";
import type { Detector } from "../types.js";

const PUBLIC_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_|PUBLIC_)/;
/**
 * Names that must never ship to a browser. ANON and PUBLISHABLE keys are public by design, and
 * are deliberately not listed: reporting them would be a false alarm.
 */
const NEVER_PUBLIC = /SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|OPENAI|ANTHROPIC|CLAUDE|GEMINI|GROQ|MISTRAL|DATABASE_URL/i;

const publicSecretNames: Detector = {
  id: "client-exposure/public-secret-name",
  skipReason: () => null,
  run: (ctx) => {
    const facts: FactDraft[] = [];
    for (const f of ctx.js) {
      const seen = new Set<string>();
      for (const r of envReads(f.ast)) {
        if (!PUBLIC_PREFIX.test(r.name) || !NEVER_PUBLIC.test(r.name) || seen.has(r.name)) continue;
        seen.add(r.name);
        facts.push({
          kind: "client_side_exposure",
          subject: "Browser-exposed secret name",
          claim: `A variable named like a secret uses a public prefix, so its value is shipped to browsers (${r.name}).`,
          attributes: { variable: r.name },
          confidence: "high",
          detector: "client-exposure/public-secret-name",
          key: `${f.file}#${r.name}`,
          locations: [{ file: f.file, line: ctx.project.position(f.file, r.offset).line }],
        });
      }
    }
    if (facts.length > 0) return facts;
    return [
      {
        kind: "client_side_exposure",
        subject: "Browser-exposed secrets",
        claim: "No secret-named variables with a public prefix were found in the scanned code.",
        claimType: "not-found",
        confidence: "medium",
        detector: "client-exposure/public-secret-name",
        key: "project",
      },
    ];
  },
};

const aiSdkInBrowser: Detector = {
  id: "client-exposure/ai-sdk-in-browser",
  skipReason: (ctx) => (AI_PROVIDERS.some((p) => ctx.hasDep(...p.packages)) ? null : "no AI SDK in dependencies"),
  run: (ctx) =>
    ctx.js.flatMap((f): FactDraft[] => {
      if (!f.isClient) return [];
      const spec = AI_PROVIDERS.find((p) => p.packages.some((pkg) => importsModule(f, pkg)));
      if (!spec) return [];
      return [
        {
          kind: "client_side_exposure",
          subject: `${spec.subject} SDK in browser code`,
          claim: `A browser component imports the ${spec.subject} SDK, which suggests a provider key may reach the browser.`,
          attributes: { sdk: spec.packages[0]! },
          confidence: "medium",
          detector: "client-exposure/ai-sdk-in-browser",
          key: f.file,
          locations: [{ file: f.file }],
        },
      ];
    }),
};

export const exposureDetectors: Detector[] = [publicSecretNames, aiSdkInBrowser];
