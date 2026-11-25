import Database from "better-sqlite3";

// A local cache of triage labels, so a repeated ticket text isn't sent to the model again.
const cache = new Database("triage-cache.db");
cache.exec("CREATE TABLE IF NOT EXISTS labels (text_hash TEXT PRIMARY KEY, label TEXT)");

export const cachedLabel = (hash: string): string | undefined =>
  (cache.prepare("SELECT label FROM labels WHERE text_hash = ?").get(hash) as { label: string } | undefined)?.label;

export const remember = (hash: string, label: string) => cache.prepare("INSERT OR REPLACE INTO labels VALUES (?, ?)").run(hash, label);
