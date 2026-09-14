// Generates docs/REAL-MEDIA-SOURCING.md directly from lib/media.ts, so the
// checklist can never drift out of sync with the actual manifest. Run with:
//   node --experimental-strip-types scripts/gen-media-doc.mjs
// (or via `npx tsx scripts/gen-media-doc.mjs` if strip-types isn't available)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaSrc = fs.readFileSync(path.join(__dirname, "../lib/media.ts"), "utf8");

// Extract the MEDIA_MANIFEST array body via a tiny hand-rolled parser isn't
// worth it here — instead, transpile just enough by stripping TS types is
// overkill for a docs script. Simplest robust approach: require ts-node/tsx
// isn't guaranteed present, so this script instead regex-extracts each
// object literal's key fields directly from the source text.
const entries = [];
const objRe = /\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\},?\n/g;
let m;
while ((m = objRe.exec(mediaSrc))) {
  const block = m[0];
  const get = (key) => {
    const r = new RegExp(`${key}:\\s*"([^"]*)"`).exec(block);
    return r ? r[1] : "";
  };
  entries.push({
    id: m[1],
    type: get("type"),
    status: get("status"),
    page: get("page"),
    section: get("section"),
    subject: get("subject"),
    aspectRatio: get("aspectRatio"),
  });
}

const lines = [
  "# Real Media Sourcing Checklist",
  "",
  "**Auto-generated from `lib/media.ts` — do not hand-edit this file.** Regenerate with `node scripts/gen-media-doc.mjs` after changing the manifest.",
  "",
  "Every row below is a real slot on the live site today, rendering as a labeled placeholder. Nothing marked here is fabricated — `status` is the honest signal of what actually exists.",
  "",
  `Total slots: ${entries.length} · Placeholder: ${entries.filter((e) => e.status === "placeholder").length} · Pending (needs a real asset, e.g. app screenshots): ${entries.filter((e) => e.status === "pending").length}`,
  "",
  "| ID | Page | Section | Type | Subject | Aspect | Status |",
  "| -- | ---- | ------- | ---- | ------- | ------ | ------ |",
  ...entries.map(
    (e) => `| \`${e.id}\` | ${e.page} | ${e.section} | ${e.type} | ${e.subject} | ${e.aspectRatio} | ${e.status} |`
  ),
  "",
  "## How to add a real asset",
  "",
  "1. Drop the file into the matching `public/media/<category>/` subfolder.",
  "2. In `lib/media.ts`, set that slot's `filename`, and move `status` to `\"p2p-owned\"` (real P2P media) or `\"licensed\"` (properly licensed third-party media).",
  "3. Fill in `source`, `creator`, `attribution`, `license`, and `sourceUrl` for anything not P2P-owned.",
  "4. Nothing else changes — `<RealImage>` / `<RealVideo>` already render the real asset automatically once `status` and `filename` are set; `<MediaPlaceholder>` stops rendering for that slot.",
  "",
  "## What must never happen",
  "",
  "- No slot moves to `\"p2p-owned\"` or `\"licensed\"` without a real file backing it.",
  "- No app-screenshot slot (`P2P_APP_SCREEN_*`, `P2P_APP_001`, `P2P_APP_VIDEO_001`) is ever filled with a redesigned or invented screen — only an actual capture from the running app.",
  "- No stock photo is marked as depicting a real P2P member, family, or church.",
];

fs.writeFileSync(path.join(__dirname, "../docs/REAL-MEDIA-SOURCING.md"), lines.join("\n") + "\n");
console.log(`Wrote docs/REAL-MEDIA-SOURCING.md with ${entries.length} entries.`);
