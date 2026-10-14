// Minimum-supported-build check — pure logic (no I/O), so it can be tested
// directly. The I/O and the screen live in components/AppVersionGate.tsx; the
// server side is migrations/186_app_version_policy.sql.
//
// Outcomes:
//   supported — this build is at or above the minimum, or no minimum is set;
//   outdated  — this build is below the minimum: show "Update required";
//   unknown   — the build number or the policy can't be determined (dev
//               builds, web, a build number that can't be read, server
//               without migration 186, first launch while offline): the app
//               runs normally. A temporary failure never locks anyone out; a
//               previously fetched policy is reused.

export type VersionStatus = "supported" | "outdated" | "unknown";
export type MobilePlatform = "ios" | "android";

export interface VersionPolicy {
  platform: MobilePlatform;
  minSupportedBuild: number | null;
  updateUrl: string | null;
  message: string | null;
}

/** Native build numbers are positive integers (CFBundleVersion "53", versionCode 53). */
export function parseBuildNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return /^[1-9]\d{0,8}$/.test(s) ? Number(s) : null;
}

/**
 * The running build's native build number: ExpoApplication.nativeBuildVersion
 * (iOS CFBundleVersion / Android versionCode — the module is already linked
 * into every build through expo-notifications), else on iOS the same
 * CFBundleVersion exposed by expo-constants. Never app.json's static value:
 * EAS sets real build numbers remotely. Unreadable → null (unknown).
 */
export function pickNativeBuild(params: { platform: string; applicationBuild: unknown; iosConstantsBuild: unknown }): number | null {
  const fromApplication = parseBuildNumber(params.applicationBuild);
  if (fromApplication !== null) return fromApplication;
  return params.platform === "ios" ? parseBuildNumber(params.iosConstantsBuild) : null;
}

const ANDROID_PACKAGE = "com.amentech.p2pglobaldiscipleshipnetwork";

/** Only official destinations are ever opened from the update screen. */
export function safeUpdateUrl(url: unknown, platform: MobilePlatform): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (platform === "ios") {
    return /^https:\/\/(apps\.apple\.com|testflight\.apple\.com)\/[^\s]*$/.test(u) || /^itms-(apps|beta):\/\/[^\s]*$/.test(u) ? u : null;
  }
  const re = new RegExp(`^https://play\\.google\\.com/store/apps/details\\?id=${ANDROID_PACKAGE.replace(/\./g, "\\.")}(&[^\\s]*)?$`);
  return re.test(u) ? u : null;
}

/** Normalizes a p2p_app_version_policy row (or a cached copy). Invalid → null. */
export function policyFromRow(row: unknown, platform: MobilePlatform): VersionPolicy | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.platform !== platform) return null;
  const rawMin = r.min_supported_build ?? r.minSupportedBuild ?? null;
  const min = rawMin === null ? null : parseBuildNumber(rawMin);
  if (rawMin !== null && min === null) return null; // malformed minimum: ignore the whole row
  const message = typeof r.message === "string" && r.message.trim() ? r.message.trim().slice(0, 300) : null;
  return { platform, minSupportedBuild: min, updateUrl: safeUpdateUrl(r.update_url ?? r.updateUrl, platform), message };
}

export function evaluateVersion(build: number | null, policy: VersionPolicy | null): VersionStatus {
  if (build === null || !policy) return "unknown";
  if (policy.minSupportedBuild === null) return "supported";
  return build >= policy.minSupportedBuild ? "supported" : "outdated";
}

export type FetchResult = { ok: true; policy: VersionPolicy | null } | { ok: false };

/**
 * Fresh answer wins (including "no policy"); after a failed request the last
 * successfully fetched policy is reused; with neither, the policy is unknown.
 */
export function choosePolicy(fresh: FetchResult, cached: VersionPolicy | null): VersionPolicy | null {
  return fresh.ok ? fresh.policy : cached;
}

/** PostgREST/SQL "table does not exist" — a server without migration 186. */
export function isMissingPolicyTable(error: { code?: string } | null | undefined): boolean {
  return ["PGRST205", "42P01"].includes(error?.code ?? "");
}

/** Build reports (migration 187) come only from native release builds with a readable build number. */
export function shouldReportBuild(params: { isDev: boolean; platform: string; build: number | null }): params is { isDev: false; platform: MobilePlatform; build: number } {
  return !params.isDev && (params.platform === "ios" || params.platform === "android") && params.build !== null;
}

/** Enforcement applies only to real native release builds. */
export function enforcementApplies(params: { isDev: boolean; platform: string }): boolean {
  return !params.isDev && (params.platform === "ios" || params.platform === "android");
}

export const DEFAULT_UPDATE_MESSAGE =
  "This version of P2P Global is no longer supported. Please install the latest version to keep using the app.";

export function updateInstructions(platform: MobilePlatform): string {
  return platform === "ios"
    ? "Open the TestFlight app (or the App Store) and install the latest version of P2P Global."
    : "Open the Google Play Store and update P2P Global.";
}
