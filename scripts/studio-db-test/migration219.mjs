// Migration 219 (PROPOSED) on PGlite with the REAL 216 + 219: additive,
// idempotent, existing studies untouched, rules enforced, closed to clients.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration219.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setupBase } from "./setup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const db = new PGlite();
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
await setupBase(db, read("152_kingdom_stories.sql"));
const q = async (sql, p) => (await db.query(sql, p)).rows;
const err = async (sql, p) => { try { await q(sql, p); return null; } catch (e) { return e.message; } };
const id = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
await q(`insert into p2p_profiles (id, role) values ($1, 'student'), ($2, 'student')`, [id(1), id(2)]);
await db.exec(read("216_study_together_shared.sql"));
await q(`insert into p2p_shared_studies (id, content_type, content_id, title, host_id, destination_type) values ($1, 'kingdom_story', $2, 'Before 219', $3, 'peer')`, [id(10), id(99), id(1)]);
const before = JSON.stringify(await q(`select * from p2p_shared_studies order by id`));

await db.exec(read("219_study_together_schedule.sql"));
await db.exec(read("219_study_together_schedule.sql"));
ok("idempotent: applies twice", true);
const after = (await q(`select * from p2p_shared_studies where id = $1`, [id(10)]))[0];
ok("existing study unchanged: unscheduled, no reminders", after.scheduled_start_at === null && after.duration_minutes === null && after.time_zone === null && Array.isArray(after.reminder_offsets) && after.reminder_offsets.length === 0);
ok("existing columns and values untouched", Object.entries(JSON.parse(before)[0]).every(([k, v]) => JSON.stringify(after[k] instanceof Date ? after[k].toISOString() : after[k]) === JSON.stringify(v instanceof Object && !Array.isArray(v) ? v : v) || k.endsWith("_at")));
ok("bible passages allowed", (await err(`insert into p2p_shared_studies (content_type, content_id, title, host_id, destination_type) values ('bible_passage', $1, 'John 3', $2, 'peer')`, [id(98), id(1)])) === null);
ok("unknown content type still refused", /check/.test(await err(`insert into p2p_shared_studies (content_type, content_id, title, host_id, destination_type) values ('video', $1, 'x', $2, 'peer')`, [id(97), id(1)]) ?? ""));
ok("only the offered reminder times", /reminder_offsets_allowed/.test(await err(`update p2p_shared_studies set scheduled_start_at = now() + interval '2 days', reminder_offsets = '{15}' where id = $1`, [id(10)]) ?? ""));
ok("reminders need a start time", /reminders_need_time/.test(await err(`update p2p_shared_studies set reminder_offsets = '{60}' where id = $1`, [id(10)]) ?? ""));
ok("duration range checked", /duration_range/.test(await err(`update p2p_shared_studies set duration_minutes = 2 where id = $1`, [id(10)]) ?? ""));
ok("a valid schedule saves", (await err(`update p2p_shared_studies set scheduled_start_at = '2026-11-02T18:00:00Z', duration_minutes = 60, time_zone = 'Africa/Lagos', reminder_offsets = '{1440,60,0}' where id = $1`, [id(10)])) === null);
const r = `insert into p2p_shared_study_reminders (study_id, user_id, offset_minutes, starts_at) values ($1, $2, 60, $3) on conflict do nothing returning id`;
ok("a reminder is recorded once", (await q(r, [id(10), id(2), "2026-11-02T18:00:00Z"])).length === 1 && (await q(r, [id(10), id(2), "2026-11-02T18:00:00Z"])).length === 0);
ok("a new start time is a new reminder", (await q(r, [id(10), id(2), "2026-11-03T18:00:00Z"])).length === 1);
const g = (await q(`select has_table_privilege('authenticated','public.p2p_shared_study_reminders','select') a, has_table_privilege('anon','public.p2p_shared_study_reminders','select') b, has_table_privilege('service_role','public.p2p_shared_study_reminders','insert') c`))[0];
ok("reminders closed to clients; API only", !g.a && !g.b && g.c);
await q(`delete from p2p_shared_studies where id = $1`, [id(10)]);
ok("reminders go with their study", (await q(`select count(*)::int n from p2p_shared_study_reminders`))[0].n === 0);
console.log(`migration 219 (proposed): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
