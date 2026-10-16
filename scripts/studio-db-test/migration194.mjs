// Migration 194 (three-level message-preview privacy) on PGlite after 193,
// under the per-column privilege model (174/185/193). Proves: existing users
// keep their privacy (true → 'name', false → 'none'; nobody becomes 'full');
// new rows default to 'name'; only the three values are allowed; the old and
// new settings stay in sync both ways; owner-only updates; re-runnable.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration194.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-0000-0000-0000000194${String(n).padStart(2, "0")}`;
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, full_name text, email text);
  alter table public.p2p_profiles enable row level security;
  create policy own_update on public.p2p_profiles for update using (id = auth.uid()) with check (id = auth.uid());
  create policy read_all on public.p2p_profiles for select using (auth.uid() is not null);
  grant select, insert, update, delete on public.p2p_profiles to service_role;
  grant update (full_name) on public.p2p_profiles to authenticated;
  grant select (id, full_name) on public.p2p_profiles to authenticated;
  insert into public.p2p_profiles (id, full_name, email) values ('${id(1)}', 'Ada', 'a@x'), ('${id(2)}', 'Ben', 'b@x'), ('${id(3)}', 'Cy', 'c@x');
`);
await db.exec(mig("193_message_preview_privacy.sql"));
await db.query(`update p2p_profiles set notify_show_sender_name = false where id = $1`, [id(2)]); // Ben hid names under 193
await db.exec(mig("194_notification_message_preview_level.sql"));
await db.exec(mig("194_notification_message_preview_level.sql")); // re-runnable

const level = async (n) => (await db.query(`select notify_message_preview p, notify_show_sender_name s from p2p_profiles where id = $1`, [id(n)])).rows[0];
ok("existing user with names shown → Name only", (await level(1)).p === "name");
ok("existing user who hid names (193) → Nothing", (await level(2)).p === "none");
ok("nobody is switched to Name and message", (await db.query(`select count(*)::int n from p2p_profiles where notify_message_preview = 'full'`)).rows[0].n === 0);
await db.query(`insert into p2p_profiles (id, full_name) values ($1, 'Dee')`, [id(4)]);
ok("new accounts default to Name only", (await level(4)).p === "name" && (await level(4)).s === true);
let bad = null; try { await db.query(`update p2p_profiles set notify_message_preview = 'everything' where id = $1`, [id(1)]); } catch (e) { bad = e.message; }
ok("only full / name / none allowed", !!bad && /check/i.test(bad), bad);

const as = async (uid, sql, params = []) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; } catch (e) { return { rows: [], error: e.message }; } finally { await db.exec("reset role;"); }
};
const own = await as(id(1), `update p2p_profiles set notify_message_preview = 'full' where id = $1 returning notify_message_preview`, [id(1)]);
ok("owner opts in to Name and message", !own.error && own.rows[0]?.notify_message_preview === "full", own.error);
ok("…old switch kept in sync (names shown)", (await level(1)).s === true);
const other = await as(id(1), `update p2p_profiles set notify_message_preview = 'full' where id = $1 returning id`, [id(3)]);
ok("can't change someone else's level", !other.error && other.rows.length === 0 && (await level(3)).p === "name");
const read = await as(id(1), `select notify_message_preview from p2p_profiles where id = $1`, [id(1)]);
ok("owner can read it under column grants", !read.error && read.rows[0]?.notify_message_preview === "full", read.error);
const email = await as(id(1), `update p2p_profiles set email = 'z@x' where id = $1`, [id(1)]);
ok("194 grants no wider write access", !!email.error);

// Sync: new → old
await db.query(`update p2p_profiles set notify_message_preview = 'none' where id = $1`, [id(3)]);
ok("level Nothing → old switch off", (await level(3)).s === false);
await db.query(`update p2p_profiles set notify_message_preview = 'name' where id = $1`, [id(3)]);
ok("level Name only → old switch on", (await level(3)).s === true);
// Sync: old → new (a build that only knows 193's switch)
await db.query(`update p2p_profiles set notify_show_sender_name = false where id = $1`, [id(1)]);
ok("old switch off → Nothing (even from Name and message)", (await level(1)).p === "none");
await db.query(`update p2p_profiles set notify_show_sender_name = true where id = $1`, [id(1)]);
ok("old switch back on → Name only (never silently Name and message)", (await level(1)).p === "name");
await db.query(`update p2p_profiles set notify_message_preview = 'full' where id = $1`, [id(1)]);
await db.query(`update p2p_profiles set notify_show_sender_name = true where id = $1`, [id(1)]);
ok("old switch set on while already on: Name and message kept", (await level(1)).p === "full");
await db.query(`update p2p_profiles set full_name = 'Ada L' where id = $1`, [id(1)]);
ok("unrelated updates leave the level alone", (await level(1)).p === "full");
await db.query(`update p2p_profiles set notify_message_preview = 'name', notify_show_sender_name = false where id = $1`, [id(1)]);
ok("both set in one update: the level wins, switch follows it", (await level(1)).p === "name" && (await level(1)).s === true);

const sql = mig("194_notification_message_preview_level.sql").replace(/--.*$/gm, "");
ok("additive: no drops/revokes of existing objects, no policy changes", !/\bdrop (table|column|policy)\b/i.test(sql) && !/\bcreate policy\b/i.test(sql) && !/revoke .* from authenticated/i.test(sql.replace(/revoke all on function public\.p2p_sync_message_preview\(\) from public, anon, authenticated;/, "")));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
