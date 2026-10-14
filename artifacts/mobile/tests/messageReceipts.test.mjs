// Unit tests for the message-receipt engine (lib/messageReceipts.ts) and its
// I/O layer (lib/messageReceiptsApi.ts, with a mocked Supabase client).
// No test framework: the real TypeScript is transpiled with the project's
// own `typescript` and executed. Run: node tests/messageReceipts.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

const cache = {};
function load(rel, mocks = {}) {
  const key = rel + JSON.stringify(Object.keys(mocks));
  if (cache[key]) return cache[key];
  const src = readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, setTimeout, clearTimeout, Date, Math, Uint8Array, globalThis: {},
    require: (n) => {
      if (n in mocks) return mocks[n];
      if (n === "@/lib/messageReceipts") return load("lib/messageReceipts.ts");
      throw new Error("unexpected import " + n);
    },
  });
  return (cache[key] = mod.exports);
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const R = load("lib/messageReceipts.ts");

const T = (s) => new Date(Date.UTC(2026, 9, 1, 12, 0, s)).toISOString();
const ME = "me", BOB = "bob", CAROL = "carol", DAVE = "dave";
const members = [
  { userId: ME, joinedAt: T(0) }, { userId: BOB, joinedAt: T(0) }, { userId: CAROL, joinedAt: T(0) },
  { userId: DAVE, joinedAt: T(30) }, // joined later
];
const msg = (id, extra = {}) => ({ id, sender_id: ME, created_at: T(10), message_type: "text", ...extra });
const rc = (messageId, userId, d, r) => ({ messageId, userId, deliveredAt: d, readAt: r });

// ── State transitions ───────────────────────────────────────────────────────
const direct = [{ userId: ME, joinedAt: T(0) }, { userId: BOB, joinedAt: T(0) }];
ok("sending", R.deriveOutgoingStatus(msg("m", { localStatus: "sending" }), direct, {}) === "sending");
ok("failed", R.deriveOutgoingStatus(msg("m", { localStatus: "failed" }), direct, {}) === "failed");
ok("failed never shows delivered even with receipts", R.deriveOutgoingStatus(msg("m", { localStatus: "failed" }), direct, { [BOB]: rc("m", BOB, T(11), T(12)) }) === "failed");
ok("sent (no receipt)", R.deriveOutgoingStatus(msg("m"), direct, undefined) === "sent");
ok("delivered", R.deriveOutgoingStatus(msg("m"), direct, { [BOB]: rc("m", BOB, T(11), null) }) === "delivered");
ok("read", R.deriveOutgoingStatus(msg("m"), direct, { [BOB]: rc("m", BOB, T(11), T(12)) }) === "read");
ok("receipts unavailable => sent only", R.deriveOutgoingStatus(msg("m"), direct, { [BOB]: rc("m", BOB, T(11), T(12)) }, false) === "sent");
ok("no recipients => sent", R.deriveOutgoingStatus(msg("m"), [{ userId: ME, joinedAt: T(0) }], {}) === "sent");

// ── Groups: per participant ─────────────────────────────────────────────────
ok("recipients exclude sender and late joiner", JSON.stringify(R.recipientsFor(msg("g"), members)) === JSON.stringify([BOB, CAROL]));
ok("group: one reader is not read", R.deriveOutgoingStatus(msg("g"), members, { [BOB]: rc("g", BOB, T(11), T(12)) }) === "sent");
ok("group: one read + one delivered => delivered", R.deriveOutgoingStatus(msg("g"), members, { [BOB]: rc("g", BOB, T(11), T(12)), [CAROL]: rc("g", CAROL, T(11), null) }) === "delivered");
ok("group: all read => read", R.deriveOutgoingStatus(msg("g"), members, { [BOB]: rc("g", BOB, T(11), T(12)), [CAROL]: rc("g", CAROL, T(13), T(14)) }) === "read");
ok("group: late joiner not required", R.deriveOutgoingStatus(msg("g"), members, { [BOB]: rc("g", BOB, T(11), T(12)), [CAROL]: rc("g", CAROL, T(13), T(14)) }) === "read");
ok("group: privacy-off recipient (never read) keeps it delivered", R.deriveOutgoingStatus(msg("g"), members, { [BOB]: rc("g", BOB, T(11), T(12)), [CAROL]: rc("g", CAROL, T(11), null) }) !== "read");

// ── Monotonic merge, duplicates, out-of-order ──────────────────────────────
let idx = {};
idx = R.applyReceipts(idx, [rc("m", BOB, T(11), null)]);
const sameIdx = R.applyReceipts(idx, [rc("m", BOB, T(11), null)]);
ok("duplicate event returns same index (no re-render)", sameIdx === idx);
idx = R.applyReceipts(idx, [rc("m", BOB, T(11), T(12))]);
ok("read applied", idx.m[BOB].readAt === T(12));
idx = R.applyReceipts(idx, [rc("m", BOB, T(11), null)]);
ok("late delivered event never regresses read", idx.m[BOB].readAt === T(12));
idx = R.applyReceipts(idx, [rc("m", BOB, null, null)]);
ok("empty stale row never clears timestamps", idx.m[BOB].deliveredAt === T(11) && idx.m[BOB].readAt === T(12));
let idx2 = R.applyReceipts({}, [rc("x", BOB, null, T(20))]);
ok("read-only row implies delivered", idx2.x[BOB].deliveredAt === T(20));
idx2 = R.applyReceipts(idx2, [rc("x", BOB, T(19), T(20))]);
ok("earlier authoritative delivered wins", idx2.x[BOB].deliveredAt === T(19));
let idx3 = R.applyReceipts({}, [rc("y", BOB, T(5), T(9)), rc("y", CAROL, T(6), null)]);
ok("multiple recipients tracked separately", !!idx3.y[BOB].readAt && idx3.y[CAROL].readAt === null);
ok("receiptFromRow maps snake_case rows", JSON.stringify(R.receiptFromRow({ message_id: "a", user_id: "b", delivered_at: T(1), read_at: null })) === JSON.stringify(rc("a", "b", T(1), null)));
ok("receiptFromRow rejects incomplete rows", R.receiptFromRow({ user_id: "b" }) === null && R.receiptFromRow(null) === null);

// ── Read candidates: visible-only, active-only, incoming-only ─────────────
const incoming = (id, extra = {}) => ({ id, sender_id: BOB, created_at: T(10), message_type: "text", ...extra });
const byId = new Map([
  ["a", incoming("a")], ["b", incoming("b")], ["mine", msg("mine")],
  ["del", incoming("del", { deletedAt: T(11) })], ["call", incoming("call", { message_type: "call_summary" })],
  ["pend", incoming("pend", { localStatus: "sending" })], ["sys", incoming("sys", { sender_id: null })],
]);
const cand = (viewable, opts = {}) => R.selectReadCandidates({ viewableIds: viewable, messagesById: byId, currentUserId: ME, alreadyRead: opts.already ?? new Set(), isActive: opts.active ?? true });
ok("only viewable incoming messages are read", JSON.stringify(cand(["a"])) === '["a"]');
ok("off-screen messages are not read", !cand(["a"]).includes("b"));
ok("own / deleted / call / pending / system excluded", cand(["mine", "del", "call", "pend", "sys"]).length === 0);
ok("background or unfocused => nothing read", cand(["a", "b"], { active: false }).length === 0);
ok("already-read ids skipped", JSON.stringify(cand(["a", "b"], { already: new Set(["a"]) })) === '["b"]');
ok("duplicate viewable ids deduped", JSON.stringify(cand(["a", "a"])) === '["a"]');
ok("no user => nothing", R.selectReadCandidates({ viewableIds: ["a"], messagesById: byId, currentUserId: null, alreadyRead: new Set(), isActive: true }).length === 0);
ok("delivery candidates: incoming only, deduped", JSON.stringify(R.selectDeliveryCandidates([incoming("a"), incoming("a"), msg("mine"), incoming("del", { deletedAt: T(1) })], ME, new Set())) === '["a"]');

// ── Helpers ─────────────────────────────────────────────────────────────────
ok("chunkIds 200", JSON.stringify(R.chunkIds(Array.from({ length: 450 }, (_, i) => String(i))).map((c) => c.length)) === "[200,200,50]");
ok("labels never colour-only", ["sending", "failed", "sent", "delivered", "read"].every((s) => R.statusAccessibilityLabel(s).length > 0) && R.statusAccessibilityLabel("read") !== R.statusAccessibilityLabel("delivered"));
ok("recipientState", R.recipientState({ deliveredAt: null, readAt: null }) === "sent" && R.recipientState({ deliveredAt: T(1), readAt: null }) === "delivered" && R.recipientState({ deliveredAt: T(1), readAt: T(2) }) === "read");
const ids = new Set(Array.from({ length: 500 }, () => R.newMessageId()));
ok("newMessageId: v4 format and unique", ids.size === 500 && [...ids].every((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)));

// ── API layer with a mocked Supabase client ────────────────────────────────
function mockClient(handlers) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => { calls.push([fn, args]); return handlers[fn] ? handlers[fn](args) : { data: null, error: { code: "PGRST202" } }; },
    from: (table) => ({
      select: () => ({ eq: async (col, val) => { calls.push(["select", table, col, val]); return handlers[table] ? handlers[table]() : { data: [], error: null }; } }),
    }),
  };
}
const api = () => { const A = load("lib/messageReceiptsApi.ts", {}); A.__resetReceiptsAvailability(); return A; };
{
  const A = api();
  const c = mockClient({ p2p_acknowledge_messages: ({ p_message_ids, p_read }) => ({ data: p_message_ids.map((id) => ({ message_id: id, delivered_at: T(1), read_at: p_read ? T(2) : null })), error: null }) });
  const res = await A.acknowledgeMessages(c, Array.from({ length: 250 }, (_, i) => `id${i % 240}`), true);
  ok("ack sends only message ids + read flag (no recipient/timestamps)", c.calls.every(([fn, a]) => fn === "p2p_acknowledge_messages" && Object.keys(a).sort().join() === "p_message_ids,p_read"));
  ok("ack dedupes and batches at 200", c.calls.length === 2 && c.calls[0][1].p_message_ids.length === 200 && c.calls[1][1].p_message_ids.length === 40);
  ok("ack returns server receipts", res.length === 240 && !!res[0].readAt);
}
{
  const A = api();
  const c = mockClient({});
  const res = await A.acknowledgeMessages(c, ["a"], false);
  ok("unmigrated server: ack degrades silently", Array.isArray(res) && res.length === 0 && A.receiptsAvailable() === false);
  await A.acknowledgeMessages(c, ["b"], false);
  ok("unmigrated server: stops calling", c.calls.length === 1);
}
{
  const A = api();
  const c = mockClient({ p2p_acknowledge_messages: () => ({ data: null, error: { code: "08006", message: "network" } }) });
  ok("transient failure returns null (retry later)", (await A.acknowledgeMessages(c, ["a"], true)) === null && A.receiptsAvailable());
}
{
  // Offline -> reconnect: acker keeps failed ids pending and retries.
  const A = api();
  let online = false;
  const c = mockClient({ p2p_acknowledge_messages: ({ p_message_ids }) => online ? { data: p_message_ids.map((id) => ({ message_id: id, delivered_at: T(1), read_at: null })), error: null } : { data: null, error: { code: "08006" } } });
  const acker = A.createDeliveryAcker(() => c, 0);
  acker.enqueue(["a", "b"]);
  await acker.flushNow();
  ok("offline: nothing marked acknowledged", !acker.has("a") && !acker.has("b"));
  online = true;
  await acker.flushNow();
  ok("reconnect: pending ids acknowledged", acker.has("a") && acker.has("b"));
  const before = c.calls.length;
  acker.enqueue(["a", "b"]);
  await acker.flushNow();
  ok("already-acknowledged ids not resent", c.calls.length === before);
  acker.reset();
  ok("reset (sign-out) clears session state", !acker.has("a"));
}
{
  const A = api();
  const c = mockClient({ p2p_message_receipt_details: () => ({ data: [{ user_id: BOB, full_name: "Bob", username: "bob", photo_url: null, delivered_at: T(1), read_at: null, is_current_member: true }], error: null }) });
  const d = await A.fetchReceiptDetails(c, "m");
  ok("details mapped", "rows" in d && d.rows[0].userId === BOB && d.rows[0].deliveredAt === T(1) && d.rows[0].readAt === null);
  const denied = mockClient({ p2p_message_receipt_details: () => ({ data: null, error: { code: "42501", message: "Message info is only available to its sender" } }) });
  const e = await A.fetchReceiptDetails(denied, "m");
  ok("details error surfaced, not fabricated", "error" in e);
}
{
  const A = api();
  const c = mockClient({ p2p_get_my_read_receipts: () => ({ data: false, error: null }), p2p_set_my_read_receipts: () => ({ data: true, error: null }) });
  ok("preference read", (await A.getReadReceiptsEnabled(c)) === false);
  ok("preference write ok", (await A.setReadReceiptsEnabled(c, true)) === null);
  const failing = mockClient({ p2p_set_my_read_receipts: () => ({ data: null, error: { code: "XX000", message: "boom" } }) });
  ok("preference write error surfaced", (await A.setReadReceiptsEnabled(failing, false)) === "boom");
}
{
  const A = api();
  const c = mockClient({ p2p_message_receipts: () => ({ data: [{ message_id: "m", user_id: BOB, delivered_at: T(1), read_at: T(2) }], error: null }) });
  const rows = await A.fetchConversationReceipts(c, "conv");
  ok("conversation receipts filtered by conversation", c.calls[0][2] === "conversation_id" && c.calls[0][3] === "conv" && rows.length === 1);
}
{
  // Offline -> back online with no further activity: the acker retries by itself.
  const A = api();
  let online = false;
  const c = mockClient({ p2p_acknowledge_messages: ({ p_message_ids }) => online ? { data: p_message_ids.map((id) => ({ message_id: id, delivered_at: T(1), read_at: null })), error: null } : { data: null, error: { code: "08006" } } });
  const acker = A.createDeliveryAcker(() => c, 0, 20, 80);
  acker.enqueue(["x"]);
  await new Promise((r) => setTimeout(r, 10));
  ok("auto-retry: first attempt failed, not acknowledged", !acker.has("x") && c.calls.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  ok("auto-retry: backoff retried while still offline", c.calls.length === 2 && !acker.has("x"));
  online = true;
  await new Promise((r) => setTimeout(r, 60));
  ok("auto-retry: acknowledged once back online, without new activity", acker.has("x") && c.calls.length === 3);
  await new Promise((r) => setTimeout(r, 100));
  ok("auto-retry: stops after success", c.calls.length === 3);
  acker.reset();
}
{
  // Sign-out while an acknowledgement is in flight: its result must not leak into the next session.
  const A = api();
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = mockClient({ p2p_acknowledge_messages: async ({ p_message_ids }) => { await gate; return { data: p_message_ids.map((id) => ({ message_id: id, delivered_at: T(1), read_at: null })), error: null }; } });
  const acker = A.createDeliveryAcker(() => c, 0, 20, 80);
  acker.enqueue(["y"]);
  const flushing = acker.flushNow();
  await new Promise((r) => setTimeout(r, 5));
  acker.reset(); // sign-out
  release();
  await flushing;
  ok("reset during flight: result from the previous session discarded", !acker.has("y") && acker.acknowledged.size === 0);
  acker.enqueue(["y"]);
  await acker.flushNow();
  ok("new session acknowledges the same id for itself", acker.has("y"));
  acker.reset();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
