// Writes migration 210's seed section from catalogue.mjs.
//   node scripts/kingdom-stories/build-seed.mjs          (rewrite the seed)
//   node scripts/kingdom-stories/build-seed.mjs --check  (exit 1 if out of date)
// The seed is idempotent and never deletes or overwrites an editor's work:
//   • existing categories are relabelled only while they still carry their
//     original 152 title (an editor's rename wins);
//   • new categories and topics are inserted on slug, skipped if present;
//   • 152 categories with no new equivalent are archived only if unused.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, ORIGINAL_TITLES, RETIRED_ORIGINAL_SLUGS, buildTopics } from "./catalogue.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = path.join(repo, "migrations/210_kingdom_story_catalogue.sql");
const BEGIN = "-- BEGIN GENERATED SEED";
const END = "-- END GENERATED SEED";

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

export function seedSql() {
  const out = [];
  const existing = CATEGORIES.map((c, i) => ({ ...c, order: i + 1 })).filter((c) => c.existing);
  const fresh = CATEGORIES.map((c, i) => ({ ...c, order: i + 1 })).filter((c) => !c.existing);
  for (const c of existing) if (!ORIGINAL_TITLES[c.slug]) throw new Error(`no original title for ${c.slug}`);

  out.push("-- Categories 1–24. The 10 original categories that map directly keep id + slug.");
  out.push("update public.p2p_kingdom_story_categories c");
  out.push("   set title = v.title, description = coalesce(c.description, v.description), display_order = v.display_order,");
  out.push("       icon = coalesce(c.icon, v.icon), updated_at = now()");
  out.push("  from (values");
  out.push(existing.map((c) => `    (${lit(c.slug)}, ${lit(ORIGINAL_TITLES[c.slug])}, ${lit(c.title)}, ${lit(c.description)}, ${c.order}, ${lit(c.icon)})`).join(",\n"));
  out.push("  ) as v(slug, original_title, title, description, display_order, icon)");
  out.push(" where c.slug = v.slug and c.title = v.original_title;");
  out.push("");
  out.push("insert into public.p2p_kingdom_story_categories (slug, title, description, display_order, icon, status) values");
  out.push(fresh.map((c) => `  (${lit(c.slug)}, ${lit(c.title)}, ${lit(c.description)}, ${c.order}, ${lit(c.icon)}, 'published')`).join(",\n"));
  out.push("on conflict (slug) do nothing;");
  out.push("");
  out.push("-- Original categories with no direct equivalent: archived (hidden from users, kept for editors) only if no story uses them.");
  out.push("update public.p2p_kingdom_story_categories c set status = 'archived', updated_at = now()");
  out.push(` where c.slug in (${RETIRED_ORIGINAL_SLUGS.map(lit).join(", ")}) and c.status = 'published'`);
  out.push("   and not exists (select 1 from public.p2p_kingdom_stories s where s.category_id = c.id);");
  out.push("");
  const topics = buildTopics();
  out.push(`-- ${topics.length} planned topics, status 'topic' (catalogued only — nothing drafted or published).`);
  out.push("insert into public.p2p_kingdom_story_topics (slug, title, category_id, summary, priority, research_notes, overlap_note, display_order)");
  out.push("select v.slug, v.title, c.id, v.summary, v.priority, v.research_notes, v.overlap_note, v.display_order");
  out.push("  from (values");
  out.push(topics.map((t) => `    (${lit(t.slug)}, ${lit(t.title)}, ${lit(t.categorySlug)}, ${lit(t.summary)}, ${lit(t.priority)}, ${lit(t.researchNotes)}, ${lit(t.overlapNote)}, ${t.displayOrder})`).join(",\n"));
  out.push("  ) as v(slug, title, category_slug, summary, priority, research_notes, overlap_note, display_order)");
  out.push("  join public.p2p_kingdom_story_categories c on c.slug = v.category_slug");
  out.push("on conflict (slug) do nothing;");
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = readFileSync(file, "utf8");
  const a = sql.indexOf(BEGIN), b = sql.indexOf(END);
  if (a < 0 || b < a) { console.error("seed markers missing in migration 210"); process.exit(2); }
  const next = sql.slice(0, a + BEGIN.length) + "\n" + seedSql() + "\n" + sql.slice(b);
  if (process.argv.includes("--check")) {
    if (next !== sql) { console.error("migration 210 seed is out of date — run scripts/kingdom-stories/build-seed.mjs"); process.exit(1); }
    console.log("migration 210 seed matches the catalogue");
  } else {
    writeFileSync(file, next);
    console.log(`wrote seed: ${CATEGORIES.length} categories, ${buildTopics().length} topics`);
  }
}
