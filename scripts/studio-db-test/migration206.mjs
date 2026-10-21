// Migration 206: the study-session roster policy no longer recurses (42P17),
// and the rule is unchanged (you read a session and its roster only if you
// are one of its participants). Original 084 policies, queried as signed-in
// users through RLS in PGlite.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration206.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000014${String(n).padStart(2, "0")}`;
const U = { a: id(1), b: id(2), outsider: id(3) };
const S1 = id(10), S2 = id(11);

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_study_sessions (id uuid primary key, title text, status text default 'active');
  create table public.p2p_study_session_participants (id uuid primary key default gen_random_uuid(), study_session_id uuid not null references public.p2p_study_sessions(id), user_id uuid not null, unique (study_session_id, user_id));
  alter table public.p2p_study_sessions enable row level security;
  alter table public.p2p_study_session_participants enable row level security;
`);
// The original policies, exactly as migration 084 created them.
const m084 = mig("084_group_study_sessions.sql");
const policies = m084.slice(m084.indexOf('create policy "Study session participants can view their session"'));
await db.exec(policies.slice(0, policies.indexOf(";", policies.indexOf('create policy "Study session participants can view the roster"')) + 1));
await db.query(`insert into p2p_study_sessions (id, title) values ($1,'Session 1'), ($2,'Session 2')`, [S1, S2]);
await db.query(`insert into p2p_study_session_participants (study_session_id, user_id) values ($1,$2), ($1,$3), ($4,$3)`, [S1, U.a, U.b, S2]);

const as = async (uid, sql) => {
  await db.query("begin");
  try { await db.query(`select set_config('test.uid', $1, true)`, [uid]); await db.query("set local role authenticated"); return { rows: (await db.query(sql)).rows }; }
  catch (e) { return { error: e.code ?? String(e.message).slice(0, 80) }; } finally { await db.query("rollback"); }
};
const roster = (u) => as(u, `select study_session_id::text s, user_id::text u from p2p_study_session_participants order by 1, 2`);
const sessions = (u) => as(u, `select id::text from p2p_study_sessions order by 1`);

ok("before 206: reading the roster hits recursion (42P17)", (await roster(U.a)).error === "42P17", JSON.stringify(await roster(U.a)));
ok("before 206: reading sessions hits recursion too", (await sessions(U.a)).error === "42P17");

await db.exec(mig("206_study_session_roster_policy_recursion.sql"));
await db.exec(mig("206_study_session_roster_policy_recursion.sql"));
ok("206 applies and re-runs", true);

let r = await roster(U.a);
ok("a participant reads their session's whole roster (no recursion)", !r.error && r.rows.length === 2 && r.rows.every((x) => x.s === S1), JSON.stringify(r));
r = await roster(U.b);
ok("someone in two sessions sees both rosters", !r.error && r.rows.length === 3);
ok("a non-participant sees no roster rows and no sessions", (await roster(U.outsider)).rows?.length === 0 && (await sessions(U.outsider)).rows?.length === 0);
ok("sessions: participants see exactly their own", (await sessions(U.a)).rows?.map((x) => x.id).join() === S1 && (await sessions(U.b)).rows?.length === 2);
ok("signed-in users still can't write the roster directly", !!(await as(U.outsider, `insert into p2p_study_session_participants (study_session_id, user_id) values ('${S1}', '${U.outsider}') returning 1`)).error
  || (await as(U.outsider, `insert into p2p_study_session_participants (study_session_id, user_id) values ('${S1}', '${U.outsider}') returning 1`)).rows?.length === 0);
ok("helper not callable by anon", (await db.query(`select has_function_privilege('anon', 'public.p2p_is_study_session_participant(uuid)', 'execute') x`)).rows[0].x === false);

const m206 = mig("206_study_session_roster_policy_recursion.sql");
await db.exec(m206.slice(m206.indexOf("-- Rollback")).split(/\r?\n/).filter((l) => l.startsWith("--   ")).map((l) => l.slice(5)).join("\n"));
ok("documented rollback restores the previous (recursive) behaviour", (await roster(U.a)).error === "42P17");
await db.exec(m206);
ok("re-apply after rollback fixes it again", !(await roster(U.a)).error);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
