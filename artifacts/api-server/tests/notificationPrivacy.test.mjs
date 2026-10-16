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
  ok("Name only (default): name shown as today", JSON.stringify(NP.lockScreenText(msg, "name")) === JSON.stringify({ title: "Grace", body: "sent you a message" }));
  ok("Name and message: same lock-screen text (content only via the secure preview)", JSON.stringify(NP.lockScreenText(msg, "full")) === JSON.stringify({ title: "Grace", body: "sent you a message" }));
  ok("Nothing: 'P2P Global — New message'", JSON.stringify(NP.lockScreenText(msg, "none")) === JSON.stringify({ title: "P2P Global", body: "New message" }));
  ok("Nothing, voice: 'New voice message'", NP.lockScreenText(voice, "none").body === "New voice message" && NP.lockScreenText(voice, "none").title === "P2P Global");
  ok("calls still show the caller", NP.lockScreenText({ notification_type: "incoming_call", title: "Grace is calling you", message: null }, "none").title === "Grace is calling you");
  ok("other types untouched", NP.lockScreenText({ notification_type: "family_join_request", title: "Family Circle join request", message: "Olu asked" }, "none").body === "Olu asked");
  ok("null title falls back to P2P Global", NP.lockScreenText({ notification_type: "x", title: null, message: null }, "name").title === "P2P Global");
  // Level lookup (getPreviewLevels) is covered in tests/notificationPreview.test.mjs.

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
  ok("push: title/body/photo/category/token all come from pushPresentation", /return pushPresentation\(n, level, \{ senderPhoto, previewToken \}\);/.test(pd)
    && /\.\.\.\(pres\.image \? \{ richContent: \{ image: pres\.image \} \} : \{\}\)/.test(pd));
  ok("push: both paths read the level and skip the photo under Nothing", /const levels = await getPreviewLevels\(userIds\);/.test(pd) && /getPreviewLevels\(\[n\.user_id\]\)/.test(pd)
    && /const photo = level === "none" \? undefined :/.test(pd) && /level === "none" \? undefined : senderPhotos\.get\(n\.id\)/.test(pd));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
