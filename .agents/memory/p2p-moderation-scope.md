---
name: P2P moderator scope decision
description: What the moderator role is allowed to see/do, confirmed with product owner — reference before touching moderation or role/RLS code.
---

Moderators get access only to: flagged/reported content (prayer posts/comments), the reporter, and a minimal identity view of the poster (name, avatar, counts of their own past flag outcomes). They must NOT see registration answers, growth/tree metrics, gifts/skills, or any other profile fields.

**Why:** product owner explicitly drew this line — moderators handle content-level issues, not pastoral/spiritual data. Deeper context needs escalation, not broader access.

**How to apply:** the minimal identity view is served through a SECURITY DEFINER function (`p2p_flag_poster_identity`) that returns only name/avatar/flag-counts — never grant moderator a broad SELECT policy on `p2p_profiles` or `p2p_registration_profiles`. "Escalate" reuses the existing `p2p_help_requests` table/queue (already visible to church_leader/regional_admin/super_admin) rather than a new inbox — do the same for any future "hand this off to a higher role" flow instead of inventing new tables.
