/**
 * The ONLY place tiers map to features. Everything else asks this file.
 *
 * Free is never blocked or degraded: scanning, the report, the questions flow and verification
 * work the same with or without a licence, and without any network call. Paid features add the
 * documents that are built from them.
 */

export const TIERS = ["free", "pro"] as const;
export type Tier = (typeof TIERS)[number];

export type Feature =
  | "answers" // soundings answers: the question bank answered as a document
  | "questionnaire-import" // soundings answer <file>: fill in a client's questionnaire
  | "documents" // privacy notice, subprocessor list, DPIA draft, AI-use statement, trust page
  | "exports"; // Word and HTML output

export interface TierInfo {
  name: string;
  /**
   * Machines one key can be activated on at once. This is the default the mock licence server
   * uses in tests; the real limit comes from the Polar benefit and is read from Polar's reply.
   */
  machines: number;
  features: readonly Feature[];
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  free: { name: "Free", machines: 0, features: [] },
  pro: { name: "Pro", machines: 3, features: ["answers", "questionnaire-import", "documents", "exports"] },
};

export const FEATURE_LABELS: Record<Feature, string> = {
  answers: "Answering the question bank as a document",
  "questionnaire-import": "Filling in a client's questionnaire",
  documents: "Privacy notice, subprocessor list, DPIA draft, AI-use statement and trust page",
  exports: "Word and HTML exports",
};

/** What stays free, said wherever a paid feature is mentioned. */
export const FREE_SUMMARY = "scanning, the report, the questions and verifying any text";

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_INFO[tier].features.includes(feature);
}

/** The cheapest tier that unlocks a feature. */
export function requiredTier(_feature: Feature): Exclude<Tier, "free"> {
  return "pro";
}

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}
