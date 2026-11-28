import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiFetch } from "@/lib/apiClient";

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
    const appVersion = `${Constants.expoConfig?.version ?? "?"} (${(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? "") || "?"})`;
    void apiFetch("/client-errors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where, message: String(e?.message ?? error ?? "unknown"), stack: `${e?.stack ?? ""}\n${stack ?? ""}`.slice(0, 2000), platform: Platform.OS, appVersion }),
    }).catch(() => {});
  } catch { /* never let reporting break anything */ }
}
