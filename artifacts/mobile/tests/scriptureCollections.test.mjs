// Scripture collections on the app side (migration 220; server rules are
// tested in api-server/tests/scriptureCollections.test.mjs):
//  1. Links: scanned / pasted collection links open the redeem screen (codes
//     validated); the website path /c/CODE does too.
//  2. Notifications open the shared collection (ids validated), in push and
//     in the in-app list; they show in P2P Updates.
//  3. The client calls exactly the server's routes.
//  4. Every shared link's website page: view-only preview + "Get the app"
//     (the website), never an automatic redirect, never innerHTML.
//  5. Source checks: entry points (Bible reader, saved passages, Bible
//     Study), permissions follow the server, private notes never touched,
//     listening fetches text live and stores nothing.
// Run: node tests/scriptureCollections.test.mjs
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
const SITE = "https://peer-to-peer-globalbiblestudynetwork.netlify.app";
const mocks = {
  "./sharing": { APP_SCHEME: "p2pglobalbiblestudy", WEB_APP_URL: SITE },
  "@/lib/sharing": { APP_SCHEME: "p2pglobalbiblestudy", WEB_APP_URL: SITE },
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
  "react-native": { Platform: { OS: "ios" }, StyleSheet: { create: (s) => s } },
};
function load(rel, extra = {}) {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => extra[m] ?? mocks[m] ?? anyModule, console, URLSearchParams, setTimeout, clearTimeout });
  return mod.exports;
}
const CODE = "AbCdEfGhIjKlMnOpQrStUvWxYz012-_9";

// 1. Links
const Q = load("lib/qrLinks.ts");
const app = Q.parseP2PCode(`p2pglobalbiblestudy://collections/link/${CODE}`);
ok("app link opens the redeem screen", app.ok && app.kind === "collection" && app.path === `/scripture-collections/link/${CODE}`);
const web = Q.parseP2PCode(`${SITE}/c/${CODE}`);
ok("website /c/CODE opens the redeem screen", web.ok && web.kind === "collection" && web.path === `/scripture-collections/link/${CODE}`);
ok("malformed codes are refused", !Q.parseP2PCode(`${SITE}/c/short`).ok && !Q.parseP2PCode(`p2pglobalbiblestudy://collections/link/../admin`).ok && !Q.parseP2PCode(`${SITE}/c/${CODE}x`).ok);
ok("existing links still parse", Q.parseP2PCode(`p2pglobalbiblestudy://lesson/abc`).ok && Q.parseP2PCode(`${SITE}/join/@peter`).ok);

// 2. Notifications
const push = load("lib/push.ts");
const CID = "0b3e6c7a-1d2f-4a5b-8c9d-0e1f2a3b4c5d";
ok("push opens the shared collection", push.pathForNotification("scripture_collection_shared", { collectionId: CID }) === `/scripture-collections/${CID}`);
ok("push: a bad id falls back to the list", push.pathForNotification("scripture_collection_shared", { collectionId: "../admin" }) === "/scripture-collections");
ok("in-app list routes it the same way", src("app/notifications/index.tsx").includes('n.notificationType === "scripture_collection_shared"'));
ok("shows in P2P Updates", src("lib/myP2P.ts").includes('"scripture_collection_shared"'));
ok("server categorises the type (community)", src("../api-server/src/lib/notificationCategories.ts").includes('scripture_collection_shared: "community"'));

// 3. Client ↔ server routes
const client = src("lib/scriptureCollectionsApi.ts");
const server = src("../api-server/src/routes/scriptureCollections.ts");
const routes = [
  ["get", '"/"'], ["post", '"/"'], ["get", '"/share-targets"'], ["get", '"/:id"'], ["patch", '"/:id"'], ["delete", '"/:id"'],
  ["post", '"/:id/items"'], ["delete", '"/:id/items/:itemId"'], ["put", '"/:id/order"'], ["put", '"/:id/items/:itemId/note"'],
  ["post", '"/:id/copy"'], ["get", '"/:id/origin"'], ["post", '"/:id/shares"'], ["delete", '"/:id/shares/:shareId"'], ["post", '"/:id/leave"'],
  ["post", '"/:id/links"'], ["delete", '"/:id/links/:linkId"'], ["get", '"/links/:token/preview"'], ["post", '"/links/redeem"'],
];
ok("server has every route the client uses", routes.every(([m, p]) => server.includes(`router.${m}(${p}`)), JSON.stringify(routes.filter(([m, p]) => !server.includes(`router.${m}(${p}`))));
ok("client calls them", ["/share-targets", "/items", "/order", "/note", "/copy", "/origin", "/shares", "/leave", "/links", "/links/redeem"].every((p) => client.includes(p)));
ok("mounted at /scripture-collections", src("../api-server/src/routes/index.ts").includes('router.use("/scripture-collections", scriptureCollectionsRouter)'));
ok("public preview is declared before /:id (not swallowed as an id)", server.indexOf('router.get("/links/:token/preview"') < server.indexOf('router.get("/:id"'));
const C = load("lib/scriptureCollectionsApi.ts");
ok("link URL is the website's /c/ path", C.collectionLinkUrl(CODE) === `${SITE}/c/${CODE}`);
ok("permission names", C.PERMISSION_LABEL.view === "View and Listen" && C.PERMISSION_LABEL.copy === "Save a Copy" && C.PERMISSION_LABEL.collaborate === "Collaborative Editing");
ok("activity reads naturally", C.activityLine({ actorName: "Ben", action: "added", detail: { references: ["John 3:16"] }, at: "" }) === "Ben added passages: John 3:16");

// 4. Website page for every shared link
const page = src("web/share-landing.html");
const script = page.slice(page.indexOf("<script>"));
ok("page: view-only preview for every link type", ["lesson", "plan", "category", "profile", "room", "circle", "family"].every((t) => script.includes(`${t}: [`)) && /churchMatch/.test(script) && /inviteMatch/.test(script) && /collectionMatch/.test(script));
ok("page: 'Get the app' goes to the website", /id="getApp" href="\/"/.test(page) && script.includes('$("getApp").href = "/";'));
ok("page: never redirects on its own (only the Open button navigates)", (script.match(/window\.location\s*=/g) ?? []).length === 1 && /addEventListener\("click", function \(\) \{\s*window\.location = link;/.test(script));
ok("page: only the app's own scheme can be opened", /\^p2pglobalbiblestudy:\\\/\\\//.test(script));
ok("page: no innerHTML (all text set safely)", !/innerHTML/.test(page));
ok("page: collection preview from the public API, with the first passage's text", script.includes('"/scripture-collections/links/" + token + "/preview"') && script.includes("firstPassage") && script.includes("p.copyright"));
ok("page: explains what needs the app", /To listen, save a copy or add these passages/.test(script) && /To study this lesson/.test(script));
ok("page: an unavailable link says so", script.includes("This link is no longer available"));
ok("redirects: /c/* serves the preview page", /^\/c\/\*\s+\/share-landing\.html\s+200$/m.test(src("web/_redirects")));

// 5. Source checks
for (const f of ["app/scripture-collections/index.tsx", "app/scripture-collections/[id].tsx", "app/scripture-collections/share.tsx", "app/scripture-collections/link/[token].tsx", "components/scripture/AddToCollectionSheet.tsx", "components/scripture/PassagePicker.tsx", "lib/listen/collectionContent.ts"]) {
  ok(`exists: ${f}`, existsSync(path.join(root, f)));
}
const bible = src("app/bible/index.tsx");
ok("Bible reader: 'Collection' beside Save adds the selected verses", bible.includes('label="Collection" onPress={() => setSheet("collection")}') && bible.includes("<AddToCollectionSheet visible={sheet === \"collection\" && !!selRef} refs={selRef ? [selRef] : []}"));
ok("saved passages / highlights: add to a collection (not notes)", src("app/bible/library.tsx").includes("{!note && !confirming ? <IconButton icon=\"albums-outline\""));
ok("Bible Study lists Scripture Collections", src("app/bible-study/index.tsx").includes('route: "/scripture-collections"'));
const detail = src("app/scripture-collections/[id].tsx");
ok("screen: actions follow the server's permission", detail.includes('const canEdit = d.access.permission === "collaborate";') && detail.includes("const canShare = owner || d.access.canReshare;") && /\{canEdit \? \(\s*<View style=\{s\.reorder\}>/.test(detail));
ok("screen: shows original / personal copy / shared with you, owner and shared-by", detail.includes('"Original"') && detail.includes('"Personal copy"') && detail.includes('"Shared with you"') && detail.includes("Shared with you by ${d.sharedByName ?? d.owner.name}"));
ok("screen: a copy never updates itself — 'See what's new' is a choice", detail.includes("Your copy hasn't changed.") && detail.includes("See what's new"));
const share = src("app/scripture-collections/share.tsx");
const resharerLevels = share.match(/const levels: Permission\[\] = owner \? \[[^\]]*\] : ([^;]*);/)?.[1] ?? "";
ok("share: a resharer can't offer editing or more than they have", share.includes('const levels: Permission[] = owner ? ["view", "copy", "collaborate"]') && !!resharerLevels && !resharerLevels.includes("collaborate") && resharerLevels.includes('d.access.permission !== "view"'));
ok("share: links are the owner's, view or copy only, and can remove who joined", share.includes("{owner ? (\n        <>\n          <Text style={s.section}>Share a link</Text>") && share.includes("revokeLink(d.id, l.id, true)") && !/createLink\([^)]*collaborate/.test(share));
const all = ["app/scripture-collections/index.tsx", "app/scripture-collections/[id].tsx", "app/scripture-collections/share.tsx", "components/scripture/AddToCollectionSheet.tsx", "components/scripture/PassagePicker.tsx", "lib/scriptureCollectionsApi.ts", "lib/listen/collectionContent.ts"].map(src).join("\n");
ok("private notes / highlights are never sent with a collection", !/addNote|getMyChapter|p2p_user_notes|highlights:/.test(all) && src("components/scripture/PassagePicker.tsx").includes('getLibrary("saved"'));
const listenSrc = src("lib/listen/collectionContent.ts");
ok("listening: text fetched live per chapter (once), nothing stored", listenSrc.includes("getChapter(i.bookCode, i.chapter, i.translationCode)") && !/AsyncStorage|setItem|SecureStore/.test(listenSrc));
ok("listening: each passage is announced", listenSrc.includes("bibleAnnouncement(d, language, part)"));

console.log(`scriptureCollections (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
