import { Platform } from "react-native";

// Sends a screen's render error to the server log (api-server routes/clientErrors.ts), so errors on phones can be
// seen and fixed (2026-11-28: build 90 screens failed on iPhone with no way to read the error). No personal data.
// Never throws; at most one report per screen per minute.
const last = new Map<string, number>();
export function reportClientError(where: string, error: unknown, stack?: string): void {
  try {
    const now = Date.now();
    if (now - (last.get(where) ?? 0) < 60_000) return;
    last.set(where, now);
    const e = error as { message?: string; stack?: string } | undefined;
    let appVersion = "?";
    try {   // loaded here, not at the top: the reporter must never fail to load (tests, web) or break anything
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const C = require("expo-constants").default;
      appVersion = `${C?.expoConfig?.version ?? "?"} (${(C?.expoConfig?.ios?.buildNumber ?? C?.expoConfig?.android?.versionCode ?? "") || "?"})`;
    } catch { /* version unknown */ }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { apiFetch } = require("@/lib/apiClient") as typeof import("@/lib/apiClient");   // lazy: no heavy imports at load
    void apiFetch("/client-errors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where, message: String(e?.message ?? error ?? "unknown"), stack: `${e?.stack ?? ""}\n${stack ?? ""}`.slice(0, 2000), platform: Platform.OS, appVersion }),
    }).catch(() => {});
  } catch { /* never let reporting break anything */ }
}
