---
name: P2P Groups RLS Recursion & Shared-Group Visibility
description: Root cause of 42P17 infinite recursion on p2p_group_members and how cross-user profile visibility for group mates was fixed.
---

## Recursion (42P17) on p2p_group_members
Old pre-migration policies (`p2p_group_members_select/_insert_self/_delete_self`) were never
dropped when new scoped policies were added later. Postgres ORs all permissive policies together,
and the leftover ones self-referenced `p2p_group_members` inside their own USING clause, causing
infinite recursion.

**Why:** Migrations that "replace" a policy must explicitly `DROP POLICY IF EXISTS` the old name(s)
first — `CREATE POLICY` with a new name does not remove old ones, and stale + new policies both stay
active and get OR'd together (silently widening access, or in this case looping).

**How to apply:** Whenever debugging RLS recursion or "access broader than expected" on a table,
first list ALL policies on it (`pg_policies`) — don't assume only the most recently written migration's
policies are active.

## Shared-group profile visibility
`p2p_profiles` SELECT policy was scoped to self / same-church-leader / same-region-admin only. Peers
who share a group (but not a church) could not see each other's name/role, breaking group member
lists and "add peer" flows.

**Why:** Profile visibility scoping predates the peer-created-groups feature and didn't anticipate
cross-church group membership.

**How to apply:** Added `p2p_shares_group_with(uuid)` SECURITY DEFINER helper (checks shared row in
`p2p_group_members`) and OR'd it into `profiles_select_scoped`. Any future feature that lets unrelated
users interact (DMs, shared content, etc.) should check whether `p2p_profiles` RLS actually allows
them to see each other first — it is scoped by default, not open.
