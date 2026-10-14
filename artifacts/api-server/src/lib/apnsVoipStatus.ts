// Pure helpers for the iOS VoIP push path (lib/apnsVoip.ts) — no I/O, so the
// configuration check and Apple's responses can be tested directly.

export const APNS_REQUIRED_VARS = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_AUTH_KEY"] as const;
export const DEFAULT_APNS_BUNDLE_ID = "com.amentech.p2pglobaldiscipleshipnetwork";

export interface VoipConfigStatus {
  configured: boolean;
  /** Names (never values) of required variables that are missing or empty. */
  missing: string[];
  /** NATIVE_CALLS_IOS=false switches the integration off on purpose. */
  disabledByFlag: boolean;
  sandbox: boolean;
  bundleId: string;
  topic: string;
}

export function voipConfigStatus(env: Record<string, string | undefined>): VoipConfigStatus {
  const missing = APNS_REQUIRED_VARS.filter((k) => !String(env[k] ?? "").trim());
  const disabledByFlag = env.NATIVE_CALLS_IOS === "false";
  const bundleId = env.APNS_BUNDLE_ID || DEFAULT_APNS_BUNDLE_ID;
  return {
    configured: missing.length === 0 && !disabledByFlag,
    missing: [...missing],
    disabledByFlag,
    sandbox: env.APNS_SANDBOX === "true",
    bundleId,
    topic: `${bundleId}.voip`,
  };
}

export type ApnsResultKind = "accepted" | "token_invalid" | "transient" | "rejected";

/** Apple's answer for one device: what it means and what to do about the token. */
export function classifyApnsResult(status: number, reason?: string): ApnsResultKind {
  if (status === 200) return "accepted";
  // Same rule as before this change. (DeviceTokenNotForTopic is NOT treated
  // as a bad token: it usually means a server-side bundle/topic mistake, and
  // deactivating tokens for it would wipe good registrations.)
  if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") return "token_invalid";
  if (status === 0 || status === 429 || status >= 500) return "transient";
  return "rejected";
}
