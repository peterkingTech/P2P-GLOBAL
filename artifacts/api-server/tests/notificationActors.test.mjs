// Guards lib/notificationActors.ts: every mapped notification type must still
// be created with that sender field in its source (API routes or migration
// 104), and the resolver must reject anything that isn't a valid id. Keeps a
// future rename from silently showing the wrong person as the sender.
// Run: node tests/notificationActors.test.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const tmp = mkdtempSync(path.join(os.tmpdir(), "notif-actors-"));
try {
  const out = await build({ entryPoints: [path.join(root, "src/lib/notificationActors.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  writeFileSync(path.join(tmp, "a.mjs"), out.outputFiles[0].text);
  const A = await import(pathToFileURL(path.join(tmp, "a.mjs")).href);
  const id = "00000000-0000-0000-0000-0000000000b1";

  ok("resolver: mapped type + valid id", A.notificationActorId("new_message", { senderId: id }) === id);
  ok("resolver: unmapped type → null even if an id is present", A.notificationActorId("pastoral_alert", { discipleId: id, senderId: id }) === null);
  ok("resolver: invalid / missing values → null", A.notificationActorId("new_message", { senderId: "x" }) === null && A.notificationActorId("new_message", {}) === null
    && A.notificationActorId("new_message", null) === null && A.notificationActorId(null, { senderId: id }) === null && A.notificationActorId("new_message", { senderId: 7 }) === null);

  // Source evidence for each mapping.
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } })(path.join(root, "src"));
  const api = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const m104 = readFileSync(path.join(root, "../../migrations/104_push_notifications.sql"), "utf8");
  ok("new_message.senderId is written by the migration 104 trigger", /'new_message'[\s\S]{0,200}'senderId', new\.sender_id/.test(m104));
  const nearby = (type, field) => {
    const re = new RegExp(`"${type}"`, "g"); let m;
    while ((m = re.exec(api))) { if (api.slice(Math.max(0, m.index - 1500), m.index + 1500).includes(field)) return true; }
    return false;
  };
  for (const [type, field] of Object.entries(A.NOTIFICATION_ACTOR_FIELD)) {
    if (type === "new_message") continue;
    ok(`${type}.${field} appears where the API creates that notification`, nearby(type, field));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
