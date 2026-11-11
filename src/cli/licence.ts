import pc from "picocolors";
import { FEATURE_LABELS, FREE_SUMMARY, TIER_INFO, hasFeature, type Feature, type Tier } from "../core/entitlements.js";
import { PORTAL_URL, PURCHASE_URL, SUPPORT_EMAIL, purchasingOpen } from "../licensing/config.js";
import { defaultMachineLabel, maskKey, resolveLicence, type LicenceStatus } from "../licensing/licence.js";
import type { LicenceProvider } from "../licensing/provider.js";
import { LicenceStore } from "../licensing/store.js";
import { openUrl as defaultOpenUrl } from "./open.js";

/** Exit code for "this needs a paid plan". Distinct from a problem (1) and an error (2). */
export const EXIT_NEEDS_PLAN = 3;

export interface LicenceCtx {
  out: (s: string) => void;
  err: (s: string) => void;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  provider: LicenceProvider;
  store: LicenceStore;
  offline: boolean;
  label?: string;
  noOpen: boolean;
  interactive: boolean;
  openUrl?: (url: string) => boolean;
}

/** Opens a link for a person at a terminal, unless --no-open. Never in CI or when piped. */
function maybeOpen(url: string, ctx: LicenceCtx): boolean {
  if (!ctx.interactive || ctx.noOpen) return false;
  return (ctx.openUrl ?? defaultOpenUrl)(url);
}

/**
 * Called before a paid command. Returns null when the command may run, or an exit code after
 * telling the person what is needed. Free commands never come through here, so they never make
 * a licence call.
 */
export async function requireFeature(feature: Feature, command: string, ctx: LicenceCtx): Promise<number | null> {
  const s = await resolveLicence({ provider: ctx.provider, store: ctx.store, env: ctx.env, now: ctx.now(), offline: ctx.offline });
  if (hasFeature(s.tier, feature)) return null;

  const lines = ["", `  ${pc.cyan("✦")} ${pc.bold(`soundings ${command}`)} is part of Soundings Pro: ${FEATURE_LABELS[feature].toLowerCase()}.`];
  if (s.message) lines.push(`    ${s.message}`);
  if (s.state === "none" || s.state === "not-configured") {
    lines.push(
      purchasingOpen()
        ? `    Buy a plan: ${pc.cyan(PURCHASE_URL!)}   then: ${pc.cyan("soundings login <key>")}`
        : "    Paid plans aren't open for purchase yet.",
    );
  }
  lines.push(pc.dim(`    Free, with no licence needed: ${FREE_SUMMARY}.`), "");
  ctx.err(lines.join("\n"));
  return EXIT_NEEDS_PLAN;
}

export function buy(ctx: LicenceCtx): number {
  const out = ["", `  ${pc.bold("Soundings plans")}`, ""];
  out.push(`  ${pc.bold("Free".padEnd(8))}${FREE_SUMMARY}`);
  out.push(`  ${pc.bold("Pro".padEnd(8))}+ ${Object.values(FEATURE_LABELS).map((l) => l[0]!.toLowerCase() + l.slice(1)).join(", ")}`);
  out.push("");

  if (!purchasingOpen()) {
    out.push("  Paid plans aren't open for purchase yet. Free features work as normal.");
    out.push(pc.dim(`  Questions: ${SUPPORT_EMAIL}`), "");
    ctx.out(out.join("\n"));
    return 0;
  }
  const current = ctx.env.SOUNDINGS_LICENCE?.trim() ? null : ctx.store.load();
  if (current && !current.problem) {
    out.push(pc.dim(`  You're logged in on this machine with Soundings ${TIER_INFO[current.tier].name} (${current.displayKey}).`), "");
  }
  const opened = maybeOpen(PURCHASE_URL!, ctx);
  out.push(
    opened
      ? `  ${pc.green("✔")} Opened the checkout in your browser. If it didn't appear: ${pc.cyan(PURCHASE_URL!)}`
      : `  ${pc.bold("Buy:")} ${pc.cyan(PURCHASE_URL!)}`,
  );
  out.push(pc.dim("  Payment, tax, invoices and cancelling are handled by Polar, our merchant of record."), "");
  out.push(`  ${pc.bold("After paying")}`);
  out.push(`    1. Get your key: ${pc.cyan(PORTAL_URL)}`);
  out.push(pc.dim("       Enter the email you bought with; the key is under your plan."));
  out.push(`    2. ${pc.cyan("soundings login <key>")}`);
  out.push(pc.dim("    In CI, add the key as a secret called SOUNDINGS_LICENCE instead."), "");
  ctx.out(out.join("\n"));
  return 0;
}

export async function login(keyArg: string | undefined, ctx: LicenceCtx): Promise<number> {
  const key = keyArg?.trim();
  if (!key || /\s/.test(key) || key.length > 200) {
    const opened = !key && purchasingOpen() && maybeOpen(PORTAL_URL, ctx);
    ctx.err(
      [
        "",
        `  ${pc.bold("Usage:")} soundings login <licence-key>`,
        "",
        `  ${pc.bold("Your key")} is in the customer portal: ${pc.cyan(PORTAL_URL)}${opened ? pc.dim("  (opened in your browser)") : ""}`,
        "  Enter the email you bought with, type the code Polar emails you, and copy the key",
        "  shown under your plan. Then run soundings login <key>.",
        "",
      ].join("\n"),
    );
    return 2;
  }
  if (ctx.offline) {
    ctx.err(pc.red("  Logging in needs one online check. Run it without --offline."));
    return 2;
  }
  const label = (ctx.label?.trim() || defaultMachineLabel()).slice(0, 200);

  // Switching keys: free the old slot first, so it isn't left using up a machine.
  const existing = ctx.store.load();
  if (existing && existing.key !== key && existing.activationId) await ctx.provider.deactivate(existing.key, existing.activationId);
  if (existing && existing.key === key && existing.activationId && !existing.problem) {
    const v = await ctx.provider.validate(key, existing.activationId);
    if (v.ok) {
      ctx.store.save({ ...existing, tier: v.value.tier, displayKey: v.value.displayKey, lastValidatedAt: ctx.now().toISOString() });
      ctx.out(`\n  ${pc.green("✔")} Already logged in: ${pc.bold(`Soundings ${TIER_INFO[v.value.tier].name}`)} on ${existing.machineLabel}.\n`);
      return 0;
    }
  }

  const a = await ctx.provider.activate(key, label);
  if (!a.ok) {
    ctx.err(`\n  ${pc.red("✖")} ${loginFailure(a.reason, a.detail)}\n`);
    return 1;
  }
  ctx.store.save({
    version: 1,
    key,
    activationId: a.value.activationId,
    machineLabel: label,
    tier: a.value.tier,
    displayKey: a.value.displayKey,
    lastValidatedAt: ctx.now().toISOString(),
  });
  const info = TIER_INFO[a.value.tier];
  ctx.out(
    [
      "",
      `  ${pc.green("✔")} Logged in: ${pc.bold(`Soundings ${info.name}`)} on ${label}.`,
      `  Unlocked: ${info.features.map((f) => FEATURE_LABELS[f]).join("; ")}.`,
      pc.dim(`  This key works on up to ${a.value.machineLimit ?? info.machines} machines. Saved in ${ctx.store.path}`),
      ctx.env.SOUNDINGS_LICENCE ? pc.yellow("  Note: SOUNDINGS_LICENCE is set in this shell and takes priority over this login.") : "",
      "",
    ]
      .filter((l) => l !== "")
      .join("\n") + "\n",
  );
  return 0;
}

export function loginFailure(reason: string, detail: string): string {
  const renew = PURCHASE_URL ? `Renew at ${PURCHASE_URL}.` : `Contact ${SUPPORT_EMAIL}.`;
  switch (reason) {
    case "invalid":
      return `That key wasn't recognised. Check you copied all of it from the customer portal: ${PORTAL_URL}`;
    case "revoked":
      return `That key is no longer active; the subscription may have ended. ${renew}`;
    case "expired":
      return `That key has expired. ${renew}`;
    case "machine-limit":
      return `That key is already in use on as many machines as your plan allows. Run soundings logout on one you no longer use, or remove it in the customer portal: ${PORTAL_URL}`;
    case "not-soundings":
      return "That key isn't a Soundings licence. Check you copied the right one.";
    case "unreachable":
      return `${detail} Check your connection and try again. Free features keep working in the meantime.`;
    case "not-configured":
      return `${detail} Free features work as normal.`;
    default:
      return detail;
  }
}

export async function logout(ctx: LicenceCtx): Promise<number> {
  const existing = ctx.store.load();
  if (!existing) {
    ctx.out("\n  You're not logged in on this machine. Soundings is running on the Free plan.\n");
    return 0;
  }
  let freed = true;
  if (existing.activationId && !ctx.offline) freed = (await ctx.provider.deactivate(existing.key, existing.activationId)).ok;
  else if (existing.activationId) freed = false;
  ctx.store.clear();
  ctx.out(
    `\n  ${pc.green("✔")} Logged out. Soundings is back on the Free plan on this machine.` +
      (freed
        ? pc.dim(`\n  This machine's slot on ${existing.displayKey} is free again.`)
        : pc.yellow(`\n  Couldn't reach the licence server to free this machine's slot. Remove "${existing.machineLabel}" in the customer portal if you need it: ${PORTAL_URL}`)) +
      "\n",
  );
  return 0;
}

export async function status(ctx: LicenceCtx): Promise<number> {
  const s: LicenceStatus = await resolveLicence({
    provider: ctx.provider,
    store: ctx.store,
    env: ctx.env,
    now: ctx.now(),
    offline: ctx.offline,
    forceOnline: !ctx.offline,
  });
  const out: string[] = [""];
  if (s.state === "none") {
    out.push(`  ${pc.bold("Soundings Free")}  ${pc.dim(`· ${FREE_SUMMARY}`)}`);
    out.push(`  Pro adds ${Object.values(FEATURE_LABELS).map((l) => l[0]!.toLowerCase() + l.slice(1)).join(", ")}.`);
    out.push(purchasingOpen() ? `  ${pc.cyan("soundings buy")} to open the checkout, then ${pc.cyan("soundings login <key>")}.` : "  Paid plans aren't open for purchase yet.");
    out.push("");
    ctx.out(out.join("\n"));
    return 0;
  }

  const stateText: Record<string, string> = {
    active: pc.green("active"),
    grace: pc.yellow("offline grace period"),
    lapsed: pc.yellow("paused: needs an online check"),
    ended: pc.red("not active"),
    "not-configured": pc.yellow("licensing not set up in this build"),
  };
  const lic = s.licensedTier as Tier;
  const confirmed = Boolean(s.lastValidatedAt);
  const planName = confirmed ? `Soundings ${TIER_INFO[lic].name}` : "Soundings licence (not confirmed yet)";
  out.push(`  ${pc.bold(planName)}  ${pc.dim("·")}  ${stateText[s.state] ?? s.state}`);
  out.push(`  ${pc.dim("Key".padEnd(10))}${s.displayKey ?? maskKey("")}${s.source === "env" ? pc.dim("  (from SOUNDINGS_LICENCE)") : ""}`);
  if (s.source === "file") out.push(`  ${pc.dim("Machine".padEnd(10))}${s.machineLabel}`);
  if (s.lastValidatedAt) out.push(`  ${pc.dim("Checked".padEnd(10))}${s.lastValidatedAt.slice(0, 16).replace("T", " ")} UTC${s.checkedOnline ? pc.dim("  (just now)") : ""}`);
  if (s.graceEndsAt) out.push(`  ${pc.dim("Offline".padEnd(10))}keeps working until ${s.graceEndsAt.slice(0, 10)}`);
  if (confirmed) out.push(`  ${pc.dim("Plan".padEnd(10))}${TIER_INFO[lic].features.map((f) => FEATURE_LABELS[f]).join("; ")}`);
  if (confirmed && s.tier !== lic) out.push(`  ${pc.dim("Now".padEnd(10))}running as Free until this is sorted`);
  if (s.message) out.push("", `  ${s.message}`);
  out.push("");
  ctx.out(out.join("\n"));
  return 0;
}
