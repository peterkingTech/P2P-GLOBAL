// AO Lab "Free Use Bible API" as a second Bible provider — lib/bibleProviders/helloao.ts,
// lib/bibleLicence.ts and their use in lib/bibleReader.ts. Uses REAL responses
// saved from https://bible.helloao.org (tests/fixtures/helloao) — no invented
// Bible text — and an in-memory translations table. Covers: catalogue/books/
// chapter parsing, verse + formatting normalisation (headings, poetry, Hebrew
// subtitles, paragraphs, footnotes, RTL), licence gating and approval,
// provider-separated caching, request de-duplication, every error path, the
// development-only preview, and that API.Bible keeps working unchanged.
// Run: node tests/bibleProviders.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => JSON.parse(readFileSync(path.join(root, "tests/fixtures/helloao", f), "utf8"));
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(os.tmpdir(), "bible-providers-"));

// In-memory p2p_bible_translations (select * / eq / order).
const T = { p2p_bible_translations: [] };
globalThis.__bp = { db: { from(t) {
  const f = [];
  const c = { select() { return c; }, eq(k, v) { f.push((r) => r[k] === v); return c; }, order() { return c; },
    then(res) { res({ data: (T[t] ?? []).filter((r) => f.every((g) => g(r))).map((r) => ({ ...r })), error: null }); } };
  return c;
} } };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{ name: "m", setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: "s", namespace: "m" })); b.onLoad({ filter: /.*/, namespace: "m" }, () => ({ contents: "export const supabaseServiceRole = globalThis.__bp.db;", loader: "js" })); } }] });
  const f = path.join(tmp, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body) });

try {
  // One bundle of the reader: it includes the adapter and licence modules, so they share state.
  const R = await bundle("src/lib/bibleReader.ts", "reader.mjs");
  const H = await bundle("src/lib/bibleProviders/helloao.ts", "helloao.mjs");
  const L = await bundle("src/lib/bibleLicence.ts", "licence.mjs");

  // ── Catalogue ──────────────────────────────────────────────────────────
  const cat = H.parseCatalogue(fx("available_translations.sample.json"));
  ok("catalogue: real entries parsed with id, names, language, direction, licence statement", cat.length === 10 && cat.find((t) => t.id === "BSB")?.license?.publicDomain === true && cat.find((t) => t.id === "arb_vdv")?.textDirection === "rtl");
  ok("catalogue: an entry without a licence is kept with licence null (not assumed)", cat.some((t) => t.license === null));
  ok("catalogue: malformed entries / ids are dropped", H.parseCatalogue({ translations: [{ id: "../etc", name: "x", language: "eng" }, { name: "no id" }, null] }).length === 0);
  ok("catalogue: wrong shape is an invalid-response error", (() => { try { H.parseCatalogue({ nope: [] }); return false; } catch (e) { return e.kind === "invalid"; } })());

  // ── Books ──────────────────────────────────────────────────────────────
  const books = H.parseBooks(fx("BSB_books.json"));
  ok("books: 66 with chapter counts", books.length === 66 && books[0].id === "GEN" && books[0].numberOfChapters === 50);

  // ── Chapter normalisation (real John 3, Psalm 23, Arabic John 3) ─────────
  const jn = H.normaliseChapter(fx("BSB_JHN_3.json"));
  ok("John 3: 36 verses in order", jn.verses.length === 36 && jn.verses.every((v, i) => v.verse === i + 1));
  ok("John 3:16 text preserved exactly", jn.verses[15].text.startsWith("For God so loved the world that He gave His one and only Son"), jn.verses[15].text.slice(0, 80));
  ok("the space lost at a footnote marker is restored only between words — never in Chinese/Japanese/Thai",
    H.normaliseChapter({ chapter: { content: [{ type: "verse", number: 1, content: ["one and only", { noteId: 1 }, "Son"] }, { type: "verse", number: 2, content: ["上帝爱世人", { noteId: 2 }, "甚至"] }, { type: "verse", number: 3, content: ["word", { noteId: 3 }, ", next"] }], footnotes: [] } }).verses.map((v) => v.text).join("|") === "one and only Son|上帝爱世人甚至|word, next");
  ok("headings land before their verse", jn.headings[0].text === "Jesus and Nicodemus" && jn.headings[0].beforeVerse === 1);
  ok("paragraphs are tracked", new Set(jn.verses.map((v) => v.paragraph)).size > 2);
  ok("footnotes kept with their verse (markers removed from the text)", jn.footnotes.length > 0 && jn.footnotes[0].verse === 3 && jn.footnotes[0].text.startsWith("Or born from above") && !/noteId/.test(JSON.stringify(jn.verses)));
  ok("previous / next chapters", jn.previous?.bookCode === "JHN" && jn.previous.chapter === 2 && jn.next?.chapter === 4);
  ok("audio links read only from AO Lab's audio host, with readers", jn.audio.length === 3 && jn.audio.every((a) => a.url.startsWith("https://audio.bible.helloao.org/")));
  const ps = H.normaliseChapter(fx("BSB_PSA_23.json"));
  ok("Psalm 23: poetry lines kept on separate lines", ps.verses[0].poetry && ps.verses[0].text === "The LORD is my shepherd;\nI shall not want.", JSON.stringify(ps.verses[0].text));
  ok("Psalm 23: Hebrew subtitle shown as a heading before verse 1", ps.headings.some((h) => h.beforeVerse === 1 && h.text.includes("A Psalm of David.")));
  const ar = H.normaliseChapter(fx("arb_vdv_JHN_3.json"));
  ok("Arabic John 3: 36 verses, Arabic text intact", ar.verses.length === 36 && /[؀-ۿ]/.test(ar.verses[15].text));
  ok("hostile audio links are ignored", H.normaliseChapter({ chapter: { content: [], footnotes: [] }, thisChapterAudioLinks: { x: "https://evil.example/a.mp3", "../y": "https://audio.bible.helloao.org/z.mp3" } }).audio.length === 0);
  ok("malformed chapter is an invalid-response error", (() => { try { H.normaliseChapter({ chapter: { content: "x" } }); return false; } catch (e) { return e.kind === "invalid"; } })());

  // ── Licence rules ──────────────────────────────────────────────────────
  const base = { translation_code: "AO-BSB", translation_name: "Berean Standard Bible", language: "en", is_default_for_language: false, license_notes: null, api_bible_id: null, provider: "helloao", provider_translation_id: "BSB" };
  const approved = { ...base, is_licensed_confirmed: true, licence_status: "approved", reviewed_by: "u1", reviewed_at: "2026-11-02", permits_display: true, permits_commercial: true };
  ok("licence: an approved AO Lab translation is shown", L.isServable(approved));
  ok("licence: being in the catalogue is not enough (unreviewed / pending / rejected hidden)", !L.isServable({ ...base, is_licensed_confirmed: false, licence_status: "unreviewed" }) && !L.isServable({ ...approved, licence_status: "needs_information" }) && !L.isServable({ ...approved, licence_status: "rejected" }));
  ok("licence: approval needs display AND commercial use AND a reviewer", !L.isServable({ ...approved, permits_commercial: null }) && !L.isServable({ ...approved, permits_display: false }) && !L.isServable({ ...approved, reviewed_by: null }));
  ok("licence: unknown permissions default to NO (cache, recorded audio, sharing text)", !L.canCache(approved) && !L.canPlayRecordedAudio(approved) && !L.textCopyAllowed(approved));
  ok("licence: explicitly permitted ones are allowed", L.canCache({ ...approved, permits_caching: true }) && L.canPlayRecordedAudio({ ...approved, permits_audio: true }) && L.textCopyAllowed({ ...approved, permits_sharing: true }));
  const kjv = { translation_code: "KJV", translation_name: "King James Version", language: "en", is_default_for_language: true, license_notes: "Public domain — no restrictions", api_bible_id: "de4e12af7f28f599-01", is_licensed_confirmed: true, provider: "api.bible" };
  ok("licence: API.Bible rules unchanged (shown, cached, public-domain copy)", L.isServable(kjv) && L.canCache(kjv) && L.textCopyAllowed(kjv) && !L.textCopyAllowed({ ...kjv, license_notes: "© 2015 Lockman" }));
  ok("licence: older rows without a provider are API.Bible", L.providerOf({ provider: undefined }) === "api.bible");
  const notes = L.reviewNotes(cat.find((t) => t.license === null));
  ok("review notes never approve; they list open questions", notes.status === "unreviewed" && notes.questions.some((q) => /no licence summary/i.test(q)) && notes.questions.some((q) => /NOT assumed/.test(q)));
  ok("review notes flag non-commercial licences for app-store distribution", L.reviewNotes(cat.find((t) => t.license && t.license.commercialUse !== "allowed")).questions.some((q) => /Commercial use/.test(q)));
  ok("approval problems explain what's missing", L.approvalProblems({ licence_status: "approved", permits_display: true, permits_commercial: false, reviewed_by: "u", provider_translation_id: "BSB" }).some((p) => /commercial/i.test(p)) && L.approvalProblems(approved).length === 0);

  // ── Reader integration (translations table + network mocked) ────────────
  T.p2p_bible_translations = [kjv, approved, { ...base, translation_code: "AO-ENGWEBP", provider_translation_id: "ENGWEBP", is_licensed_confirmed: false, licence_status: "unreviewed" }];
  let aoCalls = 0, apiBibleCalls = 0;
  const routes = { "/api/BSB/JHN/3.json": () => response(200, fx("BSB_JHN_3.json")), "/api/BSB/books.json": () => response(200, fx("BSB_books.json")) };
  H.setHelloAoFetch(null);
  // The reader bundle has its own copy of the adapter: patch its fetch through the global (both use fetch()).
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://bible.helloao.org")) { aoCalls++; const r = routes[new URL(u).pathname]; return r ? r() : response(404, {}); }
    if (u.startsWith("https://api.scripture.api.bible")) { apiBibleCalls++; return response(200, { data: { content: [{ name: "para", type: "tag", attrs: { style: "p" }, items: [{ type: "text", text: "For God so loved the world…", attrs: { verseId: "JHN.3.16" } }] }], copyright: "Public Domain", next: { bookId: "JHN", number: "4" } } }); }
    throw new Error("unexpected fetch " + u);
  };
  process.env.API_BIBLE_KEY = "test-key";
  const list = await R.licensedTranslations();
  ok("reader: API.Bible + approved AO Lab listed; unreviewed AO Lab hidden", list.map((r) => r.translation_code).sort().join(",") === "AO-BSB,KJV");
  const pub = list.map(R.publicTranslation);
  ok("reader: each translation names its source; codes stay unique", pub.find((t) => t.code === "AO-BSB").provider === "helloao" && pub.find((t) => t.code === "KJV").provider === "api.bible" && new Set(pub.map((t) => t.code)).size === pub.length);
  const [a1, a2] = await Promise.all([R.getChapter("JHN", 3, "AO-BSB"), R.getChapter("JHN", 3, "AO-BSB")]);
  ok("reader: AO Lab chapter in the reader's model, with attribution", a1.verses.length === 36 && a1.translation.provider === "helloao" && /Free Use Bible API/.test(a1.copyright ?? "") && a1.footnotes.length > 0);
  ok("reader: identical requests at the same time share ONE provider call", aoCalls === 1 && a1 === a2);
  ok("reader: recorded audio withheld until its licence is approved", !("audio" in a1));
  await R.getChapter("JHN", 3, "AO-BSB");
  ok("reader: not cached when the licence doesn't permit caching", aoCalls === 2);
  T.p2p_bible_translations[1] = { ...approved, permits_caching: true, permits_audio: true }; R.clearTranslationCache();
  const c1 = await R.getChapter("JHN", 3, "AO-BSB"); const before = aoCalls; await R.getChapter("JHN", 3, "AO-BSB");
  ok("reader: cached when permitted (no second call); audio offered when permitted", aoCalls === before && c1.audio?.length === 3);
  const k = await R.getChapter("JHN", 3, "KJV");
  ok("reader: API.Bible path unchanged (regression)", apiBibleCalls === 1 && k.verses[0].verse === 16 && k.translation.provider === undefined);
  ok("reader: provider caches are separate (KJV call didn't touch AO Lab)", aoCalls === before);
  ok("reader: books for an AO Lab translation come from its own list", (await R.booksFor("AO-BSB")).length === 66 && (await R.booksFor("KJV")).length === 66);
  const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
  const missing = await err(R.getChapter("JHN", 4, "AO-BSB"));
  ok("errors: chapter not in the translation → 404 with a clear message", missing?.status === 404 && /isn't in this translation/.test(missing.message));
  ok("errors: an unapproved translation is simply unavailable", (await err(R.getChapter("JHN", 3, "AO-ENGWEBP")))?.status === 404);
  ok("errors: word search says it isn't available (reference search still works)", (await err(R.searchBible("love", "AO-BSB", 0)))?.status === 400 && (await R.searchBible("John 3:16", "AO-BSB", 0)).kind === "reference");
  routes["/api/BSB/ROM/1.json"] = () => { throw Object.assign(new Error("down"), { name: "TypeError" }); };
  ok("errors: no network → 502 'couldn't be reached'", (await err(R.getChapter("ROM", 1, "AO-BSB")))?.message.includes("couldn't be reached"));
  routes["/api/BSB/ROM/2.json"] = () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
  ok("errors: timeout → 504", (await err(R.getChapter("ROM", 2, "AO-BSB")))?.status === 504);
  routes["/api/BSB/ROM/3.json"] = () => response(503, {});
  ok("errors: provider unavailable → 502", (await err(R.getChapter("ROM", 3, "AO-BSB")))?.status === 502);
  routes["/api/BSB/ROM/4.json"] = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } });
  ok("errors: unreadable reply → 502 invalid", /couldn't read/.test((await err(R.getChapter("ROM", 4, "AO-BSB")))?.message ?? ""));
  routes["/api/BSB/ROM/5.json"] = () => response(200, { chapter: { content: "not a list" } });
  ok("errors: wrong shape → invalid, never guessed", /unexpected/.test((await err(R.getChapter("ROM", 5, "AO-BSB")))?.message ?? ""));
  ok("validation: bad book / chapter never reach the network", (await err(R.getChapter("XYZ", 1, "AO-BSB")))?.status === 400 && (await err(R.getChapter("JHN", 99, "AO-BSB")))?.status === 400);
  ok("validation: adapter rejects unsafe ids before building a URL", (await err(H.getHelloAoChapter("../../x", "JHN", 3)))?.kind === "not_found");

  // ── Development preview (never in production) ──────────────────────────
  routes["/api/available_translations.json"] = () => response(200, fx("available_translations.sample.json"));
  for (const k of ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "RAILWAY_SERVICE_ID"]) delete process.env[k];
  process.env.HELLOAO_PREVIEW = "arb_vdv"; R.clearTranslationCache();
  const dev = (await R.licensedTranslations()).map(R.publicTranslation);
  const pv = dev.find((t) => t.code === "AO-arb_vdv");
  ok("preview (local machine): listed, marked as not yet approved, RTL, Arabic", pv && pv.preview && /licence not yet approved/.test(pv.name) && pv.textDirection === "rtl" && pv.language === "ar");
  process.env.RAILWAY_PROJECT_ID = "d3dbf174"; R.clearTranslationCache();
  ok("preview: ignored on the deployed server even if the variable is set", !(await R.licensedTranslations()).some((r) => r.preview));
  delete process.env.RAILWAY_PROJECT_ID; delete process.env.HELLOAO_PREVIEW;
} catch (e) { fail++; console.log("FAIL crashed", e?.stack ?? e); }
finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`bibleProviders: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
