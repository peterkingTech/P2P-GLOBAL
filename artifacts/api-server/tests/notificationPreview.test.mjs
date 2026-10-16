// iPhone long-press previews — API side, no database:
//   lib/previewToken.ts      signing, verification, tampering, expiry, secret
//   lib/notificationPrivacy  three levels, push presentation rules
//   lib/pushDispatch.ts      the real builder end to end (in-memory db, mocked
//                            Expo): no message content or voice URL in any push,
//                            token/category/photo only where the level allows,
//                            calls untouched, token never logged.
// The preview endpoint against real migrations is covered by
// scripts/studio-db-test/notification-preview.mjs.
// Run: node tests/notificationPreview.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(os.tmpdir(), "notif-preview-"));
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const N = "00000000-0000-4000-8000-0000000000a1", U = "00000000-0000-4000-8000-0000000000b1", M = "00000000-0000-4000-8000-0000000000c1", C = "00000000-0000-4000-8000-0000000000d1";

const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /^\.\/(supabase|logger|accountStatus)$/ }, (a) => ({ path: a.path.slice(2), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: {
    supabase: "export const supabaseServiceRole = globalThis.__pv.db; export const SUPABASE_PUBLIC_URL = 'https://proj.supabase.co';",
    logger: "export const logger = globalThis.__pv.logger;",
    accountStatus: "export const getDeactivatedUserIds = async () => new Set();",
  }[a.path] }));
} };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin] });
  const f = path.join(tmp, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};

// ── In-memory db (chainable) ─────────────────────────────────────────────────
const state = { tables: {}, writes: [], failProfiles: null };
function makeDb() {
  const match = (row, f) => f.every(([op, c, v]) => op === "eq" ? row[c] === v : op === "neq" ? row[c] !== v : op === "is" ? (row[c] ?? null) === v : op === "in" ? v.includes(row[c]) : true);
  return { from(table) {
    const q = { op: "select", f: [], payload: null, single: false, cols: "*" };
    const exec = () => {
      if (table === "p2p_profiles" && state.failProfiles) {
        const fp = state.failProfiles(q.cols); if (fp) return { data: null, error: fp };
      }
      const rows = state.tables[table] ?? [];
      if (q.op === "update") { const hit = rows.filter((r) => match(r, q.f)); hit.forEach((r) => Object.assign(r, q.payload)); return { data: q.single ? hit[0] ?? null : hit, error: null }; }
      let out = rows.filter((r) => match(r, q.f)); if (q.limit) out = out.slice(0, q.limit);
      return { data: q.single ? out[0] ?? null : out, error: null };
    };
    const c = { select(cols) { q.cols = cols ?? "*"; return c; }, order() { return c; }, limit(n) { q.limit = n; return c; }, update(p) { q.op = "update"; q.payload = p; return c; },
      eq(k, v) { q.f.push(["eq", k, v]); return c; }, neq(k, v) { q.f.push(["neq", k, v]); return c; }, is(k, v) { q.f.push(["is", k, v]); return c; }, in(k, v) { q.f.push(["in", k, v]); return c; },
      maybeSingle() { q.single = true; return c; }, then(res, rej) { try { res(exec()); } catch (e) { rej(e); } } };
    return c;
  } };
}
const logs = [];
const lg = (level) => (obj, msg) => logs.push({ level, obj, msg });
globalThis.__pv = { db: makeDb(), logger: { info: lg("info"), warn: lg("warn"), error: lg("error"), debug() {} } };

try {
  // ── Token ────────────────────────────────────────────────────────────────
  const T = await bundle("src/lib/previewToken.ts", "pt.mjs");
  const secret = Buffer.from(SECRET);
  const claims = { notificationId: N, recipientId: U, messageId: M, conversationId: C };
  const now = Date.UTC(2026, 9, 16, 12, 0, 0);
  const tok = T.issuePreviewToken(claims, { secret, now });
  ok("token issued with a secret", typeof tok === "string" && tok.startsWith("v1."));
  const v = T.verifyPreviewToken(tok, { secret, now: now + 60_000 });
  ok("valid token verifies to the same claims", v && v.notificationId === N && v.recipientId === U && v.messageId === M && v.conversationId === C);
  ok("expires after 10 minutes", T.PREVIEW_TOKEN_TTL_SECONDS === 600 && T.verifyPreviewToken(tok, { secret, now: now + 599_000 }) && !T.verifyPreviewToken(tok, { secret, now: now + 600_000 }));
  ok("wrong secret rejected", !T.verifyPreviewToken(tok, { secret: Buffer.from(SECRET + "x"), now }));
  const [ver, payload, sig] = tok.split(".");
  const forged = JSON.parse(Buffer.from(payload, "base64url"));
  forged.u = "00000000-0000-4000-8000-0000000000ff";
  ok("payload tampering (other recipient) rejected", !T.verifyPreviewToken(`${ver}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, { secret, now }));
  forged.u = U; forged.m = "00000000-0000-4000-8000-0000000000ee";
  ok("payload tampering (other message) rejected", !T.verifyPreviewToken(`${ver}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, { secret, now }));
  ok("signature tampering rejected", !T.verifyPreviewToken(`${ver}.${payload}.${sig.slice(0, -2)}AA`, { secret, now }));
  ok("malformed tokens rejected (never throws)", [undefined, null, "", "v1", "v1.a", "v2." + payload + "." + sig, "v1.!!.??", 42, {}, "v1." + "a".repeat(2000) + ".b"].every((x) => T.verifyPreviewToken(x, { secret, now }) === null));
  const far = T.issuePreviewToken(claims, { secret, now, ttlSeconds: 3600 });
  ok("a token valid far longer than 10 minutes is rejected", !T.verifyPreviewToken(far, { secret, now }));
  ok("no secret → no token, and nothing verifies (fail closed)", T.issuePreviewToken(claims, { secret: null, now }) === null && T.verifyPreviewToken(tok, { secret: null, now }) === null);
  ok("short secret refused", T.previewSecret({ NOTIFICATION_PREVIEW_SECRET: "short" }) === null && T.previewSecret({}) === null && !!T.previewSecret({ NOTIFICATION_PREVIEW_SECRET: SECRET }));
  ok("non-UUID claims refused", T.issuePreviewToken({ ...claims, messageId: "x" }, { secret, now }) === null);
  ok("token carries no message content (ids + expiry only)", Object.keys(JSON.parse(Buffer.from(payload, "base64url"))).sort().join() === "c,e,m,n,u");

  // ── Presentation rules ───────────────────────────────────────────────────
  const P = await bundle("src/lib/notificationPrivacy.ts", "np.mjs");
  const msg = { notification_type: "new_message", title: "Grace", message: "sent you a message" };
  const full = P.pushPresentation(msg, "full", { senderPhoto: "https://cdn.example/g.jpg", previewToken: "TOK" });
  ok("Name and message: name, photo, category, token, mutable", full.title === "Grace" && full.body === "sent you a message" && full.image && full.categoryId === "p2p_message" && full.previewToken === "TOK" && full.mutableContent);
  const hold = P.pushPresentation(msg, "hold", { senderPhoto: "https://cdn.example/g.jpg", previewToken: "TOK" });
  ok("Reveal on hold: same private banner as Name only, plus token/category for the hold view", hold.title === "Grace" && hold.body === "sent you a message" && hold.image && hold.categoryId === "p2p_message" && hold.previewToken === "TOK" && hold.mutableContent);
  const name = P.pushPresentation(msg, "name", { senderPhoto: "https://cdn.example/g.jpg", previewToken: "TOK" });
  ok("Name only: name, photo, category — NO token", name.title === "Grace" && name.image && name.categoryId === "p2p_message" && !name.previewToken && name.mutableContent);
  const none = P.pushPresentation(msg, "none", { senderPhoto: "https://cdn.example/g.jpg", previewToken: "TOK" });
  ok("Nothing: generic, no photo/category/token/mutable", none.title === "P2P Global" && none.body === "New message" && !none.image && !none.categoryId && !none.previewToken && !none.mutableContent);
  ok("Nothing, voice: 'New voice message'", P.pushPresentation({ ...msg, message: "sent you a voice message" }, "none").body === "New voice message");
  const call = P.pushPresentation({ notification_type: "incoming_call", title: "Grace is calling you", message: null }, "full", { senderPhoto: "https://x/y.jpg", previewToken: "TOK" });
  ok("calls untouched at every level (no photo, category, token, mutable)", ["full", "name", "none"].every((l) => { const c = P.pushPresentation({ notification_type: "incoming_call", title: "Grace is calling you", message: null }, l, { senderPhoto: "https://x/y.jpg", previewToken: "TOK" }); return c.title === "Grace is calling you" && !c.image && !c.categoryId && !c.previewToken && !c.mutableContent; }));
  const conn = P.pushPresentation({ notification_type: "connection_request", title: "New P2P Connection Request", message: "Sola wants to connect." }, "full", { senderPhoto: "https://x/y.jpg", previewToken: "TOK" });
  ok("other person types: photo only, no message category or token", conn.image && !conn.categoryId && !conn.previewToken);
  ok("other person types under Nothing: no photo, text unchanged", (() => { const c = P.pushPresentation({ notification_type: "connection_request", title: "T", message: "M" }, "none", { senderPhoto: "https://x/y.jpg" }); return !c.image && c.title === "T"; })());
  ok("Name and message without a token (no secret): behaves as Name only", (() => { const c = P.pushPresentation(msg, "full", { senderPhoto: undefined, previewToken: null }); return !c.previewToken && c.categoryId === "p2p_message" && !c.mutableContent; })());

  // Levels lookup: new column, fallback to 193's switch, failures → Nothing.
  state.tables.p2p_profiles = [{ id: "a", notify_message_preview: "full", notify_show_sender_name: true }, { id: "b", notify_message_preview: "none", notify_show_sender_name: false }, { id: "c", notify_message_preview: null, notify_show_sender_name: true }, { id: "e", notify_message_preview: "hold", notify_show_sender_name: true }, { id: "f", notify_message_preview: "weird", notify_show_sender_name: true }];
  let lv = await P.getPreviewLevels(["a", "b", "c", "d", "e", "f"]);
  ok("levels read from notify_message_preview (incl. hold); null/missing/unknown → Name only", lv.get("a") === "full" && lv.get("b") === "none" && lv.get("c") === "name" && lv.get("d") === "name" && lv.get("e") === "hold" && lv.get("f") === "name");
  ok("content levels are exactly full + hold", [...P.PREVIEW_CONTENT_LEVELS].sort().join() === "full,hold");
  state.failProfiles = (cols) => (/notify_message_preview/.test(cols) ? { code: "42703", message: "column does not exist" } : null);
  lv = await P.getPreviewLevels(["a", "b", "c"]);
  ok("before migration 194: 193's switch maps true → Name only, false → Nothing", lv.get("a") === "name" && lv.get("b") === "none" && lv.get("c") === "name");
  state.failProfiles = () => ({ code: "42703", message: "column does not exist" });
  lv = await P.getPreviewLevels(["a"]);
  ok("before 193 as well: Name only", lv.get("a") === "name");
  state.failProfiles = () => ({ code: "57014", message: "timeout" });
  lv = await P.getPreviewLevels(["a", "b"]);
  ok("lookup failure → Nothing for the batch (most private), never full", lv.get("a") === "none" && lv.get("b") === "none");
  state.failProfiles = null;

  // ── Real dispatch, end to end ────────────────────────────────────────────
  process.env.NOTIFICATION_PREVIEW_SECRET = SECRET;
  const D = await bundle("src/lib/pushDispatch.ts", "pd.mjs");
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const batch = JSON.parse(init.body); sent.push(...batch); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: batch.map((_, i) => ({ status: "ok", id: `t${i}` })) }) }; };
  const ids = { full: "00000000-0000-4000-8000-00000000f001", name: "00000000-0000-4000-8000-00000000f002", none: "00000000-0000-4000-8000-00000000f003", sender: "00000000-0000-4000-8000-00000000f0aa" };
  const note = (i, user, extra = {}) => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, user_id: user, title: "Grace Sender", message: "sent you a message", notification_type: "new_message",
    data: { conversationId: C, messageId: M, senderId: ids.sender }, pushed_at: null, created_at: new Date().toISOString(), ...extra });
  state.tables = {
    p2p_profiles: [
      { id: ids.full, notify_message_preview: "full" }, { id: ids.name, notify_message_preview: "name" }, { id: ids.none, notify_message_preview: "none" },
      { id: ids.sender, photo_url: "https://cdn.example/grace.jpg", notify_message_preview: "name" },
    ],
    p2p_notifications: [
      note(1, ids.full), note(2, ids.name), note(3, ids.none),
      note(4, ids.full, { title: "Grace Sender is calling you", message: null, notification_type: "incoming_call", data: { callId: "c1", callerId: ids.sender } }),
    ],
    p2p_push_tokens: [ids.full, ids.name, ids.none].map((u, i) => ({ id: `t${i}`, user_id: u, token: `ExponentPushToken[pv${i}]`, is_active: true, platform: "ios" })),
  };
  // the message body and voice URL exist in "the database", never in pushes
  const SECRET_BODY = "MY PRIVATE MESSAGE TEXT", VOICE = "https://proj.supabase.co/storage/v1/object/public/voice-messages/u/v.m4a";
  state.tables.p2p_messages = [{ id: M, conversation_id: C, body: SECRET_BODY, media_url: VOICE }];
  await D.dispatchPendingPushes();
  const byUser = (u) => sent.find((m) => m.to === `ExponentPushToken[pv${[ids.full, ids.name, ids.none].indexOf(u)}]` && m.data.notificationType === "new_message");
  const pf = byUser(ids.full), pn = byUser(ids.name), pz = byUser(ids.none);
  ok("three message pushes sent", !!pf && !!pn && !!pz, String(sent.length));
  ok("no push contains message text or a voice URL", !JSON.stringify(sent).includes(SECRET_BODY) && !JSON.stringify(sent).includes("voice-messages"));
  ok("Name and message push: token in data, category, photo, mutable", typeof pf.data.previewToken === "string" && pf.categoryId === "p2p_message" && pf.richContent?.image === "https://cdn.example/grace.jpg" && pf.mutableContent === true && pf.title === "Grace Sender");
  ok("its token is valid for exactly that recipient/notification/message/conversation", (() => { const c = T.verifyPreviewToken(pf.data.previewToken, { secret }); return c && c.recipientId === ids.full && c.notificationId === note(1, ids.full).id && c.messageId === M && c.conversationId === C; })());
  ok("Name only push: no token; category + photo", !("previewToken" in pn.data) && pn.categoryId === "p2p_message" && pn.richContent?.image && pn.title === "Grace Sender");
  ok("Nothing push: generic, no token/category/photo/mutable", pz.title === "P2P Global" && pz.body === "New message" && !("previewToken" in pz.data) && !pz.categoryId && !pz.richContent && !pz.mutableContent);
  ok("routing fields preserved on every push", [pf, pn, pz].every((m) => m.data.notificationId && m.data.conversationId === C && m.data.messageId === M && m.data.senderId === ids.sender && m.data.notificationType === "new_message"));
  const callPush = sent.find((m) => m.data.notificationType === "incoming_call");
  ok("call push untouched: its own category, no photo/token/mutable", callPush && callPush.categoryId === "incoming_call" && !callPush.richContent && !callPush.mutableContent && !("previewToken" in callPush.data) && callPush.channelId === "calls");
  ok("the token never appears in logs", !JSON.stringify(logs).includes(pf.data.previewToken.split(".")[2]));

  // Without the secret: Name and message degrades to Name only (no token).
  delete process.env.NOTIFICATION_PREVIEW_SECRET;
  sent.length = 0;
  state.tables.p2p_notifications = [note(5, ids.full)];
  await D.dispatchPendingPushes();
  ok("no secret → no token in any push (full previews fail closed)", sent.length === 1 && !("previewToken" in sent[0].data) && sent[0].categoryId === "p2p_message");

  // Reveal on hold: token for the press-and-hold view, banner stays private.
  process.env.NOTIFICATION_PREVIEW_SECRET = SECRET;
  const holdUser = "00000000-0000-4000-8000-00000000f004";
  state.tables.p2p_profiles.push({ id: holdUser, notify_message_preview: "hold" });
  state.tables.p2p_push_tokens.push({ id: "th", user_id: holdUser, token: "ExponentPushToken[pvhold]", is_active: true, platform: "ios" });
  state.tables.p2p_notifications = [note(6, holdUser)];
  sent.length = 0;
  await D.dispatchPendingPushes();
  const ph = sent.find((m) => m.to === "ExponentPushToken[pvhold]");
  ok("Reveal on hold push: token + category + photo, banner text unchanged, no content", ph && typeof ph.data.previewToken === "string" && ph.categoryId === "p2p_message" && ph.title === "Grace Sender" && ph.body === "sent you a message"
    && !JSON.stringify(ph).includes(SECRET_BODY) && !JSON.stringify(ph).includes("voice-messages"), JSON.stringify(ph));
  delete process.env.NOTIFICATION_PREVIEW_SECRET;
  globalThis.fetch = realFetch;

  const logger = readFileSync(path.join(root, "src/lib/logger.ts"), "utf8");
  ok("logger redacts the preview-token header", /x-p2p-preview-token/.test(logger));
  const app = readFileSync(path.join(root, "src/app.ts"), "utf8");
  ok("HTTP logs drop query strings and don't log bodies/headers", /url: req\.url\?\.split\("\?"\)\[0\]/.test(app));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
