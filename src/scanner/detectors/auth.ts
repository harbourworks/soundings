import type { FactDraft } from "../../evidence/build.js";
import { calls } from "../ast.js";
import { importsModule } from "../context.js";
import type { Detector } from "../types.js";

const SUPABASE_METHODS: Record<string, string> = {
  signInWithPassword: "email-password",
  signUp: "email-password",
  signInWithOtp: "one-time-code",
  signInWithOAuth: "oauth",
  signInWithIdToken: "oauth",
  signInWithSSO: "sso",
};

const supabaseAuth: Detector = {
  id: "auth/supabase-auth",
  skipReason: (ctx) => (ctx.hasDepPrefix("@supabase/") ? null : "no Supabase package in dependencies"),
  run: (ctx) => {
    const facts: FactDraft[] = [];
    for (const f of ctx.js) {
      const methods = new Set<string>();
      let line: number | undefined;
      for (const c of calls(f.ast)) {
        const i = c.chain?.indexOf("auth") ?? -1;
        const m = c.chain && i >= 0 ? c.chain[i + 1] : undefined;
        if (m && SUPABASE_METHODS[m]) {
          methods.add(SUPABASE_METHODS[m]!);
          line ??= c.line;
        }
      }
      if (methods.size === 0) continue;
      facts.push({
        kind: "auth",
        subject: "Supabase Auth",
        claim: `Users sign in through Supabase Auth (${[...methods].sort().join(", ")}).`,
        attributes: { provider: "Supabase Auth", methods: [...methods] },
        confidence: "high",
        detector: "auth/supabase-auth",
        key: f.file,
        locations: [{ file: f.file, ...(line ? { line } : {}) }],
      });
    }
    return facts;
  },
};

interface AuthSpec {
  slug: string;
  subject: string;
  packages: string[];
  claim: string;
}

const AUTH_PACKAGES: AuthSpec[] = [
  { slug: "jwt", subject: "JSON Web Tokens", packages: ["jsonwebtoken", "jose"], claim: "Requests are authenticated with JSON Web Tokens." },
  { slug: "authjs", subject: "Auth.js", packages: ["next-auth", "@auth/core"], claim: "Sign-in is handled by Auth.js." },
  { slug: "clerk", subject: "Clerk", packages: ["@clerk/nextjs", "@clerk/clerk-react", "@clerk/express", "@clerk/backend"], claim: "Sign-in is handled by Clerk." },
  { slug: "auth0", subject: "Auth0", packages: ["@auth0/nextjs-auth0", "@auth0/auth0-react", "auth0"], claim: "Sign-in is handled by Auth0." },
  { slug: "firebase-auth", subject: "Firebase Auth", packages: ["firebase/auth", "firebase-admin/auth"], claim: "Sign-in is handled by Firebase Auth." },
  { slug: "passport", subject: "Passport", packages: ["passport"], claim: "Sign-in is handled with Passport strategies." },
];

function authDetector(spec: AuthSpec): Detector {
  const id = `auth/${spec.slug}`;
  return {
    id,
    skipReason: (ctx) => {
      const roots = spec.packages.map((p) => (p.startsWith("@") ? p : p.split("/")[0]!));
      return ctx.hasDep(...roots) ? null : `no ${spec.subject} package in dependencies`;
    },
    run: (ctx) =>
      ctx.js.flatMap((f): FactDraft[] => {
        const imp = spec.packages.map((p) => importsModule(f, p)).find(Boolean);
        if (!imp) return [];
        return [
          {
            kind: "auth",
            subject: spec.subject,
            claim: spec.claim,
            attributes: { provider: spec.subject },
            confidence: "high",
            detector: id,
            key: f.file,
            locations: [{ file: f.file, ...(imp.line ? { line: imp.line } : {}) }],
          },
        ];
      }),
  };
}

export const authDetectors: Detector[] = [supabaseAuth, ...AUTH_PACKAGES.map(authDetector)];
