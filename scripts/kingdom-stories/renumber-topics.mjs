// Close the gaps in Kingdom Stories topic numbers (owner request 2026-11-24, after the duplicate merge),
// keeping the present order: 1, 3, 4 … becomes 1, 2, 3 …. Draft/review categories only; a category with a
// published story is left alone (its numbers are live). Story text is not changed.
//
//   node scripts/kingdom-stories/renumber-topics.mjs <category-slug> …            dry run
//   node scripts/kingdom-stories/renumber-topics.mjs <category-slug> … --apply
//   node scripts/kingdom-stories/renumber-topics.mjs <category-slug> … --content  content files the same way
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cats = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!cats.length) { console.error("name at least one category slug"); process.exit(2); }

if (process.argv.includes("--content")) {
  const dir = path.join(repo, "scripts/kingdom-stories/content");
  for (const cat of cats) {
    const file = path.join(dir, `${cat}-stories.mjs`);
    const stories = (await import(pathToFileURL(file).href)).default;
    const sorted = [...stories].sort((a, b) => a.topicNumber - b.topicNumber);
    sorted.forEach((s, i) => { s.topicNumber = i + 1; });
    const src = readFileSync(file, "utf8");
    writeFileSync(file, src.slice(0, src.indexOf("export default")) + "export default " + JSON.stringify(sorted, null, 1) + ";\n");
    console.log(`${cat}: content file renumbered 1–${sorted.length}`);
  }
  process.exit(0);
}

function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}
const url = process.env.KS_IMPORT_DB_URL
  || envValue(path.join(repo, "artifacts/api-server/.env.production-direct.local"), "PROD_DIRECT_DB_URL")
  || envValue(path.join(repo, "artifacts/api-server/.env"), "SUPABASE_DB_URL");
const store = path.join(repo, "node_modules/.pnpm");
const pg = createRequire(import.meta.url)(path.join(store, readdirSync(store).filter((d) => /^pg@\d/.test(d)).sort().pop(), "node_modules/pg"));
const c = new pg.Client({ connectionString: url, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
try {
  await c.query("BEGIN");
  await c.query("SET LOCAL statement_timeout = '60s'");
  for (const cat of cats) {
    const k = (await c.query("select id from public.p2p_kingdom_story_categories where slug = $1", [cat])).rows[0];
    if (!k) { console.log(`${cat}: no such category`); continue; }
    const rows = (await c.query("select id, topic_number, status, title from public.p2p_kingdom_stories where category_id = $1 and topic_number is not null order by topic_number", [k.id])).rows;
    if (rows.some((r) => r.status === "published")) { console.log(`SKIP ${cat}: has published stories`); continue; }
    const moves = rows.map((r, i) => ({ ...r, to: i + 1 })).filter((r) => r.topic_number !== r.to);
    // Park, then set — topic_number is unique per category.
    for (const r of moves) await c.query("update public.p2p_kingdom_stories set topic_number = topic_number + 1000 where id = $1", [r.id]);
    for (const r of moves) await c.query("update public.p2p_kingdom_stories set topic_number = $2, updated_at = now() where id = $1", [r.id, r.to]);
    console.log(`${cat}: ${rows.length} stories, ${moves.length} renumbered` + (moves.length ? ` (${moves.map((r) => `${r.topic_number}→${r.to}`).join(", ")})` : ""));
  }
  if (apply) { await c.query("COMMIT"); console.log("APPLIED."); }
  else { await c.query("ROLLBACK"); console.log("Dry run — rolled back. Add --apply to commit."); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
finally { await c.end(); }
