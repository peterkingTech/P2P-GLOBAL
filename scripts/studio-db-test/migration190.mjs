// Migration 190 (Studio audit trigger grant cleanup) on the REAL migrations
// 152 + 188 in PGlite: applies twice, then proves the grant is gone and the
// append-only audit log still refuses changes (the trigger still fires).
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration190.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
const cat = await setupBase(db, mig("152_kingdom_stories.sql"));
await db.exec(mig("188_publishing_studio_foundation.sql"));
const anonX = async () => (await db.query(`select has_function_privilege('anon', 'public.p2p_studio_audit_immutable()', 'execute') a,
  has_function_privilege('authenticated', 'public.p2p_studio_audit_immutable()', 'execute') u,
  has_function_privilege('service_role', 'public.p2p_studio_audit_immutable()', 'execute') s`)).rows[0];
const before = await anonX();
ok("before 190: the leftover grant exists (what 188's postcheck found)", before.a && before.u && before.s, JSON.stringify(before));
await db.exec(mig("190_studio_audit_trigger_grant_cleanup.sql"));
await db.exec(mig("190_studio_audit_trigger_grant_cleanup.sql"));
const after = await anonX();
ok("190 applies twice; anon, signed-in users and service_role can no longer execute it", !after.a && !after.u && !after.s, JSON.stringify(after));

// The trigger still fires: create an audited story change, then try to alter the log.
const id = (await db.query(`insert into p2p_kingdom_stories (title, category_id, body) values ('t', $1, 'b') returning id`, [cat])).rows[0].id;
await db.exec(`set test.uid = '${U.A}'; set role authenticated;`);
await db.query(`select p2p_kingdom_story_set_status($1, 'archived')`, [id]);
await db.exec(`reset role; set test.uid = '';`);
const n = (await db.query(`select count(*)::int n from p2p_studio_audit_log where source_id = $1`, [id])).rows[0].n;
ok("audit row written", n === 1);
const upd = await db.query(`update p2p_studio_audit_log set action = 'tampered' where source_id = $1`, [id]).then(() => null, (e) => e.message);
const del = await db.query(`delete from p2p_studio_audit_log where source_id = $1`, [id]).then(() => null, (e) => e.message);
ok("audit log still append-only after 190 (trigger fires without the grant)", /append-only/.test(upd ?? "") && /append-only/.test(del ?? ""), `${upd} / ${del}`);
await db.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
