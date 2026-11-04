// The Admin Centre session token while it lasts (migration 238), in memory
// only — closing the app ends it on this device. lib/apiClient reads it to
// send with every request; lib/adminSession starts and ends it.

export interface AdminSessionInfo { token: string; expiresAt: string; displayName: string; roles: string[]; permissions: string[]; identityKind: string }
let current: AdminSessionInfo | null = null;
const listeners = new Set<() => void>();

export const ADMIN_SESSION_HEADER = "X-P2P-Admin-Session";
export const getAdminSession = () => current;
export const adminSessionHeader = (): Record<string, string> => (current ? { [ADMIN_SESSION_HEADER]: current.token } : {});
export function subscribeAdminSession(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function setAdminSession(s: AdminSessionInfo | null) { current = s; listeners.forEach((l) => l()); }
/** The server said the session ended (expired, revoked, account suspended): forget it here too. */
export const adminSessionEnded = () => setAdminSession(null);
