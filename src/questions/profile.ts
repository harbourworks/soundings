/**
 * Things no scan can know: how a team runs, not what its code does. Each is asked once, saved in
 * the answers file, and reused for every questionnaire. `lead` starts the sentence the answer
 * appears in, so the user's own words are always attributed to them.
 */
export interface ProfileItem {
  key: string;
  prompt: string;
  lead: string;
}

const item = (key: string, prompt: string, lead: string): [string, ProfileItem] => [key, { key: `profile.${key}`, prompt, lead }];

export const PROFILE: Record<string, ProfileItem> = Object.fromEntries([
  item("ai-data-categories", "What categories of data do you send to AI providers (for example support tickets, documents, personal data)?", "Data sent to AI providers"),
  item("ai-human-oversight", "Is a person involved in reviewing AI outputs before they affect users? Describe how.", "Human oversight of AI outputs"),
  item("ai-processing-region", "In which country or region do your AI providers process your data, and is that configurable?", "AI processing location"),
  item("encryption-at-rest", "How is stored data encrypted at rest (for example by the database provider by default)?", "Encryption at rest"),
  item("encryption-in-transit", "How is data encrypted in transit (for example HTTPS/TLS everywhere)?", "Encryption in transit"),
  item("deletion-process", "How can a user or customer have their data deleted, and who carries it out?", "Deletion requests"),
  item("personal-data-categories", "What categories of personal data does the system handle (for example names, emails, payment details)?", "Personal data handled"),
  item("tenant-separation", "How is one customer's data kept separate from another's?", "Customer data separation"),
  item("mfa", "Is multi-factor authentication available or required for users and for administrators?", "Multi-factor authentication"),
  item("admin-access", "Who has administrative access to production systems, and how is it controlled?", "Administrative access"),
  item("access-review", "How often is access reviewed, and what happens when someone leaves?", "Access reviews"),
  item("password-policy", "What password or credential rules apply, and are they enforced by a provider?", "Credential rules"),
  item("secret-storage", "How are secrets and API keys stored and shared with the team?", "Secret storage"),
  item("secret-rotation", "How and how often are keys and secrets rotated, and what happens if one is exposed?", "Secret rotation"),
  item("log-retention", "How long are logs kept, who can read them, and where are they stored?", "Log retention"),
  item("monitoring", "What monitoring or alerting is in place for errors and security events?", "Monitoring and alerting"),
  item("other-suppliers", "Which other suppliers handle your data outside the code (hosting, email, support tools, backups)?", "Other suppliers"),
  item("payments", "How are payments handled, if at all?", "Payments"),
  item("analytics", "Do you use analytics or tracking? If so, which, and what do they collect?", "Analytics"),
  item("email", "How is email sent to users, and by which provider?", "Email"),
  item("incident-response", "Do you have an incident response process? Describe who does what.", "Incident response"),
  item("breach-notification", "How quickly would you notify a customer of a personal data breach, and how?", "Breach notification"),
  item("dpo", "Who is your data protection contact or officer?", "Data protection contact"),
  item("staff-vetting", "What checks are made on staff and contractors with access to client systems or data?", "Staff vetting"),
  item("staff-training", "What security or data protection training do staff receive?", "Staff training"),
  item("backup-recovery", "How is data backed up, and how long would recovery take?", "Backup and recovery"),
  item("vulnerability-process", "How are vulnerabilities in your code and dependencies found and fixed?", "Vulnerability management"),
  item("certifications", "Which security certifications or independent assessments do you hold, if any? Say 'none' if none.", "Certifications and assessments"),
  item("dpia", "Has a data protection impact assessment been carried out for this system?", "Impact assessment"),
  item("supplier-diligence", "How do you check the security of your suppliers?", "Supplier checks"),
]);

export const PROFILE_KEYS = new Set(Object.values(PROFILE).map((p) => p.key));
export const profileByKey = (key: string): ProfileItem | undefined => Object.values(PROFILE).find((p) => p.key === key);
export const need = (short: string) => {
  const p = PROFILE[short];
  if (!p) throw new Error(`unknown profile item ${short}`);
  return { key: p.key, prompt: p.prompt };
};
