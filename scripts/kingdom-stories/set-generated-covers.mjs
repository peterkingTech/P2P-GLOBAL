// Set P2P Global | Creative Studios covers for one Kingdom Stories category (owner request 2026-11-24).
//   node scripts/kingdom-stories/set-generated-covers.mjs <content/covers-*.mjs> --images <folder>            dry run (ROLLBACK, no upload)
//   node scripts/kingdom-stories/set-generated-covers.mjs <content/covers-*.mjs> --images <folder> --apply    upload + COMMIT
//
// Per story, in one transaction: the old cover stays in the story (only is_cover is cleared — public-domain
// paintings remain as chapter images); the new artwork is added as cover with the studio credit and alt text.
// Re-running replaces a cover this script added earlier (same path). Published stories are skipped.
// image_kind stays empty like the Creation artwork (owner credit decision). Never prints secrets.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUCKET = "kingdom-stories-media";
const CREDIT = "Image: P2P Global | Creative Studios";
const LICENSE = "Original artwork by P2P Global | Creative Studios. All rights reserved.";
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const planFile = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== arg("--images"));
const imagesDir = arg("--images");
if (!planFile || !imagesDir) { console.error("Usage: <covers plan .mjs> --images <folder> [--apply]"); process.exit(2); }

function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}
const apiEnv = path.join(repo, "artifacts/api-server/.env");
async function upload(p, file) {
  const url = envValue(apiEnv, "SUPABASE_URL"), key = envValue(apiEnv, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from artifacts/api-server/.env");
  const r = await fetch(`${url.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${p}`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: readFileSync(path.join(imagesDir, file)),
  });
  if (!r.ok) throw new Error(`upload ${file} failed: HTTP ${r.status}`);
}

const plan = (await import(pathToFileURL(path.resolve(planFile)).href)).default;
const missing = plan.covers.filter((x) => !existsSync(path.join(imagesDir, x.file)));
if (missing.length) { console.error("Missing files:\n" + missing.map((x) => "  - " + x.file).join("\n")); process.exit(1); }

const dbUrl = process.env.KS_IMPORT_DB_URL
  || envValue(path.join(repo, "artifacts/api-server/.env.production-direct.local"), "PROD_DIRECT_DB_URL")
  || envValue(apiEnv, "SUPABASE_DB_URL");
const store = path.join(repo, "node_modules/.pnpm");
const pg = createRequire(import.meta.url)(path.join(store, readdirSync(store).filter((d) => /^pg@\d/.test(d)).sort().pop(), "node_modules/pg"));
const c = new pg.Client({ connectionString: dbUrl, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl) ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
const uploads = [];
try {
  await c.query("BEGIN");
  await c.query("SET LOCAL statement_timeout = '120s'");
  for (const x of plan.covers) {
    const s = (await c.query(`select s.id, s.title, s.status from public.p2p_kingdom_stories s join public.p2p_kingdom_story_categories k on k.id = s.category_id
      where k.slug = $1 and s.topic_number = $2`, [plan.category, x.topic])).rows[0];
    if (!s) { console.log(`T${x.topic}: no story — skipped`); continue; }
    if (s.status === "published") { console.log(`SKIP T${x.topic} "${s.title}": published`); continue; }
    const p = `${s.id}/p2p/${x.file}`;
    await c.query("update public.p2p_kingdom_story_media set is_cover = false where story_id = $1 and is_cover and media_path <> $2", [s.id, p]);
    const had = (await c.query("select id from public.p2p_kingdom_story_media where story_id = $1 and media_path = $2", [s.id, p])).rows[0];
    if (had) {
      await c.query("update public.p2p_kingdom_story_media set is_cover = true, caption = $2, alt_text = $3, license_note = $4, image_kind = null, source_url = null, chapter_id = null, display_order = 0 where id = $1", [had.id, CREDIT, x.alt, LICENSE]);
    } else {
      await c.query("update public.p2p_kingdom_story_media set display_order = display_order + 1 where story_id = $1", [s.id]);
      await c.query(`insert into public.p2p_kingdom_story_media (story_id, media_type, media_path, caption, display_order, is_cover, chapter_id, alt_text, source_url, license_note, image_kind)
        values ($1, 'image', $2, $3, 0, true, null, $4, null, $5, null)`, [s.id, p, CREDIT, x.alt, LICENSE]);
    }
    uploads.push([p, x.file]);
    console.log(`T${x.topic} "${s.title}": cover → ${x.file}${had ? " (replaced earlier upload)" : ""}`);
  }
  if (apply) {
    for (const [p, f] of uploads) await upload(p, f);
    console.log(`uploaded ${uploads.length} file(s)`);
    await c.query("COMMIT"); console.log("APPLIED.");
  } else { await c.query("ROLLBACK"); console.log("Dry run — rolled back, nothing uploaded. Add --apply."); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
finally { await c.end(); }
