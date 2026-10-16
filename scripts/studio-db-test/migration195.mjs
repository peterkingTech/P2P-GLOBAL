// Migration 195 ("Name, reveal message on hold") on PGlite after 193 + 194.
// Proves: 'hold' becomes allowed; nothing existing changes; nobody is moved
// to it; 194's sync trigger handles it (names shown); invalid values still
// refused; re-runnable; documented rollback works.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration195.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-0000-0000-0000000195${String(n).padStart(2, "0")}`;
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, full_name text);
  alter table public.p2p_profiles enable row level security;
  create policy own_update on public.p2p_profiles for update using (id = auth.uid()) with check (id = auth.uid());
  create policy read_all on public.p2p_profiles for select using (auth.uid() is not null);
  grant select (id, full_name) on public.p2p_profiles to authenticated;
  insert into public.p2p_profiles (id, full_name) values ('${id(1)}', 'Ada'), ('${id(2)}', 'Ben'), ('${id(3)}', 'Cy');
`);
await db.exec(mig("193_message_preview_privacy.sql"));
await db.exec(mig("194_notification_message_preview_level.sql"));
await db.query(`update p2p_profiles set notify_message_preview = 'full' where id = $1`, [id(2)]);
await db.query(`update p2p_profiles set notify_message_preview = 'none' where id = $1`, [id(3)]);
const snap = async () => (await db.query(`select string_agg(id || ':' || notify_message_preview || ':' || notify_show_sender_name, ',' order by id) s from p2p_profiles`)).rows[0].s;
const before = await snap();
let refused = null; try { await db.query(`update p2p_profiles set notify_message_preview = 'hold' where id = $1`, [id(1)]); } catch (e) { refused = e.code; }
ok("before 195, 'hold' is refused (as the app expects)", refused === "23514");

await db.exec(mig("195_notification_preview_hold_level.sql"));
await db.exec(mig("195_notification_preview_hold_level.sql")); // re-runnable
ok("existing levels untouched; nobody moved to 'hold'", (await snap()) === before && (await db.query(`select count(*)::int n from p2p_profiles where notify_message_preview = 'hold'`)).rows[0].n === 0);

const as = async (uid, sql, params = []) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; } catch (e) { return { rows: [], error: e.message }; } finally { await db.exec("reset role;"); }
};
const r = await as(id(1), `update p2p_profiles set notify_message_preview = 'hold' where id = $1 returning notify_message_preview, notify_show_sender_name`, [id(1)]);
ok("owner can choose 'hold'; old switch stays on (names shown)", !r.error && r.rows[0]?.notify_message_preview === "hold" && r.rows[0]?.notify_show_sender_name === true, r.error);
await db.query(`update p2p_profiles set notify_show_sender_name = false where id = $1`, [id(1)]);
ok("old switch off → Nothing (from 'hold')", (await db.query(`select notify_message_preview p from p2p_profiles where id = $1`, [id(1)])).rows[0].p === "none");
let bad = null; try { await db.query(`update p2p_profiles set notify_message_preview = 'everything' where id = $1`, [id(1)]); } catch (e) { bad = e.code; }
ok("other values still refused", bad === "23514");

await db.query(`update p2p_profiles set notify_message_preview = 'hold' where id = $1`, [id(1)]);
const lines = mig("195_notification_preview_hold_level.sql").split(/\r?\n/);
await db.exec(lines.slice(lines.findIndex((l) => /^-- Rollback/.test(l)) + 1).filter((l) => l.startsWith("--   ")).map((l) => l.slice(5)).join("\n"));
const after = (await db.query(`select notify_message_preview p from p2p_profiles where id = $1`, [id(1)])).rows[0].p;
let refusedAgain = null; try { await db.query(`update p2p_profiles set notify_message_preview = 'hold' where id = $1`, [id(2)]); } catch (e) { refusedAgain = e.code; }
ok("documented rollback: 'hold' users fall back to Name only; 'hold' refused again", after === "name" && refusedAgain === "23514");
await db.exec(mig("195_notification_preview_hold_level.sql"));
ok("re-applies after rollback", !(await (async () => { try { await db.query(`update p2p_profiles set notify_message_preview = 'hold' where id = $1`, [id(2)]); return null; } catch (e) { return e; } })()));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
