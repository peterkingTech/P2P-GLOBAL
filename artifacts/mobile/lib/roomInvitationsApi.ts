import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// P2P Rooms — Shareable Room Links (Stage C: authenticated in-app
// resolution + client-side link caching). The server intentionally never
// stores the raw token (only its hash) — see routes/roomInvitations.ts —
// so once the creation response is gone, the server can never redisplay
// it. That is a deliberate security property, not a gap, but it means
// THIS client is the only place capable of remembering a link long enough
// for a host to "Copy Link" after navigating away and back. Regenerating
// is the only way to recover a lost link, and it revokes the old one.
async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body;
}

export type RoomType = "break_room" | "church_call" | "family_worship";
export type RoomState = "scheduled" | "live" | "completed" | "unavailable";

export interface RoomInvitationCreated {
  invitationId: string; token: string; roomType: RoomType; roomId: string;
  status: "active"; expiresAt: string | null; createdAt: string;
}
export interface RoomInvitationPreview {
  roomType: RoomType; roomId: string; title: string; subtitle: string | null; hostName: string | null;
  scheduledAt: string | null; roomState: RoomState; invitationStatus: "active" | "revoked"; canAttemptJoin: boolean;
}

export function createRoomInvitation(roomType: RoomType, roomId: string, expiresAt?: string | null): Promise<RoomInvitationCreated> {
  return authedFetch("/room-invitations", { method: "POST", body: JSON.stringify({ roomType, roomId, expiresAt: expiresAt ?? null }) });
}
export function resolveRoomInvitation(token: string): Promise<RoomInvitationPreview> {
  return authedFetch(`/room-invitations/${encodeURIComponent(token)}`);
}
export function revokeRoomInvitation(invitationId: string): Promise<{ revoked: true }> {
  return authedFetch(`/room-invitations/${invitationId}/revoke`, { method: "POST" });
}

export interface RoomInvitationStatus {
  hasActive: boolean; invitationId?: string; createdAt?: string; expiresAt?: string | null;
}
// Host-only: is there ALREADY an active invitation for this room, even if
// this device has no cached token for it? Never returns the token itself
// (the server can't — only its hash is stored). Exists so "Generate Link"
// can tell "nothing exists yet" apart from "something exists elsewhere,
// generating a new one will revoke it" — see getVerifiedCachedRoomInvitation.
export function getRoomInvitationStatus(roomType: RoomType, roomId: string): Promise<RoomInvitationStatus> {
  return authedFetch(`/room-invitations/status?roomType=${roomType}&roomId=${encodeURIComponent(roomId)}`);
}

// ── Client-side link cache ──────────────────────────────────────────────
// Purely a per-device convenience so a host can re-open "Share Room" and
// still see/copy the same link without triggering a silent regeneration
// (which would revoke it). This is NOT a security boundary — it only ever
// stores what the server already handed back to THIS device once, and a
// cached entry is NEVER presented as valid without re-confirming with the
// server first (see getVerifiedCachedRoomInvitation below) — the cache is
// a token-value store, not a trust decision.
//
// Namespaced by the current user's id, not just room+type: on a shared
// device, a different signed-in account can never construct the same
// storage key, so their session cannot surface another user's cached
// link even without an explicit clear-on-logout step. (Decision: no
// sign-out hook was added for this reason — namespacing alone already
// prevents cross-user leakage, and adding one would mean touching
// AuthContext's sign-out flow for a benefit it doesn't need.)
const CACHE_PREFIX = "p2p_room_invite_cache_";
interface CachedInvitation { invitationId: string; token: string; expiresAt: string | null; createdAt: string }

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
function cacheKey(userId: string, roomType: RoomType, roomId: string): string {
  return `${CACHE_PREFIX}${userId}_${roomType}_${roomId}`;
}
export async function cacheRoomInvitation(invitation: RoomInvitationCreated): Promise<void> {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    const cached: CachedInvitation = { invitationId: invitation.invitationId, token: invitation.token, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt };
    await AsyncStorage.setItem(cacheKey(userId, invitation.roomType, invitation.roomId), JSON.stringify(cached));
  } catch { /* best-effort convenience cache — never block on it */ }
}
async function getCachedRoomInvitation(roomType: RoomType, roomId: string): Promise<CachedInvitation | null> {
  try {
    const userId = await currentUserId();
    if (!userId) return null;
    const raw = await AsyncStorage.getItem(cacheKey(userId, roomType, roomId));
    return raw ? (JSON.parse(raw) as CachedInvitation) : null;
  } catch {
    return null;
  }
}
export async function clearCachedRoomInvitation(roomType: RoomType, roomId: string): Promise<void> {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    await AsyncStorage.removeItem(cacheKey(userId, roomType, roomId));
  } catch { /* ignore */ }
}

// The one function the Stage D share panel should actually call to decide
// what to show. Always re-resolves the cached token against the server —
// a cached entry is NEVER shown as "Invitation Active" on cache contents
// alone. Revoked/expired/any-error cache entries are cleared automatically
// so a stale link is never silently redisplayed as valid.
export async function getVerifiedCachedRoomInvitation(roomType: RoomType, roomId: string): Promise<{ token: string; invitationId: string; preview: RoomInvitationPreview } | null> {
  const cached = await getCachedRoomInvitation(roomType, roomId);
  if (!cached) return null;
  try {
    const preview = await resolveRoomInvitation(cached.token);
    if (preview.invitationStatus !== "active") { await clearCachedRoomInvitation(roomType, roomId); return null; }
    return { token: cached.token, invitationId: cached.invitationId, preview };
  } catch (e: any) {
    // Only forget the cached link once the SERVER has confirmed it's no
    // longer valid. A transient network/server error must not destroy a
    // still-good cached token — doing so would force an unnecessary
    // revoke-and-regenerate next time, breaking anyone who already has
    // the (still valid) old link over what was only a momentary blip.
    const msg = (e?.message ?? "").toLowerCase();
    if (msg.includes("revoked") || msg.includes("expired") || msg.includes("not found") || msg.includes("no longer exists")) {
      await clearCachedRoomInvitation(roomType, roomId);
    }
    return null;
  }
}

// Builds the shareable link for a raw token. Uses the app's custom scheme
// directly for this phase — Stage D will additionally offer the HTTPS
// landing-page form (lib/sharing.ts) as the primary share text, since no
// iOS associatedDomains / Android intentFilters are configured yet (see
// Stage A audit) and this scheme-only link only opens the app if it is
// already installed and the OS routes the scheme to it.
//
// Route is app/rooms/join/[token].tsx, NOT app/join/[token].tsx — the
// latter path is already owned by app/(auth)/join/[username].tsx (an
// existing "invite a friend by username" flow; route groups like (auth)
// don't appear in the URL, so that screen already resolves at /join/:x).
export function buildRoomInvitationLink(token: string): string {
  return `p2pglobalbiblestudy://rooms/join/${token}`;
}
