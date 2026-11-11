import type { Fact } from "../evidence/schema.js";
import { S, absenceSentence, addFacts, draft, factSentence, list, profile, refsOf, subjectsOf, unknownAnswer } from "./helpers.js";
import type { AnswerCtx, BankQuestion, Category, Draft } from "./types.js";

/**
 * The baseline question bank. Each question knows which facts answer it and which things only the
 * user can supply. Sentences come from evidence and answers; none is written freehand.
 * Wording that carries legal weight lives in the document templates, not here.
 */

const q = (id: string, category: Category, text: string, keywords: string[], build: (ctx: AnswerCtx) => Draft): BankQuestion => ({
  id,
  category,
  text,
  keywords,
  build,
});

const services = (ctx: AnswerCtx, purposes: string[]): Fact[] =>
  ctx.facts("third_party_service").filter((f) => purposes.includes(String(f.attributes.purpose)));

/** Answers a question from a set of services, or asks the user when the scan found none. */
function fromServices(ctx: AnswerCtx, d: Draft, purposes: string[], fallback: string): void {
  if (addFacts(d, services(ctx, purposes)) === 0) profile(ctx, d, fallback);
}

export const BANK: BankQuestion[] = [
  // ---- AI use
  q("ai-use", "ai", "Does the system use artificial intelligence or machine-learning services?", ["artificial intelligence", "machine learning", "AI", "LLM", "generative", "large language model"], (ctx) => {
    const d = draft();
    const providers = ctx.facts("ai_provider");
    if (providers.length > 0) d.sentences.push(S(`The system uses AI services from ${list(subjectsOf(providers))}.`, ...refsOf(providers)));
    else {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
    }
    return d;
  }),
  q("ai-providers", "ai", "Which AI providers and models are used?", ["AI provider", "model", "which AI", "third-party AI", "foundation model", "openai", "anthropic"], (ctx) => {
    const d = draft();
    const providers = ctx.facts("ai_provider");
    if (providers.length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    const parts = providers.map((f) => (f.attributes.model ? `${f.subject} (model ${String(f.attributes.model)})` : f.subject));
    d.sentences.push(S(`AI providers in use: ${list([...new Set(parts)])}.`, ...refsOf(providers)));
    return d;
  }),
  q("ai-data-sent", "ai", "What data is sent to AI providers?", ["data sent to AI", "prompts", "inputs to the model", "customer data AI", "personal data AI"], (ctx) => {
    const d = draft();
    if (ctx.facts("ai_provider").length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    addFacts(d, ctx.facts("data_flow"));
    profile(ctx, d, "ai-data-categories");
    return d;
  }),
  q("ai-training", "ai", "Is customer data used to train AI models, by you or by your AI providers?", ["train", "training data", "model training", "opt out", "retention at provider"], (ctx) => {
    const d = draft();
    const unknowns = ctx.unknownsWithTopic("AI provider data use");
    if (unknowns.length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    for (const u of unknowns) unknownAnswer(ctx, d, u);
    return d;
  }),
  q("ai-oversight", "ai", "Is there human oversight of AI outputs?", ["human oversight", "human in the loop", "review of AI output", "automated decision"], (ctx) => {
    const d = draft();
    if (ctx.facts("ai_provider").length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
    } else profile(ctx, d, "ai-human-oversight");
    return d;
  }),
  q("ai-keys", "ai", "How are AI provider credentials protected?", ["AI keys", "API key protection", "model credentials", "provider keys"], (ctx) => {
    const d = draft();
    if (ctx.facts("ai_provider").length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    addFacts(d, ctx.byDetector("secrets/env-usage"));
    addFacts(d, ctx.byDetector("client-exposure/public-secret-name"));
    addFacts(d, ctx.byDetector("client-exposure/ai-sdk-in-browser"));
    return d;
  }),
  q("ai-browser", "ai", "Are AI services called directly from users' browsers?", ["browser", "client-side AI", "front end calls", "direct from the client"], (ctx) => {
    const d = draft();
    const providers = ctx.facts("ai_provider");
    if (providers.length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    const browser = providers.filter((f) => f.attributes.runsOn === "browser");
    const server = providers.filter((f) => f.attributes.runsOn === "server");
    if (browser.length) d.sentences.push(S(`Browser code imports an AI SDK (${list(subjectsOf(browser))}).`, ...refsOf(browser)));
    if (server.length) d.sentences.push(S(`AI SDK use was found in server code (${list(subjectsOf(server))}).`, ...refsOf(server)));
    const unclear = providers.filter((f) => f.attributes.runsOn === "unclear");
    if (unclear.length) d.sentences.push(S(`For some AI SDK use the scan could not tell whether it runs in the browser or on a server (${list(subjectsOf(unclear))}).`, ...refsOf(unclear)));
    return d;
  }),
  q("ai-region", "ai", "Where do AI providers process your data?", ["AI processing location", "AI data residency", "where is AI data processed"], (ctx) => {
    const d = draft();
    if (ctx.facts("ai_provider").length === 0) {
      const none = absenceSentence(ctx, "ai-provider/none-found");
      if (none) d.sentences.push(none);
    } else profile(ctx, d, "ai-processing-region");
    return d;
  }),

  // ---- Data handling
  q("data-stores", "data", "Where and in what systems is customer data stored?", ["data stored", "storage", "database", "data repository", "where is data held"], (ctx) => {
    const d = draft();
    if (addFacts(d, ctx.facts("data_store")) === 0) {
      const none = absenceSentence(ctx, "data-store/none-found");
      if (none) d.sentences.push(none);
    }
    return d;
  }),
  q("data-region", "data", "In which country or region is data hosted?", ["data residency", "hosting location", "data location", "UK", "EU", "region", "sovereignty"], (ctx) => {
    const d = draft();
    const unknowns = ctx.unknownsWithTopic("Data region", "Database hosting", "Hosting");
    if (unknowns.length === 0) {
      const none = absenceSentence(ctx, "data-store/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    for (const u of unknowns) unknownAnswer(ctx, d, u);
    return d;
  }),
  q("data-encryption-rest", "data", "Is data encrypted at rest?", ["encryption at rest", "encrypted storage", "disk encryption"], (ctx) => {
    const d = draft();
    profile(ctx, d, "encryption-at-rest");
    return d;
  }),
  q("data-encryption-transit", "data", "Is data encrypted in transit?", ["encryption in transit", "TLS", "HTTPS", "SSL", "transport encryption"], (ctx) => {
    const d = draft();
    profile(ctx, d, "encryption-in-transit");
    return d;
  }),
  q("data-retention", "data", "How long is data kept, and what is the retention policy?", ["retention", "how long", "data kept", "retention period", "storage limitation"], (ctx) => {
    const d = draft();
    const unknowns = ctx.unknownsWithTopic("Retention");
    if (unknowns.length === 0) {
      const none = absenceSentence(ctx, "data-store/none-found");
      if (none) d.sentences.push(none);
      return d;
    }
    for (const u of unknowns) unknownAnswer(ctx, d, u, "Retention and deletion");
    return d;
  }),
  q("data-deletion", "data", "Can customers or users have their data deleted on request?", ["deletion", "erasure", "right to be forgotten", "delete my data", "data subject request"], (ctx) => {
    const d = draft();
    profile(ctx, d, "deletion-process");
    return d;
  }),
  q("data-recipients", "data", "Which third parties receive customer data?", ["third parties", "data sharing", "recipients", "who receives data", "external services"], (ctx) => {
    const d = draft();
    const recipients = [...ctx.facts("third_party_service"), ...ctx.facts("ai_provider")];
    if (recipients.length > 0) {
      d.sentences.push(S(`The code integrates with these external services: ${list(subjectsOf(recipients))}.`, ...refsOf(recipients)));
    }
    addFacts(d, ctx.facts("data_flow"));
    profile(ctx, d, "other-suppliers");
    return d;
  }),
  q("data-categories", "data", "What categories of personal data are processed?", ["personal data", "categories of data", "special category", "PII", "data types"], (ctx) => {
    const d = draft();
    profile(ctx, d, "personal-data-categories");
    return d;
  }),
  q("data-separation", "data", "How is one customer's data separated from another's?", ["tenant", "segregation", "separation", "multi-tenant", "row level security", "isolation"], (ctx) => {
    const d = draft();
    const withRls = ctx.facts("data_store").filter((f) => f.attributes.rowLevelSecurity !== undefined);
    if (withRls.length > 0) addFacts(d, withRls);
    profile(ctx, d, "tenant-separation");
    return d;
  }),

  // ---- Access control
  q("auth-methods", "access", "How do users authenticate?", ["authentication", "login", "sign in", "identity", "SSO", "user accounts"], (ctx) => {
    const d = draft();
    if (addFacts(d, ctx.facts("auth")) === 0) {
      const none = absenceSentence(ctx, "auth/none-found");
      if (none) d.sentences.push(none);
    }
    return d;
  }),
  q("auth-mfa", "access", "Is multi-factor authentication supported or required?", ["MFA", "2FA", "two-factor", "multi-factor"], (ctx) => {
    const d = draft();
    profile(ctx, d, "mfa");
    return d;
  }),
  q("access-admin", "access", "Who has administrative access to production systems, and how is it controlled?", ["administrative access", "privileged access", "admin", "production access", "least privilege"], (ctx) => {
    const d = draft();
    profile(ctx, d, "admin-access");
    return d;
  }),
  q("access-review", "access", "How often is access reviewed, and how is it removed when someone leaves?", ["access review", "joiners movers leavers", "offboarding", "recertification"], (ctx) => {
    const d = draft();
    profile(ctx, d, "access-review");
    return d;
  }),
  q("access-passwords", "access", "What password and credential policies apply?", ["password policy", "password complexity", "credential policy"], (ctx) => {
    const d = draft();
    profile(ctx, d, "password-policy");
    return d;
  }),

  // ---- Key management
  q("keys-storage", "keys", "How are secrets and API keys stored?", ["secrets management", "key management", "API keys", "credentials storage", "vault", "environment variables"], (ctx) => {
    const d = draft();
    if (addFacts(d, ctx.byDetector("secrets/env-usage")) === 0) profile(ctx, d, "secret-storage");
    return d;
  }),
  q("keys-hardcoded", "keys", "Are credentials ever written into source code?", ["hard-coded", "hardcoded", "credentials in code", "secrets in source", "secret scanning"], (ctx) => {
    const d = draft();
    addFacts(d, ctx.byDetector("secrets/hardcoded-patterns"));
    return d;
  }),
  q("keys-rotation", "keys", "How are keys rotated, and what happens if one is exposed?", ["key rotation", "rotate", "compromised key", "revocation"], (ctx) => {
    const d = draft();
    profile(ctx, d, "secret-rotation");
    return d;
  }),
  q("keys-browser", "keys", "Are any secrets exposed to browsers or client-side code?", ["client-side secrets", "exposed to the browser", "front-end secrets", "public keys"], (ctx) => {
    const d = draft();
    addFacts(d, ctx.byDetector("client-exposure/public-secret-name"));
    addFacts(d, ctx.byDetector("client-exposure/ai-sdk-in-browser"));
    return d;
  }),

  // ---- Logging and monitoring
  q("logging-content", "logging", "What is logged, and does it include user content or personal data?", ["logging", "audit log", "personal data in logs", "what is logged", "log content"], (ctx) => {
    const d = draft();
    addFacts(d, ctx.byDetector("logging/request-body"));
    return d;
  }),
  q("logging-retention", "logging", "How long are logs kept, and who can access them?", ["log retention", "log access", "log storage"], (ctx) => {
    const d = draft();
    profile(ctx, d, "log-retention");
    return d;
  }),
  q("monitoring", "logging", "What monitoring and alerting is in place?", ["monitoring", "alerting", "SIEM", "error tracking", "observability", "security events"], (ctx) => {
    const d = draft();
    fromServices(ctx, d, ["error tracking"], "monitoring");
    return d;
  }),

  // ---- Suppliers and subprocessors
  q("suppliers-list", "suppliers", "Which subprocessors and suppliers are used to deliver the service?", ["subprocessor", "sub-processor", "supplier list", "vendors", "third-party processors"], (ctx) => {
    const d = draft();
    const all = [...ctx.facts("third_party_service"), ...ctx.facts("ai_provider"), ...ctx.facts("data_store")];
    if (all.length > 0) d.sentences.push(S(`The code uses these services: ${list(subjectsOf(all))}.`, ...refsOf(all)));
    profile(ctx, d, "other-suppliers");
    return d;
  }),
  q("suppliers-payments", "suppliers", "How are payments processed?", ["payment", "card data", "PCI", "payment processor", "billing"], (ctx) => {
    const d = draft();
    fromServices(ctx, d, ["payments"], "payments");
    return d;
  }),
  q("suppliers-analytics", "suppliers", "Do you use analytics or tracking tools, and what do they collect?", ["analytics", "tracking", "cookies", "telemetry", "usage data"], (ctx) => {
    const d = draft();
    fromServices(ctx, d, ["analytics"], "analytics");
    return d;
  }),
  q("suppliers-email", "suppliers", "How is email sent to users?", ["email provider", "transactional email", "SMTP", "notifications"], (ctx) => {
    const d = draft();
    fromServices(ctx, d, ["email"], "email");
    return d;
  }),
  q("suppliers-diligence", "suppliers", "How do you assess the security of your suppliers?", ["supplier assurance", "due diligence", "vendor risk", "third-party risk"], (ctx) => {
    const d = draft();
    profile(ctx, d, "supplier-diligence");
    return d;
  }),

  // ---- Organisation and incident response
  q("org-incident", "organisation", "Do you have an incident response process?", ["incident response", "security incident", "incident management", "IR plan"], (ctx) => {
    const d = draft();
    profile(ctx, d, "incident-response");
    return d;
  }),
  q("org-breach", "organisation", "How and how quickly are customers notified of a personal data breach?", ["breach notification", "72 hours", "notify", "data breach"], (ctx) => {
    const d = draft();
    profile(ctx, d, "breach-notification");
    return d;
  }),
  q("org-dpo", "organisation", "Who is responsible for data protection?", ["DPO", "data protection officer", "privacy contact", "responsible person"], (ctx) => {
    const d = draft();
    profile(ctx, d, "dpo");
    return d;
  }),
  q("org-vetting", "organisation", "What checks are made on staff and contractors?", ["staff vetting", "background checks", "BPSS", "security clearance", "personnel security"], (ctx) => {
    const d = draft();
    profile(ctx, d, "staff-vetting");
    return d;
  }),
  q("org-training", "organisation", "What security and data protection training do staff receive?", ["training", "awareness", "security training"], (ctx) => {
    const d = draft();
    profile(ctx, d, "staff-training");
    return d;
  }),
  q("org-backup", "organisation", "How is data backed up, and how long would recovery take?", ["backup", "disaster recovery", "business continuity", "RTO", "RPO", "resilience"], (ctx) => {
    const d = draft();
    profile(ctx, d, "backup-recovery");
    return d;
  }),
  q("org-vulnerabilities", "organisation", "How are vulnerabilities identified and fixed?", ["vulnerability management", "patching", "penetration test", "dependency scanning", "security testing"], (ctx) => {
    const d = draft();
    const findings = ctx.evidence.findings;
    if (findings.length > 0) {
      const high = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
      d.sentences.push(S(`A Seaworthy scan of the code reported ${findings.length} finding${findings.length === 1 ? "" : "s"}, ${high} of them high or critical.`, ...findings.map((f) => f.id)));
    }
    profile(ctx, d, "vulnerability-process");
    return d;
  }),
  q("org-certifications", "organisation", "Which security certifications or independent assessments do you hold?", ["ISO 27001", "SOC 2", "Cyber Essentials", "certification", "accreditation", "assurance"], (ctx) => {
    const d = draft();
    profile(ctx, d, "certifications");
    return d;
  }),
  q("org-dpia", "organisation", "Has a data protection impact assessment been carried out?", ["DPIA", "impact assessment", "privacy impact"], (ctx) => {
    const d = draft();
    profile(ctx, d, "dpia");
    return d;
  }),
];

export const bankQuestion = (id: string): BankQuestion | undefined => BANK.find((b) => b.id === id);

// `factSentence` is re-exported for the document templates.
export { factSentence };
