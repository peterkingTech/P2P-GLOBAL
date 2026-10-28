// Imports editor-supplied Kingdom Stories (content/topics-*.mjs) as DRAFTS,
// and keeps those drafts in step with the content files.
//   node scripts/kingdom-stories/import-stories.mjs                    (dry run: everything runs, then ROLLBACK)
//   node scripts/kingdom-stories/import-stories.mjs --apply            (COMMIT)
//   … --images <folder>   also place the PDF images (content/images.mjs) — needs migration 211
//   … --no-upload         with --images: write the media rows but skip the storage upload (rehearsals)
// Database URL: KS_IMPORT_DB_URL, else PROD_DIRECT_DB_URL from
// artifacts/api-server/.env.production-direct.local, else SUPABASE_DB_URL from
// artifacts/api-server/.env. Storage: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// from artifacts/api-server/.env. Never prints secrets.
//
// Safety: one database transaction. A story is matched by its topic; a story
// that is NOT a draft (in review, published, archived) is never touched. A
// draft is brought in line with the content files (title, subtitle, body and
// each chapter's text, lessons, reflections and assignment); its chapter
// count must match. Images are added once (matched by storage path), never
// replaced or removed. Nothing is published; no editor is assigned.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CATEGORY_SLUG = "biblical-history";
const BUCKET = "kingdom-stories-media";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const imagesDir = arg("--images");
const noUpload = process.argv.includes("--no-upload");

function loadPg() {
  const store = path.join(repo, "node_modules/.pnpm");
  const dir = readdirSync(store).filter((d) => /^pg@\d/.test(d)).sort().pop();
  if (!dir) throw new Error("pg not found in node_modules/.pnpm");
  return createRequire(import.meta.url)(path.join(store, dir, "node_modules/pg"));
}

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

export async function loadStories() {
  const dir = path.join(repo, "scripts/kingdom-stories/content");
  const files = readdirSync(dir).filter((f) => /^topics-.*\.mjs$/.test(f)).sort();
  const stories = [];
  for (const f of files) stories.push(...(await import(pathToFileURL(path.join(dir, f)).href)).default);
  return stories;
}
export async function loadImages() {
  return (await import(pathToFileURL(path.join(repo, "scripts/kingdom-stories/content/images.mjs")).href)).default;
}

export function validate(stories, images = null) {
  const errors = [];
  const titles = new Set();
  for (const s of stories) {
    const at = s.title || "(untitled)";
    if (!s.topicSlug || !s.title || !Array.isArray(s.body) || !s.body.length) errors.push(`${at}: topicSlug, title and body are required`);
    if (titles.has(s.title)) errors.push(`${at}: duplicate title`);
    titles.add(s.title);
    if (!Array.isArray(s.chapters) || !s.chapters.length) errors.push(`${at}: no chapters`);
    (s.chapters || []).forEach((c, i) => {
      const where = `${at} ch${i + 1}`;
      if (!c.title || !c.scripture || !c.narrative?.length) errors.push(`${where}: title, scripture and narrative are required`);
      if (c.lessons?.length !== 5) errors.push(`${where}: ${c.lessons?.length ?? 0} lessons (need 5)`);
      if (c.reflections?.length !== 5) errors.push(`${where}: ${c.reflections?.length ?? 0} reflections (need 5)`);
      if (!c.assignment?.text?.trim()) errors.push(`${where}: assignment text missing`);
      if (c.assignment?.title != null && (typeof c.assignment.title !== "string" || c.assignment.title.length > 200)) errors.push(`${where}: bad assignment title`);
      for (const t of [...(c.narrative || []), ...(c.lessons || []), ...(c.reflections || [])]) {
        if (typeof t !== "string" || !t.trim()) errors.push(`${where}: empty text`);
      }
    });
    if (images) {
      const list = images[s.topicSlug];
      if (!list?.length) { errors.push(`${at}: no images listed`); continue; }
      if (list.filter((x) => x.cover).length !== 1) errors.push(`${at}: exactly one cover image needed`);
      for (const x of list) if (x.chapter !== null && !(x.chapter >= 1 && x.chapter <= s.chapters.length)) errors.push(`${at}: image ${x.file} → no chapter ${x.chapter}`);
    }
  }
  return errors;
}

// PDF extracts live under pdf/; the editor's own artwork (folder: "p2p") under p2p/.
const storagePath = (storyId, file, folder = "pdf") => `${storyId}/${folder}/${file}`;
async function upload(storyId, file, folder) {
  const url = envValue(apiEnv, "SUPABASE_URL"), key = envValue(apiEnv, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from artifacts/api-server/.env");
  const r = await fetch(`${url.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${storagePath(storyId, file, folder)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: readFileSync(path.join(imagesDir, file)),
  });
  if (!r.ok) throw new Error(`upload ${file} failed: HTTP ${r.status}`);
}

async function run() {
  const stories = await loadStories();
  const images = imagesDir ? await loadImages() : null;
  const errors = validate(stories, images);
  if (images) for (const list of Object.values(images)) for (const x of list) if (!existsSync(path.join(imagesDir, x.file))) errors.push(`image file missing: ${x.file}`);
  if (errors.length) { console.error("Validation failed:\n" + errors.map((e) => "  - " + e).join("\n")); process.exit(1); }
  console.log(`Validated ${stories.length} stories, ${stories.reduce((n, s) => n + s.chapters.length, 0)} chapters${images ? `, ${Object.values(images).flat().length} images` : ""}.`);

  const url = dbUrl();
  if (!url) { console.error("No database URL configured."); process.exit(2); }
  const pg = loadPg();
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const c = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = '60s'");
    const has211 = (await c.query(`select count(*)::int n from information_schema.columns where table_schema='public'
      and ((table_name='p2p_kingdom_story_chapters' and column_name in ('assignment','assignment_title')) or (table_name='p2p_kingdom_story_media' and column_name='chapter_id'))`)).rows[0].n === 3;
    if (!has211) throw new Error("migration 211 (chapter assignment + chapter images) is not applied to this database");
    const cat = (await c.query("select id from public.p2p_kingdom_story_categories where slug = $1", [CATEGORY_SLUG])).rows[0];
    if (!cat) throw new Error(`category ${CATEGORY_SLUG} not found`);
    const uploads = [];

    for (const s of stories) {
      let topic = (await c.query("select id, status, category_id from public.p2p_kingdom_story_topics where slug = $1", [s.topicSlug])).rows[0];
      if (!topic && s.newTopic) {
        const after = (await c.query("select display_order from public.p2p_kingdom_story_topics where slug = $1 and category_id = $2", [s.newTopic.afterSlug, cat.id])).rows[0];
        if (!after) throw new Error(`${s.title}: anchor topic ${s.newTopic.afterSlug} not found`);
        const order = after.display_order + 1;
        const shifted = await c.query("update public.p2p_kingdom_story_topics set display_order = display_order + 1, updated_at = now() where category_id = $1 and display_order >= $2", [cat.id, order]);
        topic = (await c.query(
          "insert into public.p2p_kingdom_story_topics (slug, title, category_id, priority, display_order, status) values ($1, $2, $3, $4, $5, 'topic') returning id, status, category_id",
          [s.topicSlug, s.newTopic.title, cat.id, s.newTopic.priority, order])).rows[0];
        console.log(`  + topic "${s.newTopic.title}" at position ${order} (${shifted.rowCount} later topics moved down one)`);
      }
      if (!topic) throw new Error(`${s.title}: topic ${s.topicSlug} not found`);
      if (topic.category_id !== cat.id) throw new Error(`${s.title}: topic ${s.topicSlug} is not in ${CATEGORY_SLUG}`);

      const existing = (await c.query("select id, status, title from public.p2p_kingdom_stories where topic_id = $1 order by created_at", [topic.id])).rows;
      if (existing.length > 1) throw new Error(`${s.title}: ${existing.length} stories linked to topic ${s.topicSlug} — resolve by hand`);
      let storyId = existing[0]?.id;
      const chapterRow = (ch, i) => [i + 1, ch.title, ch.narrative.join("\n\n"), ch.scripture, ch.lessons, ch.reflections, ch.assignment.title ?? null, ch.assignment.text];

      if (!storyId) {
        storyId = (await c.query(
          `insert into public.p2p_kingdom_stories (title, subtitle, category_id, body, status, topic_id) values ($1, $2, $3, $4, 'draft', $5) returning id`,
          [s.title, s.subtitle || null, cat.id, s.body.join("\n\n"), topic.id])).rows[0].id;
        for (const [i, ch] of s.chapters.entries()) {
          await c.query(
            `insert into public.p2p_kingdom_story_chapters (story_id, chapter_number, title, narrative, scripture_refs, lessons, reflections, assignment_title, assignment)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [storyId, ...chapterRow(ch, i)]);
        }
        console.log(`  + draft "${s.title}" (${s.chapters.length} chapters)`);
      } else if (existing[0].status !== "draft") {
        console.log(`  = "${existing[0].title}" is ${existing[0].status}, not a draft — left untouched`);
        continue;
      } else {
        const chs = (await c.query("select id, chapter_number from public.p2p_kingdom_story_chapters where story_id = $1 order by chapter_number", [storyId])).rows;
        if (chs.length !== s.chapters.length) throw new Error(`${s.title}: the draft has ${chs.length} chapters, the content file ${s.chapters.length} — resolve by hand`);
        await c.query("update public.p2p_kingdom_stories set title = $2, subtitle = $3, body = $4, updated_at = now() where id = $1",
          [storyId, s.title, s.subtitle || null, s.body.join("\n\n")]);
        for (const [i, ch] of s.chapters.entries()) {
          const [, title, narrative, scripture, lessons, reflections, aTitle, aText] = chapterRow(ch, i);
          await c.query(`update public.p2p_kingdom_story_chapters set title = $2, narrative = $3, scripture_refs = $4, lessons = $5, reflections = $6,
                           assignment_title = $7, assignment = $8, updated_at = now() where id = $1`,
            [chs[i].id, title, narrative, scripture, lessons, reflections, aTitle, aText]);
        }
        console.log(`  ~ draft "${s.title}" brought in line (${s.chapters.length} chapters)`);
      }
      if (topic.status === "topic" || topic.status === "researching") {
        await c.query("update public.p2p_kingdom_story_topics set status = 'drafting', updated_at = now() where id = $1", [topic.id]);
      }

      if (images) {
        const chIds = Object.fromEntries((await c.query("select id, chapter_number from public.p2p_kingdom_story_chapters where story_id = $1", [storyId])).rows.map((r) => [r.chapter_number, r.id]));
        const have = new Set((await c.query("select media_path from public.p2p_kingdom_story_media where story_id = $1", [storyId])).rows.map((r) => r.media_path));
        const hasCover = (await c.query("select 1 from public.p2p_kingdom_story_media where story_id = $1 and is_cover", [storyId])).rows.length > 0;
        let added = 0;
        for (const [order, x] of images[s.topicSlug].entries()) {
          const p = storagePath(storyId, x.file, x.folder);
          if (have.has(p)) continue;
          await c.query(`insert into public.p2p_kingdom_story_media (story_id, media_type, media_path, caption, display_order, is_cover, chapter_id)
                         values ($1, 'image', $2, $3, $4, $5, $6)`,
            [storyId, p, x.credit ? `Image: ${x.credit}` : null, order, x.cover && !hasCover, x.chapter ? chIds[x.chapter] : null]);
          uploads.push([storyId, x.file, x.folder]);
          added++;
        }
        console.log(`      images: ${added} added${added < images[s.topicSlug].length ? `, ${images[s.topicSlug].length - added} already present` : ""}`);
      }
    }

    const published = (await c.query("select count(*)::int n from public.p2p_kingdom_stories where category_id = $1 and status = 'published'", [cat.id])).rows[0].n;
    console.log(`Published stories in ${CATEGORY_SLUG}: ${published} (this import publishes none).`);
    if (apply && uploads.length && !noUpload) {
      // Files before COMMIT, so no committed row ever points at a missing file.
      // A failure rolls the rows back; already-uploaded files are reused (upsert) on the next run.
      for (const [sid, file, folder] of uploads) await upload(sid, file, folder);
      console.log(`Uploaded ${uploads.length} images to ${BUCKET}.`);
    }
    await c.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(apply ? "COMMITTED." : "DRY RUN — rolled back. Re-run with --apply to save.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("FAILED, rolled back: " + String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>"));
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
