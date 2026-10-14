// Deploy-order safety: the REAL API routes against a database WITHOUT
// migration 188 (only 152), as production is until 188 is released. Story
// publish / unpublish / archive must keep working exactly as before, and the
// Studio must answer "not set up yet" instead of failing.
//
// Run (same PGlite setup as run.mjs):
//   PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/studio-db-test/routes-pre188.mjs
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const db = new PGlite();
const cat = await setupBase(db, readFileSync(path.join(repo, "migrations/152_kingdom_stories.sql"), "utf8"));
const tmp = mkdtempSync(path.join(os.tmpdir(), "studio-pre188-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const row = async (id) => (await db.query(`select status, published_at, archived_at from p2p_kingdom_stories where id=$1`, [id])).rows[0];

try {
  ok("precondition: 188 is not installed", (await db.query(`select to_regprocedure('p2p_kingdom_story_set_status(uuid,text)') f`)).rows[0].f === null);
  const id = (await db.query(`insert into p2p_kingdom_stories (title, category_id, body) values ('Polycarp', $1, 'Synthetic body.') returning id`, [cat])).rows[0].id;

  const pub = await call("PUT", `/kingdom-stories/${id}`, U.A, { status: "published" });
  const r1 = await row(id);
  ok("pre-188: publish works as before", pub.status === 200 && r1.status === "published" && r1.published_at !== null, JSON.stringify(pub.body));
  const unp = await call("PUT", `/kingdom-stories/${id}`, U.A, { status: "draft" });
  ok("pre-188: unpublish works as before", unp.status === 200 && (await row(id)).status === "draft");
  const arc = await call("PUT", `/kingdom-stories/${id}`, U.A, { status: "archived" });
  const r3 = await row(id);
  ok("pre-188: archive works as before", arc.status === 200 && r3.status === "archived" && r3.archived_at !== null);
  ok("pre-188: field edit with status in one request", (await call("PUT", `/kingdom-stories/${id}`, U.A, { title: "Polycarp of Smyrna", status: "draft" })).status === 200
    && (await row(id)).status === "draft");
  ok("pre-188: a moderator still cannot change stories", (await call("PUT", `/kingdom-stories/${id}`, U.M, { status: "published" })).status === 403);

  const lib = await call("GET", "/studio/items?sourceType=kingdom_story", U.A);
  ok("pre-188: Studio answers 'not set up yet' (503)", lib.status === 503 && /not set up yet/.test(lib.body?.error ?? ""), JSON.stringify(lib));
  const rev = await call("POST", `/studio/items/kingdom_story/${id}/review`, U.A, { to: "in_review", version: 1 });
  ok("pre-188: Studio write answers 503, nothing changes", rev.status === 503 && (await row(id)).status === "draft", JSON.stringify(rev));
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  await db.close();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
