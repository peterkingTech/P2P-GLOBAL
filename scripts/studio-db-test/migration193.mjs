// Migration 193 (message-preview privacy) on PGlite, under the per-column
// privilege model of 174 (owner UPDATE on listed columns) and 185 (signed-in
// SELECT on listed columns). Proves: default true for existing rows; the
// owner can read and change it; nobody can change someone else's; it gives
// no wider write access; re-runnable.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration193.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sql193 = readFileSync(path.join(repo, "migrations/193_message_preview_privacy.sql"), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const A = "00000000-0000-0000-0000-0000000009a1", B = "00000000-0000-0000-0000-0000000009b1";
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, full_name text, email text, notify_break_rooms boolean not null default true);
  alter table public.p2p_profiles enable row level security;
  create policy own_update on public.p2p_profiles for update using (id = auth.uid()) with check (id = auth.uid());
  create policy read_all on public.p2p_profiles for select using (auth.uid() is not null);
  grant select, insert, update, delete on public.p2p_profiles to service_role;
  -- 174-style: owner may update listed columns only; 185-style: signed-in users read listed columns only.
  grant update (full_name, notify_break_rooms) on public.p2p_profiles to authenticated;
  grant select (id, full_name, notify_break_rooms) on public.p2p_profiles to authenticated;
  insert into public.p2p_profiles (id, full_name, email) values ('${A}', 'Ada', 'a@example.invalid'), ('${B}', 'Ben', 'b@example.invalid');
`);
await db.exec(sql193);
await db.exec(sql193); // re-runnable

const as = async (uid, sql, params = []) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: e.message }; }
  finally { await db.exec("reset role;"); }
};

ok("existing users default to showing names", (await db.query(`select bool_and(notify_show_sender_name) v from p2p_profiles`)).rows[0].v === true);
const read = await as(A, `select notify_show_sender_name from p2p_profiles where id = $1`, [A]);
ok("owner can read it (works under 185's column grants)", !read.error && read.rows[0]?.notify_show_sender_name === true, read.error);
const upd = await as(A, `update p2p_profiles set notify_show_sender_name = false where id = $1 returning id`, [A]);
ok("owner can turn it off", !upd.error && upd.rows.length === 1 && (await db.query(`select notify_show_sender_name v from p2p_profiles where id = $1`, [A])).rows[0].v === false, upd.error);
const other = await as(A, `update p2p_profiles set notify_show_sender_name = false where id = $1 returning id`, [B]);
ok("can't change someone else's setting", !other.error && other.rows.length === 0 && (await db.query(`select notify_show_sender_name v from p2p_profiles where id = $1`, [B])).rows[0].v === true);
const email = await as(A, `update p2p_profiles set email = 'x@example.invalid' where id = $1`, [A]);
ok("193 grants no wider write access (email still not writable)", !!email.error);
const priv = await as(A, `select email from p2p_profiles where id = $1`, [A]);
ok("193 grants no wider read access (email still not readable)", !!priv.error);
ok("193 changes nothing but the one column and its two grants", !/\b(policy|revoke|drop|create table|function)\b/i.test(sql193.replace(/--.*$/gm, "")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
