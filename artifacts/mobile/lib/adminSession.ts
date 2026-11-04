import { apiFetch } from "@/lib/apiClient";
import { getAdminSession, setAdminSession, type AdminSessionInfo } from "@/lib/adminSessionStore";

// The Admin Centre's own session (migration 238), separate from the person's
// peer use of the app. Started right after an admin signs in, sent with every
// API request while it lasts (lib/apiClient), ended on Admin Centre sign-out.

export { getAdminSession, adminSessionHeader, adminSessionEnded, subscribeAdminSession, type AdminSessionInfo } from "@/lib/adminSessionStore";

export type StartResult = { ok: true; session: AdminSessionInfo } | { ok: false; reason: "mfa" | "fresh" | "not_admin" | "error"; message: string };

/** Right after signing in: open an admin session (needs a fresh sign-in, and two-step verification where the account requires it). */
export async function startAdminSession(): Promise<StartResult> {
  try {
    const res = await apiFetch("/admin-identity/session/start", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (res.ok) {
      const s: AdminSessionInfo = { token: body.token, expiresAt: body.expiresAt, displayName: body.displayName, roles: body.roles ?? [], permissions: body.permissions ?? [], identityKind: body.identityKind };
      setAdminSession(s);
      return { ok: true, session: s };
    }
    const reason = body.mfaRequired ? "mfa" : body.freshSignInRequired ? "fresh" : res.status === 403 ? "not_admin" : "error";
    return { ok: false, reason, message: String(body.error ?? "Couldn't open the Admin Centre.") };
  } catch {
    return { ok: false, reason: "error", message: "Couldn't reach P2P Global. Please check your connection." };
  }
}

/** Admin Centre sign-out: the server ends the session (recorded in the audit), then it is forgotten here. */
export async function endAdminSession(): Promise<void> {
  if (!getAdminSession()) return;
  await apiFetch("/admin-identity/session/end", { method: "POST" }).catch(() => {});
  setAdminSession(null);
}
