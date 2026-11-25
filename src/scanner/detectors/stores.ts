import type { FactDraft } from "../../evidence/build.js";
import { importsModule, importsPy, isProductFile } from "../context.js";
import { stringBody, isFString, type Tok } from "../python/tokenize.js";
import type { Detector, PyFile } from "../types.js";

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
  /** The claim, when "The app stores data in <subject>." would say more than an import shows. */
  claim?: string;
  /** Defaults to high. */
  confidence?: "high" | "medium";
}

/** An ORM or query builder that can sit on more than one engine: a generic fact, dropped once a specific engine is known. */
const sqlLayer = (slug: string, name: string, confidence: "high" | "medium" = "high"): StoreSpec => ({
  slug,
  subject: `SQL database (${name})`,
  engine: "sql",
  packages: [slug],
  claim: `The app uses ${name}, but its imports don't show which database engine it connects to.`,
  confidence,
});

export const STORES: StoreSpec[] = [
  { slug: "postgres", subject: "PostgreSQL", engine: "postgres", packages: ["pg", "postgres", "pg-promise"], pyModules: ["psycopg", "psycopg2", "asyncpg"] },
  { slug: "mongodb", subject: "MongoDB", engine: "mongodb", packages: ["mongodb", "mongoose"], pyModules: ["pymongo", "motor", "mongoengine", "beanie"] },
  { slug: "redis", subject: "Redis", engine: "redis", packages: ["redis", "ioredis", "@upstash/redis"], pyModules: ["redis", "aioredis"] },
  { slug: "firebase", subject: "Firebase (Firestore)", engine: "firestore", packages: ["firebase/firestore", "firebase-admin/firestore", "firebase-admin"], pyModules: ["firebase_admin.firestore", "google.cloud.firestore"] },
  { slug: "mysql", subject: "MySQL", engine: "mysql", packages: ["mysql", "mysql2"], pyModules: ["pymysql", "mysql.connector", "aiomysql", "MySQLdb"] },
  { slug: "sqlalchemy", subject: "SQL database (SQLAlchemy)", engine: "sql", packages: [], pyModules: ["sqlalchemy"] },
  // An import shows SQLite is used, not what is kept in it.
  { slug: "sqlite", subject: "SQLite", engine: "sqlite", packages: ["better-sqlite3", "sqlite3", "@libsql/client"], pyModules: ["sqlite3"], claim: "The app uses SQLite." },
  // TypeORM also runs on MongoDB, so "SQL database" is only medium confidence for it.
  sqlLayer("typeorm", "TypeORM", "medium"),
  sqlLayer("knex", "Knex"),
  sqlLayer("sequelize", "Sequelize"),
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
    claim: spec.claim ?? `The app stores data in ${spec.subject}.`,
    attributes: { engine: spec.engine },
    confidence: spec.confidence ?? "high",
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

/** Engines an ORM can name, keyed by how Prisma's `provider` or Drizzle's schema module writes them. */
export const ENGINES: Record<string, { subject: string; engine: string }> = {
  postgresql: { subject: "PostgreSQL", engine: "postgresql" },
  postgres: { subject: "PostgreSQL", engine: "postgresql" },
  mysql: { subject: "MySQL", engine: "mysql" },
  sqlite: { subject: "SQLite", engine: "sqlite" },
  mongodb: { subject: "MongoDB", engine: "mongodb" },
  sqlserver: { subject: "SQL Server", engine: "sqlserver" },
  cockroachdb: { subject: "CockroachDB", engine: "cockroachdb" },
};

/** A double-quoted Prisma string on one line. */
const PRISMA_STRING = /"(?:[^"\\\n]|\\.)*"/.source;

/**
 * Blanks `//` comments (and `///` doc comments) without moving anything, so offsets still give the
 * right line. A `//` inside a string (a url's scheme, `postgresql://…`) is not a comment.
 */
const blankLineComments = (text: string) =>
  text.replace(new RegExp(`${PRISMA_STRING}|\\/\\/[^\\n]*`, "g"), (m) => (m.startsWith("//") ? " ".repeat(m.length) : m));

/**
 * The `provider` of each `datasource` block in a Prisma schema, with its line. Only the provider is
 * read: the `url` (a connection string or the env variable holding one) is never looked at.
 */
function prismaProviders(text: string): Array<{ provider: string; offset: number }> {
  const code = blankLineComments(text);
  const out: Array<{ provider: string; offset: number }> = [];
  for (const block of code.matchAll(/\bdatasource\s+\w+\s*\{([^}]*)\}/g)) {
    const body = block[1]!;
    // `provider` anywhere in the block, even after the url on one line, but never inside a string.
    const m = [...body.matchAll(new RegExp(`${PRISMA_STRING}|\\bprovider\\s*=\\s*"([^"\\n]*)"`, "g"))].find((x) => x[0].startsWith("provider"));
    if (!m) continue;
    const start = (block.index ?? 0) + block[0].indexOf(body) + (m.index ?? 0);
    out.push({ provider: m[1]!.trim().toLowerCase(), offset: start });
  }
  return out;
}

const prisma: Detector = {
  id: "data-store/prisma",
  skipReason: (ctx) => (ctx.hasDep("@prisma/client") ? null : "no Prisma client in dependencies"),
  run: (ctx) => {
    const imports = ctx.js.flatMap((f) => {
      const imp = importsModule(f, "@prisma/client");
      return imp ? [{ file: f.file, ...(imp.line ? { line: imp.line } : {}) }] : [];
    });
    if (imports.length === 0) return [];

    const facts: FactDraft[] = [];
    const schemas = ctx.project.files.filter((f) => f.endsWith(".prisma") && isProductFile(f)).sort();
    for (const file of schemas) {
      const text = ctx.project.read(file);
      if (text === null) continue;
      for (const { provider, offset } of prismaProviders(text)) {
        const known = ENGINES[provider];
        if (!known) continue;
        facts.push({
          kind: "data_store",
          subject: known.subject,
          claim: `The app stores data in ${known.subject} through Prisma, as set by the datasource provider in its Prisma schema.`,
          attributes: { engine: known.engine },
          confidence: "high",
          detector: "data-store/prisma",
          key: file,
          // The schema line is the source of the engine; the import only has to exist for the fact to.
          locations: [{ file, line: ctx.project.position(file, offset).line }],
        });
      }
    }
    if (facts.length > 0) return facts;

    // Prisma is imported but no schema says which engine: it is usually SQL, but MongoDB is possible.
    return [
      {
        kind: "data_store",
        subject: "SQL database (Prisma)",
        claim: "The app uses the Prisma client, but no Prisma schema in the project says which database engine it connects to.",
        attributes: { engine: "sql" },
        confidence: "medium",
        detector: "data-store/prisma",
        key: imports[0]!.file,
        locations: imports,
      },
    ];
  },
};

/** Drizzle's schema modules name the engine: `drizzle-orm/pg-core` defines PostgreSQL tables. */
const DRIZZLE_CORE: Record<string, string> = { "drizzle-orm/pg-core": "postgresql", "drizzle-orm/mysql-core": "mysql", "drizzle-orm/sqlite-core": "sqlite" };

const drizzle: Detector = {
  id: "data-store/drizzle",
  skipReason: (ctx) => (ctx.hasDep("drizzle-orm") ? null : "no Drizzle ORM in dependencies"),
  run: (ctx) =>
    ctx.js.flatMap((f): FactDraft[] => {
      const uses = f.imports.filter((i) => i.source === "drizzle-orm" || i.source.startsWith("drizzle-orm/"));
      if (uses.length === 0) return [];
      const fact = (subject: string, engine: string, claim: string, line?: number): FactDraft => ({
        kind: "data_store",
        subject,
        claim,
        attributes: { engine },
        confidence: "high",
        detector: "data-store/drizzle",
        key: f.file,
        locations: [{ file: f.file, ...(line ? { line } : {}) }],
      });
      const specific = uses.flatMap((i) => {
        const known = ENGINES[DRIZZLE_CORE[i.source] ?? ""];
        return known ? [fact(known.subject, known.engine, `The app stores data in ${known.subject} through Drizzle ORM: it imports Drizzle's ${known.subject} schema module.`, i.line)] : [];
      });
      // A Drizzle import that names no engine. Dropped later if any fact names a specific SQL engine.
      return specific.length > 0
        ? specific
        : [fact("SQL database (Drizzle)", "sql", "The app uses Drizzle ORM, but its imports don't show which database engine it connects to.", uses[0]!.line)];
    }),
};

/** Django's own database backends, by module path: `ENGINE` names one of these. */
const DJANGO_ENGINES: Record<string, { subject: string; engine: string }> = {
  "django.db.backends.postgresql": ENGINES.postgresql!,
  "django.db.backends.postgresql_psycopg2": ENGINES.postgresql!,
  "django.contrib.gis.db.backends.postgis": ENGINES.postgresql!,
  "django.db.backends.sqlite3": ENGINES.sqlite!,
  "django.contrib.gis.db.backends.spatialite": ENGINES.sqlite!,
  "django.db.backends.mysql": ENGINES.mysql!,
  "django.contrib.gis.db.backends.mysql": ENGINES.mysql!,
  "django.db.backends.oracle": { subject: "Oracle", engine: "oracle" },
  "django.contrib.gis.db.backends.oracle": { subject: "Oracle", engine: "oracle" },
};

/** An app's first migration, `<app>/migrations/0001_*.py`. */
const DJANGO_MIGRATION = /(?:^|\/)[^/]+\/migrations\/0001_[^/]*\.py$/;

/** The value tokens of a module-level `DATABASES = …` (or `DATABASES: dict = …`), or null if the file doesn't assign it. */
function djangoDatabases(f: PyFile): { line: number; toks: Tok[] } | null {
  for (const l of f.lines) {
    const t = l.toks;
    if (l.indent !== 0 || t[0]?.t !== "name" || t[0].s !== "DATABASES" || t[1]?.t !== "op" || (t[1].s !== "=" && t[1].s !== ":")) continue;
    // The `=` that assigns: the first one outside the annotation's brackets that isn't part of `==`.
    let depth = 0;
    for (let i = 1; i < t.length; i++) {
      const x = t[i]!;
      if (x.t !== "op") continue;
      if ("([{".includes(x.s)) depth++;
      else if (")]}".includes(x.s)) depth--;
      else if (depth === 0 && x.s === "=" && t[i + 1]?.s !== "=" && !"=!<>".includes(t[i - 1]!.t === "op" ? t[i - 1]!.s : "_")) return { line: l.line, toks: t.slice(i + 1) };
    }
  }
  return null;
}

/**
 * Every `"ENGINE": <value>` dict entry in the tokens. `value` is the engine's module path when it is
 * one plain string, and null when it is anything else (a variable, a call, an f-string).
 */
function engineEntries(toks: Tok[]): Array<{ value: string | null; line: number }> {
  const out: Array<{ value: string | null; line: number }> = [];
  for (let i = 0; i < toks.length - 1; i++) {
    if (toks[i]!.t !== "str" || isFString(toks[i]!.s) || stringBody(toks[i]!.s) !== "ENGINE" || toks[i + 1]!.s !== ":") continue;
    const value: Tok[] = [];
    let depth = 0;
    for (let k = i + 2; k < toks.length; k++) {
      const y = toks[k]!;
      if (y.t === "op" && "([{".includes(y.s)) depth++;
      else if (y.t === "op" && ")]}".includes(y.s) && depth-- === 0) break;
      else if (depth === 0 && y.t === "op" && y.s === ",") break;
      value.push(y);
    }
    const plain = value.length === 1 && value[0]!.t === "str" && !isFString(value[0]!.s);
    out.push({ value: plain ? stringBody(value[0]!.s) : null, line: toks[i]!.line });
  }
  return out;
}

/** Test settings by name: `test.py`, `tests.py` or `testing.py`. (`test_*.py`, `*_test.py` and `tests/` are never product files.) */
const DJANGO_TEST_SETTINGS = /(?:^|\/)(?:test|tests|testing)\.py$/;

/**
 * Test settings that sit in a settings package (`…/settings/test.py`) or next to a settings module
 * (`site/test.py` beside `site/settings.py`). They say how tests run, not where the product stores data.
 */
function isDjangoTestSettings(file: string, pyFiles: ReadonlySet<string>): boolean {
  if (!DJANGO_TEST_SETTINGS.test(file)) return false;
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  return /(?:^|\/)settings$/.test(dir) || pyFiles.has(dir ? `${dir}/settings.py` : "settings.py");
}

/** The product's Django settings modules and their `DATABASES` values, test settings left out. */
function djangoSettings(py: readonly PyFile[]): Array<{ file: string; line: number; toks: Tok[] }> {
  const files = new Set(py.map((f) => f.file));
  return py.flatMap((f) => {
    if (isDjangoTestSettings(f.file, files)) return [];
    const db = djangoDatabases(f);
    return db ? [{ file: f.file, ...db }] : [];
  });
}

const DJANGO_UNREAD = "The project uses Django's database layer (models or migrations), but the scan could not tell which database engine its settings name.";

/**
 * The database engine a Django project's settings name. Read from `DATABASES` dict literals in
 * product code (test settings are left out), so comments and docstrings never count. When no
 * engine can be read, Django models or migrations still show a SQL database, at medium confidence.
 */
const django: Detector = {
  id: "data-store/django",
  skipReason: (ctx) =>
    djangoSettings(ctx.py).length > 0 || ctx.py.some((f) => importsPy(f, "django.db")) ? null : "no Django database settings, models or migrations found",
  run: (ctx) => {
    const settings = djangoSettings(ctx.py);
    const facts: FactDraft[] = [];
    for (const s of settings) {
      const seen = new Set<string>();
      for (const e of engineEntries(s.toks)) {
        const known = e.value === null ? undefined : DJANGO_ENGINES[e.value];
        if (!known || seen.has(known.subject)) continue;
        seen.add(known.subject);
        facts.push({
          kind: "data_store",
          subject: known.subject,
          claim: `The project's Django settings name ${known.subject} as a database engine (DATABASES ENGINE).`,
          attributes: { engine: known.engine },
          confidence: "high",
          detector: "data-store/django",
          key: s.file,
          locations: [{ file: s.file, line: e.line }],
        });
      }
    }
    if (facts.length > 0) return facts;

    const at = (f: PyFile) => {
      const imp = importsPy(f, "django.db");
      return { file: f.file, ...(imp?.line ? { line: imp.line } : {}) };
    };
    // A migration imports `models` too; it is counted as a migration, not as a models file.
    const models = ctx.py.filter((f) => importsPy(f, "django.db.models") && !/(?:^|\/)migrations\//.test(f.file));
    const migrations = ctx.py.filter((f) => DJANGO_MIGRATION.test(f.file) && importsPy(f, "django.db"));
    if (models.length === 0 && migrations.length === 0) return [];
    return [
      {
        kind: "data_store",
        subject: "SQL database (Django)",
        claim: DJANGO_UNREAD,
        attributes: { engine: "sql" },
        confidence: "medium",
        detector: "data-store/django",
        key: (settings[0] ?? models[0] ?? migrations[0])!.file,
        locations: [...settings.map((s) => ({ file: s.file, line: s.line })), ...models.slice(0, 3).map(at), ...migrations.slice(0, 1).map(at)],
      },
    ];
  },
};

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

export const storeDetectors: Detector[] = [supabase, ...STORES.map(storeDetector), prisma, drizzle, django, connectionString];
