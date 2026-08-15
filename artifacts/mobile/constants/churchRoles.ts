import type { ChurchRole } from "@/contexts/DataContext";

// UI-facing labels only — the underlying DB role values (senior_pastor,
// discipleship_pastor, small_group_leader, peer_guide, member) are unchanged
// and still drive every RLS policy/endpoint check. This is purely a
// presentation layer on top of the existing role system, not a new role
// model — see p2p_is_church_creator for the separate, independent
// ownership gate (senior_pastor label "General Overseer" does NOT imply
// ownership permissions; only the church's actual creator has those).
export const CHURCH_ROLE_LABELS: Record<ChurchRole, string> = {
  senior_pastor: "General Overseer",
  discipleship_pastor: "Church Admin",
  small_group_leader: "Church Admin",
  peer_guide: "Peer Guide",
  member: "Member",
};

export function churchRoleLabel(role: ChurchRole | string | null | undefined): string {
  if (!role) return "Member";
  return CHURCH_ROLE_LABELS[role as ChurchRole] ?? role;
}

// Roles assignable via the "Change Role" UI — senior_pastor is excluded
// (matches the backend's PUT .../role validRoles list exactly; the senior
// pastor role can't be reassigned through this endpoint).
export const ASSIGNABLE_CHURCH_ROLES: ChurchRole[] = ["discipleship_pastor", "small_group_leader", "peer_guide", "member"];