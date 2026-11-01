// Scripture collections (migration 220) — routes/scriptureCollections.ts run
// for real over HTTP against an in-memory database, plus the pure rules in
// lib/scriptureAccess.ts:
//   • cross-user isolation (strangers get 404, never a hint it exists);
//   • permission levels (view / copy / collaborate) and resharing limits;
//   • live group membership (leaving a Family removes access at once);
//   • revoked access, blocks, child accounts;
//   • collaborative edits with stale-revision refusal and activity history;
//   • personal copies stay independent of the original;
//   • links: public preview (no notes, no ids), redeem, expiry, max uses,
//     revoke (optionally removing everyone who joined through it);
//   • private notes/highlights are never read.
// Synthetic ids only; no network beyond localhost, no database.
// Run: node tests/scriptureCollections.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmpDir = path.join(root, "tests", `.tmp-scripture-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });

const mocks = {
  supabase: "export const supabaseServiceRole = globalThis.__sc.db; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
  bibleReader: `const BOOKS = { JHN: { code: 'JHN', name: 'John', chapters: 21 }, PSA: { code: 'PSA', name: 'Psalms', chapters: 150 }, GEN: { code: 'GEN', name: 'Genesis', chapters: 50 } };
    export const bookByCode = (c) => BOOKS[String(c || '').toUpperCase()];
    export const licensedTranslations = async () => [{ translation_code: 'BSB' }];
    export const getChapter = async (b, ch, t) => ({ translation: { code: t, name: 'Berean Standard Bible', textCopyAllowed: true }, book: BOOKS[b], chapter: ch,
      verses: Array.from({ length: 40 }, (_, i) => ({ verse: i + 1, text: 'Verse text ' + (i + 1), paragraph: 0, poetry: false })), headings: [], copyright: 'BSB ©', previous: null, next: null });`,
  minors: "export const childUserIds = async (ids) => new Set(ids.filter((i) => globalThis.__sc.children.has(i)));",
  studyPartnerAuth: "export const getEligibleStudyPartners = async (_db, u) => new Map((globalThis.__sc.partners[u] || []).map((p) => [p, 'connection']));",
  groupLearning: "export const canManageGroupLearning = async (t, g, u) => globalThis.__sc.leaders.has(t + ':' + g + ':' + u); export const isGroupMember = async () => false;",
  pushDispatch: "export const dispatchNotificationNow = async () => {};",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)(supabase|bibleReader|minors|studyPartnerAuth|groupLearning|pushDispatch)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};

// ── In-memory database ─────────────────────────────────────────────────────
const T = {};
const now = () => new Date().toISOString();
const DEFAULTS = {
  p2p_scripture_collections: () => ({ kind: "collection", description: null, origin_collection_id: null, origin_owner_id: null, copied_at: null, revision: 1, created_at: now(), updated_at: now(), deleted_at: null }),
  p2p_scripture_collection_items: () => ({ position: 0, shared_note: null, added_by: null, created_at: now() }),
  p2p_scripture_collection_shares: () => ({ target_id: null, user_id: null, can_reshare: false, shared_by: null, via_link_id: null, status: "active", created_at: now(), revoked_at: null, revoked_by: null }),
  p2p_scripture_collection_links: () => ({ max_uses: null, uses: 0, expires_at: null, created_at: now(), revoked_at: null }),
  p2p_scripture_collection_activity: () => ({ detail: {}, created_at: now() }),
};
const reads = [];
function makeDb() {
  return { from(table) {
    reads.push(table);
    const q = { op: "select", f: [], payload: null, single: false, lim: null, orders: [] };
    const rows = () => (T[table] ??= []);
    const match = (r) => q.f.every(([op, k, v]) => op === "eq" ? r[k] === v : op === "is" ? (r[k] ?? null) === v : op === "in" ? v.includes(r[k]) : true);
    const exec = () => {
      let data;
      if (q.op === "insert") {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ id: randomUUID(), ...(DEFAULTS[table]?.() ?? {}), ...p }));
        rows().push(...list); data = list;
      } else if (q.op === "update") { const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, q.payload)); data = hit; }
      else if (q.op === "delete") { const hit = rows().filter(match); T[table] = rows().filter((r) => !hit.includes(r)); data = hit; }
      else {
        data = rows().filter(match);
        for (const [k, asc] of [...q.orders].reverse()) data = [...data].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
        if (q.lim) data = data.slice(0, q.lim);
      }
      data = data.map((r) => ({ ...r }));
      return { data: q.single ? data[0] ?? null : data, error: null };
    };
    const c = {
      select() { return c; }, insert(p) { q.op = "insert"; q.payload = p; return c; }, update(p) { q.op = "update"; q.payload = p; return c; }, delete() { q.op = "delete"; return c; },
      eq(k, v) { q.f.push(["eq", k, v]); return c; }, is(k, v) { q.f.push(["is", k, v]); return c; }, in(k, v) { q.f.push(["in", k, v]); return c; },
      order(k, o) { q.orders.push([k, o?.ascending !== false]); return c; }, limit(n) { q.lim = n; return c; },
      maybeSingle() { q.single = true; return c; }, single() { q.single = true; return c; },
      then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
    };
    return c;
  } };
}
globalThis.__sc = { db: makeDb(), children: new Set(), partners: {}, leaders: new Set() };

// People: A owner · B, G peers of A/B · C stranger · D and E in A's Family · K a child.
const [A, B, C, D, E, G, K] = Array.from({ length: 7 }, () => randomUUID());
const FAM = randomUUID();
T.p2p_profiles = [[A, "Ann Owner"], [B, "Ben Peer"], [C, "Cal Stranger"], [D, "Dee Family"], [E, "Eve Family"], [G, "Gus Peer"], [K, "Kid Child"]].map(([id, full_name]) => ({ id, full_name, photo_url: null }));
T.p2p_family_members = [A, D, E].map((user_id) => ({ family_id: FAM, user_id, status: "active" }));
T.p2p_families = [{ id: FAM, name: "The Owners" }];
globalThis.__sc.partners = { [A]: [B, G], [B]: [A, G], [G]: [A, B] };
globalThis.__sc.children.add(K);

let server, base;
const call = async (method, p, user, body) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = (book, chapter, sv, ev = sv) => ({ translationCode: "BSB", bookCode: book, chapter, startVerse: sv, endVerse: ev });

try {
  // ── Pure rules ───────────────────────────────────────────────────────────
  const R = await bundle("src/lib/scriptureAccess.ts", "access.mjs");
  const share = (o) => ({ id: randomUUID(), target_type: "peer", target_id: null, user_id: null, permission: "view", can_reshare: false, status: "active", shared_by: A, ...o });
  const base0 = { ownerId: A, deleted: false, members: {}, blockedWithOwner: false };
  ok("rules: owner has full control", R.resolveAccess({ ...base0, userId: A, shares: [] }).role === "owner");
  ok("rules: no share → no access", R.resolveAccess({ ...base0, userId: C, shares: [share({ user_id: B })] }).role === "none");
  ok("rules: best of several shares wins", R.resolveAccess({ ...base0, userId: B, members: { family: new Set([FAM]) }, shares: [share({ user_id: B }), share({ target_type: "family", target_id: FAM, permission: "collaborate" })] }).permission === "collaborate");
  ok("rules: revoked shares don't count", R.resolveAccess({ ...base0, userId: B, shares: [share({ user_id: B, status: "revoked" })] }).role === "none");
  ok("rules: group share needs CURRENT membership", R.resolveAccess({ ...base0, userId: D, members: { family: new Set() }, shares: [share({ target_type: "family", target_id: FAM })] }).role === "none");
  ok("rules: a block removes access", R.resolveAccess({ ...base0, userId: B, blockedWithOwner: true, shares: [share({ user_id: B })] }).role === "none");
  ok("rules: deleted → nobody, not even the owner", R.resolveAccess({ ...base0, deleted: true, userId: A, shares: [] }).role === "none");
  const rec = (permission, canReshare) => ({ role: "recipient", permission, canReshare, shareIds: ["x"] });
  ok("rules: reshare needs permission", typeof R.grantable(rec("copy", false), "view", false) === "string");
  ok("rules: reshare never above own level", typeof R.grantable(rec("view", true), "copy", false) === "string");
  ok("rules: only the owner grants collaborate", typeof R.grantable(rec("collaborate", true), "collaborate", false) === "string");
  ok("rules: a reshare can't be reshared", R.grantable(rec("copy", true), "view", true).canReshare === false);
  ok("rules: owner may allow resharing", R.grantable({ role: "owner", permission: "collaborate", canReshare: true, shareIds: [] }, "copy", true).canReshare === true);
  ok("rules: reorder must name exactly the current items", R.validReorder(["a", "b"], ["b", "a"]) && !R.validReorder(["a", "b"], ["a"]) && !R.validReorder(["a", "b"], ["a", "a"]) && !R.validReorder(["a", "b"], ["a", "c"]) && !R.validReorder(["a"], "a"));
  ok("rules: revision must match exactly", R.revisionMatches(3, 3) && R.revisionMatches(3, "3") && !R.revisionMatches(3, 2) && !R.revisionMatches(3, undefined));
  ok("rules: link states", R.linkState({ revoked_at: null, expires_at: null, max_uses: null, uses: 0 }) === "ok" && R.linkState({ revoked_at: now(), expires_at: null, max_uses: null, uses: 0 }) === "revoked"
    && R.linkState({ revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString(), max_uses: null, uses: 0 }) === "expired" && R.linkState({ revoked_at: null, expires_at: null, max_uses: 2, uses: 2 }) === "full");
  const tok = R.newLinkToken();
  ok("rules: link codes are 32 URL-safe characters; only a fingerprint is stored", R.LINK_TOKEN_RE.test(tok) && R.hashToken(tok).length === 64 && R.hashToken(tok) !== tok && R.newLinkToken() !== tok);

  // ── The routes over HTTP ─────────────────────────────────────────────────
  const express = createRequire(path.join(root, "package.json"))("express");
  const { default: router } = await bundle("src/routes/scriptureCollections.ts", "route.mjs");
  const app = express(); app.use(express.json()); app.use("/c", router);
  server = app.listen(0); await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  ok("signed out → 401", (await call("GET", "/c", null)).status === 401);
  const made = await call("POST", "/c", A, { title: "  Comfort  ", refs: [ref("PSA", 23, 1, 6), ref("JHN", 14, 1, 3)] });
  const id = made.body?.id;
  ok("create with passages", made.status === 200 && T.p2p_scripture_collection_items.filter((i) => i.collection_id === id).length === 2);
  ok("create: bad passages refused", (await call("POST", "/c", A, { title: "x", refs: [ref("JHN", 99, 1)] })).status === 400 && (await call("POST", "/c", A, { title: "x", refs: [{ ...ref("JHN", 3, 16), translationCode: "NOPE" }] })).status === 400);
  ok("create: a name is required", (await call("POST", "/c", A, { title: "  " })).status === 400);
  ok("owner sees it as the original", (await call("GET", `/c/${id}`, A)).body?.status === "original");

  // Isolation
  ok("isolation: a stranger gets 404", (await call("GET", `/c/${id}`, C)).status === 404);
  ok("isolation: a peer before sharing gets 404", (await call("GET", `/c/${id}`, B)).status === 404);
  ok("isolation: not in a stranger's list", ((await call("GET", "/c", C)).body?.shared ?? []).length === 0);
  ok("isolation: unknown / malformed ids → 404", (await call("GET", `/c/${randomUUID()}`, A)).status === 404 && (await call("GET", `/c/not-a-uuid`, A)).status === 404);

  // View permission
  ok("share with a peer (view)", (await call("POST", `/c/${id}/shares`, A, { targets: [{ type: "peer", id: B }], permission: "view" })).status === 200);
  const asB = await call("GET", `/c/${id}`, B);
  ok("peer can view: owner + shared-by shown", asB.status === 200 && asB.body.access.permission === "view" && asB.body.owner.name === "Ann Owner" && asB.body.sharedByName === "Ann Owner" && asB.body.status === "shared");
  ok("a viewer doesn't see the recipient list or links", asB.body.shares.length === 0 && asB.body.links.length === 0);
  ok("in the peer's 'shared with me' list", (await call("GET", "/c", B)).body.shared.some((s) => s.id === id && s.permission === "view"));
  ok("notified once, with a safe type", T.p2p_notifications?.filter((n) => n.user_id === B && n.notification_type === "scripture_collection_shared" && n.data.collectionId === id).length === 1);
  ok("view: can't add", (await call("POST", `/c/${id}/items`, B, { refs: [ref("JHN", 3, 16)] })).status === 403);
  ok("view: can't copy", (await call("POST", `/c/${id}/copy`, B, {})).status === 403);
  ok("view: can't reshare", (await call("POST", `/c/${id}/shares`, B, { targets: [{ type: "peer", id: G }], permission: "view" })).status === 403);
  ok("can't share with a stranger", (await call("POST", `/c/${id}/shares`, A, { targets: [{ type: "peer", id: C }], permission: "view" })).status === 403);
  ok("can't share with a group you're not in", (await call("POST", `/c/${id}/shares`, A, { targets: [{ type: "family", id: randomUUID() }], permission: "view" })).status === 403);

  // Group share + copy permission + live membership
  ok("share with the Family (copy)", (await call("POST", `/c/${id}/shares`, A, { targets: [{ type: "family", id: FAM }], permission: "copy" })).status === 200);
  ok("family members notified (not the sharer)", T.p2p_notifications.some((n) => n.user_id === D) && !T.p2p_notifications.some((n) => n.user_id === A));
  const asD = await call("GET", `/c/${id}`, D);
  ok("family member can view with copy permission", asD.status === 200 && asD.body.access.permission === "copy");
  const copied = await call("POST", `/c/${id}/copy`, D, {});
  const copyId = copied.body?.id;
  const copyView = await call("GET", `/c/${copyId}`, D);
  ok("personal copy: owned by the copier, marked as a copy of the original", copied.status === 200 && copyView.body.status === "copy" && copyView.body.owner.id === D && copyView.body.origin.ownerName === "Ann Owner" && copyView.body.items.length === 2);
  ok("copier can't edit the original", (await call("POST", `/c/${id}/items`, D, { refs: [ref("JHN", 3, 16)] })).status === 403);
  ok("the original's owner can't see into the copy", (await call("GET", `/c/${copyId}`, A)).status === 404);
  await sleep(10);
  const rev0 = (await call("GET", `/c/${id}`, A)).body.revision;
  ok("owner adds to the original", (await call("POST", `/c/${id}/items`, A, { refs: [ref("JHN", 3, 16, 17)] })).status === 200);
  const copyAfter = await call("GET", `/c/${copyId}`, D);
  ok("copy independence: the copy is unchanged", copyAfter.body.items.length === 2);
  ok("copy shows that the original changed (never applied automatically)", copyAfter.body.origin.available && copyAfter.body.origin.changed);
  const whatsNew = await call("GET", `/c/${copyId}/origin`, D);
  ok("'See what's new' lists only the added passage", whatsNew.body.newItems.length === 1 && whatsNew.body.newItems[0].reference === "John 3:16–17");
  ok("revision bumped by the change", (await call("GET", `/c/${id}`, A)).body.revision === rev0 + 1);
  T.p2p_family_members.find((m) => m.user_id === D).status = "left";
  ok("leaving the Family removes access at once", (await call("GET", `/c/${id}`, D)).status === 404);
  ok("…but the personal copy stays theirs", (await call("GET", `/c/${copyId}`, D)).status === 200 && (await call("GET", `/c/${copyId}`, D)).body.origin.available === false);

  // Blocks
  T.p2p_user_blocks = [{ blocker_id: E, blocked_id: A }];
  ok("a block removes group access", (await call("GET", `/c/${id}`, E)).status === 404);
  T.p2p_user_blocks = [];

  // Collaborative editing
  ok("owner makes the peer a collaborator (re-share updates, no duplicate)", (await call("POST", `/c/${id}/shares`, A, { targets: [{ type: "peer", id: B }], permission: "collaborate" })).status === 200
    && T.p2p_scripture_collection_shares.filter((s) => s.collection_id === id && s.user_id === B && s.status === "active").length === 1);
  const before = await call("GET", `/c/${id}`, B);
  const order = before.body.items.map((i) => i.id).reverse();
  ok("stale reorder refused (409)", (await call("PUT", `/c/${id}/order`, B, { itemIds: order, revision: before.body.revision - 1 })).status === 409);
  ok("reorder with a wrong set refused", (await call("PUT", `/c/${id}/order`, B, { itemIds: order.slice(1), revision: before.body.revision })).status === 409);
  ok("collaborator reorders", (await call("PUT", `/c/${id}/order`, B, { itemIds: order, revision: before.body.revision })).status === 200);
  const after = await call("GET", `/c/${id}`, B);
  ok("new order saved", JSON.stringify(after.body.items.map((i) => i.id)) === JSON.stringify(order));
  ok("collaborator removes with the current revision", (await call("DELETE", `/c/${id}/items/${after.body.items[0].id}`, B, { revision: after.body.revision })).status === 200);
  ok("collaborator adds (shown as added by them)", (await call("POST", `/c/${id}/items`, B, { refs: [ref("GEN", 1, 1)] })).status === 200
    && (await call("GET", `/c/${id}`, A)).body.items.some((i) => i.reference === "Genesis 1:1" && i.addedByName === "Ben Peer"));
  ok("collaborator can't rename, delete, attach notes or create links", (await call("PATCH", `/c/${id}`, B, { title: "Mine", revision: after.body.revision })).status === 403
    && (await call("DELETE", `/c/${id}`, B)).status === 403
    && (await call("PUT", `/c/${id}/items/${after.body.items[1].id}/note`, B, { sharedNote: "x" })).status === 403
    && (await call("POST", `/c/${id}/links`, B, { permission: "view" })).status === 403);
  const acts = (await call("GET", `/c/${id}`, A)).body.activity.map((a) => a.action);
  ok("activity history records who did what", ["created", "shared", "added", "reordered", "removed"].every((x) => acts.includes(x)) && (await call("GET", `/c/${id}`, A)).body.activity.some((a) => a.actorName === "Ben Peer" && a.action === "reordered"));

  // Resharing
  ok("owner allows the peer to reshare (view)", (await call("POST", `/c/${id}/shares`, A, { targets: [{ type: "peer", id: B }], permission: "copy", canReshare: true })).status === 200);
  ok("reshare above own level refused", (await call("POST", `/c/${id}/shares`, B, { targets: [{ type: "peer", id: G }], permission: "collaborate" })).status === 403);
  ok("reshare at a lower level allowed", (await call("POST", `/c/${id}/shares`, B, { targets: [{ type: "peer", id: G }], permission: "view" })).status === 200);
  const asG = await call("GET", `/c/${id}`, G);
  ok("reshared recipient sees who shared it", asG.status === 200 && asG.body.sharedByName === "Ben Peer" && asG.body.access.canReshare === false);
  const ownerView = await call("GET", `/c/${id}`, A);
  ok("owner sees every recipient and who shared", ownerView.body.shares.some((s) => s.name === "Gus Peer" && s.sharedByName === "Ben Peer") && ownerView.body.shares.some((s) => s.targetType === "family"));
  ok("resharer sees only the shares they made", (await call("GET", `/c/${id}`, B)).body.shares.every((s) => s.sharedByName === "Ben Peer"));
  const gShare = ownerView.body.shares.find((s) => s.name === "Gus Peer");
  ok("a stranger can't revoke", (await call("DELETE", `/c/${id}/shares/${gShare.id}`, C)).status === 404);
  ok("owner revokes a reshare", (await call("DELETE", `/c/${id}/shares/${gShare.id}`, A)).status === 200 && (await call("GET", `/c/${id}`, G)).status === 404);
  ok("recipient can leave", (await call("POST", `/c/${id}/leave`, B)).status === 200 && (await call("GET", `/c/${id}`, B)).status === 404);

  // Shared notes are explicit; private notes are never read
  const itemId = (await call("GET", `/c/${id}`, A)).body.items[0].id;
  ok("owner attaches a note for sharing", (await call("PUT", `/c/${id}/items/${itemId}/note`, A, { sharedNote: "Read this slowly." })).status === 200);
  T.p2p_family_members.find((m) => m.user_id === E).status = "active";
  ok("recipients see only that deliberate note", (await call("GET", `/c/${id}`, E)).body.items.find((i) => i.id === itemId)?.sharedNote === "Read this slowly.");
  ok("private notes / highlights are never read", !reads.includes("p2p_user_notes") && !reads.includes("p2p_user_highlights"));
  const src = readFileSync(path.join(root, "src/routes/scriptureCollections.ts"), "utf8").replace(/\/\/.*$/gm, "");
  ok("route never references private study tables", !/p2p_user_notes|p2p_user_highlights|p2p_prayer|journal/.test(src));

  // Links
  const link = await call("POST", `/c/${id}/links`, A, { permission: "view", expiresInDays: 7 });
  const token = link.body?.token;
  ok("owner creates a link; only a fingerprint is stored", link.status === 200 && /^[A-Za-z0-9_-]{32}$/.test(token) && !JSON.stringify(T.p2p_scripture_collection_links).includes(token));
  const pv = await call("GET", `/c/links/${token}/preview`, null);
  ok("public preview without sign-in: title, owner first name, references, first passage text", pv.status === 200 && pv.body.title === "Comfort" && pv.body.ownerName === "Ann"
    && pv.body.passageCount === pv.body.references.length && pv.body.firstPassage?.verses.length > 0 && pv.body.firstPassage.verses[0].text.startsWith("Verse text") && pv.body.firstPassage.copyright === "BSB ©");
  const pvText = JSON.stringify(pv.body);
  ok("preview shows no notes, ids or recipients", !pvText.includes("Read this slowly") && !pvText.includes(A) && !pvText.includes(id) && !/shares|sharedNote|owner_id/.test(pvText));
  ok("preview: bad / unknown codes → 404", (await call("GET", `/c/links/nope/preview`, null)).status === 404 && (await call("GET", `/c/links/${"x".repeat(32)}/preview`, null)).status === 404);
  ok("redeem needs sign-in", (await call("POST", `/c/links/redeem`, null, { token })).status === 401);
  ok("a child account can't join by link", (await call("POST", `/c/links/redeem`, K, { token })).status === 403);
  const red = await call("POST", `/c/links/redeem`, C, { token });
  ok("signed-in person joins at the link's level", red.status === 200 && red.body.id === id && (await call("GET", `/c/${id}`, C)).body.access.permission === "view");
  ok("joining twice doesn't use another place", (await call("POST", `/c/links/redeem`, C, { token })).status === 200 && T.p2p_scripture_collection_links[0].uses === 1);
  ok("owner sees who joined via the link", (await call("GET", `/c/${id}`, A)).body.shares.some((s) => s.name === "Cal Stranger" && s.viaLink));
  const linkId = (await call("GET", `/c/${id}`, A)).body.links[0].id;
  ok("turning off the link (and removing who joined) stops access", (await call("DELETE", `/c/${id}/links/${linkId}`, A, { removeJoined: true })).status === 200
    && (await call("GET", `/c/${id}`, C)).status === 404 && (await call("GET", `/c/links/${token}/preview`, null)).status === 404 && (await call("POST", `/c/links/redeem`, G, { token })).status === 404);
  const one = (await call("POST", `/c/${id}/links`, A, { permission: "copy", maxUses: 1 })).body.token;
  ok("a one-person link fills up", (await call("POST", `/c/links/redeem`, G, { token: one })).status === 200 && (await call("POST", `/c/links/redeem`, B, { token: one })).status === 404);
  const exp = (await call("POST", `/c/${id}/links`, A, { permission: "view", expiresInDays: 1 })).body.token;
  T.p2p_scripture_collection_links.at(-1).expires_at = new Date(Date.now() - 1000).toISOString();
  ok("an expired link stops working", (await call("POST", `/c/links/redeem`, B, { token: exp })).status === 404 && (await call("GET", `/c/links/${exp}/preview`, null)).status === 404);
  ok("links never grant collaborative editing", (await call("POST", `/c/${id}/links`, A, { permission: "collaborate" })).status === 200 && T.p2p_scripture_collection_links.at(-1).permission === "view");

  // Playlists
  const pl = await call("POST", `/c/${id}/copy`, A, { kind: "playlist", title: "Morning", itemIds: [itemId] });
  ok("playlist from selected verses of a collection", pl.status === 200 && (await call("GET", `/c/${pl.body.id}`, A)).body.kind === "playlist" && (await call("GET", `/c/${pl.body.id}`, A)).body.items.length === 1);

  // Deletion
  ok("owner deletes: everyone loses access, links stop", (await call("DELETE", `/c/${id}`, A)).status === 200 && (await call("GET", `/c/${id}`, E)).status === 404 && (await call("GET", `/c/links/${one}/preview`, null)).status === 404);
  ok("…copies made before stay with their owners", (await call("GET", `/c/${copyId}`, D)).status === 200);
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`scriptureCollections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
