import type { FactDraft } from "../../evidence/build.js";
import { walkAst } from "../../core/js.js";
import { importsModule, importsPy } from "../context.js";
import type { Detector } from "../types.js";

export interface ServiceSpec {
  slug: string;
  subject: string;
  purpose: string;
  packages: string[];
  /** Python modules for the same service. */
  pyModules?: string[];
  /** Hosts that identify the service when it is loaded with a script tag. */
  scriptHosts?: string[];
  /** Strings in the importing file that say how it is integrated. */
  integrations?: Array<{ contains: string; value: string }>;
  /** The same, for Python code. */
  pyIntegrations?: Array<{ contains: string; value: string }>;
}

export const SERVICES: ServiceSpec[] = [
  {
    slug: "stripe",
    subject: "Stripe",
    purpose: "payments",
    packages: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    pyModules: ["stripe"],
    pyIntegrations: [
      { contains: "checkout.Session", value: "checkout" },
      { contains: "PaymentIntent", value: "payment-intents" },
    ],
    integrations: [
      { contains: "checkout.sessions", value: "checkout" },
      { contains: "paymentIntents", value: "payment-intents" },
    ],
  },
  { slug: "vercel-analytics", subject: "Vercel Analytics", purpose: "analytics", packages: ["@vercel/analytics", "@vercel/speed-insights"] },
  { slug: "plausible-analytics", subject: "Plausible Analytics", purpose: "analytics", packages: ["next-plausible", "plausible-tracker"], scriptHosts: ["plausible.io"] },
  {
    slug: "google-analytics",
    subject: "Google Analytics",
    purpose: "analytics",
    packages: ["@next/third-parties", "react-ga4", "ga-gtag"],
    scriptHosts: ["googletagmanager.com", "google-analytics.com"],
  },
  { slug: "hotjar", subject: "Hotjar", purpose: "analytics", packages: ["@hotjar/browser", "react-hotjar"], scriptHosts: ["static.hotjar.com"] },
  { slug: "posthog", subject: "PostHog", purpose: "analytics", packages: ["posthog-js", "posthog-node"], pyModules: ["posthog"] },
  { slug: "mixpanel", subject: "Mixpanel", purpose: "analytics", packages: ["mixpanel", "mixpanel-browser"], pyModules: ["mixpanel"] },
  { slug: "segment", subject: "Segment", purpose: "analytics", packages: ["@segment/analytics-next", "@segment/analytics-node", "analytics-node"], pyModules: ["segment.analytics"] },
  { slug: "sentry", subject: "Sentry", purpose: "error tracking", packages: ["@sentry/nextjs", "@sentry/node", "@sentry/react", "@sentry/browser"], pyModules: ["sentry_sdk"] },
  { slug: "resend", subject: "Resend", purpose: "email", packages: ["resend"], pyModules: ["resend"] },
  { slug: "sendgrid", subject: "SendGrid", purpose: "email", packages: ["@sendgrid/mail"], pyModules: ["sendgrid"] },
  { slug: "postmark", subject: "Postmark", purpose: "email", packages: ["postmark"], pyModules: ["postmarker"] },
  { slug: "twilio", subject: "Twilio", purpose: "SMS and voice", packages: ["twilio"], pyModules: ["twilio"] },
];

const HTML_FILE = /\.(?:html?|ejs|hbs|njk|liquid)$/i;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

function serviceDetector(spec: ServiceSpec): Detector {
  const id = `third-party/${spec.slug}`;
  return {
    id,
    skipReason: (ctx) => {
      if (ctx.hasDep(...spec.packages)) return null;
      if (spec.pyModules && ctx.hasPyImport(...spec.pyModules)) return null;
      if (spec.scriptHosts) return null; // may be loaded by a script tag rather than a package
      return `no ${spec.subject} package in dependencies`;
    },
    run: (ctx) => {
      const facts = new Map<string, FactDraft>();
      const add = (file: string, line?: number, extra: Record<string, string> = {}) => {
        if (facts.has(file)) return;
        facts.set(file, {
          kind: "third_party_service",
          subject: spec.subject,
          claim: `${spec.subject} is used for ${spec.purpose}.`,
          attributes: { purpose: spec.purpose, ...extra },
          confidence: "high",
          detector: id,
          key: file,
          locations: [{ file, ...(line ? { line } : {}) }],
        });
      };

      for (const f of ctx.py) {
        const imp = spec.pyModules ? importsPy(f, ...spec.pyModules) : undefined;
        if (!imp) continue;
        const text = ctx.project.read(f.file) ?? "";
        const integration = spec.pyIntegrations?.find((i) => text.includes(i.contains));
        add(f.file, imp.line, integration ? { integration: integration.value } : {});
      }

      for (const f of ctx.js) {
        const imp = spec.packages.map((p) => importsModule(f, p)).find(Boolean);
        if (imp) {
          const text = ctx.project.read(f.file) ?? "";
          const integration = spec.integrations?.find((i) => text.includes(i.contains));
          add(f.file, imp.line, integration ? { integration: integration.value } : {});
        }
        if (spec.scriptHosts) {
          walkAst(f.ast, (n) => {
            if (n.type === "StringLiteral" && /^https?:\/\//.test(n.value) && spec.scriptHosts!.some((h) => new URL(n.value).hostname.endsWith(h))) {
              add(f.file, n.loc?.start.line);
            }
            return undefined;
          });
        }
      }

      if (spec.scriptHosts) {
        for (const file of ctx.project.files) {
          if (!HTML_FILE.test(file)) continue;
          const text = ctx.project.read(file);
          if (text === null) continue;
          for (const m of text.matchAll(SCRIPT_SRC)) {
            let host = "";
            try {
              host = new URL(m[1]!.startsWith("//") ? `https:${m[1]}` : m[1]!).hostname;
            } catch {
              continue;
            }
            if (spec.scriptHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
              add(file, ctx.project.position(file, m.index ?? 0).line);
              break;
            }
          }
        }
      }
      return [...facts.values()];
    },
  };
}

export const serviceDetectors: Detector[] = SERVICES.map(serviceDetector);
