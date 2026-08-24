import type { SupabaseClient } from "@supabase/supabase-js";

// Whether userA is authorized to see userB's Study Together data.
// Mirrors the exact relationship rule already established by
// GET /discipleship/study-partners/:userId (active discipleship link,
// either direction; shared group membership) — the same two query shapes,
// not a new relationship system. Deliberately excludes the super_admin/
// help-request branches of p2p_start_direct_conversation (migration 081):
// those are messaging permissions, not a "we are studying together"
// relationship, and have no legitimate reason to expose lesson progress.
export async function isEligibleStudyPartner(
  supabase: SupabaseClient,
  userA: string,
  userB: string
): Promise<boolean> {
  if (userA === userB) return true;

  const { data: linkOneWay } = await supabase
    .from("p2p_discipleship_links")
    .select("id")
    .eq("mentor_id", userA)
    .eq("disciple_id", userB)
    .eq("active", true)
    .maybeSingle();
  if (linkOneWay) return true;

  const { data: linkOtherWay } = await supabase
    .from("p2p_discipleship_links")
    .select("id")
    .eq("mentor_id", userB)
    .eq("disciple_id", userA)
    .eq("active", true)
    .maybeSingle();
  if (linkOtherWay) return true;

  const { data: myGroups } = await supabase.from("p2p_group_members").select("group_id").eq("user_id", userA);
  const groupIds = (myGroups ?? []).map((g) => g.group_id as string);
  if (groupIds.length === 0) return false;

  const { data: shared } = await supabase
    .from("p2p_group_members")
    .select("user_id")
    .eq("user_id", userB)
    .in("group_id", groupIds)
    .limit(1);
  return !!shared && shared.length > 0;
}

export type StudyPartnerRelationship = "peer_guide" | "disciple" | "connection";

// The full set of people eligible to study with userId, keyed by id with
// their relationship label. Same three query shapes as
// isEligibleStudyPartner above (this is the "list everyone" counterpart to
// that pairwise check) — extracted here so GET /discipleship/study-partners
// and Add People's inviteable-people endpoint share one implementation
// instead of two copies of this relationship rule.
export async function getEligibleStudyPartners(
  supabase: SupabaseClient,
  userId: string
): Promise<Map<string, StudyPartnerRelationship>> {
  const relationshipById = new Map<string, StudyPartnerRelationship>();

  const { data: peerGuideLinks } = await supabase
    .from("p2p_discipleship_links").select("mentor_id").eq("disciple_id", userId).eq("active", true);
  for (const r of (peerGuideLinks ?? []) as Record<string, unknown>[]) {
    relationshipById.set(r.mentor_id as string, "peer_guide");
  }

  const { data: discipleLinks } = await supabase
    .from("p2p_discipleship_links").select("disciple_id").eq("mentor_id", userId).eq("active", true);
  for (const r of (discipleLinks ?? []) as Record<string, unknown>[]) {
    const id = r.disciple_id as string;
    if (!relationshipById.has(id)) relationshipById.set(id, "disciple");
  }

  const { data: myGroups } = await supabase.from("p2p_group_members").select("group_id").eq("user_id", userId);
  const groupIds = ((myGroups ?? []) as Record<string, unknown>[]).map((g) => g.group_id as string);
  if (groupIds.length) {
    const { data: groupmates } = await supabase
      .from("p2p_group_members").select("user_id").in("group_id", groupIds).neq("user_id", userId);
    for (const r of (groupmates ?? []) as Record<string, unknown>[]) {
      const id = r.user_id as string;
      if (!relationshipById.has(id)) relationshipById.set(id, "connection");
    }
  }

  return relationshipById;
}