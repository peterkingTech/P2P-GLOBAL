// Tests for the Kingdom Stories library/discovery app surfaces (migration 215):
//  1. lib/storyShare.ts — share text, link parsing, chat send through the
//     normal message insert (RLS errors become a friendly message).
//  2. formatTopicNumber + progressOf — "Topic 007", "Chapter 3 of 8".
//  3. Source checks — homepage, library, collections admin, image slots,
//     topic-number field, reader Favourite/Later/Share, chat "Open story".
// Run: node tests/kingdomLibrary.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const anyModule = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? true : k === "default" ? anyModule : host(String(k))) });
const mocks = {
  "@/lib/sharing": { APP_SCHEME: "p2pglobalbiblestudy" },
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
  "@/lib/togetherTheme": { colors: {}, type: {}, MIN_TOUCH_TARGET: 44 },
  react: require("react"),
  "react-native": { StyleSheet: { create: (s) => s }, Platform: { OS: "web" } },
};
const cache = new Map();
function load(rel) {
  const file = path.join(root, rel);
  if (cache.has(file)) return cache.get(file);
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const req = (m) => {
    if (m in mocks) return mocks[m];
    if (m === "@/lib/kingdomStoriesApi") return load("lib/kingdomStoriesApi.ts");
    return anyModule;
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req, console, fetch: async () => ({ ok: false }), setTimeout, clearTimeout });
  cache.set(file, mod.exports);
  return mod.exports;
}

// 1. storyShare
const share = load("lib/storyShare.ts");
const ID = "0f8b2c4e-1a2b-4c3d-8e9f-0123456789ab";
const msg = share.storyShareMessage({ id: ID, title: "Daniel in Babylon", subtitle: "Faith under pressure", topicNumber: 7 });
ok("share: topic number padded", msg.includes("Topic 007 · Daniel in Babylon"), msg);
ok("share: subtitle on its own line", msg.includes("\nFaith under pressure\n"));
ok("share: deep link", msg.endsWith(`p2pglobalbiblestudy://kingdom-stories/${ID}`));
ok("share: no number when unset", !share.storyShareMessage({ id: ID, title: "X" }).includes("Topic"));
ok("share: no progress/notes leaked", !/progress|note|answer/i.test(msg));
ok("link parse: finds id", share.storyIdInMessage(`hey look ${share.storyLink(ID)} !`) === ID);
ok("link parse: case-insensitive, lower-cased", share.storyIdInMessage(`p2pglobalbiblestudy://kingdom-stories/${ID.toUpperCase()}`) === ID);
ok("link parse: other links ignored", share.storyIdInMessage("https://example.com/kingdom-stories/abc") === null);
ok("link parse: null body", share.storyIdInMessage(null) === null);

function fakeClient(error) {
  const calls = [];
  return { calls, from: (t) => ({ insert: (row) => { calls.push({ t, row }); return { select: () => ({ single: async () => ({ data: error ? null : { id: row.id }, error }) }) }; } }) };
}
{
  const c = fakeClient(null);
  const r = await share.sendStoryToChat(c, { conversationId: "conv", senderId: "me", body: msg });
  ok("send: ok", r.ok === true);
  ok("send: normal p2p_messages insert", c.calls[0]?.t === "p2p_messages" && c.calls[0].row.conversation_id === "conv" && c.calls[0].row.sender_id === "me");
  ok("send: client-generated uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(c.calls[0]?.row.id ?? ""));
  const denied = await share.sendStoryToChat(fakeClient({ message: "new row violates row-level security policy" }), { conversationId: "x", senderId: "me", body: "b" });
  ok("send: RLS → can't post", !denied.ok && /can't post/.test(denied.error));
  const other = await share.sendStoryToChat(fakeClient({ message: "network" }), { conversationId: "x", senderId: "me", body: "b" });
  ok("send: other error → retry text", !other.ok && /try again/.test(other.error));
}

// 2. formatting + progress
const api = load("lib/kingdomStoriesApi.ts");
ok("topic: 7 → Topic 007", api.formatTopicNumber(7) === "Topic 007");
ok("topic: 1234 → Topic 1234", api.formatTopicNumber(1234) === "Topic 1234");
ok("topic: null → null", api.formatTopicNumber(null) === null && api.formatTopicNumber(undefined) === null);
const { progressOf } = load("components/kingdom-stories/DiscoverRow.tsx");
ok("progress: not started → null", progressOf({ myProgress: { started: false, doneChapters: 0, totalChapters: 8 } }) === null);
ok("progress: no progress → null", progressOf({ myProgress: null }) === null);
const mid = progressOf({ myProgress: { started: true, doneChapters: 2, totalChapters: 8 }, lastChapterNumber: 3 });
ok("progress: mid", mid?.label === "Chapter 3 of 8" && mid.fraction === 0.25, JSON.stringify(mid));
const fb = progressOf({ myProgress: { started: true, doneChapters: 2, totalChapters: 8 } });
ok("progress: falls back to next chapter", fb?.label === "Chapter 3 of 8");
ok("progress: completed", progressOf({ myProgress: { started: true, doneChapters: 9, totalChapters: 8 } })?.label === "Completed");

// 3. source checks
const home = src("app/kingdom-stories/index.tsx");
ok("home: uses discover endpoint", home.includes("getDiscoverHome"));
for (const row of ["continueLearning", "favourites", "recentlyViewed", "collections", "categoryRows", "recentlyAdded"]) ok(`home: row ${row}`, home.includes(row));
for (const f of ["app/kingdom-stories/library.tsx", "app/kingdom-stories/all.tsx", "app/kingdom-stories/collection/[slug].tsx", "app/admin/kingdom-stories/collections.tsx", "components/kingdom-stories/ImageSlots.tsx", "components/kingdom-stories/ShareStorySheet.tsx"]) ok(`exists: ${f}`, existsSync(path.join(root, f)));
const lib = src("app/kingdom-stories/library.tsx");
for (const s of ["favourites", "later", "recent", "in_progress", "completed"]) ok(`library: shelf ${s}`, lib.includes(`"${s}"`));
const reader = src("app/kingdom-stories/[id].tsx");
ok("reader: favourite + later", reader.includes("saveStory") && reader.includes("unsaveStory") && reader.includes('"later"'));
ok("reader: share sheet", reader.includes("ShareStorySheet"));
ok("reader: records opened", reader.includes("markStoryOpened"));
ok("reader: overview not repeated in gallery", /m\.id !== overview\?\.id/.test(reader));
ok("chapter: records last chapter", src("app/kingdom-stories/chapter.tsx").includes("markStoryOpened("));
ok("chat: open-story chip", src("app/messages/[id].tsx").includes("storyIdInMessage"));
const slots = src("components/kingdom-stories/ImageSlots.tsx");
for (const l of ["Story Cover Image", "Featured Hero Image", "Story Overview Image", "[ Upload or Select Image ]"]) ok(`slots: ${l}`, slots.includes(l));
ok("slots: jpeg/png/webp only", slots.includes('"image/jpeg", "image/png", "image/webp"'));
ok("slots: 10 MB limit", slots.includes("10 * 1024 * 1024"));
const editor = src("app/admin/kingdom-stories/[id].tsx");
ok("editor: topic number field", editor.includes("topicNumber") && /Topic number/.test(editor));
ok("editor: image slots wired", editor.includes("<ImageSlots"));
const cols = src("app/admin/kingdom-stories/collections.tsx");
ok("collections: created as draft", cols.includes("Create (as draft)"));
ok("collections: delete goes to the bin", cols.includes("deleteStoryCollection") && cols.includes("Recycle Bin"));
ok("collections: linked from admin index", src("app/admin/kingdom-stories/index.tsx").includes("/admin/kingdom-stories/collections"));

console.log(`kingdomLibrary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
