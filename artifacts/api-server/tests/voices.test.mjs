// P2P Voices (owner brief 2026-11-18) — the real modules (lib/voices/*, routes/narrationsAdmin helpers), bundled,
// with FAKE providers (no credentials, no network, nothing is ever sent to Azure, Google, ElevenLabs or Spitch).
//   A catalogue: dynamic, normalised (accent from locale, presentation only when supplied, characteristics only
//     from metadata), child voices excluded, filters + facets, caching, provider failure → last verified list
//   B ElevenLabs: no synthesize anywhere, preview = provider link (no generation), no TTS endpoint in the server
//   C/D eligibility: Bible / playlists only in public-domain translations (owner 2026-11-19); language must match
//   G cache: same content+voice reused, edited text regenerates, concurrent requests generate ONCE
//   I security: no provider secret in the app; narration routes owner-only; uploads validated
// Run: node tests/voices.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.resolve(root, "../mobile");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-voices-"));
let V;
try {
  await build({ stdin: { contents: `export * from "./src/lib/voices/catalogue"; export * from "./src/lib/voices/synth"; export * as T from "./src/lib/voices/types"; export * as P from "./src/lib/voices/providers"; export { audioKind, checkTimings } from "./src/routes/narrationsAdmin"; export { cleanPrefs } from "./src/routes/voices";`,
    resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "v.mjs"), loader: { ".txt": "text" }, logLevel: "silent", packages: "external" });
  V = await import(pathToFileURL(path.join(tmp, "v.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ── fake providers ──
const now = new Date().toISOString();
const mk = (provider, id, locale, presentation, extra = {}) => ({ id: `${provider}:${id}`, provider, providerVoiceId: id, name: id, ...V.T.describeLocale(locale), presentation,
  characteristics: [], model: null, preview: { kind: "generate" }, canSynthesize: true, status: "available", source: "fake", refreshedAt: now, ...extra });
let synthCalls = 0, azureDown = false;
const azure = { id: "azure", name: "Azure", role: "", policy: { cacheAllowed: true, offlineAllowed: true, retentionDays: null, note: "" }, status: () => ({ enabled: true, reason: null }),
  async listVoices() { if (azureDown) throw new V.T.ProviderError("azure", "unavailable", "down"); return [mk("azure", "en-GB-SoniaNeural", "en-GB", "female", { characteristics: V.T.characteristicsFrom(["Warm", "Narration"]) }), mk("azure", "en-NG-AbeoNeural", "en-NG", "male"), mk("azure", "de-DE-KatjaNeural", "de-DE", "female")]; },
  async synthesize(text) { synthCalls++; await new Promise((r) => setTimeout(r, 20)); return { audio: Buffer.alloc(500, 1), contentType: "audio/mpeg", characters: text.length }; } };
const google = { ...azure, id: "google", name: "Google", async listVoices() { return [mk("google", "en-GB-Neural2-A", "en-GB", "female"), mk("google", "en-US-Neural2-X", "en-US", null)]; } };
const eleven = { id: "elevenlabs", name: "ElevenLabs", role: "", policy: { cacheAllowed: false, offlineAllowed: false, retentionDays: null, note: "" }, status: () => ({ enabled: true, reason: null }),
  async listVoices() { return [mk("elevenlabs", "xi1", "en-GB", "male", { canSynthesize: false, preview: { kind: "url", url: "https://example.org/preview.mp3" } })]; } };
const off = { ...google, id: "spitch", status: () => ({ enabled: false, reason: "not verified" }), async listVoices() { return [mk("spitch", "ig1", "ig", "female")]; } };
V.setProvidersForTests([azure, google, eleven, off]);
const store = new Map(); V.setTestStore(store);

// ── A. catalogue ──
const all = await V.catalogue({});
ok("dynamic catalogue: only ENABLED providers' voices (unverified Igbo provider hidden)", all.total === 6 && !all.voices.some((v) => v.language === "ig"));
ok("accent from the locale: en-NG → Nigerian English, en-GB → British English", all.voices.some((v) => v.accent === "Nigerian English") && all.voices.some((v) => v.accent === "British English"));
ok("presentation only when the provider says (neutral → none)", all.voices.find((v) => v.id === "google:en-US-Neural2-X").presentation === null);
ok("characteristics only from provider metadata (Warm, Narration → warm, narrator)", JSON.stringify(all.voices.find((v) => v.id === "azure:en-GB-SoniaNeural").characteristics.sort()) === '["narrator","warm"]');
ok("language filter", (await V.catalogue({ language: "de" })).voices.every((v) => v.language === "de"));
ok("accent filter", (await V.catalogue({ accent: "British English" })).voices.every((v) => v.accent === "British English"));
ok("provider filter", (await V.catalogue({ provider: "google" })).voices.every((v) => v.provider === "google"));
ok("female/male filter", (await V.catalogue({ presentation: "male" })).voices.every((v) => v.presentation === "male"));
ok("facets list only values that exist", all.facets.presentation.every((x) => x.count > 0) && !all.facets.language.some((x) => x.key === "ig"));
ok("purpose 'everyday' lists only voices P2P can synthesise (no ElevenLabs)", !(await V.catalogue({ purpose: "everyday" })).voices.some((v) => v.provider === "elevenlabs"));
ok("no child voices offered (metadata check)", V.T.isChildVoice(["child"]) && V.T.isChildVoice(["young girl"]) && !V.T.isChildVoice(["young adult", "warm"]));
azureDown = true; V.setProvidersForTests([azure, google, eleven, off]); // fresh cache, provider down, no stored list
const down = await V.catalogue({});
ok("provider down with nothing verified before → its voices are not invented", !down.voices.some((v) => v.provider === "azure") && down.providers.find((p) => p.id === "azure").stale);
azureDown = false; V.setProvidersForTests([azure, google, eleven, off]); await V.catalogue({});
azureDown = true; const again = await V.allVoices(true);
ok("provider down after a verified refresh → the last verified list is kept (stale)", again.voices.some((v) => v.provider === "azure") && again.providers.find((p) => p.id === "azure").stale);
azureDown = false;
const caps = await V.capabilities();
ok("capabilities: languages from real voices only", caps.some((c) => c.language === "en" && c.canListen) && !caps.some((c) => c.language === "ig"));

// ── B. ElevenLabs ──
ok("the real ElevenLabs adapter has NO synthesize (no generation possible)", V.P.elevenlabs.synthesize === undefined);
const req = (o) => V.speak({ userId: "u1", voiceId: "azure:en-GB-SoniaNeural", contentKind: "story", contentKey: "story:s1:c1", contentVersion: "v1", language: "en", text: "In the beginning was the Word.", baseUrl: "http://x", ...o });
let err = null; try { await req({ voiceId: "elevenlabs:xi1" }); } catch (e) { err = e; }
ok("an ElevenLabs voice can't be used to read content (catalogue only)", err?.code === "catalogue_only" && synthCalls === 0);
const pv = await V.preview("u1", "elevenlabs:xi1", "http://x");
ok("ElevenLabs preview = the provider's own sample link (no generation, no credits)", pv.kind === "provider" && pv.url.startsWith("https://example.org/") && synthCalls === 0);
const srcFiles = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? srcFiles(p) : [p]; });
const serverSrc = srcFiles(path.join(root, "src")).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(f, "utf8")).join("\n");
ok("the server source never calls an ElevenLabs text-to-speech endpoint", !/api\.elevenlabs\.io\/v\d\/text-to-speech/.test(serverSrc));
ok("the narration admin routes contain no TTS call", !/elevenlabs\.io|synthesize\(/.test(readFileSync(path.join(root, "src/routes/narrationsAdmin.ts"), "utf8")));

// ── C/D. eligibility ──
// Owner 2026-11-19: P2P Voice only — the Bible and playlists too, but ONLY in a public-domain translation.
V.setTranslationLookupForTests(async (code) => ({
  KJV: { translation_code: "KJV", provider: null, license_notes: "Public domain — no restrictions" },
  "AO-eng_asv": { translation_code: "AO-eng_asv", provider: "helloao", licence_status: "approved", licence_name: "Public domain" },
  NIV: { translation_code: "NIV", provider: null, license_notes: "Copyright © Biblica" },
  ONEN: { translation_code: "ONEN", provider: null, license_notes: "Biblica® Open License — available in API.Bible" },
  "AO-eng_lsv": { translation_code: "AO-eng_lsv", provider: "helloao", licence_status: "approved", licence_name: "CC BY-SA 4.0" },
}[code] ?? null));
const tryReq = async (o) => { try { return { r: await req(o) }; } catch (e) { return { e }; } };
for (const kind of ["bible", "playlist"]) {
  ok(`${kind}: no translation named → refused`, (await tryReq({ contentKind: kind })).e?.code === "translation_required");
  ok(`${kind}: public-domain API.Bible translation (KJV) → read`, !!(await tryReq({ contentKind: kind, contentKey: "bible:KJV:JHN.3", translation: "KJV" })).r?.url);
  ok(`${kind}: public-domain AO Lab translation (ASV) → read`, !!(await tryReq({ contentKind: kind, contentKey: "bible:AO-eng_asv:JHN.3", translation: "AO-eng_asv" })).r?.url);
  for (const t of ["NIV", "ONEN", "AO-eng_lsv", "UNKNOWN"]) ok(`${kind}: ${t} (not public domain) → refused`, (await tryReq({ contentKind: kind, translation: t })).e?.code === "translation_not_permitted");
}
ok("study (commentary, dictionary, lexicon) → read", !!(await tryReq({ contentKind: "study", contentKey: "dictionary:grace" })).r?.url);
ok("unknown content kinds are still refused", (await tryReq({ contentKind: "messages" })).e?.code === "not_eligible");
err = null; try { await req({ language: "de" }); } catch (e) { err = e; }
ok("the voice must speak the TEXT's language (no silent translation)", err?.code === "language_mismatch");
err = null; try { await req({ text: "x".repeat(2000) }); } catch (e) { err = e; }
ok("long text is refused (the player sends sentences)", err?.code === "too_long");

// ── G. caching and deduplication ──
synthCalls = 0;
const [a1, a2, a3] = await Promise.all([req(), req(), req()]);
ok("three simultaneous requests for the same sentence → ONE generation", synthCalls === 1 && a1.url === a2.url && a2.url === a3.url);
const a4 = await req();
ok("the same content + voice later → served from the cache", a4.cached && synthCalls === 1);
await req({ text: "In the beginning was the Word, and the Word was with God." });
ok("edited content → a new recording (old audio never served for new text)", synthCalls === 2);
await req({ contentVersion: "v2" });
ok("a new content version → a new recording", synthCalls === 3);
ok("Daily Word, lessons and plans are eligible", ["daily_word", "lesson", "plan", "story-intro"].every((k) => V.isEligible(k)));
const prevA = await V.preview("u1", "azure:en-GB-SoniaNeural", "http://x"); const before = synthCalls; await V.preview("u1", "azure:en-GB-SoniaNeural", "http://x");
ok("Azure/Google preview: one short fixed sample, generated once then cached", prevA.kind === "sample" && synthCalls === before);
ok("local audio links are signed and expire", V.verifyLocal("a".repeat(64), Math.floor(Date.now() / 1000) + 60, V.signLocal("a".repeat(64), Math.floor(Date.now() / 1000) + 60)) && !V.verifyLocal("a".repeat(64), Math.floor(Date.now() / 1000) - 5, V.signLocal("a".repeat(64), Math.floor(Date.now() / 1000) - 5)));
V.resetLimitsForTests();
let limited = false; for (let i = 0; i < 1501; i++) if (!V.underLimit("u2", "speak")) limited = true;
ok("rate limit per participant", limited);

// ── F. preferences (server validation) ──
const p = V.cleanPrefs({ preferOfficial: false, byLanguage: { en: { voiceId: "azure:en-GB-SoniaNeural" }, de: { voiceId: "google:de-DE-X" }, "x!": { voiceId: "bad" } }, favourites: ["azure:en-GB-SoniaNeural", "javascript:alert(1)"] });
ok("preferences per language kept; invalid ids and languages dropped", p.byLanguage.en.voiceId === "azure:en-GB-SoniaNeural" && p.byLanguage.de && !p.byLanguage["x!"] && p.favourites.length === 1 && p.preferOfficial === false);

// ── I. narration uploads, permissions, secrets ──
ok("audio checked by its bytes (MP3 yes, a renamed text file no)", V.audioKind(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0])) === "mp3" && V.audioKind(new TextEncoder().encode("hello world, not audio")) === null);
const t = { storyId: "s", chapterId: "c", language: "en" };
ok("timing file must belong to THIS story and chapter", !V.checkTimings({ storyId: "other", chapterId: "c", words: "a b", starts: [0, 10], ends: [10, 20] }, t).ok && V.checkTimings({ storyId: "s", chapterId: "c", words: "a b", starts: [0, 10], ends: [10, 2000] }, t).ok);
ok("timing file must be complete (words = starts = ends)", !V.checkTimings({ words: "a b", starts: [0], ends: [1, 2] }, t).ok);
const nar = readFileSync(path.join(root, "src/routes/narrationsAdmin.ts"), "utf8");
ok("narration management is owner-only on the SERVER (every route)", nar.includes('router.use(requireAdmin, requireRole("super_admin"))'));
ok("approve requires the owner's explicit 'listened and verified'", nar.includes("req.body?.verified !== true"));
ok("nothing is deleted (withdraw / supersede only)", !/\.delete\(|\.remove\(/.test(nar));
const sn = readFileSync(path.join(root, "src/lib/storyNarration.ts"), "utf8");
ok("participants get only PUBLISHED official narration; withdrawn legacy hidden; legacy unchanged otherwise", sn.includes('in("status", ["published", "withdrawn"])') && sn.includes('if (decision.kind === "withdrawn") return null;'));
const appSrc = srcFiles(path.join(mobile, "lib")).concat(srcFiles(path.join(mobile, "components")), srcFiles(path.join(mobile, "app"))).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
ok("no provider secret or key name in the app", !/AZURE_SPEECH_KEY|GOOGLE_TTS_API_KEY|ELEVENLABS_API_KEY|SPITCH_API_KEY|xi-api-key|Ocp-Apim-Subscription-Key/.test(appSrc));
ok("no provider key in public (EXPO_PUBLIC_) variables", !/EXPO_PUBLIC_[A-Z_]*(AZURE|GOOGLE_TTS|ELEVEN|SPITCH)/.test(appSrc));
const listenSrc = readFileSync(path.join(mobile, "lib/listen/index.ts"), "utf8");
ok("the app's player uses the phone's voice only offline (owner 2026-11-19)", (listenSrc.match(/phoneSpeech\.speak\(/g) ?? []).length === 1 && listenSrc.includes("isNetworkFailure(e) ? noInternet() : refused("));
ok("the app's player sends the Bible translation so the server can check it", readFileSync(path.join(mobile, "lib/listen/engine.ts"), "utf8").includes("translation: content.sections[c.section]?.translation"));
ok("official narration comes first unless the listener chose otherwise", listenSrc.includes("(!official || (chosen && !getVoicePrefs().preferOfficial && !authorised))"));
const mig = readFileSync(path.join(root, "../../migrations/254_p2p_voices.sql"), "utf8");
ok("migration 254: additive, RLS on, API-only, one published recording per chapter", !/drop table|alter table [^;]* drop|delete from/i.test(mig.replace(/-- .*$/gm, "")) && (mig.match(/enable row level security/g) ?? []).length === 5 && mig.includes("where status = 'published'"));

console.log(`voices (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
