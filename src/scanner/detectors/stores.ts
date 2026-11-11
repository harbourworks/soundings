import type { FactDraft } from "../../evidence/build.js";
import { importsModule } from "../context.js";
import type { Detector } from "../types.js";

const SUPABASE_SQL = /(^|\/)supabase\/(migrations\/.+|schema)\.sql$/;

/** Removes SQL comments so a commented-out statement isn't counted. */
const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** "public.notes", "\"notes\"" and "notes" are the same table; other schemas (auth, storage) are Supabase's own. */
function tableName(raw: string): string | null {
  const parts = raw.replace(/"/g, "").split(".");
  if (parts.length === 2 && parts[0] !== "public") return null;
  return parts[parts.length - 1]!.toLowerCase();
}

const supabase: Detector = {
  id: "data-store/supabase",
  skipReason: (ctx) =>
    ctx.hasDepPrefix("@supabase/") || ctx.project.files.some((f) => SUPABASE_SQL.test(f)) ? null : "no Supabase package or migrations found",
  run: (ctx) => {
    const sqlFiles = ctx.project.files.filter((f) => SUPABASE_SQL.test(f)).sort();
    const created = new Map<string, { file: string; line: number }>();
    const secured = new Set<string>();

    for (const file of sqlFiles) {
      const raw = ctx.project.read(file);
      if (raw === null) continue;
      const sql = stripSqlComments(raw);
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) {
        const name = tableName(m[1]!);
        if (name && !created.has(name)) created.set(name, { file, line: ctx.project.position(file, raw.indexOf(m[0])).line });
      }
      for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi)) {
        const name = tableName(m[1]!);
        if (name) secured.add(name);
      }
    }

    if (created.size > 0) {
      const names = [...created.keys()];
      const covered = names.filter((n) => secured.has(n)).length;
      const rls = covered === names.length ? "enabled" : covered === 0 ? "disabled" : "partial";
      const first = created.values().next().value as { file: string; line: number };
      const claim = {
        enabled: "Application data is stored in a Supabase Postgres database, and the migrations enable row-level security on every table they create.",
        partial: "Application data is stored in a Supabase Postgres database, but the migrations enable row-level security on only some of the tables they create.",
        disabled: "Application data is stored in a Supabase Postgres database, and the migrations don't enable row-level security on the tables they create.",
      }[rls];
      return [
        {
          kind: "data_store",
          subject: "Supabase Postgres",
          claim,
          attributes: { provider: "Supabase", engine: "postgres", rowLevelSecurity: rls, tables: names.length },
          confidence: "high",
          detector: "data-store/supabase",
          key: sqlFiles[0]!,
          locations: [{ file: first.file, line: first.line }],
        },
      ];
    }

    // No migrations in the repo: the client library shows Supabase is used, but not how it is secured.
    const user = ctx.js.find((f) => importsModule(f, "@supabase/supabase-js"));
    if (!user) return [];
    const imp = importsModule(user, "@supabase/supabase-js");
    return [
      {
        kind: "data_store",
        subject: "Supabase Postgres",
        claim: "The app uses Supabase as its database; no migrations were found, so row-level security can't be checked.",
        attributes: { provider: "Supabase", engine: "postgres", rowLevelSecurity: "unknown" },
        confidence: "medium",
        detector: "data-store/supabase",
        key: user.file,
        locations: [{ file: user.file, ...(imp?.line ? { line: imp.line } : {}) }],
      } satisfies FactDraft,
    ];
  },
};

export interface StoreSpec {
  slug: string;
  subject: string;
  engine: string;
  packages: string[];
}

export const STORES: StoreSpec[] = [
  { slug: "postgres", subject: "PostgreSQL", engine: "postgres", packages: ["pg", "postgres", "pg-promise"] },
  { slug: "mongodb", subject: "MongoDB", engine: "mongodb", packages: ["mongodb", "mongoose"] },
  { slug: "redis", subject: "Redis", engine: "redis", packages: ["redis", "ioredis", "@upstash/redis"] },
  { slug: "firebase", subject: "Firebase (Firestore)", engine: "firestore", packages: ["firebase/firestore", "firebase-admin/firestore", "firebase-admin"] },
];

function storeDetector(spec: StoreSpec): Detector {
  const id = `data-store/${spec.slug}`;
  return {
    id,
    skipReason: (ctx) => {
      const roots = spec.packages.map((p) => p.split("/")[0]!);
      return ctx.hasDep(...roots) ? null : `no ${spec.subject} package in dependencies`;
    },
    run: (ctx) =>
      ctx.js.flatMap((f): FactDraft[] => {
        const imp = spec.packages.map((p) => importsModule(f, p)).find(Boolean);
        if (!imp) return [];
        return [
          {
            kind: "data_store",
            subject: spec.subject,
            claim: `The app stores data in ${spec.subject}.`,
            attributes: { engine: spec.engine },
            confidence: "high",
            detector: id,
            key: f.file,
            locations: [{ file: f.file, ...(imp.line ? { line: imp.line } : {}) }],
          },
        ];
      }),
  };
}

export const storeDetectors: Detector[] = [supabase, ...STORES.map(storeDetector)];
