// Merge the editor's duplicate Kingdom Stories (owner request 2026-11-24: "combine the important ones and
// delete one"). For each pair the fuller story is kept; chapters of the other story that teach something the
// kept story does not are COPIED into it whole (text, scripture, lessons, reflections, check — unchanged) at
// the right place in the story; the other story then goes to the admin Recycle Bin (restorable, intact).
//
//   node scripts/kingdom-stories/merge-duplicate-stories.mjs                    dry run (BEGIN … ROLLBACK)
//   node scripts/kingdom-stories/merge-duplicate-stories.mjs --apply --actor <admin profile id>
//   node scripts/kingdom-stories/merge-duplicate-stories.mjs --content          same change in the content files
//
// Only draft/review stories are touched.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");

// keep: topic kept · drop: topic recycled · add: [chapter of drop, insert after chapter N of keep (original numbering)]
// Topic numbers are those at the time of the merge. DONE lists are history only — the topics were
// renumbered afterwards (renumber-topics.mjs), so those numbers now point at OTHER stories: never re-run them.
export const PLAN = [
  // 2026-11-24 (after renumbering): African Pentecostal pair.
  { cat: "african-christianity", file: "african-christianity-stories.mjs", keep: 20, drop: 25, add: [[6, 5], [7, 7]], done: true },
];
export const DONE_2026_11_24 = [
  { cat: "early-christianity-church-fathers", file: "early-christianity-church-fathers-stories.mjs", keep: 7, drop: 11, add: [[9, 13]] },
  { cat: "early-christianity-church-fathers", file: "early-christianity-church-fathers-stories.mjs", keep: 23, drop: 13, add: [[9, 8], [10, 13], [12, 15]] },
  { cat: "early-christianity-church-fathers", file: "early-christianity-church-fathers-stories.mjs", keep: 15, drop: 21, add: [[9, 9]] },
  { cat: "early-christianity-church-fathers", file: "early-christianity-church-fathers-stories.mjs", keep: 16, drop: 22, add: [] },
  { cat: "early-christianity-church-fathers", file: "early-christianity-church-fathers-stories.mjs", keep: 17, drop: 20, add: [] },
  { cat: "early-christianity-church-fathers", file: "early-christianity-church-fathers-stories.mjs", keep: 18, drop: 19, add: [] },
  { cat: "apostles-early-church", file: "apostles-early-church-stories.mjs", keep: 30, drop: 2, add: [] },
  { cat: "apostles-early-church", file: "apostles-early-church-stories.mjs", keep: 29, drop: 5, add: [[5, 3]] },
  { cat: "apostles-early-church", file: "apostles-early-church-stories.mjs", keep: 25, drop: 6, add: [[8, 9]] },
  { cat: "apostles-early-church", file: "apostles-early-church-stories.mjs", keep: 22, drop: 19, add: [[7, 6]] },
  { cat: "african-christianity", file: "african-christianity-stories.mjs", keep: 12, drop: 11, add: [[2, 1]] },
];

// New chapter order for one pair: kept chapters with the added ones slotted in after their anchor.
function order(keepCount, add) {
  const seq = [];
  for (let k = 0; k <= keepCount; k++) {
    if (k > 0) seq.push({ from: "keep", n: k });
    for (const [d, after] of add) if (after === k) seq.push({ from: "drop", n: d });
  }
  return seq;
}

// ---- content files ----------------------------------------------------------------------------------------
if (process.argv.includes("--content")) {
  const dir = path.join(repo, "scripts/kingdom-stories/content");
  for (const file of [...new Set(PLAN.map((p) => p.file))]) {
    const full = path.join(dir, file);
    let stories = (await import(pathToFileURL(full).href)).default;
    for (const p of PLAN.filter((x) => x.file === file && !x.done)) {
      const K = stories.find((s) => s.topicNumber === p.keep), D = stories.find((s) => s.topicNumber === p.drop);
      if (!K || !D) { console.log(`${file}: T${p.keep}/T${p.drop} already merged`); continue; }
      K.chapters = order(K.chapters.length, p.add).map((x) => (x.from === "keep" ? K : D).chapters[x.n - 1]);
      stories = stories.filter((s) => s !== D);
      console.log(`${file}: T${p.drop} merged into T${p.keep} (+${p.add.length} chapter(s), now ${K.chapters.length})`);
    }
    const src = readFileSync(full, "utf8");
    writeFileSync(full, src.slice(0, src.indexOf("export default")) + "export default " + JSON.stringify(stories, null, 1) + ";\n");
  }
  process.exit(0);
}

// ---- database ---------------------------------------------------------------------------------------------
const actor = arg("--actor");
if (apply && !actor) { console.error("--apply needs --actor <admin profile id> (recorded as who moved the stories to the Recycle Bin)"); process.exit(2); }
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
  await c.query("SET LOCAL statement_timeout = '120s'");
  const who = actor ?? (await c.query("select id from public.p2p_profiles where role::text = 'super_admin' order by created_at limit 1")).rows[0]?.id;
  const cols = (await c.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'p2p_kingdom_story_chapters'
    and column_name not in ('id', 'story_id', 'chapter_number', 'created_at', 'updated_at') and is_generated = 'NEVER' order by ordinal_position`)).rows.map((r) => r.column_name);
  for (const p of PLAN.filter((x) => !x.done)) {
    const get = async (n) => (await c.query(`select s.id, s.title, s.status from public.p2p_kingdom_stories s join public.p2p_kingdom_story_categories k on k.id = s.category_id
      where k.slug = $1 and s.topic_number = $2`, [p.cat, n])).rows[0];
    const K = await get(p.keep), D = await get(p.drop);
    if (!K || !D) { console.log(`${p.cat} T${p.keep}/T${p.drop}: already merged (one is gone)`); continue; }
    if ([K.status, D.status].includes("published")) { console.log(`SKIP ${p.cat} T${p.keep}/T${p.drop}: published`); continue; }
    const kc = (await c.query("select id, chapter_number, title from public.p2p_kingdom_story_chapters where story_id = $1 order by chapter_number", [K.id])).rows;
    const dc = (await c.query("select id, chapter_number, title from public.p2p_kingdom_story_chapters where story_id = $1 order by chapter_number", [D.id])).rows;
    const seq = order(kc.length, p.add);
    // Park the kept chapters out of the way, then lay the full sequence down 1..n.
    await c.query("update public.p2p_kingdom_story_chapters set chapter_number = chapter_number + 1000 where story_id = $1", [K.id]);
    let n = 0;
    for (const x of seq) {
      n++;
      if (x.from === "keep") await c.query("update public.p2p_kingdom_story_chapters set chapter_number = $2 where id = $1", [kc[x.n - 1].id, n]);
      else {
        const src = dc.find((r) => r.chapter_number === x.n);
        if (!src) throw new Error(`${p.cat} T${p.drop} has no chapter ${x.n}`);
        await c.query(`insert into public.p2p_kingdom_story_chapters (story_id, chapter_number, ${cols.join(", ")})
          select $1, $2, ${cols.join(", ")} from public.p2p_kingdom_story_chapters where id = $3`, [K.id, n, src.id]);
        console.log(`   + "${src.title}" → chapter ${n} of T${p.keep}`);
      }
    }
    await c.query("update public.p2p_kingdom_stories set updated_at = now() where id = $1", [K.id]);
    await c.query("select public.p2p_recycle_delete($1, 'kingdom_story', $2)", [who, D.id]);
    console.log(`${p.cat}: T${p.drop} "${D.title}" → Recycle Bin; T${p.keep} "${K.title}" now ${n} chapters (was ${kc.length})\n`);
  }
  if (apply) { await c.query("COMMIT"); console.log("APPLIED."); }
  else { await c.query("ROLLBACK"); console.log("Dry run — rolled back. Add --apply --actor <admin id> to commit."); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
finally { await c.end(); }
