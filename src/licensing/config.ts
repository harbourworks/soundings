import type { Tier } from "../core/entitlements.js";

/**
 * Where people buy a licence, and where they find their key. Both are `null` until the Soundings
 * products exist in Polar. While they are null, `soundings buy` says purchasing isn't open yet
 * rather than printing a dead link, and no licence call is ever made.
 *
 * To open purchasing: create the product and its licence-key benefit in Polar, then set
 * PURCHASE_URL (the hosted checkout link), PORTAL_URL, and the benefit ID below.
 */
export const PURCHASE_URL: string | null = null;

/** Polar's customer portal for Dynamo Maritime: sign in with the purchase email, the key is under the plan. */
export const PORTAL_URL = "https://polar.sh/dynamo-maritime/portal";

/** Where to ask for help. */
export const SUPPORT_EMAIL = "support@dynamomaritime.com";

/**
 * Polar settings for each server. These IDs are public (they ship in the CLI) and are
 * deliberately NOT overridable from the environment: if they were, anyone could point the CLI at
 * their own Polar organisation and mint themselves a key.
 *
 * Soundings sells through the same Polar organisation as the company's other products. Licensing
 * counts as configured only once at least one Soundings licence-key benefit is listed.
 */
export interface PolarSettings {
  apiBase: string;
  organizationId: string;
  /** Licence-key benefit ID → tier. */
  benefits: Record<string, Exclude<Tier, "free">>;
}

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

export const POLAR_SERVERS: Record<"production" | "sandbox", PolarSettings> = {
  production: {
    apiBase: "https://api.polar.sh",
    // The company's Polar organisation, public in the Seaworthy source. No benefit is listed yet,
    // so licensing stays switched off until a Soundings benefit ID is added.
    organizationId: "a4a6a28a-20f3-4b1f-9211-7eccab46ff92",
    benefits: {},
  },
  sandbox: {
    apiBase: "https://sandbox-api.polar.sh",
    organizationId: PLACEHOLDER,
    benefits: {},
  },
};

/** SOUNDINGS_POLAR_SERVER=sandbox switches to Polar's sandbox, for testing a real purchase flow. */
export function polarSettings(env: NodeJS.ProcessEnv = process.env): PolarSettings {
  return env.SOUNDINGS_POLAR_SERVER === "sandbox" ? POLAR_SERVERS.sandbox : POLAR_SERVERS.production;
}

export function isConfigured(s: PolarSettings): boolean {
  return s.organizationId !== PLACEHOLDER && Object.keys(s.benefits).length > 0;
}

/** True when a person could actually buy a plan today. */
export const purchasingOpen = (s: PolarSettings = polarSettings()): boolean => PURCHASE_URL !== null && isConfigured(s);

/** "Renew at <link>" when there is a link, otherwise where to ask. */
export const renewHint = (): string => (PURCHASE_URL ? `Renew at ${PURCHASE_URL}` : `Contact ${SUPPORT_EMAIL}`);

/** How long a successful validation keeps working with no network. */
export const OFFLINE_GRACE_DAYS = 14;
/** How long a successful validation is trusted before checking again online. */
export const REVALIDATE_AFTER_HOURS = 24;
/** Network timeout for licence calls. A slow licence server must never hang a command. */
export const LICENCE_TIMEOUT_MS = 8000;
