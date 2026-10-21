// Shared PGlite setup for the Studio database tests: Supabase stand-ins
// (roles, auth.uid(), auth.users, storage tables, Supabase-style default
// privileges), the tables migration 152 references, synthetic profiles, then
// the REAL migration 152 and the given migration 188 text.

export const USERS = {
  A: "00000000-0000-0000-0000-0000000000a1", // admin_content
  B: "00000000-0000-0000-0000-0000000000b1", // admin_content
  C: "00000000-0000-0000-0000-0000000000c1", // admin_content
  S: "00000000-0000-0000-0000-0000000000f1", // super_admin
  M: "00000000-0000-0000-0000-0000000000d1", // admin_moderation
  V: "00000000-0000-0000-0000-0000000000e1", // admin_supervisor
  P: "00000000-0000-0000-0000-000000000011", // student
};
export const ROLES = { A: "admin_content", B: "admin_content", C: "admin_content", S: "super_admin", M: "admin_moderation", V: "admin_supervisor", P: "student" };
export const WIN = "22222222-2222-4222-8222-000000000001";

/** Stand-ins + 152 applied; returns before 188 so callers can seed pre-188 data. */
export async function setupBase(db, m152) {
  const profiles = Object.entries(USERS).map(([k, id]) => `('${id}','${ROLES[k]}')`).join(", ");
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
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase grants new public objects to the API roles by default.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.p2p_profiles (id uuid primary key, role text not null);
    create table public.p2p_scripture_references (id uuid primary key);
    create table public.p2p_mission_fields (id uuid primary key);
    create table public.p2p_mission_stories (id uuid primary key);
    create table public.p2p_curriculums (id uuid primary key default gen_random_uuid(), title text, status text not null default 'draft', created_at timestamptz default now());
    create table public.p2p_prayer_topics (id uuid primary key default gen_random_uuid(), title text, status text default 'draft', updated_at timestamptz default now());
    create table public.p2p_prayer_paths (id uuid primary key default gen_random_uuid(), title text, status text default 'draft', updated_at timestamptz default now());
    create table public.p2p_kingdom_wins (id uuid primary key, title text, status text default 'submitted', visibility text default 'p2p_network',
                                          updated_at timestamptz default now(), published_at timestamptz);
    insert into p2p_profiles values ${profiles};
    insert into p2p_kingdom_wins (id, title) values ('${WIN}', 'Synthetic win');
  `);
  await db.exec(m152);
  return (await db.query(`select id from p2p_kingdom_story_categories order by display_order limit 1`)).rows[0].id;
}
