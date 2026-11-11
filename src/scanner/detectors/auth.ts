import type { FactDraft } from "../../evidence/build.js";
import { calls } from "../ast.js";
import { importsModule, importsPy } from "../context.js";
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

export interface AuthSpec {
  slug: string;
  subject: string;
  packages: string[];
  /** Python modules for the same thing. */
  pyModules?: string[];
  claim: string;
}

export const AUTH_PACKAGES: AuthSpec[] = [
  { slug: "jwt", subject: "JSON Web Tokens", packages: ["jsonwebtoken", "jose"], pyModules: ["jwt", "jose"], claim: "Requests are authenticated with JSON Web Tokens." },
  { slug: "authjs", subject: "Auth.js", packages: ["next-auth", "@auth/core"], claim: "Sign-in is handled by Auth.js." },
  { slug: "clerk", subject: "Clerk", packages: ["@clerk/nextjs", "@clerk/clerk-react", "@clerk/express", "@clerk/backend"], pyModules: ["clerk_backend_api"], claim: "Sign-in is handled by Clerk." },
  { slug: "auth0", subject: "Auth0", packages: ["@auth0/nextjs-auth0", "@auth0/auth0-react", "auth0"], pyModules: ["auth0"], claim: "Sign-in is handled by Auth0." },
  { slug: "firebase-auth", subject: "Firebase Auth", packages: ["firebase/auth", "firebase-admin/auth"], pyModules: ["firebase_admin.auth"], claim: "Sign-in is handled by Firebase Auth." },
  { slug: "entra", subject: "Microsoft Entra ID", packages: ["@azure/msal-browser", "@azure/msal-react", "@azure/msal-node"], pyModules: ["msal"], claim: "Sign-in uses Microsoft Entra ID (MSAL)." },
  { slug: "fastapi-security", subject: "OAuth2 bearer tokens (FastAPI)", packages: [], pyModules: ["fastapi.security"], claim: "Requests are authenticated with bearer tokens through FastAPI's security helpers." },
  { slug: "django-auth", subject: "Django authentication", packages: [], pyModules: ["django.contrib.auth"], claim: "Sign-in is handled by Django's authentication system." },
  { slug: "flask-login", subject: "Flask-Login", packages: [], pyModules: ["flask_login"], claim: "Sign-in is handled with Flask-Login." },
  { slug: "authlib", subject: "Authlib", packages: [], pyModules: ["authlib"], claim: "Sign-in or token handling uses Authlib." },
  { slug: "passport", subject: "Passport", packages: ["passport"], claim: "Sign-in is handled with Passport strategies." },
];

function authDetector(spec: AuthSpec): Detector {
  const id = `auth/${spec.slug}`;
  const fact = (file: string, line?: number): FactDraft => ({
    kind: "auth",
    subject: spec.subject,
    claim: spec.claim,
    attributes: { provider: spec.subject },
    confidence: "high",
    detector: id,
    key: file,
    locations: [{ file, ...(line ? { line } : {}) }],
  });
  return {
    id,
    skipReason: (ctx) => {
      const roots = spec.packages.map((p) => (p.startsWith("@") ? p : p.split("/")[0]!));
      if (roots.length > 0 && ctx.hasDep(...roots)) return null;
      if (spec.pyModules && ctx.hasPyImport(...spec.pyModules)) return null;
      return `no ${spec.subject} package in dependencies`;
    },
    run: (ctx) => [
      ...ctx.py.flatMap((f): FactDraft[] => {
        const imp = spec.pyModules ? importsPy(f, ...spec.pyModules) : undefined;
        return imp ? [fact(f.file, imp.line)] : [];
      }),
      ...ctx.js.flatMap((f): FactDraft[] => {
        const imp = spec.packages.map((p) => importsModule(f, p)).find(Boolean);
        return imp ? [fact(f.file, imp.line)] : [];
      }),
    ],
  };
}

export const authDetectors: Detector[] = [supabaseAuth, ...AUTH_PACKAGES.map(authDetector)];
