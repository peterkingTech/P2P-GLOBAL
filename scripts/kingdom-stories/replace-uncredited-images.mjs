// Replaces Biblical History images that carry no credit with credited public-domain artworks
// (content/images-bh-replacements.mjs, owner decision 2026-11-24).
//   node scripts/kingdom-stories/replace-uncredited-images.mjs --images <folder> --actor <admin profile id>            (dry run, ROLLBACK)
//   node scripts/kingdom-stories/replace-uncredited-images.mjs --images <folder> --actor <admin profile id> --apply    (COMMIT)
// Same database/storage settings as import-stories.mjs. Never prints secrets.
//
// Per image, in one transaction: the old row is moved to the Admin Recycle Bin (p2p_recycle_delete — it can be
// restored from there; its file is kept until purged), then the new artwork takes its place (same chapter,
// cover flag, role and order) with full attribution (alt text, source page, licence, kind). Files are
// uploaded before COMMIT. A PUBLISHED story's images are frozen (recycle_live_story): those stories are
// skipped and listed — unpublishing to change them is an editorial decision.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUCKET = "kingdom-stories-media";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const imagesDir = arg("--images");
const actor = arg("--actor");

function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}
const apiEnv = path.join(repo, "artifacts/api-server/.env");
const dbUrl = () => process.env.KS_IMPORT_DB_URL
  || envValue(path.join(repo, "artifacts/api-server/.env.production-direct.local"), "PROD_DIRECT_DB_URL")
  || envValue(apiEnv, "SUPABASE_DB_URL");
function loadPg() {
  const store = path.join(repo, "node_modules/.pnpm");
  const dir = readdirSync(store).filter((d) => /^pg@\d/.test(d)).sort().pop();
  if (!dir) throw new Error("pg not found in node_modules/.pnpm");
  return createRequire(import.meta.url)(path.join(store, dir, "node_modules/pg"));
}
async function upload(p, file) {
  const url = envValue(apiEnv, "SUPABASE_URL"), key = envValue(apiEnv, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from artifacts/api-server/.env");
  const r = await fetch(`${url.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${p}`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: readFileSync(path.join(imagesDir, file)),
  });
  if (!r.ok) throw new Error(`upload ${file} failed: HTTP ${r.status}`);
}

async function run() {
  if (!imagesDir || !actor || !/^[0-9a-f-]{36}$/i.test(actor)) { console.error("Usage: --images <folder> --actor <admin profile uuid> [--apply]"); process.exit(2); }
  const plan = (await import(pathToFileURL(path.join(repo, "scripts/kingdom-stories/content/images-bh-replacements.mjs")).href)).default;
  const missing = Object.values(plan).flat().filter((x) => !existsSync(path.join(imagesDir, x.file)));
  if (missing.length) { console.error("Missing image files:\n" + missing.map((x) => "  - " + x.file).join("\n")); process.exit(1); }

  const url = dbUrl();
  if (!url) { console.error("No database URL configured."); process.exit(2); }
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const c = new (loadPg().Client)({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await c.connect();
  const uploads = [], skipped = [];
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = '60s'");
    for (const [slug, list] of Object.entries(plan)) {
      const story = (await c.query(`select s.id, s.status, s.title from public.p2p_kingdom_stories s join public.p2p_kingdom_story_topics t on t.id = s.topic_id where t.slug = $1`, [slug])).rows;
      if (story.length !== 1) throw new Error(`${slug}: ${story.length} stories found — resolve by hand`);
      const st = story[0];
      if (st.status === "published") { skipped.push(`${st.title} (published — its images are frozen)`); continue; }
      for (const x of list) {
        const old = (await c.query(`select id, chapter_id, is_cover, role, display_order from public.p2p_kingdom_story_media where story_id = $1 and media_path = $2`,
          [st.id, `${st.id}/pdf/${x.replaces}`])).rows[0];
        if (!old) { console.log(`  = ${st.title}: ${x.replaces} not found (already replaced?) — skipped`); continue; }
        const newPath = `${st.id}/art/${x.file}`;
        if ((await c.query("select 1 from public.p2p_kingdom_story_media where media_path = $1", [newPath])).rows.length) { console.log(`  = ${x.file} already present`); continue; }
        await c.query("select public.p2p_recycle_delete($1::uuid, 'kingdom_story_media', $2::uuid)", [actor, old.id]);
        await c.query(`insert into public.p2p_kingdom_story_media (story_id, media_type, media_path, caption, display_order, is_cover, chapter_id, role, alt_text, source_url, license_note, image_kind)
                       values ($1, 'image', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [st.id, newPath, `Image: ${x.credit}`, old.display_order, old.is_cover, old.chapter_id, old.role, x.alt, x.sourceUrl, x.license, x.imageKind]);
        uploads.push([newPath, x.file]);
        console.log(`  ~ ${st.title}: ${x.replaces} → ${x.credit}`);
      }
    }
    if (apply) { for (const [p, f] of uploads) await upload(p, f); console.log(`Uploaded ${uploads.length} images to ${BUCKET}.`); }
    await c.query(apply ? "COMMIT" : "ROLLBACK");
    if (skipped.length) console.log("Skipped (published):\n" + skipped.map((s) => "  - " + s).join("\n"));
    console.log(apply ? `COMMITTED: ${uploads.length} images replaced; the old ones are in the Admin Recycle Bin.` : `DRY RUN — ${uploads.length} replacements rolled back. Re-run with --apply to save.`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("FAILED, rolled back: " + String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>"));
    process.exitCode = 1;
  } finally { await c.end(); }
}
await run();
