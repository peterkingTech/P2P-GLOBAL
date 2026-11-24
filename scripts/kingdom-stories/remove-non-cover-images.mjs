// Owner decision 2026-11-24: keep only the P2P Global | Creative Studios cover on each story for now;
// every other image (chapter images, old interim covers) in the named categories goes to the admin
// Recycle Bin (p2p_recycle_delete 'kingdom_story_media' — restorable, file kept until purged).
// Published stories are skipped (their images are frozen). Covers are never touched.
//
//   node scripts/kingdom-stories/remove-non-cover-images.mjs <category-slug> …                       dry run
//   node scripts/kingdom-stories/remove-non-cover-images.mjs <category-slug> … --apply --actor <id>
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const actor = arg("--actor");
const cats = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== actor);
if (!cats.length) { console.error("name at least one category slug"); process.exit(2); }
if (apply && !/^[0-9a-f-]{36}$/i.test(actor ?? "")) { console.error("--apply needs --actor <admin profile id>"); process.exit(2); }

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
  await c.query("SET LOCAL statement_timeout = '300s'");
  const who = actor ?? (await c.query("select id from public.p2p_profiles where role::text = 'super_admin' order by created_at limit 1")).rows[0]?.id;
  for (const cat of cats) {
    const rows = (await c.query(`select m.id, s.status, s.topic_number from public.p2p_kingdom_story_media m
      join public.p2p_kingdom_stories s on s.id = m.story_id join public.p2p_kingdom_story_categories k on k.id = s.category_id
      where k.slug = $1 and not m.is_cover order by s.topic_number, m.display_order`, [cat])).rows;
    const skip = rows.filter((r) => r.status === "published");
    const go = rows.filter((r) => r.status !== "published");
    for (const r of go) await c.query("select public.p2p_recycle_delete($1, 'kingdom_story_media', $2)", [who, r.id]);
    const covers = (await c.query(`select count(*)::int n from public.p2p_kingdom_story_media m join public.p2p_kingdom_stories s on s.id = m.story_id
      join public.p2p_kingdom_story_categories k on k.id = s.category_id where k.slug = $1 and m.is_cover`, [cat])).rows[0].n;
    console.log(`${cat}: ${go.length} image(s) → Recycle Bin${skip.length ? `, ${skip.length} skipped (published)` : ""}; covers kept: ${covers}`);
  }
  if (apply) { await c.query("COMMIT"); console.log("APPLIED."); }
  else { await c.query("ROLLBACK"); console.log("Dry run — rolled back. Add --apply --actor <admin id>."); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
finally { await c.end(); }
