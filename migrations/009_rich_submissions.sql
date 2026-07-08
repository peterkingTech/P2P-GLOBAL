-- 009: Rich submission capture (text / audio / video)
-- Introduces p2p_submissions as the canonical submission record, a private Supabase
-- Storage bucket for media files, and migrates the evaluator-assignment trigger
-- from the old p2p_assignment_submissions table to the new one.

-- ── New table: p2p_submissions ────────────────────────────────────────────────
create table if not exists p2p_submissions (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid not null references p2p_profiles(id)           on delete cascade,
  lesson_id              uuid not null references p2p_lessons(id)            on delete cascade,
  reflection_question_id uuid           references p2p_reflection_questions(id) on delete set null,
  assignment_id          uuid           references p2p_assignments(id)       on delete set null,
  submission_type        text not null  check (submission_type in ('text','audio','video')),
  text_content           text,
  media_url              text,
  duration_seconds       integer,
  created_at             timestamptz not null default now()
);

create index if not exists idx_p2p_submissions_user    on p2p_submissions(user_id);
create index if not exists idx_p2p_submissions_lesson  on p2p_submissions(lesson_id);
create index if not exists idx_p2p_submissions_created on p2p_submissions(created_at desc);

-- ── RLS: p2p_submissions ──────────────────────────────────────────────────────
alter table p2p_submissions enable row level security;

drop policy if exists "Users view own submissions"           on p2p_submissions;
drop policy if exists "Users insert own submissions"         on p2p_submissions;
drop policy if exists "Evaluators view assigned submission"  on p2p_submissions;
drop policy if exists "Admins manage all submissions"        on p2p_submissions;

create policy "Users view own submissions" on p2p_submissions
  for select using (auth.uid() = user_id);

create policy "Users insert own submissions" on p2p_submissions
  for insert with check (auth.uid() = user_id);

create policy "Evaluators view assigned submission" on p2p_submissions
  for select using (
    exists (
      select 1 from p2p_lesson_evaluations e
      where e.submission_id = p2p_submissions.id
        and e.evaluator_id  = auth.uid()
    )
  );

create policy "Admins manage all submissions" on p2p_submissions
  for all using (p2p_is_admin()) with check (p2p_is_admin());

-- ── Supabase Storage bucket (private, 100 MB limit) ───────────────────────────
-- Path convention:  {user_id}/{submission_id}/recording.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submissions', 'submissions', false, 104857600,
  array[
    'audio/m4a','audio/x-m4a','audio/mpeg','audio/mp3','audio/aac',
    'audio/wav','audio/webm','audio/ogg',
    'video/mp4','video/quicktime','video/webm','video/x-msvideo'
  ]
)
on conflict (id) do nothing;

-- ── Storage RLS ───────────────────────────────────────────────────────────────
drop policy if exists "Submitters manage own media"       on storage.objects;
drop policy if exists "Evaluators read assigned media"    on storage.objects;
drop policy if exists "Admins read all submission media"  on storage.objects;

create policy "Submitters manage own media" on storage.objects
  for all
  using  (bucket_id = 'submissions' and auth.uid()::text = split_part(name, '/', 1))
  with check (bucket_id = 'submissions' and auth.uid()::text = split_part(name, '/', 1));

create policy "Evaluators read assigned media" on storage.objects
  for select using (
    bucket_id = 'submissions' and
    exists (
      select 1 from p2p_lesson_evaluations e
      where e.evaluator_id  = auth.uid()
        and e.submission_id::text = split_part(name, '/', 2)
    )
  );

create policy "Admins read all submission media" on storage.objects
  for select using (bucket_id = 'submissions' and p2p_is_admin());

-- ── Migrate existing p2p_assignment_submissions → p2p_submissions ─────────────
-- Keep the same UUIDs so p2p_lesson_evaluations.submission_id stays valid.
insert into p2p_submissions (id, user_id, lesson_id, assignment_id, submission_type, text_content, created_at)
select id, user_id, lesson_id, assignment_id, 'text', content, created_at
from p2p_assignment_submissions
on conflict (id) do nothing;

-- ── Re-point p2p_lesson_evaluations.submission_id → p2p_submissions ───────────
alter table p2p_lesson_evaluations
  drop constraint if exists p2p_lesson_evaluations_submission_id_fkey;

alter table p2p_lesson_evaluations
  add constraint p2p_lesson_evaluations_submission_id_fkey
  foreign key (submission_id) references p2p_submissions(id) on delete cascade;

-- ── Move evaluator-assignment trigger to p2p_submissions ──────────────────────
drop trigger if exists trg_assign_evaluator_on_submission on p2p_assignment_submissions;

create or replace function p2p_assign_evaluator_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluator uuid;
begin
  -- Reflection-only submissions don't gate lesson completion.
  if new.assignment_id is null then
    return new;
  end if;

  v_evaluator := p2p_pick_evaluator(new.lesson_id, array[new.user_id]);
  if v_evaluator is not null then
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at)
    values (new.id, new.lesson_id, new.user_id, v_evaluator, 'pending', now());
  else
    insert into p2p_lesson_evaluations (
      submission_id, lesson_id, submitter_id, evaluator_id, status,
      self_approved, feedback, assigned_at, resolved_at
    )
    values (
      new.id, new.lesson_id, new.user_id, new.user_id, 'approved',
      true, 'First through this lesson — unevaluated, auto-approved.', now(), now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_evaluator_on_submission on p2p_submissions;
create trigger trg_assign_evaluator_on_submission
  after insert on p2p_submissions
  for each row execute function p2p_assign_evaluator_on_submission();
