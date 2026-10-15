// Shared PGlite setup for the Kingdom Wins database tests: Supabase stand-ins
// (roles, auth.uid(), auth.users, storage), the real helper functions the Wins
// migrations call (p2p_is_admin from 088, p2p_current_role from 012), stub
// tables for referenced domains, then the REAL migrations 150 + 151 + 152 and,
// optionally, 188 and 189. Synthetic users only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");

export const U = {
  P: "00000000-0000-0000-0000-000000000011", // student (member, author)
  Q: "00000000-0000-0000-0000-000000000012", // student (another member)
  G: "00000000-0000-0000-0000-000000000013", // peer_guide
  O: "00000000-0000-0000-0000-000000000014", // moderator
  L: "00000000-0000-0000-0000-000000000015", // church_leader
  F: "00000000-0000-0000-0000-000000000016", // admin_finance
  M: "00000000-0000-0000-0000-0000000000d1", // admin_moderation
  V: "00000000-0000-0000-0000-0000000000e1", // admin_supervisor
  A: "00000000-0000-0000-0000-0000000000a1", // admin_content
  B: "00000000-0000-0000-0000-0000000000b1", // admin_content
  S: "00000000-0000-0000-0000-0000000000f1", // super_admin
};
export const ROLE = {
  P: "student", Q: "student", G: "peer_guide", O: "moderator", L: "church_leader", F: "admin_finance",
  M: "admin_moderation", V: "admin_supervisor", A: "admin_content", B: "admin_content", S: "super_admin",
};

/** Fresh database with 150 + 151 + 152 (+ 188) (+ 189, applied `times189` times). */
export async function buildWinsDb(PGlite, { with188 = false, with189 = false, times189 = 1, extra188 = "" } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert on storage.objects to authenticated;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.p2p_profiles (id uuid primary key, role text not null, full_name text, photo_url text, avatar_url text, bio text);
    create function public.p2p_is_admin() returns boolean language sql stable security definer set search_path to 'public'
      as $$ select exists (select 1 from p2p_profiles where id = auth.uid() and role != 'student') $$;
    create function public.p2p_current_role() returns text language sql security definer set search_path = public stable
      as $$ select role::text from p2p_profiles where id = auth.uid() $$;
    create table public.p2p_scripture_references (id uuid primary key);
    create table public.p2p_mission_fields (id uuid primary key);
    create table public.p2p_mission_stories (id uuid primary key);
    create table public.p2p_prayer_coord_requests (id uuid primary key, user_id uuid);
    create table public.p2p_help_requests (id uuid primary key default gen_random_uuid(), user_id uuid, tier text, category text, note text, status text);
    create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
    -- 013's table (content_type check widened by 150), RLS on like production.
    -- author_id as it exists in production (seen on staging, which mirrors the
    -- production schema): nullable, ON DELETE SET NULL — not 013's NOT NULL/CASCADE.
    create table public.p2p_content_flags (id uuid primary key default gen_random_uuid(), content_type text not null, content_id uuid not null,
      author_id uuid references public.p2p_profiles(id) on delete set null, reporter_id uuid references public.p2p_profiles(id) on delete set null,
      reason text, content_snapshot text, status text not null default 'open' check (status in ('open', 'dismissed', 'warned', 'removed', 'escalated')),
      resolved_by uuid, resolved_at timestamptz, resolution_note text, escalation_help_request_id uuid, created_at timestamptz not null default now());
    alter table public.p2p_content_flags enable row level security;
    create policy "content_flags_select_moderation" on public.p2p_content_flags for select to authenticated
      using (reporter_id = auth.uid() or p2p_current_role() in ('moderator', 'church_leader', 'regional_admin', 'super_admin'));
    -- 069's admin activity log (RLS as in 069).
    create table public.p2p_admin_activity_log (id uuid primary key default gen_random_uuid(), admin_id uuid not null references public.p2p_profiles(id) on delete cascade,
      admin_role text not null, action_type text not null, target_user_id uuid references public.p2p_profiles(id) on delete set null,
      target_resource_id uuid, target_resource_type text, action_detail jsonb not null default '{}'::jsonb, duration_seconds integer, created_at timestamptz not null default now());
    alter table public.p2p_admin_activity_log enable row level security;
    create policy "admin_activity_log_select" on public.p2p_admin_activity_log for select to authenticated
      using (auth.uid() = admin_id or p2p_current_role() in ('super_admin', 'admin_supervisor'));
    create table public.p2p_curriculums (id uuid primary key default gen_random_uuid(), title text, is_published boolean default false, created_at timestamptz default now());
    insert into auth.users values ${Object.values(U).map((id) => `('${id}')`).join(", ")};
    insert into p2p_profiles (id, role, full_name) values ${Object.entries(U).map(([k, id]) => `('${id}','${ROLE[k]}','Synthetic ${ROLE[k]} ${k}')`).join(", ")};
  `);
  await db.exec(mig("150_kingdom_wins.sql"));
  await db.exec(mig("151_p2p_impact.sql"));
  await db.exec(mig("152_kingdom_stories.sql"));
  if (with188) await db.exec(mig("188_publishing_studio_foundation.sql") + extra188);
  if (with189) for (let i = 0; i < times189; i++) await db.exec(mig("189_kingdom_wins_safeguards.sql"));
  return db;
}

/** Runs a statement as a signed-in user (authenticated role + auth.uid()); returns { rows } or { error, code }. */
export async function as(db, who, sql, params = []) {
  await db.exec(`set test.uid = '${who ? U[who] : ""}'; set role ${who ? "authenticated" : "service_role"};`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: String(e.message).split("\n")[0], code: e.code }; }
  finally { await db.exec("reset role; set test.uid = '';"); }
}
export const brief = (r) => (r.error ? `error: ${r.error}` : `rows: ${r.rows.length}`);
