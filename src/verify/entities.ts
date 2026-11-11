import { AI_PROVIDERS } from "../scanner/detectors/ai.js";
import { AUTH_PACKAGES } from "../scanner/detectors/auth.js";
import { SERVICES } from "../scanner/detectors/services.js";
import { STORES } from "../scanner/detectors/stores.js";

/** Names a sentence can't mention without something backing them up. */
const EXTRA = [
  "AWS",
  "Amazon Web Services",
  "Azure",
  "Google Cloud",
  "GCP",
  "Cloudflare",
  "Netlify",
  "Vercel",
  "Heroku",
  "DigitalOcean",
  "GitHub",
  "GitLab",
  "Slack",
  "Notion",
  "SharePoint",
  "Datadog",
  "Supabase",
  "Firebase",
  "Postgres",
  "Mailchimp",
  "HubSpot",
  "Salesforce",
  "Zendesk",
  "Intercom",
];

/** Single words from multi-word subjects that name a vendor on their own ("Vercel Analytics" → Vercel). */
const VENDOR_WORDS = ["Vercel", "Supabase", "Firebase", "Google", "Bedrock", "Plausible", "Stripe", "OpenAI", "Anthropic", "Sentry", "PostHog", "Mixpanel", "Segment", "Resend", "SendGrid", "Postmark", "Twilio", "Clerk", "Auth0", "Hotjar"];

function build(): string[] {
  const names = new Set<string>();
  for (const p of AI_PROVIDERS) names.add(p.subject);
  for (const s of SERVICES) names.add(s.subject);
  for (const s of STORES) names.add(s.subject);
  for (const a of AUTH_PACKAGES) names.add(a.subject);
  for (const e of EXTRA) names.add(e);
  for (const w of VENDOR_WORDS) names.add(w);
  // Generic technology words are not vendors.
  for (const generic of ["JSON Web Tokens", "Auth.js", "Passport"]) names.delete(generic);
  return [...names].sort((a, b) => b.length - a.length);
}

export const KNOWN_ENTITIES: readonly string[] = build();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Known entity names mentioned in `text`, as whole words. Longer names win ("Google Cloud" before "Google"). */
export function entitiesIn(text: string, extra: readonly string[] = []): string[] {
  const found = new Set<string>();
  let rest = text;
  for (const name of [...new Set([...KNOWN_ENTITIES, ...extra])].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![\\w])${escape(name)}(?![\\w])`, "i");
    if (re.test(rest)) {
      found.add(name.toLowerCase());
      rest = rest.replace(new RegExp(`(?<![\\w])${escape(name)}(?![\\w])`, "gi"), " ");
    }
  }
  return [...found];
}
