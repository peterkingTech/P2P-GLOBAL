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