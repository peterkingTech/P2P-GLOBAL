-- 218: Learning attachments — handwriting, images and PDFs on Comprehensive
-- Check answers (Universal Learning System, step 2).
--
-- Security first (same model as 209 group resources):
--   • PRIVATE bucket 'learning-work' with NO storage.objects policies for
--     anon/authenticated: clients can't list, read or write it directly.
--     The API checks every request and hands out short-lived signed URLs.
--   • Metadata table, API-only: RLS on, no client policies, all client
--     grants revoked (Supabase default privileges grant ALL to
--     authenticated on new tables — see 217).
--   • A row with no target is a DRAFT: visible to its owner only.
--     A row with a target is a FROZEN copy linked to one submission
--     (p2p_submissions or p2p_group_assignment_submissions). Who may open
--     it is decided by who may see that submission today.
--   • No existing table, function, trigger, policy or bucket is changed.
-- Additive only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-work', 'learning-work', false, 26214400,
  array['application/json', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create table if not exists public.p2p_learning_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.p2p_profiles(id) on delete cascade,
  kind text not null check (kind in ('handwriting', 'image', 'pdf')),
  storage_path text not null unique check (char_length(storage_path) between 1 and 400),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/json', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer check (size_bytes is null or (size_bytes > 0 and size_bytes <= 26214400)),
  page_count integer check (page_count is null or page_count between 1 and 20),
  caption text check (caption is null or char_length(caption) <= 500),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  target_kind text check (target_kind in ('core_submission', 'group_submission')),
  target_id uuid,
  source_attachment_id uuid references public.p2p_learning_attachments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint p2p_learning_attachments_target_pair check ((target_kind is null) = (target_id is null)),
  constraint p2p_learning_attachments_kind_type check (
    (kind = 'handwriting' and mime_type = 'application/json')
    or (kind = 'image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
    or (kind = 'pdf' and mime_type = 'application/pdf'))
);

create index if not exists idx_p2p_learning_attachments_owner
  on public.p2p_learning_attachments (owner_id, updated_at desc) where deleted_at is null;
create index if not exists idx_p2p_learning_attachments_target
  on public.p2p_learning_attachments (target_kind, target_id) where target_id is not null and deleted_at is null;

alter table public.p2p_learning_attachments enable row level security;
revoke all on public.p2p_learning_attachments from public, anon, authenticated;
grant all on public.p2p_learning_attachments to service_role;

-- Rollback (ONLY while the table is empty and the bucket holds nothing):
--   drop table if exists public.p2p_learning_attachments;
--   then empty + delete the 'learning-work' bucket with the Storage API.
-- Once learners have stored work, do NOT roll back: switch the feature off
-- (LEARNING_ATTACHMENTS=off) and keep the table and files.
