// Migration 203: the family-roster policies no longer recurse (42P17), and
// the access rules are exactly what they were. Real family migrations +
// 199/200 (helpers) in PGlite, queried as signed-in users through RLS.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration203.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`;
const U = { shep: id(1), co: id(2), kid: id(3), left: id(4), other: id(5), outsider: id(6) };
const FA = "66666666-6666-4666-8666-000000000021", FB = "66666666-6666-4666-8666-000000000022";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text);
  create table public.p2p_curriculums (id uuid primary key); create table public.p2p_lessons (id uuid primary key);
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create function public.p2p_is_church_member(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active)';
  create function public.p2p_is_church_leadership(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active and role in (''senior_pastor'',''discipleship_pastor'',''small_group_leader''))';
`);
for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "117_family_worship_modes_and_history.sql", "126_family_multi_membership.sql",
  "134_custom_studies_church.sql", "135_custom_studies_family.sql", "199_group_learning_journeys.sql", "200_custom_lesson_authoring.sql"]) await db.exec(mig(f));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'A',$2), ($3,'B',$4)`, [FA, U.shep, FB, U.other]);
for (const [f, u, r, st] of [[FA, U.shep, "shepherd", "active"], [FA, U.co, "co_shepherd", "active"], [FA, U.kid, "child", "active"], [FA, U.left, "adult", "left"], [FB, U.other, "shepherd", "active"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role, status) values ($1,$2,$3,$4)`, [f, u, r, st]);
await db.query(`insert into p2p_family_worship_sessions (family_id, host_id, status, channel_name) values ($1,$2,'active','fw_a'), ($3,$4,'active','fw_b')`, [FA, U.shep, FB, U.other]);
await db.query(`insert into p2p_family_worship_history (family_id, session_id, duration_seconds, participant_count) select $1, id, 60, 2 from p2p_family_worship_sessions where family_id = $1`, [FA]);

// Run one statement as a signed-in user, through RLS; always rolled back.
const as = async (uid, sql, params = []) => {
  await db.query("begin");
  try {
    await db.query(`select set_config('test.uid', $1, true)`, [uid]);
    await db.query("set local role authenticated");
    const r = await db.query(sql, params);
    return { rows: r.rows, n: r.affectedRows };
  } catch (e) { return { error: e.code ?? String(e.message).slice(0, 80) }; } finally { await db.query("rollback"); }
};
const roster = (uid) => as(uid, `select user_id from p2p_family_members order by user_id`);
const families = (uid) => as(uid, `select id from p2p_families order by id`);
const sessions = (uid) => as(uid, `select family_id from p2p_family_worship_sessions order by family_id`);
const history = (uid) => as(uid, `select family_id from p2p_family_worship_history`);

// ── Before 203: the recursion ────────────────────────────────────────────
ok("before 203: a member reading the roster hits recursion (42P17)", (await roster(U.kid)).error === "42P17", JSON.stringify(await roster(U.kid)));
ok("before 203: a member reading Gathering sessions/history hits recursion", (await sessions(U.kid)).error === "42P17" && (await history(U.kid)).error === "42P17");

await db.exec(mig("203_family_roster_policy_recursion.sql"));
await db.exec(mig("203_family_roster_policy_recursion.sql"));
ok("203 applies and re-runs", true);

// ── After 203: reads work, same rules ────────────────────────────────────
const ids = (r) => (r.rows ?? []).map((x) => Object.values(x)[0]).sort().join();
let r = await roster(U.kid);
ok("member reads their whole family roster (all 4 rows incl. the one who left)", !r.error && ids(r) === [U.shep, U.co, U.kid, U.left].sort().join(), JSON.stringify(r));
ok("…and never another family's roster", !ids(r).includes(U.other));
r = await roster(U.left);
ok("someone who left sees only their own row", !r.error && ids(r) === U.left, JSON.stringify(r));
ok("an outsider sees no roster rows", ids(await roster(U.outsider)) === "" && !(await roster(U.outsider)).error);
ok("family read: active member sees their family; outsider and leaver don't", ids(await families(U.kid)) === FA && ids(await families(U.outsider)) === "" && ids(await families(U.left)) === "");
ok("family read: Shepherd sees their family", ids(await families(U.other)) === FB);
ok("Gathering sessions: members see only their family's (no recursion now)", ids(await sessions(U.kid)) === FA && ids(await sessions(U.other)) === FB && ids(await sessions(U.outsider)) === "");
ok("Gathering history: members see theirs; outsiders nothing", ids(await history(U.co)) === FA && ids(await history(U.outsider)) === "");

// Manage roster: Shepherd + active Co-Shepherd only (unchanged).
const addRow = (uid, fam) => as(uid, `insert into p2p_family_members (family_id, user_id, role) values ($1,$2,'adult')`, [fam, U.outsider]);
ok("Shepherd can add to their roster", !(await addRow(U.shep, FA)).error);
ok("active Co-Shepherd can add to their roster", !(await addRow(U.co, FA)).error);
ok("a child member can't add", !!(await addRow(U.kid, FA)).error);
ok("another family's Shepherd can't add to this roster", !!(await addRow(U.other, FA)).error);
ok("an outsider can't add themselves", !!(await addRow(U.outsider, FA)).error);
r = await as(U.kid, `update p2p_family_members set role = 'adult' where family_id = $1 and user_id = $2`, [FA, U.co]);
ok("a member can't change someone else's row (0 rows)", !r.error && r.n === 0, JSON.stringify(r));
r = await as(U.co, `delete from p2p_family_members where family_id = $1 and user_id = $2`, [FA, U.kid]);
ok("Co-Shepherd can remove a member (rolled back)", !r.error && r.n === 1, JSON.stringify(r));

// Policy text: helper-based, no inline self-reference left.
const defs = (await db.query(`select policyname, coalesce(qual,'') || coalesce(with_check,'') d from pg_policies where tablename in ('p2p_family_members','p2p_families')`)).rows;
ok("no roster/family policy reads p2p_family_members inline any more", defs.every((p) => !/from p2p_family_members|from public\.p2p_family_members/i.test(p.d)), JSON.stringify(defs));

// Rollback text in the file restores the old behaviour (and re-apply fixes it again).
const m203 = mig("203_family_roster_policy_recursion.sql");
const rollback = m203.slice(m203.indexOf("-- Rollback")).split(/\r?\n/).filter((l) => l.startsWith("--   ")).map((l) => l.slice(5)).join("\n");
await db.exec(rollback);
ok("documented rollback restores the previous (recursive) behaviour", (await roster(U.kid)).error === "42P17");
await db.exec(mig("203_family_roster_policy_recursion.sql"));
ok("re-apply after rollback fixes it again", !(await roster(U.kid)).error);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
