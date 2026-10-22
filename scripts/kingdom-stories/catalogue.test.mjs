// Catalogue data checks (no database): the approved 24 categories in order,
// topic integrity, overlap flags, and migration 210's seed in sync.
// Run: node scripts/kingdom-stories/catalogue.test.mjs
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, ORIGINAL_TITLES, RETIRED_ORIGINAL_SLUGS, buildTopics, slugify } from "./catalogue.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const APPROVED = [
  "Biblical History", "Jesus Christ", "The Apostles & The Early Church", "Early Christianity & The Church Fathers",
  "African Christianity", "Asian Christianity", "European Christianity", "Christianity in the Americas", "The Reformation",
  "Bible History & Translation", "Missionaries & Mission Movements", "Revivals & Spiritual Awakenings",
  "Christian Persecution & Martyrdom", "Christian Leaders & Teachers", "Women of Faith", "Prayer & Intercession",
  "Discipleship & Spiritual Formation", "Christianity & Social Justice", "Christian Martyrs, Heroes & Courageous Witnesses",
  "Church Councils, Denominations & Movements", "Christianity, Culture & Civilisation", "Christianity in the Modern World",
  "Archaeology, Discoveries & Historical Evidence", "Places, Pilgrimages & Sacred Sites",
];
ok("24 categories with the approved names, in order", JSON.stringify(CATEGORIES.map((c) => c.title)) === JSON.stringify(APPROVED), JSON.stringify(CATEGORIES.map((c) => c.title)));
ok("category slugs unique and URL-safe", new Set(CATEGORIES.map((c) => c.slug)).size === 24 && CATEGORIES.every((c) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)));
ok("every category has a description and an icon", CATEGORIES.every((c) => c.description?.length > 20 && c.icon));
const mapped = CATEGORIES.filter((c) => c.existing).map((c) => c.slug).sort();
ok("the 10 mapped originals keep migration 152 slugs", JSON.stringify(mapped) === JSON.stringify(Object.keys(ORIGINAL_TITLES).sort()));
ok("retired originals are the other 3 of 152's 13", RETIRED_ORIGINAL_SLUGS.length === 3 && RETIRED_ORIGINAL_SLUGS.every((s) => !mapped.includes(s)));
ok("no duplicate title inside one category", CATEGORIES.every((c) => new Set(c.topics.map((t) => t.title)).size === c.topics.length));
ok("titles are trimmed and non-empty", CATEGORIES.every((c) => c.topics.every((t) => t.title === t.title.trim() && t.title.length > 2 && t.title.length <= 200)));
ok("priorities valid", CATEGORIES.every((c) => ["P2", "P3"].includes(c.defaultPriority) && c.topics.every((t) => !t.priority || ["P1", "P2", "P3", "P4"].includes(t.priority))));
ok("P1 only in the foundational categories", CATEGORIES.every((c) => c.topics.every((t) => t.priority !== "P1" || ["biblical-history", "jesus-christ", "apostles-early-church", "discipleship"].includes(c.slug))));
ok("research notes only state Scripture passages, marked for verification", CATEGORIES.every((c) => c.topics.every((t) => !t.notes || (/^Scripture: /.test(t.notes) && /Verify/.test(t.notes)))));

const topics = buildTopics();
ok("topic slugs unique, URL-safe, ≤160 chars", new Set(topics.map((t) => t.slug)).size === topics.length && topics.every((t) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug) && t.slug.length <= 160));
ok("slugs are stable (same input, same output)", JSON.stringify(buildTopics().map((t) => t.slug)) === JSON.stringify(topics.map((t) => t.slug)));
ok("accents and apostrophes slugify cleanly", slugify("Teresa of Ávila") === "teresa-of-avila" && slugify("Paul's Journey to Rome") === "pauls-journey-to-rome" && slugify("Revivals & Awakenings") === "revivals-and-awakenings");
ok("summaries say 'planned', never claim facts", topics.every((t) => t.summary.includes("a planned Kingdom Story")));
const flagged = (title) => topics.filter((t) => t.title === title).every((t) => t.overlapNote);
for (const t of ["Perpetua and Felicity", "The Council of Nicaea", "Codex Sinaiticus", "The Azusa Street Revival", "Mary Slessor", "Polycarp of Smyrna", "Corrie ten Boom", "The First Great Awakening", "Samuel Ajayi Crowther"]) {
  ok(`overlap flagged: ${t}`, flagged(t));
}
ok("Martin Luther is not confused with Martin Luther King Jr.", !(topics.find((t) => t.title === "Martin Luther King Jr. and the Black Church").overlapNote ?? "").includes("“Martin Luther”"));
ok("First and Second Great Awakening are not flagged as each other", !topics.find((t) => t.title === "The First Great Awakening").overlapNote.includes("Second"));
ok("a distinct topic is not flagged", topics.find((t) => t.title === "The Pilate Stone").overlapNote === null);

const here = path.dirname(fileURLToPath(import.meta.url));
let inSync = true;
try { execFileSync(process.execPath, [path.join(here, "build-seed.mjs"), "--check"], { stdio: "pipe" }); } catch { inSync = false; }
ok("migration 210 seed matches the catalogue", inSync);

console.log(`\ncatalogue data: ${pass} passed, ${fail} failed (${CATEGORIES.length} categories, ${topics.length} topics, ${topics.filter((t) => t.overlapNote).length} overlap flags)`);
process.exit(fail ? 1 : 0);
