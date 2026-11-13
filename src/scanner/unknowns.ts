import type { FactDraft, UnknownDraft } from "../evidence/build.js";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * What the code can't tell us, turned into questions. Each question is raised only when a fact
 * makes it relevant, and its ID comes from its subject so it stays the same between scans.
 */
export function unknownsFor(all: FactDraft[], unanalysed = false): UnknownDraft[] {
  // A "not found" fact is the absence of something; it never makes a question relevant.
  const facts = all.filter((f) => f.claimType !== "not-found");
  const out = new Map<string, UnknownDraft>();
  const add = (u: UnknownDraft) => out.set(u.key, u);

  const providers = [...new Set(facts.filter((f) => f.kind === "ai_provider").map((f) => f.subject))];
  for (const subject of providers) {
    add({
      key: `${slug(subject)}-data-use`,
      topic: "AI provider data use",
      question: `Is ${subject}'s data-retention or training opt-out configured on your account?`,
      why: "This is an account setting at the provider, not something the code shows.",
      related: [
        { kind: "ai_provider", subject },
        { kind: "data_flow", subject },
      ],
    });
  }

  // A prompt the scan couldn't tie to one provider: its flow facts are low confidence, and the user is asked.
  const unclear = new Map<string, { line?: number; subjects: Set<string> }>();
  for (const f of facts) {
    const options = f.attributes?.possibleDestinations;
    if (f.kind !== "data_flow" || !Array.isArray(options)) continue;
    for (const loc of f.locations ?? []) {
      const entry = unclear.get(loc.file) ?? { ...(loc.line ? { line: loc.line } : {}), subjects: new Set<string>() };
      for (const s of options) entry.subjects.add(s);
      unclear.set(loc.file, entry);
    }
  }
  for (const [file, { line, subjects }] of [...unclear].sort(([a], [b]) => a.localeCompare(b))) {
    const names = [...subjects].sort();
    add({
      key: `ai-destination-${slug(file.replace(/[()]/g, " "))}`,
      topic: "AI prompt destination",
      question: `Which AI provider receives the prompt sent from ${file}${line ? ` (line ${line})` : ""}: ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`,
      why: "The call goes through a client the scan couldn't tie to one provider's import.",
      related: names.map((subject) => ({ kind: "data_flow" as const, subject })),
    });
  }

  const stores = [...new Set(facts.filter((f) => f.kind === "data_store").map((f) => f.subject))];
  for (const subject of stores) {
    const isSupabase = subject.startsWith("Supabase");
    const isFirebase = subject.startsWith("Firebase");
    add({
      key: isSupabase ? "supabase-region" : isFirebase ? "firebase-region" : `${slug(subject)}-hosting`,
      topic: isSupabase || isFirebase ? "Data region" : "Database hosting",
      question: isSupabase
        ? "In which region is the Supabase project hosted?"
        : isFirebase
          ? "In which location is the Firebase project hosted?"
          : `Where is the ${subject} database hosted, and by whom?`,
      why: "Hosting is set up outside the code, so a scan can't see it.",
      related: [{ kind: "data_store", subject }],
    });
  }

  if (stores.length > 0) {
    add({
      key: "retention-deletion",
      topic: "Retention",
      question: "How long is user data kept, and what happens to it when a user or customer asks for it to be deleted?",
      why: "No retention or deletion rules can be read from the code alone.",
      related: stores.map((subject) => ({ kind: "data_store" as const, subject })),
    });
  }

  const hasBackendSignals = facts.some((f) => f.kind === "data_store" || f.kind === "ai_provider" || f.kind === "auth");
  // Unread back-end code means "no back end found" would be a guess, so the hosting question isn't raised on that basis.
  if (!hasBackendSignals && !unanalysed) {
    add({
      key: "hosting-location",
      topic: "Hosting",
      question: "Where is the site hosted, and by whom?",
      why: "Hosting is configured outside the code, so a scan can't see it.",
    });
  }

  return [...out.values()];
}
