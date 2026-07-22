-- 036: Peer Confirmation System — unlocks the 6 Community fruits seeded in
-- migration 032 (Fellowship, Encouragement, Compassion, Service, Unity, Global)
-- that have had no award mechanism until now.
--
-- Numbering note: the spec that produced this asked for "034", but 034 and
-- 035 were already taken by the fruit-system realtime and dashboard
-- migrations from the same feature build — this is 036, the real next number.
--
-- Architecture note (read before assuming this should route through
-- artifacts/api-server): this app's real evaluation/lesson-progress/fruit
-- flows NEVER go through the Express api-server — they go client → Supabase
-- directly, with RLS + SECURITY DEFINER triggers doing any cross-user write
-- (confirmed by reading evaluations.ts, which is nearly empty, and
-- DataContext.tsx's resolveEvaluation(), which calls supabase directly).
-- Building this as new Express routes would be dead code the app never
-- calls. Instead: confirmation rows are created by DB triggers on the exact
-- tables the client already writes to (p2p_lesson_evaluations feedback,
-- p2p_prayer_wall_reactions, p2p_sessions completion) — no client code needs
-- to change to originate them, only to display/act on them (see the mobile
-- changes in this same commit for confirmations.tsx and DataContext).

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists p2p_peer_confirmations (
  id                  uuid primary key default uuid_generate_v4(),
  confirmation_type   text not null check (confirmation_type in ('encouragement', 'compassion', 'service', 'fellowship', 'unity', 'global')),
  actor_user_id       uuid not null references p2p_profiles(id) on delete cascade,
  confirmer_user_id   uuid not null references p2p_profiles(id) on delete cascade,
  source_type         text check (source_type in ('evaluation_feedback', 'prayer', 'session', 'message')),
  source_id           uuid,
  confirmation_status text not null default 'pending' check (confirmation_status in ('pending', 'confirmed', 'declined', 'expired')),
  confirmation_message text,
  actor_notified      boolean not null default false,
  created_at          timestamptz not null default now(),
  confirmed_at        timestamptz,
  expires_at          timestamptz,
  unique (confirmation_type, actor_user_id, confirmer_user_id, source_id)
);

create index if not exists idx_p2p_peer_confirmations_confirmer on p2p_peer_confirmations(confirmer_user_id, confirmation_status);
create index if not exists idx_p2p_peer_confirmations_actor on p2p_peer_confirmations(actor_user_id, confirmation_type, confirmation_status);

create table if not exists p2p_peer_confirmation_audit (
  id                uuid primary key default uuid_generate_v4(),
  confirmation_id   uuid references p2p_peer_confirmations(id) on delete cascade,
  event             text not null check (event in ('created', 'confirmed', 'declined', 'expired', 'fruit_awarded')),
  performed_by      uuid references p2p_profiles(id),
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_peer_confirmations enable row level security;
alter table p2p_peer_confirmation_audit enable row level security;

drop policy if exists "Users can read own confirmations" on p2p_peer_confirmations;
create policy "Users can read own confirmations" on p2p_peer_confirmations
  for select using (auth.uid() = actor_user_id or auth.uid() = confirmer_user_id or p2p_is_admin());

-- Only the confirmer may act on their own pending confirmation. In practice
-- the mobile app calls p2p_process_confirmation()/p2p_decline_confirmation()
-- (SECURITY DEFINER) rather than updating this row directly, but this policy
-- stands as the real enforcement boundary regardless of call path.
drop policy if exists "Confirmer can update status" on p2p_peer_confirmations;
create policy "Confirmer can update status" on p2p_peer_confirmations
  for update using (auth.uid() = confirmer_user_id) with check (auth.uid() = confirmer_user_id);

-- No general insert policy for authenticated users — every row here is
-- created by a SECURITY DEFINER trigger (see below), same pattern as every
-- other cross-user write in this app.
drop policy if exists "Admins can manage confirmations" on p2p_peer_confirmations;
create policy "Admins can manage confirmations" on p2p_peer_confirmations
  for all using (p2p_is_admin()) with check (p2p_is_admin());

drop policy if exists "Admins can read confirmation audit" on p2p_peer_confirmation_audit;
create policy "Admins can read confirmation audit" on p2p_peer_confirmation_audit
  for select using (p2p_is_admin());

-- ── Core processing functions ────────────────────────────────────────────────

create or replace function p2p_process_confirmation(p_confirmation_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_conf p2p_peer_confirmations%rowtype;
  v_awarded boolean;
  v_fruit_key text;
  v_confirmed_count int;
begin
  select * into v_conf from p2p_peer_confirmations
  where id = p_confirmation_id and confirmation_status = 'pending' and confirmer_user_id = auth.uid();
  if not found then
    return null;
  end if;

  update p2p_peer_confirmations set confirmation_status = 'confirmed', confirmed_at = now()
  where id = p_confirmation_id;

  insert into p2p_peer_confirmation_audit (confirmation_id, event, performed_by, metadata)
  values (p_confirmation_id, 'confirmed', v_conf.confirmer_user_id, '{}'::jsonb);

  if v_conf.confirmation_type = 'encouragement' then
    select count(*) into v_confirmed_count from p2p_peer_confirmations
    where confirmation_type = 'encouragement' and actor_user_id = v_conf.actor_user_id and confirmation_status = 'confirmed';

    perform p2p_update_fruit_progress(v_conf.actor_user_id, 'encouragement_fruit', v_confirmed_count, 5,
      jsonb_build_object('confirmed_count', v_confirmed_count));

    if v_confirmed_count >= 5 then
      v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'encouragement_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', v_confirmed_count || ' peers confirmed your encouragement genuinely helped them.'));
      if v_awarded then v_fruit_key := 'encouragement_fruit'; end if;
    end if;

  elsif v_conf.confirmation_type = 'compassion' then
    v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'compassion_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
      jsonb_build_object('summary', 'A peer confirmed you prayed with them.'));
    if v_awarded then v_fruit_key := 'compassion_fruit'; end if;

  elsif v_conf.confirmation_type = 'service' then
    v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'service_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
      jsonb_build_object('summary', 'A mentee confirmed your guidance helped them through a lesson.'));
    if v_awarded then v_fruit_key := 'service_fruit'; end if;

  elsif v_conf.confirmation_type = 'fellowship' then
    -- Fellowship requires BOTH directions confirmed (each participant
    -- confirming the other's participation) before either side earns it.
    if exists (
      select 1 from p2p_peer_confirmations
      where confirmation_type = 'fellowship' and source_id = v_conf.source_id
        and actor_user_id = v_conf.confirmer_user_id and confirmer_user_id = v_conf.actor_user_id
        and confirmation_status = 'confirmed'
    ) then
      v_awarded := p2p_award_fruit(v_conf.actor_user_id, 'fellowship_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', 'Both peers confirmed a real discussion session happened.'));
      if v_awarded then v_fruit_key := 'fellowship_fruit'; end if;
      perform p2p_award_fruit(v_conf.confirmer_user_id, 'fellowship_fruit', 'confirmation_confirmed', 'peer_action', p_confirmation_id,
        jsonb_build_object('summary', 'Both peers confirmed a real discussion session happened.'));
    end if;
  end if;

  if v_fruit_key is not null then
    insert into p2p_peer_confirmation_audit (confirmation_id, event, performed_by, metadata)
    values (p_confirmation_id, 'fruit_awarded', v_conf.confirmer_user_id, jsonb_build_object('fruit_key', v_fruit_key));
  end if;

  insert into p2p_notifications (user_id, title, message)
  values (
    v_conf.actor_user_id, 'Confirmed! 🙏',
    case v_conf.confirmation_type
      when 'encouragement' then 'A peer confirmed your encouragement genuinely helped them.'
      when 'compassion' then 'A peer confirmed you prayed with them.'
      when 'service' then 'A mentee confirmed your guidance helped them through a lesson.'
      when 'fellowship' then 'A peer confirmed your discussion session happened.'
      else 'Your action was confirmed.'
    end
  );

  return v_fruit_key;
end;
$$;

grant execute on function p2p_process_confirmation(uuid) to authenticated;

create or replace function p2p_decline_confirmation(p_confirmation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update p2p_peer_confirmations set confirmation_status = 'declined'
  where id = p_confirmation_id and confirmation_status = 'pending' and confirmer_user_id = auth.uid();

  insert into p2p_peer_confirmation_audit (confirmation_id, event, performed_by)
  select p_confirmation_id, 'declined', confirmer_user_id
  from p2p_peer_confirmations where id = p_confirmation_id and confirmer_user_id = auth.uid();
end;
$$;

grant execute on function p2p_decline_confirmation(uuid) to authenticated;

-- ── Trigger: encouragement (+ service, when the evaluator is an active
-- mentor) confirmation requests, created the moment real written feedback
-- lands on an evaluation — no client change needed, resolveEvaluation()
-- already writes feedback to this exact table. ──────────────────────────────
create or replace function p2p_create_encouragement_confirmation()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_is_mentor boolean;
  v_expires timestamptz := now() + interval '14 days';
begin
  if new.status in ('approved', 'needs_revision')
     and new.feedback is not null and length(trim(new.feedback)) > 20
     and new.evaluator_id <> new.submitter_id
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.feedback is distinct from new.feedback)
  then
    insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
    values ('encouragement', new.evaluator_id, new.submitter_id, 'evaluation_feedback', new.id, v_expires)
    on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

    select exists (
      select 1 from p2p_discipleship_links
      where mentor_id = new.evaluator_id and disciple_id = new.submitter_id and active = true
    ) into v_is_mentor;

    if v_is_mentor then
      insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
      values ('service', new.evaluator_id, new.submitter_id, 'evaluation_feedback', new.id, v_expires)
      on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;
    end if;

    insert into p2p_notifications (user_id, title, message)
    values (
      new.submitter_id, 'A peer left you encouragement',
      'Did their feedback genuinely help? Tap to confirm and help them earn a fruit.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_encouragement_confirmation on p2p_lesson_evaluations;
create trigger trg_create_encouragement_confirmation
  after insert or update of status, feedback on p2p_lesson_evaluations
  for each row execute function p2p_create_encouragement_confirmation();

-- ── Trigger: compassion confirmation, created the moment someone taps
-- "praying" on another user's real (non-self) prayer wall post. ─────────────
create or replace function p2p_create_compassion_confirmation()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_post_author uuid;
  v_expires timestamptz := now() + interval '14 days';
begin
  if new.reaction_type = 'praying' then
    select user_id into v_post_author from p2p_prayer_wall_posts where id = new.post_id;
    if v_post_author is not null and v_post_author <> new.user_id then
      insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
      values ('compassion', new.user_id, v_post_author, 'prayer', new.id, v_expires)
      on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

      insert into p2p_notifications (user_id, title, message)
      values (v_post_author, 'Someone prayed for you 🙏', 'Did you feel supported? Tap to confirm.');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_compassion_confirmation on p2p_prayer_wall_reactions;
create trigger trg_create_compassion_confirmation
  after insert on p2p_prayer_wall_reactions
  for each row execute function p2p_create_compassion_confirmation();

-- ── Global Fruit helper — distinct countries reached across this user's
-- completed peer sessions. ───────────────────────────────────────────────────
create or replace function p2p_check_global_fruit(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
  v_countries text;
begin
  select count(distinct p.country), string_agg(distinct p.country, ', ')
    into v_count, v_countries
  from p2p_sessions s
  join p2p_profiles p on p.id = (case when s.mentor_id = p_user_id then s.participant_id else s.mentor_id end)
  where (s.mentor_id = p_user_id or s.participant_id = p_user_id)
    and s.status = 'completed'
    and p.country is not null;

  if v_count >= 3 then
    perform p2p_award_fruit(p_user_id, 'global_fruit', 'session_completed', 'milestone', null,
      jsonb_build_object('summary', 'Peer sessions completed across ' || v_count || ' different countries: ' || coalesce(v_countries, '')));
  end if;
end;
$$;

-- ── Trigger: fellowship confirmations + direct Unity/Global fruit checks,
-- fired the moment a real 1:1 peer session (p2p_sessions.mentor_id /
-- participant_id) is marked completed. ──────────────────────────────────────
create or replace function p2p_handle_session_completion()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_mentor_country text;
  v_participant_country text;
  v_expires timestamptz := now() + interval '14 days';
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and new.mentor_id is not null and new.participant_id is not null
  then
    insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
    values ('fellowship', new.mentor_id, new.participant_id, 'session', new.id, v_expires)
    on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

    insert into p2p_peer_confirmations (confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, expires_at)
    values ('fellowship', new.participant_id, new.mentor_id, 'session', new.id, v_expires)
    on conflict (confirmation_type, actor_user_id, confirmer_user_id, source_id) do nothing;

    insert into p2p_notifications (user_id, title, message)
    values
      (new.participant_id, 'Confirm your peer session', 'Did this discussion session really happen? Tap to confirm.'),
      (new.mentor_id, 'Confirm your peer session', 'Did this discussion session really happen? Tap to confirm.');

    select country into v_mentor_country from p2p_profiles where id = new.mentor_id;
    select country into v_participant_country from p2p_profiles where id = new.participant_id;

    if v_mentor_country is not null and v_participant_country is not null and v_mentor_country <> v_participant_country then
      perform p2p_award_fruit(new.mentor_id, 'unity_fruit', 'session_completed', 'peer_action', new.id,
        jsonb_build_object('summary', 'Completed a peer session with someone from ' || v_participant_country || '.'));
      perform p2p_award_fruit(new.participant_id, 'unity_fruit', 'session_completed', 'peer_action', new.id,
        jsonb_build_object('summary', 'Completed a peer session with someone from ' || v_mentor_country || '.'));
    end if;

    perform p2p_check_global_fruit(new.mentor_id);
    perform p2p_check_global_fruit(new.participant_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_handle_session_completion on p2p_sessions;
create trigger trg_handle_session_completion
  after insert or update of status on p2p_sessions
  for each row execute function p2p_handle_session_completion();

-- ── p2p_sessions had RLS enabled with ZERO policies — the exact same
-- silent-block bug pattern already found once in this codebase (see
-- migration 007's note on p2p_notifications). Confirmed live: this made the
-- table completely unreadable/unwritable by any real user, masked the whole
-- time by session/[id].tsx falling back to mock data when the real query
-- came back empty. Without a real SELECT/UPDATE policy here, marking a
-- session complete (and therefore the entire Fellowship/Unity/Global path)
-- silently fails for every real user. ───────────────────────────────────────
drop policy if exists "Participants can view own sessions" on p2p_sessions;
create policy "Participants can view own sessions" on p2p_sessions
  for select using (auth.uid() = mentor_id or auth.uid() = participant_id or p2p_is_admin());

drop policy if exists "Participants can update own sessions" on p2p_sessions;
create policy "Participants can update own sessions" on p2p_sessions
  for update using (auth.uid() = mentor_id or auth.uid() = participant_id or p2p_is_admin())
  with check (auth.uid() = mentor_id or auth.uid() = participant_id or p2p_is_admin());

drop policy if exists "Participants can create own sessions" on p2p_sessions;
create policy "Participants can create own sessions" on p2p_sessions
  for insert with check (auth.uid() = mentor_id or auth.uid() = participant_id);

drop policy if exists "Admins manage sessions" on p2p_sessions;
create policy "Admins manage sessions" on p2p_sessions
  for all using (p2p_is_admin()) with check (p2p_is_admin());

-- ── Actor profile lookup for the confirmer's UI — p2p_profiles RLS
-- ("profiles_select_scoped", migration 015) only lets a user read another
-- profile if they share a group, are admin, or lead that person's
-- church/region. A confirmer often has no such relationship with the actor
-- (e.g. any peer evaluator, not just group-mates), so a direct client-side
-- profile read silently returns nothing and the UI falls back to "A fellow
-- disciple". Same fix pattern as p2p_get_submitter_evaluation_context (030):
-- a narrow SECURITY DEFINER lookup gated on a REAL confirmation row proving
-- the caller is genuinely the confirmer for that actor. ───────────────────
create or replace function p2p_get_confirmation_actor_profiles(p_actor_ids uuid[])
returns table (id uuid, full_name text, photo_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.photo_url
  from p2p_profiles p
  where p.id = any(p_actor_ids)
    and exists (
      select 1 from p2p_peer_confirmations c
      where c.actor_user_id = p.id and c.confirmer_user_id = auth.uid()
    );
$$;

grant execute on function p2p_get_confirmation_actor_profiles(uuid[]) to authenticated;

-- Mirror of the above for the other direction — an actor viewing their own
-- "Confirmed By" list (e.g. the Encouragement Fruit detail screen) needs the
-- CONFIRMER's name, gated on a real confirmation row proving the caller is
-- genuinely the actor for that confirmer.
create or replace function p2p_get_confirmer_profiles(p_confirmer_ids uuid[])
returns table (id uuid, full_name text, photo_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.photo_url
  from p2p_profiles p
  where p.id = any(p_confirmer_ids)
    and exists (
      select 1 from p2p_peer_confirmations c
      where c.confirmer_user_id = p.id and c.actor_user_id = auth.uid()
    );
$$;

grant execute on function p2p_get_confirmer_profiles(uuid[]) to authenticated;

-- ── Realtime — without this, DataContext's pending-confirmations
-- subscription silently never fires. Same gap found and fixed for
-- p2p_lesson_evaluations (028) and p2p_user_fruits (034); caught here
-- proactively instead of via a live-test failure this time.
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_peer_confirmations;
