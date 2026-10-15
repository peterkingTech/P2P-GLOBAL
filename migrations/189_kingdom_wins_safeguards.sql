-- 189: Kingdom Wins safeguards — content screening, an explicit moderator
-- allowlist, database-enforced posting rules and repeat-offender posting
-- restrictions. Forward-only and additive; re-runnable.
--
-- PRODUCT RULES (unchanged by this migration)
--   * Kingdom Wins is community testimony. Ordinary Win/testimony posts still
--     publish immediately — there is NO Publishing Studio approval for Wins.
--   * P2P Impact keeps its pending review + consent workflow.
--   * Kingdom Stories (152/188) is untouched.
--
-- AUTHORIZATION MODEL
--   * Wins moderators (p2p_is_wins_moderator): moderator, admin_moderation,
--     admin_supervisor, super_admin. Only they may moderate other people's
--     Wins, resolve Wins reports, release screening holds and impose or lift
--     posting restrictions. Replaces "any role except student"
--     (p2p_is_admin) for Kingdom Wins — peer_guide, church_leader,
--     admin_finance etc. no longer moderate Wins.
--   * P2P Impact reviewers (p2p_is_impact_reviewer): the moderators above plus
--     admin_content, which the admin dashboard already designates as the P2P
--     Impact reviewer. Reviewers may only approve/reject a pending, unheld
--     P2P Impact submission — nothing else.
--   * Authors: their own entries only, through owner-settable states.
--   The actor is always auth.uid() of the verified session; nothing trusts a
--   client-supplied user id, role, consent flag or timestamp.
--
-- WHERE IT IS ENFORCED
--   trg_p2p_kingdom_win_guard (BEFORE INSERT/UPDATE) runs for every write
--   path: the API (which now writes as the signed-in user), direct PostgREST
--   writes and SECURITY DEFINER moderation functions. Writes without a session
--   user (service_role/owner, e.g. account-deletion cascades) are trusted
--   server paths, as elsewhere in this schema; the P2P Impact consent rule
--   still applies to them.
--
-- CONTENT SCREENING (same two-layer approach as message scanning, 022/023)
--   Deterministic, versioned regex rules in p2p_kingdom_win_screening_rules:
--   'reject' rules block clear advertising, payment/donation instructions,
--   money schemes and scam patterns; 'hold' rules (links, contact details,
--   fundraising mentions, promotional wording) keep an ordinary post out of
--   the feed (status 'submitted', moderation_hold) and file an automated
--   report in the existing moderation queue (p2p_content_flags). Text is
--   normalised first (case, zero-width characters, l33t substitutions,
--   s p a c e d letters). Rules are heuristics, not a classifier.
--   Posts not in English are translated to English on the server and both
--   versions are screened (section 3b); if no translation is available the
--   post is held for a moderator.
--   MEDIA IS NOT SCANNED: there is no image/video analysis in this system.
--   Photos and videos are covered by reporting and moderator review only.
--
-- AUDIT
--   Moderator status changes, report resolutions and restriction changes are
--   written to the existing p2p_admin_activity_log in the same transaction.
--
-- Rollback (manual; restores 150/151/013/020 behaviour, keeps the two added
-- columns, which are harmless to older code):
--   begin;
--   drop trigger if exists trg_p2p_kingdom_win_guard on public.p2p_kingdom_wins;
--   drop trigger if exists trg_p2p_kingdom_win_restriction_immutable on public.p2p_kingdom_win_restrictions;
--   drop function if exists public.p2p_kingdom_win_guard();
--   drop function if exists public.p2p_wins_restrict_user(uuid, text, timestamptz);
--   drop function if exists public.p2p_wins_lift_restriction(uuid, text);
--   drop function if exists public.p2p_my_wins_posting_status();
--   drop function if exists public.p2p_wins_restriction_active(uuid);
--   drop function if exists public.p2p_kingdom_win_restriction_immutable();
--   drop table if exists public.p2p_kingdom_win_restrictions;
--   drop function if exists public.p2p_kingdom_win_screening_input(text, text, text, jsonb);
--   drop function if exists public.p2p_kingdom_win_needs_translation(text);
--   drop function if exists public.p2p_kingdom_win_screening_text(text, text, text, jsonb);
--   drop table if exists public.p2p_kingdom_win_translations;
--   drop function if exists public.p2p_kingdom_win_screen(text);
--   drop function if exists public.p2p_kingdom_win_normalize(text);
--   drop table if exists public.p2p_kingdom_win_screening_rules;
--   -- then re-run the policy/function sections of 150, 151, 013 and 020
--   -- (policies "Published kingdom wins are public, own always visible",
--   -- "Authors manage their own kingdom wins", "Reactions visible with their
--   -- kingdom win", "Admins read all kingdom win media",
--   -- "content_flags_select_moderation"; functions p2p_moderate_flag,
--   -- p2p_report_content, p2p_flag_poster_identity), after which:
--   drop function if exists public.p2p_wins_log_admin_action(text, uuid, uuid, text, jsonb);
--   drop function if exists public.p2p_is_impact_reviewer();
--   drop function if exists public.p2p_is_wins_moderator();
--   commit;

-- ── 1. Columns ───────────────────────────────────────────────────────────────
-- moderation_hold: kept out of the feed by automated screening until a Wins
-- moderator decides. screening: the rule hits (staff-only, never shown to
-- the author beyond "held for review").
alter table public.p2p_kingdom_wins add column if not exists moderation_hold boolean not null default false;
alter table public.p2p_kingdom_wins add column if not exists screening jsonb;

-- ── 2. Role allowlists (single source of truth) ─────────────────────────────
create or replace function public.p2p_is_wins_moderator()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.p2p_profiles
    where id = auth.uid() and role::text in ('moderator', 'admin_moderation', 'admin_supervisor', 'super_admin')
  );
$$;
revoke all on function public.p2p_is_wins_moderator() from public, anon;
grant execute on function public.p2p_is_wins_moderator() to authenticated;

create or replace function public.p2p_is_impact_reviewer()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.p2p_profiles
    where id = auth.uid() and role::text in ('moderator', 'admin_moderation', 'admin_supervisor', 'super_admin', 'admin_content')
  );
$$;
revoke all on function public.p2p_is_impact_reviewer() from public, anon;
grant execute on function public.p2p_is_impact_reviewer() to authenticated;

-- Audit helper: the existing admin activity log (069), actor = session user.
create or replace function public.p2p_wins_log_admin_action(
  p_action text, p_target_user uuid, p_resource_id uuid, p_resource_type text, p_detail jsonb
) returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.p2p_admin_activity_log (admin_id, admin_role, action_type, target_user_id, target_resource_id, target_resource_type, action_detail)
  select auth.uid(), coalesce((select role::text from public.p2p_profiles where id = auth.uid()), 'unknown'),
         p_action, p_target_user, p_resource_id, p_resource_type, coalesce(p_detail, '{}'::jsonb)
  where auth.uid() is not null;
$$;
revoke all on function public.p2p_wins_log_admin_action(text, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ── 3. Content screening ─────────────────────────────────────────────────────
create table if not exists public.p2p_kingdom_win_screening_rules (
  rule_key      text primary key,
  category      text not null check (category in ('advertising', 'fundraising', 'payment', 'money_scheme', 'scam', 'contact', 'link', 'promotion')),
  action        text not null check (action in ('reject', 'hold')),
  target        text not null check (target in ('plain', 'normalized')),
  -- Validated on write: an invalid regular expression cannot be stored.
  pattern       text not null check ((''::text ~ pattern) is not null),
  description   text not null,
  rules_version integer not null,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.p2p_kingdom_win_screening_rules enable row level security;
revoke all on table public.p2p_kingdom_win_screening_rules from public, anon, authenticated, service_role;

-- Version 1. 'plain' = lower-cased text; 'normalized' = plain + l33t and
-- spaced-letter folding (see p2p_kingdom_win_normalize). \y is the word
-- boundary in Postgres regular expressions (\b is not — see 023).
insert into public.p2p_kingdom_win_screening_rules (rule_key, category, action, target, pattern, description, rules_version) values
  ('pay_handle_direct', 'payment', 'reject', 'normalized',
   '\y(cash ?app|venmo|zelle|pay ?pal|paypal\.me|mpesa|m pesa|opay|palmpay|momo) ?(me|us)\y',
   'Direct payment requests such as "cashapp me" or "paypal me".', 1),
  ('cashtag', 'payment', 'reject', 'plain',
   '(^|\s)\$[a-z][a-z0-9_]{2,}',
   'Cash App $cashtags.', 1),
  ('payment_instruction', 'payment', 'reject', 'normalized',
   '\y(send|donate|give|transfer|pay|sow|contribute|deposit)\y.{0,25}\y(to|into|via|through|on|using)\y (my |our |this )?(cash ?app|venmo|zelle|pay ?pal|bank account|account|mpesa|m pesa|opay|palmpay|momo|mobile money|bitcoin|btc|usdt|crypto|wallet|gift ?card)\y',
   'Instructions to send money through a payment channel.', 1),
  ('financial_details', 'payment', 'reject', 'plain',
   '\yiban\y|\y(routing|account|acct)\s*(number|#|no\.?)\y|\y(swift|bic|ifsc|sort code)\y|\y0x[a-f0-9]{40}\y|\ybc1[a-z0-9]{25,39}\y|\ywestern union\y|\ymoneygram\y|\ywire (me|the money|transfer)\y',
   'Bank/account details, wallet addresses and money-transfer services (as in message scanning, 023).', 1),
  ('donation_request', 'fundraising', 'reject', 'normalized',
   '\y(please|kindly|pls|plz)\y.{0,25}\y(donate|sponsor me|support me financially|send (me )?money|contribute)\y|\ydonate (now|today|here|to (me|my|our|this))\y|\ysupport (my|our) (ministry|cause|project) (financially|with money)\y',
   'Direct donation or fundraising requests.', 1),
  ('money_scheme', 'money_scheme', 'reject', 'normalized',
   '\y(double your money|guaranteed (returns?|profits?|income)|investment (opportunity|plan|platform)|forex (signals?|trading|trader)|crypto (signals?|investment|trading)|binary options?|make money (fast|online|from home)|passive income|ponzi|pyramid scheme|(earn|make) \$?[0-9][0-9,]* (daily|weekly|per day|a day|every day))\y',
   'Investment and money-making schemes.', 1),
  ('scam_pattern', 'scam', 'reject', 'normalized',
   '\y(processing fee|advance fee|claim your (prize|reward)|you (have )?won (a|the|\$)|lottery (winner|prize)|recover your (money|funds) for a fee)\y',
   'Common scam phrasing.', 1),
  ('advertising', 'advertising', 'reject', 'normalized',
   '\y(buy now|shop now|order now|(promo|discount|coupon) code|[0-9]{1,2} ?% off|limited (time )?offer|free shipping|dm (me )?(to|for) (buy|order|prices?))\y',
   'Advertising and commercial promotion.', 1),
  ('link', 'link', 'hold', 'plain',
   '(https?://|www\.)|\y[a-z0-9-]+\.(com|net|org|io|co|ng|uk|me|ly|link|shop|store|biz|info|xyz|app|tv)\y(/|\s|$)',
   'External links.', 1),
  ('email', 'contact', 'hold', 'plain',
   '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}',
   'Email addresses.', 1),
  ('phone', 'contact', 'hold', 'plain',
   '\+[0-9]{1,3}[\s.-]?\(?[0-9]{2,4}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{3,4}|\y0[0-9]{9,10}\y|\y[0-9]{3}[\s.-][0-9]{3}[\s.-][0-9]{4}\y',
   'Phone numbers.', 1),
  ('messaging_handle', 'contact', 'hold', 'normalized',
   '\y((whatsapp|whats app|telegram|signal) (me|us|number|line|link|group)|(contact|reach|message|chat with) (me|us) (on|via) (whatsapp|whats app|telegram|signal)|dm me|inbox me|text me (at|on)|call me (at|on))\y',
   'Moving the conversation to another app or a phone.', 1),
  ('fundraising_mention', 'fundraising', 'hold', 'normalized',
   '\y(fundrais[a-z]*|donations?|sponsorship|crowdfund[a-z]*|gofundme|go fund me)\y|\y(i|we) need (money|funds|financial help)\y',
   'Fundraising mentions — may be legitimate testimony, so held for review rather than rejected.', 1),
  ('promotion', 'promotion', 'hold', 'normalized',
   '\y(for sale|now selling|i sell|we sell|my business page|follow (me|us|my page)|subscribe to my|link in (my )?bio|check out my (page|channel|shop|store|business))\y',
   'Promotional wording — may be legitimate, so held for review.', 1)
on conflict (rule_key) do nothing;

-- Folds evasive spellings: zero-width characters, l33t substitutions inside
-- words, and s p a c e d / d.o.t.t.e.d single letters (3 or more in a row).
create or replace function public.p2p_kingdom_win_normalize(p_text text)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_tokens text[];
  v_out text[] := '{}';
  v_run text := '';
  v_tok text;
begin
  if p_text is null then return ''; end if;
  v_tokens := regexp_split_to_array(lower(p_text), '[\s.\-_*/|·•]+');
  foreach v_tok in array v_tokens loop
    -- Punctuation at a word's edges is not part of it ("now!" -> "now").
    v_tok := regexp_replace(v_tok, '^[^a-z0-9@$%]+|[^a-z0-9@$%]+$', '', 'g');
    if v_tok ~ '[a-z]' then v_tok := translate(v_tok, '@$0134578', 'asoieastb'); end if;
    if char_length(v_tok) = 1 and v_tok ~ '^[a-z]$' then
      v_run := v_run || v_tok;
    else
      if char_length(v_run) >= 3 then v_out := v_out || v_run;
      elsif char_length(v_run) > 0 then v_out := v_out || regexp_split_to_array(v_run, ''); end if;
      v_run := '';
      if v_tok <> '' then v_out := v_out || v_tok; end if;
    end if;
  end loop;
  if char_length(v_run) >= 3 then v_out := v_out || v_run;
  elsif char_length(v_run) > 0 then v_out := v_out || regexp_split_to_array(v_run, ''); end if;
  return array_to_string(v_out, ' ');
end;
$$;
revoke all on function public.p2p_kingdom_win_normalize(text) from public, anon, authenticated, service_role;

-- Returns {action: allow|hold|reject, hits: [{rule, category, action}], rulesVersion}.
create or replace function public.p2p_kingdom_win_screen(p_text text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_plain text;
  v_norm text;
  v_hits jsonb := '[]'::jsonb;
  v_action text := 'allow';
  r record;
begin
  v_plain := regexp_replace(lower(coalesce(p_text, '')), '[​-‍⁠﻿­]', '', 'g');
  v_plain := regexp_replace(v_plain, '\s+', ' ', 'g');
  v_norm := public.p2p_kingdom_win_normalize(v_plain);
  for r in select * from public.p2p_kingdom_win_screening_rules where enabled order by rule_key loop
    if (case when r.target = 'plain' then v_plain else v_norm end) ~ r.pattern then
      v_hits := v_hits || jsonb_build_object('rule', r.rule_key, 'category', r.category, 'action', r.action);
      if r.action = 'reject' then v_action := 'reject';
      elsif v_action = 'allow' then v_action := 'hold'; end if;
    end if;
  end loop;
  return jsonb_build_object('action', v_action, 'hits', v_hits,
    'rulesVersion', (select max(rules_version) from public.p2p_kingdom_win_screening_rules where enabled));
end;
$$;
revoke all on function public.p2p_kingdom_win_screen(text) from public, anon, authenticated, service_role;

-- ── 3b. Translated screening (posts in other languages) ─────────────────────
-- The rules above are English. A post that is not in English is translated
-- to English ON THE SERVER (the API, with the same AI translator the app
-- already uses for lessons) and both the original and the translation are
-- screened. Only the server can record a translation (service_role); the
-- guard looks it up by a hash of the exact text being published, so a member
-- writing to the database directly cannot supply their own "translation".
-- No translation available (provider down, too slow, direct write) → the
-- post is HELD for a moderator, never published unchecked.
create table if not exists public.p2p_kingdom_win_translations (
  id            uuid primary key default gen_random_uuid(),
  content_hash  text not null,
  english_text  text not null check (char_length(english_text) <= 20000),
  provider      text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_p2p_kingdom_win_translations_hash on public.p2p_kingdom_win_translations(content_hash, created_at desc);
alter table public.p2p_kingdom_win_translations enable row level security;
revoke all on table public.p2p_kingdom_win_translations from public, anon, authenticated, service_role;
grant select, insert on table public.p2p_kingdom_win_translations to service_role;

-- The exact text that is screened (and hashed): title, story, lesson and the
-- guided sections in key order. One definition, used by the guard and the API.
create or replace function public.p2p_kingdom_win_screening_text(p_title text, p_body text, p_lesson text, p_guided jsonb)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select concat_ws(' ', p_title, p_body, p_lesson,
    (select string_agg(value, ' ' order by key) from jsonb_each_text(coalesce(p_guided, '{}'::jsonb))));
$$;
revoke all on function public.p2p_kingdom_win_screening_text(text, text, text, jsonb) from public, anon, authenticated, service_role;

-- True when the text is probably not English: it contains letters outside
-- ASCII (another script, or accented letters), or — for 4+ words of plain
-- ASCII — fewer than 20% of the words are common English words. Emoji,
-- typographic punctuation and symbols are ignored. A heuristic: an English
-- post that trips it is simply translated (harmless); a non-English post that
-- slips past it is still screened by the original-text rules.
create or replace function public.p2p_kingdom_win_needs_translation(p_text text)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_rest text;
  v_word text;
  v_total integer := 0;
  v_english integer := 0;
  v_common constant text[] := array[
    'the','and','to','of','a','i','my','in','is','was','it','me','for','that','god','he','with','his','you','we','our','on',
    'have','had','but','not','this','be','at','from','they','after','when','so','by','are','were','as','her','she','him',
    'them','their','all','an','will','can','just','what','who','lord','jesus','prayed','prayer','pray','healed','life',
    'family','church','did','do','has','been','now','then','there','because','into','out','up','your','us','about','how',
    'every','through','day','days','years','faith','thank','thanks','praise','amen','christ','holy','spirit','bible','blessed'];
begin
  if p_text is null or btrim(p_text) = '' then return false; end if;
  v_rest := regexp_replace(p_text,
    '[\x01-\x7F -¿×÷ -⯿　-〿︀-️\U0001F000-\U0001FAFF]', '', 'g');
  if v_rest <> '' then return true; end if;
  foreach v_word in array regexp_split_to_array(lower(p_text), '[^a-z'']+') loop
    if v_word <> '' then
      v_total := v_total + 1;
      if v_word = any(v_common) then v_english := v_english + 1; end if;
    end if;
  end loop;
  if v_total < 4 then return false; end if;
  return v_english::numeric / v_total < 0.2;
end;
$$;
revoke all on function public.p2p_kingdom_win_needs_translation(text) from public, anon, authenticated, service_role;

-- For the API (service_role only): the text to translate, its hash and
-- whether translation is needed — computed by the same functions the guard uses.
create or replace function public.p2p_kingdom_win_screening_input(p_title text, p_body text, p_lesson text, p_guided jsonb)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('text', t, 'hash', encode(sha256(convert_to(t, 'UTF8')), 'hex'),
                            'needsTranslation', public.p2p_kingdom_win_needs_translation(t))
  from (select public.p2p_kingdom_win_screening_text(p_title, p_body, p_lesson, p_guided) as t) s;
$$;
revoke all on function public.p2p_kingdom_win_screening_input(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.p2p_kingdom_win_screening_input(text, text, text, jsonb) to service_role;

-- ── 4. Posting restrictions (no prior user-restriction system exists) ────────
create table if not exists public.p2p_kingdom_win_restrictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.p2p_profiles(id) on delete cascade,
  reason      text not null check (char_length(btrim(reason)) between 3 and 1000),
  imposed_by  uuid references public.p2p_profiles(id) on delete set null,
  imposed_at  timestamptz not null default now(),
  expires_at  timestamptz,                -- null = until lifted
  lifted_at   timestamptz,
  lifted_by   uuid references public.p2p_profiles(id) on delete set null,
  lift_reason text,
  check (expires_at is null or expires_at > imposed_at),
  check ((lifted_at is null) = (lift_reason is null))
);
create index if not exists idx_p2p_kingdom_win_restrictions_user on public.p2p_kingdom_win_restrictions(user_id, imposed_at desc);
alter table public.p2p_kingdom_win_restrictions enable row level security;
revoke all on table public.p2p_kingdom_win_restrictions from public, anon, authenticated, service_role;
grant select on table public.p2p_kingdom_win_restrictions to authenticated;
drop policy if exists "Wins moderators read posting restrictions" on public.p2p_kingdom_win_restrictions;
create policy "Wins moderators read posting restrictions" on public.p2p_kingdom_win_restrictions
  for select to authenticated using (public.p2p_is_wins_moderator());

-- A restriction is a record: only the lift fields may be filled, once.
create or replace function public.p2p_kingdom_win_restriction_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.lifted_at is not null
     or (new.id, new.user_id, new.reason, new.imposed_by, new.imposed_at, new.expires_at)
        is distinct from (old.id, old.user_id, old.reason, old.imposed_by, old.imposed_at, old.expires_at) then
    raise exception 'wins_restriction_immutable' using errcode = 'W0409';
  end if;
  return new;
end;
$$;
revoke all on function public.p2p_kingdom_win_restriction_immutable() from public, anon, authenticated, service_role;
drop trigger if exists trg_p2p_kingdom_win_restriction_immutable on public.p2p_kingdom_win_restrictions;
create trigger trg_p2p_kingdom_win_restriction_immutable
  before update on public.p2p_kingdom_win_restrictions
  for each row execute function public.p2p_kingdom_win_restriction_immutable();

-- Active = not lifted and not expired, by database time.
create or replace function public.p2p_wins_restriction_active(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.p2p_kingdom_win_restrictions
    where user_id = p_user_id and lifted_at is null and (expires_at is null or expires_at > now())
  );
$$;
revoke all on function public.p2p_wins_restriction_active(uuid) from public, anon, authenticated, service_role;

create or replace function public.p2p_wins_restrict_user(p_user_id uuid, p_reason text, p_expires_at timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target_role text;
  v_row public.p2p_kingdom_win_restrictions;
begin
  if v_actor is null then raise exception 'wins_unauthenticated' using errcode = 'W0401'; end if;
  if not public.p2p_is_wins_moderator() then raise exception 'wins_forbidden' using errcode = 'W0403'; end if;
  if p_user_id = v_actor then raise exception 'wins_cannot_restrict_self' using errcode = 'W0403'; end if;
  select role::text into v_target_role from public.p2p_profiles where id = p_user_id;
  if not found then raise exception 'wins_user_missing' using errcode = 'W0404'; end if;
  if v_target_role in ('moderator', 'admin_moderation', 'admin_supervisor', 'super_admin')
     and (select role::text from public.p2p_profiles where id = v_actor) <> 'super_admin' then
    raise exception 'wins_cannot_restrict_moderator' using errcode = 'W0403';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'wins_reason_required' using errcode = 'W0422';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() + interval '1 minute' or p_expires_at > now() + interval '5 years') then
    raise exception 'wins_invalid_expiry' using errcode = 'W0422';
  end if;
  insert into public.p2p_kingdom_win_restrictions (user_id, reason, imposed_by, expires_at)
  values (p_user_id, btrim(p_reason), v_actor, p_expires_at)
  returning * into v_row;
  perform public.p2p_wins_log_admin_action('kingdom_win.restriction_imposed', p_user_id, v_row.id, 'kingdom_win_restriction',
    jsonb_build_object('reason', v_row.reason, 'expires_at', v_row.expires_at));
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.p2p_wins_restrict_user(uuid, text, timestamptz) from public, anon, service_role;
grant execute on function public.p2p_wins_restrict_user(uuid, text, timestamptz) to authenticated;

create or replace function public.p2p_wins_lift_restriction(p_restriction_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.p2p_kingdom_win_restrictions;
begin
  if v_actor is null then raise exception 'wins_unauthenticated' using errcode = 'W0401'; end if;
  if not public.p2p_is_wins_moderator() then raise exception 'wins_forbidden' using errcode = 'W0403'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'wins_reason_required' using errcode = 'W0422';
  end if;
  select * into v_row from public.p2p_kingdom_win_restrictions where id = p_restriction_id for update;
  if not found then raise exception 'wins_restriction_missing' using errcode = 'W0404'; end if;
  if v_row.lifted_at is not null or (v_row.expires_at is not null and v_row.expires_at <= now()) then
    raise exception 'wins_restriction_not_active' using errcode = 'W0409';
  end if;
  update public.p2p_kingdom_win_restrictions
     set lifted_at = now(), lifted_by = v_actor, lift_reason = btrim(p_reason)
   where id = p_restriction_id
  returning * into v_row;
  perform public.p2p_wins_log_admin_action('kingdom_win.restriction_lifted', v_row.user_id, v_row.id, 'kingdom_win_restriction',
    jsonb_build_object('reason', v_row.lift_reason));
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.p2p_wins_lift_restriction(uuid, text) from public, anon, service_role;
grant execute on function public.p2p_wins_lift_restriction(uuid, text) to authenticated;

-- The signed-in member's own status: restricted + until (null = until
-- lifted). No reason, no moderator identity.
create or replace function public.p2p_my_wins_posting_status()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'restricted', count(*) > 0,
    'until', case when count(*) = 0 or bool_or(expires_at is null) then null else max(expires_at) end)
  from public.p2p_kingdom_win_restrictions
  where user_id = auth.uid() and lifted_at is null and (expires_at is null or expires_at > now());
$$;
revoke all on function public.p2p_my_wins_posting_status() from public, anon, service_role;
grant execute on function public.p2p_my_wins_posting_status() to authenticated;

-- ── 5. The write guard on p2p_kingdom_wins ───────────────────────────────────
create or replace function public.p2p_kingdom_win_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_is_mod boolean;
  v_is_reviewer boolean;
  v_is_author boolean;
  v_content_changed boolean;
  v_entering_public boolean;
  v_text text;
  v_screen jsonb;
  v_screen_en jsonb;
  v_translation jsonb;
  v_tr_id uuid;
  v_tr_text text;
  v_tr_provider text;
  v_categories text;
begin
  -- Account deletion (FK ON DELETE SET NULL): only author_id changes.
  if tg_op = 'UPDATE' and old.author_id is not null and new.author_id is null
     and (to_jsonb(new) - 'author_id') = (to_jsonb(old) - 'author_id') then
    return new;
  end if;

  -- Trusted server paths (no session user). The consent rule still holds.
  if v_actor is null then
    if new.entry_type = 'p2p_impact' and new.status = 'published' and new.consent_confirmed_at is null
       and (tg_op = 'INSERT' or old.status is distinct from 'published') then
      raise exception 'wins_consent_required' using errcode = 'W0422';
    end if;
    return new;
  end if;

  select role::text into v_role from public.p2p_profiles where id = v_actor;
  v_is_mod := coalesce(v_role in ('moderator', 'admin_moderation', 'admin_supervisor', 'super_admin'), false);
  v_is_reviewer := v_is_mod or coalesce(v_role = 'admin_content', false);

  if tg_op = 'INSERT' then
    if new.author_id is distinct from v_actor then raise exception 'wins_not_owner' using errcode = 'W0403'; end if;
    if new.status not in ('draft', 'submitted', 'published') then raise exception 'wins_invalid_status' using errcode = 'W0409'; end if;
    -- Server-managed fields: never taken from the client.
    new.moderation_note := null; new.moderation_hold := false; new.screening := null;
    new.created_at := now(); new.updated_at := now();
    new.submitted_at := null; new.published_at := null; new.archived_at := null;
    if new.consent_confirmed_at is not null then new.consent_confirmed_at := now(); end if;
    v_is_author := true;
    v_content_changed := true;
  else
    if new.id is distinct from old.id or new.author_id is distinct from old.author_id then
      raise exception 'wins_not_owner' using errcode = 'W0403';
    end if;
    new.created_at := old.created_at; new.updated_at := now();
    new.submitted_at := old.submitted_at; new.published_at := old.published_at; new.archived_at := old.archived_at;
    -- coalesce: a post whose author deleted their account (author_id null)
    -- has no author — a NULL here would wrongly skip the moderator rules.
    v_is_author := coalesce(old.author_id = v_actor, false);
    v_content_changed :=
      (new.title, new.body, new.lesson_learned, new.guided_sections, new.category, new.impact_themes, new.scripture_reference_id,
       new.mission_story_id, new.mission_field_id, new.prayer2_request_id, new.media_type, new.media_path,
       new.media_duration_seconds, new.is_anonymous, new.visibility, new.entry_type)
      is distinct from
      (old.title, old.body, old.lesson_learned, old.guided_sections, old.category, old.impact_themes, old.scripture_reference_id,
       old.mission_story_id, old.mission_field_id, old.prayer2_request_id, old.media_type, old.media_path,
       old.media_duration_seconds, old.is_anonymous, old.visibility, old.entry_type);

    if not v_is_author then
      -- Moderation of someone else's entry: status and moderation fields only.
      if not v_is_reviewer then raise exception 'wins_forbidden' using errcode = 'W0403'; end if;
      if v_content_changed or new.consent_confirmed_at is distinct from old.consent_confirmed_at
         or new.screening is distinct from old.screening then
        raise exception 'wins_moderator_content_edit' using errcode = 'W0403';
      end if;
      if not v_is_mod then
        -- P2P Impact reviewer: approve/reject a pending, unheld P2P Impact submission.
        if not (old.entry_type = 'p2p_impact' and old.status = 'submitted' and not old.moderation_hold
                and new.status in ('published', 'rejected') and new.moderation_hold = old.moderation_hold) then
          raise exception 'wins_forbidden' using errcode = 'W0403';
        end if;
      end if;
      if new.status = 'published' then
        if new.entry_type = 'p2p_impact' and new.consent_confirmed_at is null then
          raise exception 'wins_consent_required' using errcode = 'W0422';
        end if;
        new.moderation_hold := false;   -- a moderator's approval releases a screening hold
      end if;
      if new.status in ('submitted', 'published') and new.submitted_at is null then new.submitted_at := now(); end if;
      if new.status = 'published' and old.status <> 'published' then new.published_at := now(); end if;
      if new.status = 'archived' and new.archived_at is null then new.archived_at := now(); end if;
      if (new.status, new.moderation_hold, new.moderation_note) is distinct from (old.status, old.moderation_hold, old.moderation_note) then
        perform public.p2p_wins_log_admin_action('kingdom_win.' || case when new.status <> old.status then new.status else 'moderation_updated' end,
          old.author_id, old.id, 'kingdom_win',
          jsonb_build_object('from', old.status, 'to', new.status, 'note', new.moderation_note,
                             'hold_released', old.moderation_hold and not new.moderation_hold));
      end if;
      return new;
    end if;

    -- Author editing their own entry.
    if old.status = 'removed' then raise exception 'wins_removed_locked' using errcode = 'W0403'; end if;
    if (new.moderation_note, new.moderation_hold, new.screening) is distinct from (old.moderation_note, old.moderation_hold, old.screening) then
      raise exception 'wins_moderation_fields' using errcode = 'W0403';
    end if;
    if new.status not in ('draft', 'submitted', 'published', 'archived') then
      raise exception 'wins_invalid_status' using errcode = 'W0409';
    end if;
    if new.entry_type is distinct from old.entry_type and old.status <> 'draft' then
      raise exception 'wins_invalid_transition' using errcode = 'W0409';
    end if;
    if old.status = 'rejected' and new.status not in ('draft', 'submitted', 'rejected') then
      raise exception 'wins_resubmit_for_review' using errcode = 'W0409';
    end if;
    if old.moderation_hold and new.status = 'published' then
      raise exception 'wins_held_for_review' using errcode = 'W0409';
    end if;
    -- Consent is given once by the author; never withdrawn or back-dated.
    if old.consent_confirmed_at is not null then new.consent_confirmed_at := old.consent_confirmed_at;
    elsif new.consent_confirmed_at is not null then new.consent_confirmed_at := now(); end if;
    -- An approved P2P Impact entry whose content the author changes goes back to review.
    if new.entry_type = 'p2p_impact' and old.status = 'published' and new.status = 'published' and v_content_changed then
      new.status := 'submitted';
    end if;
  end if;

  -- ── Author rules (insert, and update of one's own entry) ──
  if new.entry_type = 'p2p_impact' and new.status = 'published'
     and (tg_op = 'INSERT' or old.status <> 'published') then
    raise exception 'wins_impact_requires_review' using errcode = 'W0409';
  end if;
  if new.media_path is not null and (tg_op = 'INSERT' or new.media_path is distinct from old.media_path) then
    if split_part(new.media_path, '/', 1) <> new.author_id::text or split_part(new.media_path, '/', 2) <> new.id::text then
      raise exception 'wins_media_not_owned' using errcode = 'W0403';
    end if;
  end if;
  if new.prayer2_request_id is not null and (tg_op = 'INSERT' or new.prayer2_request_id is distinct from old.prayer2_request_id) then
    if not exists (select 1 from public.p2p_prayer_coord_requests where id = new.prayer2_request_id and user_id = new.author_id) then
      raise exception 'wins_link_not_owned' using errcode = 'W0403';
    end if;
  end if;

  v_entering_public := new.status in ('submitted', 'published') and (tg_op = 'INSERT' or old.status not in ('submitted', 'published'));
  if new.status in ('submitted', 'published') and (v_entering_public or v_content_changed) then
    if public.p2p_wins_restriction_active(new.author_id) then
      raise exception 'wins_posting_restricted' using errcode = 'W0423';
    end if;
    if new.entry_type = 'p2p_impact' and new.consent_confirmed_at is null then
      raise exception 'wins_consent_required' using errcode = 'W0422';
    end if;
    v_text := public.p2p_kingdom_win_screening_text(new.title, new.body, new.lesson_learned, new.guided_sections);
    v_screen := public.p2p_kingdom_win_screen(v_text);
    v_translation := null;
    if public.p2p_kingdom_win_needs_translation(v_text) then
      -- Server-recorded translation of exactly this text (recent, single use).
      select id, english_text, provider into v_tr_id, v_tr_text, v_tr_provider
        from public.p2p_kingdom_win_translations
       where content_hash = encode(sha256(convert_to(v_text, 'UTF8')), 'hex') and created_at > now() - interval '30 minutes'
       order by created_at desc limit 1;
      if v_tr_id is not null then
        v_screen_en := public.p2p_kingdom_win_screen(v_tr_text);
        v_screen := jsonb_build_object(
          'action', case when 'reject' in (v_screen->>'action', v_screen_en->>'action') then 'reject'
                         when 'hold' in (v_screen->>'action', v_screen_en->>'action') then 'hold' else 'allow' end,
          'hits', (v_screen->'hits') || coalesce((select jsonb_agg(h || '{"translated": true}'::jsonb) from jsonb_array_elements(v_screen_en->'hits') h), '[]'::jsonb),
          'rulesVersion', v_screen->'rulesVersion');
        v_translation := jsonb_build_object('text', v_tr_text, 'provider', v_tr_provider);
        delete from public.p2p_kingdom_win_translations where id = v_tr_id or created_at < now() - interval '1 day';
      else
        -- Could not be checked in English: never published unchecked.
        v_screen := jsonb_build_object(
          'action', case when v_screen->>'action' = 'reject' then 'reject' else 'hold' end,
          'hits', (v_screen->'hits') || '[{"rule": "translation_unavailable", "category": "translation", "action": "hold"}]'::jsonb,
          'rulesVersion', v_screen->'rulesVersion');
      end if;
      v_screen := v_screen || jsonb_build_object('translation', v_translation);
    end if;
    if v_screen->>'action' = 'reject' then
      raise exception '%', 'wins_content_rejected:' || coalesce(
        (select h->>'category' from jsonb_array_elements(v_screen->'hits') h where h->>'action' = 'reject' limit 1), 'policy')
        using errcode = 'W0422';
    elsif v_screen->>'action' = 'hold' then
      new.screening := v_screen;
      if new.status = 'published' then new.status := 'submitted'; end if;
      if tg_op = 'INSERT' or not old.moderation_hold then
        select string_agg(distinct h->>'category', ', ') into v_categories from jsonb_array_elements(v_screen->'hits') h;
        insert into public.p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
        values ('kingdom_win', new.id, new.author_id, null, 'Automated screening: held for review (' || v_categories || ')',
                left(coalesce(new.title, '') || E'\n\n' || coalesce(new.body, '')
                     || coalesce(E'\n\n[English translation]\n' || (v_translation->>'text'), ''), 2000));
      end if;
      new.moderation_hold := true;
    elsif not coalesce(new.moderation_hold, false) then
      -- Clean. Keep the English translation (staff-only) for later reports.
      new.screening := case when v_translation is not null
        then jsonb_build_object('action', 'allow', 'translation', v_translation) else null end;
    end if;
  end if;

  if new.status in ('submitted', 'published') and new.submitted_at is null then new.submitted_at := now(); end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then new.published_at := now(); end if;
  if new.status = 'archived' and new.archived_at is null then new.archived_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.p2p_kingdom_win_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_p2p_kingdom_win_guard on public.p2p_kingdom_wins;
create trigger trg_p2p_kingdom_win_guard
  before insert or update on public.p2p_kingdom_wins
  for each row execute function public.p2p_kingdom_win_guard();

-- ── 6. Row-level security: least privilege for reading/moderating Wins ──────
-- (was p2p_is_admin(): every role except student)
drop policy if exists "Published kingdom wins are public, own always visible" on public.p2p_kingdom_wins;
create policy "Published kingdom wins are public, own always visible" on public.p2p_kingdom_wins
  for select using (
    (status = 'published' and visibility = 'p2p_network')
    or author_id = auth.uid()
    or public.p2p_is_wins_moderator()
    or (entry_type = 'p2p_impact' and public.p2p_is_impact_reviewer())
  );
drop policy if exists "Authors manage their own kingdom wins" on public.p2p_kingdom_wins;
create policy "Authors manage their own kingdom wins" on public.p2p_kingdom_wins
  for update using (
    author_id = auth.uid() or public.p2p_is_wins_moderator() or (entry_type = 'p2p_impact' and public.p2p_is_impact_reviewer())
  ) with check (
    (author_id = auth.uid() and status in ('draft', 'submitted', 'published', 'archived'))
    or public.p2p_is_wins_moderator()
    or (entry_type = 'p2p_impact' and public.p2p_is_impact_reviewer())
  );
drop policy if exists "Reactions visible with their kingdom win" on public.p2p_kingdom_win_reactions;
create policy "Reactions visible with their kingdom win" on public.p2p_kingdom_win_reactions
  for select using (
    exists (
      select 1 from public.p2p_kingdom_wins w
      where w.id = kingdom_win_id
        and ((w.status = 'published' and w.visibility = 'p2p_network') or w.author_id = auth.uid() or public.p2p_is_wins_moderator())
    )
  );
drop policy if exists "Admins read all kingdom win media" on storage.objects;
create policy "Admins read all kingdom win media" on storage.objects
  for select using (
    bucket_id = 'kingdom-wins-media' and (
      public.p2p_is_wins_moderator()
      or (public.p2p_is_impact_reviewer() and exists (
            select 1 from public.p2p_kingdom_wins w where w.id::text = split_part(name, '/', 2) and w.entry_type = 'p2p_impact'))
    )
  );

-- ── 7. Reports: admin_moderation can work the queue; Wins reports are Wins-moderator-only ──
drop policy if exists "content_flags_select_moderation" on public.p2p_content_flags;
create policy "content_flags_select_moderation" on public.p2p_content_flags for select to authenticated
using (
  reporter_id = auth.uid()
  or (content_type <> 'kingdom_win' and p2p_current_role()::text in ('moderator', 'church_leader', 'regional_admin', 'super_admin', 'admin_moderation'))
  or (content_type = 'kingdom_win' and public.p2p_is_wins_moderator())
);

create or replace function public.p2p_flag_poster_identity(p_user_id uuid)
returns table (
  id uuid, full_name text, avatar_url text, total_flags bigint, dismissed_count bigint,
  warned_count bigint, removed_count bigint, escalated_count bigint
)
language plpgsql security definer
set search_path = public, pg_temp
stable
as $$
begin
  if p2p_current_role()::text not in ('moderator', 'church_leader', 'regional_admin', 'super_admin', 'admin_moderation')
     and not public.p2p_is_wins_moderator() then
    raise exception 'not permitted';
  end if;
  return query
  select p.id, p.full_name, p.photo_url,
    count(f.id) as total_flags,
    count(f.id) filter (where f.status = 'dismissed') as dismissed_count,
    count(f.id) filter (where f.status = 'warned') as warned_count,
    count(f.id) filter (where f.status = 'removed') as removed_count,
    count(f.id) filter (where f.status = 'escalated') as escalated_count
  from p2p_profiles p
  left join p2p_content_flags f on f.author_id = p.id
  where p.id = p_user_id
  group by p.id, p.full_name, p.photo_url;
end;
$$;
revoke all on function public.p2p_flag_poster_identity(uuid) from public, anon;
grant execute on function public.p2p_flag_poster_identity(uuid) to authenticated;

-- Same actions as 150; changes: admin_moderation may resolve reports; Kingdom
-- Wins reports need a Wins moderator; nobody resolves a report about their
-- own content; every resolution is written to the admin activity log.
create or replace function public.p2p_moderate_flag(p_flag_id uuid, p_action text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_flag p2p_content_flags%rowtype;
  v_help_request_id uuid;
  v_new_status text;
begin
  if not (p2p_current_role()::text in ('moderator', 'church_leader', 'regional_admin', 'super_admin', 'admin_moderation')
          or public.p2p_is_wins_moderator()) then
    raise exception 'not permitted';
  end if;
  if p_action not in ('dismiss', 'warn', 'remove', 'escalate') then
    raise exception 'invalid action';
  end if;

  select * into v_flag from p2p_content_flags where id = p_flag_id;
  if v_flag.id is null then
    raise exception 'flag not found';
  end if;
  if v_flag.content_type = 'kingdom_win' then
    if not public.p2p_is_wins_moderator() then raise exception 'not permitted'; end if;
  elsif p2p_current_role()::text not in ('moderator', 'church_leader', 'regional_admin', 'super_admin', 'admin_moderation') then
    raise exception 'not permitted';
  end if;
  if v_flag.author_id = auth.uid() then
    raise exception 'not permitted: a report about your own content must be resolved by another moderator';
  end if;

  if p_action = 'remove' then
    if v_flag.content_type = 'prayer_post' then
      delete from p2p_prayer_wall_posts where id = v_flag.content_id;
    elsif v_flag.content_type = 'prayer_comment' then
      delete from p2p_prayer_wall_comments where id = v_flag.content_id;
    elsif v_flag.content_type = 'message' then
      delete from p2p_messages where id = v_flag.content_id;
    elsif v_flag.content_type = 'prayer_testimony' then
      update p2p_prayer_testimonies set moderation_status = 'removed', updated_at = now() where id = v_flag.content_id;
    elsif v_flag.content_type = 'mission_story' then
      update p2p_mission_stories set status = 'removed', updated_at = now() where id = v_flag.content_id;
    elsif v_flag.content_type = 'kingdom_win' then
      update p2p_kingdom_wins set status = 'removed' where id = v_flag.content_id;
    else -- 'profile'
      update p2p_profiles set avatar_url = null, bio = null where id = v_flag.content_id;
    end if;
    v_new_status := 'removed';
  elsif p_action = 'escalate' then
    insert into p2p_help_requests (user_id, tier, category, note, status)
    values (
      v_flag.author_id,
      'struggling',
      'Moderation Escalation',
      coalesce(p_note, 'Escalated from content flag: ' || coalesce(v_flag.content_snapshot, '')),
      'open'
    )
    returning id into v_help_request_id;
    v_new_status := 'escalated';
  elsif p_action = 'warn' then
    v_new_status := 'warned';
  else
    v_new_status := 'dismissed';
  end if;

  update p2p_content_flags
  set status = v_new_status,
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_note = p_note,
      escalation_help_request_id = v_help_request_id
  where id = p_flag_id;

  perform public.p2p_wins_log_admin_action('moderation.flag_' || v_new_status, v_flag.author_id, v_flag.id, 'content_flag',
    jsonb_build_object('content_type', v_flag.content_type, 'content_id', v_flag.content_id, 'note', p_note));
end;
$$;
revoke all on function public.p2p_moderate_flag(uuid, text, text) from public, anon;
grant execute on function public.p2p_moderate_flag(uuid, text, text) to authenticated;

-- Same as 150, except a Kingdom Win report also carries the post's automatic
-- English translation (when it has one), so moderators can read reports about
-- posts in any language.
create or replace function public.p2p_report_content(p_content_type text, p_content_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_author_id uuid;
  v_snapshot text;
  v_flag_id uuid;
  v_conversation_id uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if p_content_type not in ('prayer_post', 'prayer_comment', 'message', 'profile', 'prayer_testimony', 'mission_story', 'kingdom_win') then
    raise exception 'invalid content type';
  end if;

  if p_content_type = 'prayer_post' then
    select user_id, body into v_author_id, v_snapshot from p2p_prayer_wall_posts where id = p_content_id;
  elsif p_content_type = 'prayer_comment' then
    select user_id, body into v_author_id, v_snapshot from p2p_prayer_wall_comments where id = p_content_id;
  elsif p_content_type = 'message' then
    select sender_id, body, conversation_id into v_author_id, v_snapshot, v_conversation_id
      from p2p_messages where id = p_content_id;
    if v_author_id is not null and not p2p_is_conversation_member(v_conversation_id, me) then
      raise exception 'not permitted to report this message';
    end if;
  elsif p_content_type = 'prayer_testimony' then
    select user_id, testimony_text into v_author_id, v_snapshot from p2p_prayer_testimonies where id = p_content_id;
  elsif p_content_type = 'mission_story' then
    select author_id, body into v_author_id, v_snapshot from p2p_mission_stories where id = p_content_id;
  elsif p_content_type = 'kingdom_win' then
    select author_id, body || coalesce(E'\n\n[English translation]\n' || (screening->'translation'->>'text'), '')
      into v_author_id, v_snapshot from p2p_kingdom_wins where id = p_content_id;
  else -- 'profile'
    if p_content_id = me then
      raise exception 'cannot report your own profile';
    end if;
    select id, bio into v_author_id, v_snapshot from p2p_profiles where id = p_content_id;
  end if;

  if v_author_id is null then
    raise exception 'content not found';
  end if;

  insert into p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
  values (p_content_type, p_content_id, v_author_id, me, p_reason, v_snapshot)
  returning id into v_flag_id;

  return v_flag_id;
end;
$$;
revoke all on function public.p2p_report_content(text, uuid, text) from public, anon;
grant execute on function public.p2p_report_content(text, uuid, text) to authenticated;
