// Display rules for a Family Circle's member list (app/family/members.tsx).
// The roster itself comes only from GET /family/:familyId, which returns the
// caller's own family's ACTIVE members (403 for non-members) — nothing here
// adds, infers or widens membership.
import type { FamilyMember } from "./familyApi";

/** Labels for the roles the family model actually stores (migration 126). */
export const FAMILY_ROLE_LABEL: Record<string, string> = {
  shepherd: "Family Circle Shepherd",
  co_shepherd: "Co-Shepherd",
  adult: "Adult",
  teen: "Teen",
  child: "Child",
};
const ROLE_ORDER: Record<string, number> = { shepherd: 0, co_shepherd: 1, adult: 2, teen: 3, child: 4 };

/** A known role's label; null for anything else (never invent a title). */
export function roleLabel(role: string | null | undefined): string | null {
  return role && role in FAMILY_ROLE_LABEL ? FAMILY_ROLE_LABEL[role] : null;
}

/** Shepherd first, then co-shepherds, then everyone else by when they joined. */
export function sortMembers(members: FamilyMember[]): FamilyMember[] {
  return [...members].sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || String(a.joinedAt).localeCompare(String(b.joinedAt)));
}

/** Case-insensitive match on name or @username. */
export function filterMembers(members: FamilyMember[], query: string): FamilyMember[] {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return members;
  return members.filter((m) => m.name.toLowerCase().includes(q) || (m.username ?? "").toLowerCase().includes(q));
}

/** Families are small; search only helps once the list gets long. */
export const SEARCH_THRESHOLD = 12;
export const showSearch = (total: number) => total > SEARCH_THRESHOLD;

export const memberCountLabel = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/**
 * Where tapping a member goes: their public @username profile, which applies
 * its own privacy and blocking rules. No username (e.g. a deleted account) →
 * not tappable.
 */
export function memberProfilePath(m: Pick<FamilyMember, "username">): string | null {
  return m.username ? `/profile/${encodeURIComponent(m.username)}` : null;
}

export function memberAccessibilityLabel(m: FamilyMember, isMe: boolean): string {
  const role = roleLabel(m.role);
  return [m.name + (isMe ? " (you)" : ""), role].filter(Boolean).join(", ");
}

/** The shepherd and the viewer themselves are never removable from the list. */
export const canRemoveMember = (m: FamilyMember, myId: string | undefined, canManage: boolean) =>
  canManage && m.userId !== myId && m.role !== "shepherd";
