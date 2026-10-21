-- 209: Files & Resources for Family Circles and Churches.
--
-- Design (security first):
--   • A PRIVATE storage bucket. There are deliberately NO storage.objects
--     policies for anon/authenticated on it: clients can't list, read or
--     write its objects directly. Every upload and download goes through the
--     API (routes/groupResources.ts), which checks ACTIVE membership of that
--     exact family/church on every request and then issues a short-lived
--     signed URL (upload: one object path; download: 5 minutes). Leaving the
--     group therefore revokes access immediately (no new links), and a
--     guessed path or id gets nothing.
--   • Object paths are server-generated: <scope>/<group id>/<resource id>/<file>.
--   • A metadata table, also API-only (RLS on, no client policies).
--   • Deletion is soft in the table (deleted_at) and removes the object.
-- Additive only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-resources', 'group-resources', false, 26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a'
  ]
)
on conflict (id) do nothing;

create table if not exists public.p2p_group_resources (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('family', 'church')),
  group_id uuid not null,
  uploader_id uuid references public.p2p_profiles(id) on delete set null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  -- Optional context (references only, never copies of content).
  lesson_id uuid,
  curriculum_id uuid,
  gathering_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_p2p_group_resources_group
  on public.p2p_group_resources (scope, group_id, created_at desc) where deleted_at is null;

alter table public.p2p_group_resources enable row level security;
revoke all on public.p2p_group_resources from anon, authenticated;
grant all on public.p2p_group_resources to service_role;

-- Rollback (SQL part — removes the feature's table):
--   drop table if exists public.p2p_group_resources;
-- The bucket can't be removed with SQL (Supabase blocks direct deletes on
-- storage tables): empty it and delete it with the Storage API, e.g.
-- supabase.storage.emptyBucket('group-resources') then
-- supabase.storage.deleteBucket('group-resources') with the service key.
-- Leaving the empty private bucket in place is harmless.
