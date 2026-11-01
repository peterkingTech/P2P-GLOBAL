import { createHash, randomBytes } from "node:crypto";

// Scripture collections (migration 220): every access rule in one place, as
// plain functions with no database — so they are tested exhaustively
// (tests/scriptureCollections.test.mjs) and the routes only gather facts.
//
//   • The owner has full control. Nobody else has any access unless an
//     ACTIVE share applies to them right now: a peer share naming them, or a
//     group share for a group they currently belong to (membership is looked
//     up live on every request, so leaving a Family removes access at once).
//   • Blocks either way between the person and the owner remove access.
//   • Permission levels rank view < copy < collaborate; the best applicable
//     share wins.
//   • Resharing: only when a share allows it, never above the resharer's
//     own level, never "collaborate", and a reshare can't itself be reshared.
//   • Content edits name the revision they started from; a stale edit is
//     refused rather than silently overwriting someone else's change.

export type Permission = "view" | "copy" | "collaborate";
export const PERMISSIONS: readonly Permission[] = ["view", "copy", "collaborate"];
export const RANK: Record<Permission, number> = { view: 1, copy: 2, collaborate: 3 };
export type TargetType = "peer" | "family" | "church" | "circle" | "group" | "study";
export const TARGET_TYPES: readonly TargetType[] = ["peer", "family", "church", "circle", "group", "study"];
export const GROUP_TARGETS: readonly TargetType[] = ["family", "church", "circle", "group", "study"];
export const LINK_PERMISSIONS: readonly Permission[] = ["view", "copy"];
export const MAX_ITEMS = 200;
export const MAX_SHARE_TARGETS = 20;

export interface ShareRow {
  id: string;
  target_type: TargetType;
  target_id: string | null;
  user_id: string | null;
  permission: Permission;
  can_reshare: boolean;
  status: "active" | "revoked";
  shared_by: string | null;
}
export type MemberSets = Partial<Record<TargetType, Set<string>>>;

export interface Access {
  role: "owner" | "recipient" | "none";
  permission: Permission | null;
  canReshare: boolean;
  /** The active shares that give this person access. */
  shareIds: string[];
}
export const NO_ACCESS: Access = { role: "none", permission: null, canReshare: false, shareIds: [] };

/** Does this share reach this person right now? */
export function shareApplies(s: ShareRow, userId: string, members: MemberSets): boolean {
  if (s.status !== "active") return false;
  if (s.target_type === "peer") return s.user_id === userId;
  return !!s.target_id && !!members[s.target_type]?.has(s.target_id);
}

export function resolveAccess(i: { userId: string; ownerId: string; deleted: boolean; shares: ShareRow[]; members: MemberSets; blockedWithOwner: boolean }): Access {
  if (i.deleted) return NO_ACCESS;
  if (i.userId === i.ownerId) return { role: "owner", permission: "collaborate", canReshare: true, shareIds: [] };
  if (i.blockedWithOwner) return NO_ACCESS;
  let best: Permission | null = null;
  let reshare = false;
  const ids: string[] = [];
  for (const s of i.shares) {
    if (!shareApplies(s, i.userId, i.members)) continue;
    ids.push(s.id);
    if (!best || RANK[s.permission] > RANK[best]) best = s.permission;
    if (s.can_reshare) reshare = true;
  }
  return best ? { role: "recipient", permission: best, canReshare: reshare, shareIds: ids } : NO_ACCESS;
}

export const allows = (a: Access, need: Permission) => !!a.permission && RANK[a.permission] >= RANK[need];

/** What this person may grant when sharing; a string is the reason they can't. */
export function grantable(a: Access, requested: unknown, requestedReshare: unknown): { permission: Permission; canReshare: boolean } | string {
  if (!PERMISSIONS.includes(requested as Permission)) return "Choose what people can do.";
  const p = requested as Permission;
  if (a.role === "none") return "This collection isn't available.";
  if (a.role === "owner") return { permission: p, canReshare: requestedReshare === true };
  if (!a.canReshare) return "Only the owner can share this.";
  if (p === "collaborate") return "Only the owner can invite people to edit.";
  if (RANK[p] > RANK[a.permission!]) return "You can't give more access than you have.";
  return { permission: p, canReshare: false };
}

/** Who may revoke a share: the owner, or the person who made that share. */
export const canRevoke = (a: Access, share: Pick<ShareRow, "shared_by">, userId: string) => a.role === "owner" || share.shared_by === userId;

export const revisionMatches = (current: number, given: unknown) => Number.isInteger(Number(given)) && Number(given) === current;

/** A reorder must name exactly the current items, each once. */
export function validReorder(current: string[], next: unknown): next is string[] {
  if (!Array.isArray(next) || next.length !== current.length) return false;
  const seen = new Set<string>();
  const have = new Set(current);
  for (const id of next) {
    if (typeof id !== "string" || !have.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// ── Links ────────────────────────────────────────────────────────────────────

export type LinkState = "ok" | "revoked" | "expired" | "full";
export function linkState(l: { revoked_at: string | null; expires_at: string | null; max_uses: number | null; uses: number }, now = Date.now()): LinkState {
  if (l.revoked_at) return "revoked";
  if (l.expires_at && new Date(l.expires_at).getTime() <= now) return "expired";
  if (l.max_uses != null && l.uses >= l.max_uses) return "full";
  return "ok";
}
/** 24 random bytes, URL-safe (32 characters). Only its fingerprint is stored. */
export const newLinkToken = () => randomBytes(24).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

// ── Copies ───────────────────────────────────────────────────────────────────

export interface ItemRef { translation_code: string; book_code: string; chapter: number; start_verse: number; end_verse: number }
export const refKey = (r: ItemRef) => `${r.translation_code}:${r.book_code}.${r.chapter}:${r.start_verse}-${r.end_verse}`;

/** Items of the original that a copy doesn't have yet (for "See what's new" — never applied automatically). */
export function newInOrigin<T extends ItemRef>(origin: T[], copy: ItemRef[]): T[] {
  const have = new Set(copy.map(refKey));
  return origin.filter((i) => !have.has(refKey(i)));
}
/** Has the original changed since this copy was made? */
export const originChangedSince = (originUpdatedAt: string | null | undefined, copiedAt: string | null | undefined) =>
  !!originUpdatedAt && !!copiedAt && new Date(originUpdatedAt).getTime() > new Date(copiedAt).getTime();
