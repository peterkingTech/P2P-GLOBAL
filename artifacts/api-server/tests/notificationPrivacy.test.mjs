// Guards lib/notificationPrivacy.ts (migration 193): with the setting off,
// message pushes read "P2P Global — New message"; nothing else changes; the
// lookup fails open to today's behaviour; and pushDispatch uses it on both
// the cron and the immediate path.
// Run: node tests/notificationPrivacy.test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const tmp = mkdtempSync(path.join(os.tmpdir(), "notif-privacy-"));
try {
  const out = await build({ entryPoints: [path.join(root, "src/lib/notificationPrivacy.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^\.\/(supabase|logger)$/ }, (a) => ({ path: a.path.slice(2), namespace: "m" }));
      b.onLoad({ filter: /.*/, namespace: "m" }, (a) => ({ loader: "js", contents: {
        supabase: "export const supabaseServiceRole = { from: (...a) => globalThis.__np.from(...a) };",
        logger: "export const logger = { warn: (...a) => globalThis.__np.warns.push(a) };",
      }[a.path] }));
    } }] });
  writeFileSync(path.join(tmp, "np.mjs"), out.outputFiles[0].text);
  const NP = await import(pathToFileURL(path.join(tmp, "np.mjs")).href);

  const msg = { notification_type: "new_message", title: "Grace", message: "sent you a message" };
  const voice = { notification_type: "new_message", title: "Grace", message: "sent you a voice message" };
  ok("setting on (default): name shown as today", JSON.stringify(NP.lockScreenText(msg, false)) === JSON.stringify({ title: "Grace", body: "sent you a message" }));
  ok("setting off: 'P2P Global — New message'", JSON.stringify(NP.lockScreenText(msg, true)) === JSON.stringify({ title: "P2P Global", body: "New message" }));
  ok("setting off, voice: 'New voice message'", NP.lockScreenText(voice, true).body === "New voice message" && NP.lockScreenText(voice, true).title === "P2P Global");
  ok("calls still show the caller", NP.lockScreenText({ notification_type: "incoming_call", title: "Grace is calling you", message: null }, true).title === "Grace is calling you");
  ok("other types untouched", NP.lockScreenText({ notification_type: "family_join_request", title: "Family Circle join request", message: "Olu asked" }, true).body === "Olu asked");
  ok("null title falls back to P2P Global", NP.lockScreenText({ notification_type: "x", title: null, message: null }, false).title === "P2P Global");

  const calls = [];
  const chain = (result) => { const c = { select: () => c, in: (k, v) => { calls.push(["in", k, v]); return c; }, eq: (k, v) => { calls.push(["eq", k, v]); return c; }, then: (r) => r(result) }; return c; };
  globalThis.__np = { warns: [], from: (t) => { calls.push(["from", t]); return chain({ data: [{ id: "u1" }], error: null }); } };
  const hidden = await NP.getHiddenSenderUserIds(["u1", "u2"]);
  ok("lookup: only users who turned it off", hidden.has("u1") && !hidden.has("u2") && calls.some((c) => c[0] === "eq" && c[1] === "notify_show_sender_name" && c[2] === false));
  ok("lookup: no users → no query", (await NP.getHiddenSenderUserIds([])).size === 0);
  globalThis.__np = { warns: [], from: () => chain({ data: null, error: { code: "42703", message: "column does not exist" } }) };
  ok("before the migration (missing column): names shown, no warning", (await NP.getHiddenSenderUserIds(["u1"])).size === 0 && globalThis.__np.warns.length === 0);
  globalThis.__np = { warns: [], from: () => chain({ data: null, error: { code: "57014", message: "timeout" } }) };
  ok("lookup error: names shown, warning logged", (await NP.getHiddenSenderUserIds(["u1"])).size === 0 && globalThis.__np.warns.length === 1);
  globalThis.__np = { warns: [], from: () => { throw new Error("boom"); } };
  ok("lookup throws: names shown, never crashes", (await NP.getHiddenSenderUserIds(["u1"])).size === 0);

  // Sender photos (item 10).
  const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000b1", C = "00000000-0000-0000-0000-0000000000c1";
  const photoRows = [{ id: A, photo_url: "https://cdn.example/a.jpg" }, { id: B, photo_url: "http://insecure.example/b.jpg" }, { id: C, photo_url: null }];
  let asked = null;
  globalThis.__np = { warns: [], from: () => { const c = { select: () => c, in: (k, v) => { asked = v; return c; }, then: (r) => r({ data: photoRows, error: null }) }; return c; } };
  const photos = await NP.getSenderPhotos([
    { id: "n1", notification_type: "new_message", data: { senderId: A } },
    { id: "n2", notification_type: "connection_request", data: { fromUserId: B } },
    { id: "n3", notification_type: "family_join_request", data: { requesterId: C } },
    { id: "n4", notification_type: "incoming_call", data: { callerId: A } },
    { id: "n5", notification_type: "admin_report_ready", data: { senderId: A } },
    { id: "n6", notification_type: "new_message", data: { senderId: "not-a-uuid" } },
  ]);
  ok("photo for a verified person sender", photos.get("n1") === "https://cdn.example/a.jpg");
  ok("no photo: non-https, missing photo, calls, system types, bad ids", !photos.has("n2") && !photos.has("n3") && !photos.has("n4") && !photos.has("n5") && !photos.has("n6"), JSON.stringify([...photos]));
  ok("one batched lookup of the senders only", Array.isArray(asked) && asked.sort().join() === [A, B, C].sort().join());
  globalThis.__np = { warns: [], from: () => { throw new Error("boom"); } };
  ok("photo lookup failure → no photos, never a crash", (await NP.getSenderPhotos([{ id: "n1", notification_type: "new_message", data: { senderId: A } }])).size === 0);
  globalThis.__np = { warns: [], from: () => { throw new Error("must not query"); } };
  ok("no person senders → no query", (await NP.getSenderPhotos([{ id: "x", notification_type: "admin_report_ready", data: {} }])).size === 0);

  const pd = readFileSync(path.join(root, "src/lib/pushDispatch.ts"), "utf8");
  ok("push: image only when the sender is shown and it isn't a call", /const image = !hideSender && !isIncomingCall \? senderPhoto : undefined;/.test(pd)
    && /\.\.\.\(image \? \{ richContent: \{ image \}, mutableContent: true \} : \{\}\)/.test(pd));
  ok("push: both paths pass the sender photo", /buildExpoMessage\(n, t\.token, hideSender, photo\)/.test(pd) && /senderPhotos\.get\(n\.id\)/.test(pd) && /const photo = hideSender \? undefined :/.test(pd));
  ok("pushDispatch: both paths use the setting", /const hiddenSender = await getHiddenSenderUserIds\(userIds\);/.test(pd) && /getHiddenSenderUserIds\(\[n\.user_id\]\)/.test(pd)
    && /buildExpoMessage\(n, t\.token, !!n\.user_id && hiddenSender\.has\(n\.user_id\), senderPhotos\.get\(n\.id\)\)/.test(pd) && /buildExpoMessage\(n, t\.token, hideSender, photo\)/.test(pd));
  ok("pushDispatch: title/body come from lockScreenText", /const \{ title, body \} = lockScreenText\(n, hideSender\);/.test(pd));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
