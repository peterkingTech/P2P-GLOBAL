-- P2P Official messaging hardening.
--
-- 1) Brand the general/support/announcement official accounts as "P2P
--    Official" (the literal string the recipient must see, per product
--    decision) — the crisis_response account deliberately keeps its own
--    distinct "P2P Global Crisis Response" identity, since a user reaching
--    out in crisis benefits from knowing specifically who's responding;
--    this was an explicit product choice, not an oversight.
update public.p2p_profiles
set full_name = 'P2P Official'
where is_official_account = true
  and official_account_type in ('announcement', 'support', 'general');

-- 2) Column-level identity protection. p2p_messages.sent_by_admin_id
-- (migration 076) and p2p_contact_replies.from_admin_id (migration 075) are
-- the internal-audit "who actually sent/replied to this" columns — the
-- officialMessages.ts/contact.ts API routes already mask them from the
-- recipient's own view (mapReply(row) with no adminUsername argument on the
-- sender-facing routes; the mobile message-thread screens never select
-- sent_by_admin_id at all). But both tables' RLS SELECT policies are
-- row-level only ("are you a member of this conversation" /
-- "is this your own non-internal reply") — they don't and structurally
-- can't restrict which *columns* a legitimate row-owner can read. A
-- recipient's own authenticated Supabase client could still issue a direct
-- PostgREST/supabase-js query selecting sent_by_admin_id or from_admin_id
-- for a row they're already allowed to see, and resolve that id to a real
-- admin's profile — exactly the "hidden UI is not the security boundary"
-- gap this hardening pass is meant to close.
--
-- Postgres column-level privileges are the right enforcement layer here
-- (RLS can't be column-scoped) — but a plain
-- `revoke select (col) on table from role` is a no-op when that role
-- already holds a table-wide SELECT grant (confirmed live: both anon and
-- authenticated hold table-level SELECT on p2p_messages, the standard
-- Supabase default). A column-level revoke only removes a column-level
-- grant entry; it doesn't narrow a broader table-level one. The correct
-- fix is to revoke the table-wide grant and re-grant SELECT on the
-- explicit list of every column except the sensitive one.
revoke select on public.p2p_messages from anon, authenticated;
grant select (
  id, conversation_id, sender_id, body, media_url, created_at, flagged_self_harm,
  message_type, call_log_id, is_official_response, crisis_context, is_pinned,
  pinned_by, pinned_at, pinned_label, media_duration_seconds, subject, department
) on public.p2p_messages to anon, authenticated;

revoke select on public.p2p_contact_replies from anon, authenticated;
grant select (
  id, message_id, from_department, body, is_internal_note, created_at
) on public.p2p_contact_replies to anon, authenticated;