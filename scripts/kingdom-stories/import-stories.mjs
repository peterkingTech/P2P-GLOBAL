// Imports editor-supplied Kingdom Stories (content/*.mjs) as DRAFTS.
//   node scripts/kingdom-stories/import-stories.mjs           (dry run: everything runs, then ROLLBACK)
//   node scripts/kingdom-stories/import-stories.mjs --apply   (COMMIT)
// Database URL: KS_IMPORT_DB_URL, else PROD_DIRECT_DB_URL from
// artifacts/api-server/.env.production-direct.local, else SUPABASE_DB_URL from
// artifacts/api-server/.env. Never prints secrets.
//
// Safety: one transaction; insert-only, apart from (a) shifting later Biblical
// History topics down one place when a new topic is inserted, and (b) moving a
// matched topic from 'topic'/'researching' to 'drafting'. A story whose title
// already exists in its category is skipped, so re-running is harmless.
// Nothing is published; stories are status 'draft' with no editor assigned.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CATEGORY_SLUG = "biblical-history";
const apply = process.argv.includes("--apply");

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

function dbUrl() {
  return process.env.KS_IMPORT_DB_URL
    || envValue(path.join(repo, "artifacts/api-server/.env.production-direct.local"), "PROD_DIRECT_DB_URL")
    || envValue(path.join(repo, "artifacts/api-server/.env"), "SUPABASE_DB_URL");
}

export async function loadStories() {
  const dir = path.join(repo, "scripts/kingdom-stories/content");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
  const stories = [];
  for (const f of files) stories.push(...(await import(pathToFileURL(path.join(dir, f)).href)).default);
  return stories;
}

export function validate(stories) {
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
      if (!c.assignment?.heading || !c.assignment?.text) errors.push(`${where}: assignment missing`);
      for (const t of [...(c.narrative || []), ...(c.lessons || []), ...(c.reflections || [])]) {
        if (typeof t !== "string" || !t.trim()) errors.push(`${where}: empty text`);
      }
    });
  }
  return errors;
}

export const chapterNarrative = (c) => [...c.narrative, `${c.assignment.heading}\n${c.assignment.text}`].join("\n\n");

async function run() {
  const stories = await loadStories();
  const errors = validate(stories);
  if (errors.length) { console.error("Validation failed:\n" + errors.map((e) => "  - " + e).join("\n")); process.exit(1); }
  console.log(`Validated ${stories.length} stories, ${stories.reduce((n, s) => n + s.chapters.length, 0)} chapters.`);

  const url = dbUrl();
  if (!url) { console.error("No database URL configured."); process.exit(2); }
  const pg = loadPg();
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = '60s'");
    const cat = (await c.query("select id from public.p2p_kingdom_story_categories where slug = $1", [CATEGORY_SLUG])).rows[0];
    if (!cat) throw new Error(`category ${CATEGORY_SLUG} not found`);

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

      const dup = (await c.query("select id, status from public.p2p_kingdom_stories where category_id = $1 and title = $2", [cat.id, s.title])).rows[0];
      if (dup) { console.log(`  = skipped "${s.title}" (already exists, status ${dup.status})`); continue; }

      const story = (await c.query(
        `insert into public.p2p_kingdom_stories (title, subtitle, category_id, body, status, topic_id)
         values ($1, $2, $3, $4, 'draft', $5) returning id`,
        [s.title, s.subtitle || null, cat.id, s.body.join("\n\n"), topic.id])).rows[0];
      for (const [i, ch] of s.chapters.entries()) {
        await c.query(
          `insert into public.p2p_kingdom_story_chapters (story_id, chapter_number, title, narrative, scripture_refs, lessons, reflections)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [story.id, i + 1, ch.title, chapterNarrative(ch), ch.scripture, ch.lessons, ch.reflections]);
      }
      if (topic.status === "topic" || topic.status === "researching") {
        await c.query("update public.p2p_kingdom_story_topics set status = 'drafting', updated_at = now() where id = $1", [topic.id]);
      }
      console.log(`  + draft "${s.title}" (${s.chapters.length} chapters) → topic ${s.topicSlug}${topic.status === "topic" || topic.status === "researching" ? " [topic → drafting]" : ""}`);
    }

    const published = (await c.query("select count(*)::int n from public.p2p_kingdom_stories where category_id = $1 and status = 'published'", [cat.id])).rows[0].n;
    console.log(`Published stories in ${CATEGORY_SLUG}: ${published} (this import adds none).`);
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
