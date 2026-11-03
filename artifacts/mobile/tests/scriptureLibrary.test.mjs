// Scripture Listening Library (migration 227) on the app side: the clients in
// lib/scriptureLibraryApi.ts and the 227 additions to lib/scriptureCollectionsApi.ts
// call the right server routes with the right bodies (rules and security are
// tested on the server: api-server/tests/scriptureLibrary.test.mjs).
// Run: node tests/scriptureLibrary.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");

// Every request is recorded instead of sent.
const sent = [];
const mocks = {
  "@/lib/apiClient": { apiRequest: async (p, init = {}) => { sent.push({ path: p, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined }); return {}; } },
  "@/lib/sharing": { WEB_APP_URL: "https://example.invalid" },
};
const load = (rel) => {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => { if (m in mocks) return mocks[m]; throw new Error(`unexpected require ${m}`); }, URLSearchParams, JSON });
  return mod.exports;
};
const last = () => sent[sent.length - 1];
const L = load("lib/scriptureLibraryApi.ts");
const C = load("lib/scriptureCollectionsApi.ts");
const ref = { translationCode: "BSB", bookCode: "JHN", chapter: 3, startVerse: 16, endVerse: 16 };

await L.saveScripture(ref, { favourite: true, collectionIds: ["p1", "c1"] });
ok("save: one request carries every destination", last().path === "/scripture-library/save" && last().method === "POST" && last().body.favourite === true && last().body.collectionIds.join() === "p1,c1" && last().body.ref.bookCode === "JHN");
await L.listSaved({ tag: "Faith", favourites: true, memorisation: "practising", offset: 50 });
ok("saved list: filters in the query", last().path === "/scripture-library/saved?tag=Faith&favourites=1&memorisation=practising&offset=50");
await L.listSaved();
ok("saved list: no filters → no query", last().path === "/scripture-library/saved");
await L.updateSaved("s1", { title: "Promise", tags: ["Hope"], memorisation: null });
ok("saved details: PATCH with title / tags / memorisation (null clears)", last().path === "/scripture-library/saved/s1" && last().method === "PATCH" && last().body.memorisation === null && last().body.tags[0] === "Hope");
await L.favouriteCollection("p1");
ok("favourite a playlist", last().path === "/scripture-library/favourites" && last().method === "PUT" && last().body.collectionId === "p1");
await L.favouritePassage(ref);
ok("favourite a passage by reference", last().method === "PUT" && last().body.ref.startVerse === 16);
await L.removeFavourite("f1");
ok("remove a favourite (only the favourite)", last().path === "/scripture-library/favourites/f1" && last().method === "DELETE");
await L.historyStarted(ref, { collectionId: "p1", itemId: "i1", source: "playlist" });
ok("history: a passage started", last().path === "/scripture-library/history" && last().method === "POST" && last().body.source === "playlist" && last().body.itemId === "i1");
await L.historyCompleted("h1", 42);
ok("history: a passage finished", last().path === "/scripture-library/history/h1/complete" && last().body.listenedSeconds === 42);
await L.clearHistory();
ok("history: clear", last().path === "/scripture-library/history" && last().method === "DELETE");
await L.saveResume("p1", { itemId: "i2", partKey: "i2:16", offset: 3, queue: ["i3", "i2"], shuffle: true, repeat: "all", rate: 1.25 });
ok("resume: saved per playlist", last().path === "/scripture-library/state/p1" && last().method === "PUT" && last().body.repeat === "all" && last().body.queue.length === 2);
await L.recentlyPlayed();
ok("recently played", last().path === "/scripture-library/recent");

await C.addToCollection("p1", [ref]);
ok("playlist add: no repeat unless asked", last().path === "/scripture-collections/p1/items" && last().body.allowRepeat === false);
await C.addToCollection("p1", [ref], undefined, true);
ok("playlist add: explicit repeat", last().body.allowRepeat === true);
await C.updateCollectionLook("p1", 4, { cover: { kind: "artwork", ref: "dawn-hills" }, tags: ["Morning"] });
ok("cover + tags with the current revision", last().path === "/scripture-collections/p1" && last().method === "PATCH" && last().body.revision === 4 && last().body.cover.ref === "dawn-hills");

const api = src("lib/scriptureLibraryApi.ts");
ok("client: never sends Bible text — references only", !/text\s*:/.test(api.replace(/\/\/.*$/gm, "")));
ok("client: older servers keep working (new collection fields optional)", /cover\?: CollectionCover \| null; tags\?: string\[\];/.test(src("lib/scriptureCollectionsApi.ts")));

console.log(`scriptureLibrary (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
