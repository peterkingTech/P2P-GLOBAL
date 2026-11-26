// Builds data/intro-videos/bundle.txt (JSON, bundled into the API as text) from:
//   data/intro-videos/timing.json   — exported by the video library (P2P-GLOBAL-VIDEO-LIBRARY/_ENGINE/export_app_text.py)
//   data/intro-videos/lang/*.json   — one file per language (en = the original script)
// Checks every language against the English source: each unit and on-screen text id must exist, nothing extra,
// brand text (the network's name) is not translated, statuses are valid, and a language that quotes Scripture
// names its Bible translations and their licences.
//   node scripts/build-intro-videos.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "intro-videos");
const timing = JSON.parse(readFileSync(join(DIR, "timing.json"), "utf8"));
const STATUSES = new Set(["not_started", "translated", "audio_generated", "awaiting_review", "approved", "published", "withdrawn"]);
const langs = {};
const problems = [];
for (const f of readdirSync(join(DIR, "lang")).filter((x) => x.endsWith(".json")).sort()) {
  const L = JSON.parse(readFileSync(join(DIR, "lang", f), "utf8"));
  const code = f.replace(/\.json$/, "");
  if (L.code !== code) problems.push(`${f}: code is ${L.code}`);
  for (const v of timing.videos) {
    const lv = L.videos?.[v.id];
    if (!lv) continue;   // this language has nothing for this video yet
    if (!lv.title || !lv.description) problems.push(`${code} ${v.id}: title/description missing`);
    for (const k of ["subtitles", "overlays", "audio"]) if (lv.status?.[k] && !STATUSES.has(lv.status[k])) problems.push(`${code} ${v.id}: bad status ${k}=${lv.status[k]}`);
    if (code !== "en" && ["approved", "published"].includes(lv.status?.subtitles)) problems.push(`${code} ${v.id}: a content file may not mark a translation approved/published — reviewers do that in the Admin Centre`);
    const unitIds = new Set(v.units.map((u) => u.id));
    for (const id of Object.keys(lv.units ?? {})) if (!unitIds.has(id)) problems.push(`${code} ${v.id}: unknown unit ${id}`);
    if (lv.units && Object.keys(lv.units).length && Object.keys(lv.units).length < unitIds.size) problems.push(`${code} ${v.id}: ${unitIds.size - Object.keys(lv.units).length} units not translated`);
    const ovIds = new Set(v.overlays.flatMap((o) => (o.ref ? [o.id, `${o.id}.ref`] : [o.id])));
    for (const id of Object.keys(lv.overlays ?? {})) if (!ovIds.has(id)) problems.push(`${code} ${v.id}: unknown on-screen text ${id}`);
    for (const o of v.overlays) if (o.brand && lv.overlays?.[o.id] && code !== "en") problems.push(`${code} ${v.id}: ${o.id} is the network's name — not translated`);
    const quotes = v.overlays.some((o) => o.scripture && lv.overlays?.[o.id]);
    if (code !== "en" && quotes && !(L.scriptureSources ?? []).length) problems.push(`${code}: quotes Scripture but names no Bible translation`);
  }
  langs[code] = L;
}
if (!langs.en) problems.push("lang/en.json (the original) is missing");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
// narrator per film and voice-over language (optional): { <lang>: { <videoId>: { name, gender } } }
let voices = {};
try { voices = JSON.parse(readFileSync(join(DIR, "voices.json"), "utf8")); delete voices._note; } catch {}
const vprob = [];
for (const [code, per] of Object.entries(voices)) for (const [vid, x] of Object.entries(per)) {
  if (!timing.videos.some((v) => v.id === vid)) vprob.push(`voices.json ${code}: unknown video ${vid}`);
  if (!x?.name || !["male", "female"].includes(x.gender)) vprob.push(`voices.json ${code} ${vid}: needs a name and gender male/female`);
}
if (vprob.length) { console.error(vprob.join("\n")); process.exit(1); }
writeFileSync(join(DIR, "bundle.txt"), JSON.stringify({ version: timing.version, timing, langs, voices }));
console.log(`bundle.txt: ${timing.videos.length} videos, languages ${Object.keys(langs).join(", ")}`);
