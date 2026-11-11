import type { FactDraft } from "../../evidence/build.js";
import { importsModule, importsPy } from "../context.js";
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
    ctx.hasDepPrefix("@supabase/") || ctx.hasPyImport("supabase") || ctx.project.files.some((f) => SUPABASE_SQL.test(f)) ? null : "no Supabase package or migrations found",
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
    const pyUser = ctx.py.find((f) => importsPy(f, "supabase"));
    const user = ctx.js.find((f) => importsModule(f, "@supabase/supabase-js")) ?? pyUser;
    if (!user) return [];
    const imp = "imports" in user && pyUser === user ? importsPy(pyUser, "supabase") : importsModule(user as Parameters<typeof importsModule>[0], "@supabase/supabase-js");
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
  /** Python modules for the same store. */
  pyModules?: string[];
}

export const STORES: StoreSpec[] = [
  { slug: "postgres", subject: "PostgreSQL", engine: "postgres", packages: ["pg", "postgres", "pg-promise"], pyModules: ["psycopg", "psycopg2", "asyncpg"] },
  { slug: "mongodb", subject: "MongoDB", engine: "mongodb", packages: ["mongodb", "mongoose"], pyModules: ["pymongo", "motor", "mongoengine", "beanie"] },
  { slug: "redis", subject: "Redis", engine: "redis", packages: ["redis", "ioredis", "@upstash/redis"], pyModules: ["redis", "aioredis"] },
  { slug: "firebase", subject: "Firebase (Firestore)", engine: "firestore", packages: ["firebase/firestore", "firebase-admin/firestore", "firebase-admin"], pyModules: ["firebase_admin.firestore", "google.cloud.firestore"] },
  { slug: "mysql", subject: "MySQL", engine: "mysql", packages: ["mysql", "mysql2"], pyModules: ["pymysql", "mysql.connector", "aiomysql", "MySQLdb"] },
  { slug: "sqlalchemy", subject: "SQL database (SQLAlchemy)", engine: "sql", packages: [], pyModules: ["sqlalchemy"] },
  { slug: "azure-blob", subject: "Azure Blob Storage", engine: "object-storage", packages: ["@azure/storage-blob"], pyModules: ["azure.storage.blob"] },
  { slug: "cosmos", subject: "Azure Cosmos DB", engine: "cosmos", packages: ["@azure/cosmos"], pyModules: ["azure.cosmos"] },
  { slug: "azure-search", subject: "Azure AI Search", engine: "search-index", packages: ["@azure/search-documents"], pyModules: ["azure.search.documents"] },
  { slug: "chroma", subject: "Chroma", engine: "vector", packages: ["chromadb"], pyModules: ["chromadb"] },
  { slug: "qdrant", subject: "Qdrant", engine: "vector", packages: ["@qdrant/js-client-rest"], pyModules: ["qdrant_client"] },
  { slug: "pinecone", subject: "Pinecone", engine: "vector", packages: ["@pinecone-database/pinecone"], pyModules: ["pinecone"] },
];

function storeDetector(spec: StoreSpec): Detector {
  const id = `data-store/${spec.slug}`;
  const fact = (file: string, line?: number): FactDraft => ({
    kind: "data_store",
    subject: spec.subject,
    claim: `The app stores data in ${spec.subject}.`,
    attributes: { engine: spec.engine },
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

/**
 * A database connection string in configuration (a compose file, settings, an env template).
 * It shows what the project is set up to use even when no client library is imported in code the
 * scan reads. Medium confidence, and dropped when a client import already shows the same store.
 */
const CONNECTION_FILE = /\.(?:py|ya?ml|toml|ini|cfg|json)$|(?:^|\/)\.env(?:\.[\w.-]+)?$/;
const CONNECTION_STRING = /\b(postgres(?:ql)?(?:\+\w+)?|mysql(?:\+\w+)?|mongodb(?:\+srv)?|rediss?):\/\//gi;
const CONNECTION_SUBJECT = (scheme: string): string => {
  const s = scheme.toLowerCase();
  return s.startsWith("postgres") ? "PostgreSQL" : s.startsWith("mysql") ? "MySQL" : s.startsWith("mongodb") ? "MongoDB" : "Redis";
};

const connectionString: Detector = {
  id: "data-store/connection-string",
  skipReason: () => null,
  run: (ctx) => {
    const facts: FactDraft[] = [];
    for (const file of ctx.project.files) {
      if (!CONNECTION_FILE.test(file) || /(?:^|\/)(?:package-lock\.json|[^/]*\.lock)$/.test(file)) continue;
      const text = ctx.project.read(file);
      if (text === null) continue;
      const seen = new Set<string>();
      for (const m of text.matchAll(CONNECTION_STRING)) {
        const subject = CONNECTION_SUBJECT(m[1]!);
        if (seen.has(subject)) continue;
        seen.add(subject);
        facts.push({
          kind: "data_store",
          subject,
          claim: `A connection string for ${subject} appears in the project's configuration.`,
          attributes: { engine: subject.toLowerCase() },
          confidence: "medium",
          detector: "data-store/connection-string",
          key: file,
          locations: [{ file, line: ctx.project.position(file, m.index ?? 0).line }],
        });
      }
    }
    return facts;
  },
};

export const storeDetectors: Detector[] = [supabase, ...STORES.map(storeDetector), connectionString];
