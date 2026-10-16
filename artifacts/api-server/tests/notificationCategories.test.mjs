// Per-category push preferences — lib/notificationCategories.ts (the one
// type → category map), lib/notificationPrivacy.ts getPushPreferences, and
// lib/pushDispatch.ts end to end (in-memory db, mocked Expo):
//   • every notification type the API writes is categorised on purpose;
//   • a category switched off stops ONLY the phone alert — the row stays,
//     is marked handled once (never retried, never sent twice);
//   • calls, safety/account/admin and unknown/untyped types always send;
//   • lookup failure fails open (today's behaviour).
// Synthetic ids/tokens only; no network, no database.
// Run: node tests/notificationCategories.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(os.tmpdir(), "notif-categories-"));

const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /^\.\/(supabase|logger|accountStatus)$/ }, (a) => ({ path: a.path.slice(2), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: {
    supabase: "export const supabaseServiceRole = globalThis.__nc.db; export const SUPABASE_PUBLIC_URL = 'https://proj.supabase.co';",
    logger: "export const logger = globalThis.__nc.logger;",
    accountStatus: "export const getDeactivatedUserIds = async () => new Set();",
  }[a.path] }));
} };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin] });
  const f = path.join(tmp, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};

const state = { tables: {}, failProfiles: false, profileSelects: [] };
function makeDb() {
  const match = (row, f) => f.every(([op, c, v]) => op === "eq" ? row[c] === v : op === "neq" ? row[c] !== v : op === "is" ? (row[c] ?? null) === v : op === "in" ? v.includes(row[c]) : true);
  return { from(table) {
    const q = { op: "select", f: [], payload: null, single: false, cols: "*" };
    const exec = () => {
      if (table === "p2p_profiles") {
        state.profileSelects.push(q.cols);
        const f = typeof state.failProfiles === "function" ? state.failProfiles(q.cols) : state.failProfiles ? { code: "57014", message: "timeout" } : null;
        if (f) return { data: null, error: f };
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
globalThis.__nc = { db: makeDb(), logger: { info: lg("info"), warn: lg("warn"), error: lg("error"), debug() {} } };

try {
  const K = await bundle("src/lib/notificationCategories.ts", "nc.mjs");

  // ── Coverage: every type literal the API writes is mapped on purpose ─────
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } })(path.join(root, "src"));
  const api = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const literal = new Set([...api.matchAll(/notification_type: *"([a-z_]+)"/g)].map((m) => m[1]));
  // Types passed through a variable (prayer, church calls, wins, connections).
  for (const t of ["prayer_invitation_received", "prayer_invitation_accepted", "prayer_invitation_declined", "prayer_invitation_cancelled", "prayer_gathering_ready", "prayer_gathering_cancelled",
    "church_call_started", "kingdom_win_moderation", "connection_accepted"]) {
    ok(`indirect type still written by the API: ${t}`, api.includes(`"${t}"`));
    literal.add(t);
  }
  const unmapped = [...literal].filter((t) => !K.KNOWN_NOTIFICATION_TYPES.includes(t));
  ok("every notification type the API writes has a category", unmapped.length === 0, JSON.stringify(unmapped));
  ok("pastoral nudges now carry a type (were untyped)", /title: "A gentle word", message, notification_type: "pastoral_gentle_word"/.test(api) && /notification_type: "elijah_checkin"/.test(api));

  // ── The map ───────────────────────────────────────────────────────────
  const cat = K.pushCategoryFor;
  ok("messages", ["new_message", "official_message_received", "contact_message_replied"].every((t) => cat(t) === "messages"));
  ok("calls always", ["incoming_call", "missed_call", "church_call_started"].every((t) => cat(t) === "always"));
  ok("community", ["connection_request", "family_join_request", "family_worship_invite", "study_invitation_received", "church_announcement"].every((t) => cat(t) === "community"));
  ok("prayer", cat("prayer_invitation_received") === "prayer" && cat("prayer_gathering_ready") === "prayer");
  ok("sessions / peer guide / fruit / encouragement / check-ins / break rooms",
    cat("church_call_reminder") === "sessions" && cat("circle_session_start") === "sessions" && cat("pastoral_alert") === "peer_guide" && cat("grain_earned") === "fruit"
    && cat("pastoral_gentle_word") === "encouragement" && cat("elijah_checkin") === "checkins" && cat("break_room_open") === "break_rooms");
  ok("safety / account / admin always", ["verification_submitted", "kingdom_win_moderation", "church_member_removed", "admin_report_ready", "super_admin_daily_digest", "break_room_flagged", "help_request", "crisis_help_request"].every((t) => cat(t) === "always"));
  ok("super admins' overdue reminders have their own switch", cat("contact_message_overdue") === "admin_overdue" && cat("admin_report_overdue") === "admin_overdue"
    && K.isPushMuted("contact_message_overdue", { notify_admin_overdue: false }) && !K.isPushMuted("super_admin_daily_digest", { notify_admin_overdue: false }));
  // Migration 196: every type the database triggers now write is categorised.
  const m196 = readFileSync(path.join(root, "../../migrations/196_notification_trigger_types.sql"), "utf8");
  const expected196 = ["fruit_awarded", "prayer_confirmation_request", "encouragement_confirmation_request", "session_confirmation_request", "lesson_completed", "lesson_submitted",
    "evaluation_waiting", "evaluation_resolved", "circle_evaluation_resolved", "peer_confirmation_confirmed", "help_request", "crisis_help_request"];
  ok("migration 196 writes the 12 trigger types", expected196.every((t) => m196.includes(`'${t}'`)));
  ok("every migration 196 type has an intended category", expected196.every((t) => K.KNOWN_NOTIFICATION_TYPES.includes(t)), JSON.stringify(expected196.filter((t) => !K.KNOWN_NOTIFICATION_TYPES.includes(t))));
  ok("196 categories: fruit / prayer / sessions / peer guide / community / always",
    cat("fruit_awarded") === "fruit" && cat("prayer_confirmation_request") === "prayer" && cat("session_confirmation_request") === "sessions"
    && ["lesson_completed", "lesson_submitted", "evaluation_waiting", "evaluation_resolved", "encouragement_confirmation_request", "peer_confirmation_confirmed"].every((t) => cat(t) === "peer_guide")
    && cat("circle_evaluation_resolved") === "community" && cat("help_request") === "always" && cat("crisis_help_request") === "always");
  ok("untyped / unknown always (today's behaviour)", cat(null) === "always" && cat(undefined) === "always" && cat("") === "always" && cat("something_new") === "always" && cat("__proto__") === "always" && cat("constructor") === "always");
  ok("preference columns = master switch + one per switchable category", JSON.stringify([...K.PREFERENCE_COLUMNS].sort()) === JSON.stringify(["notifications_enabled", "notify_admin_overdue", "notify_break_rooms", "notify_elijah_checkins", "notify_fruit_awards", "notify_groups", "notify_messages", "notify_peer_guide_alerts", "notify_prayer", "notify_session_reminders", "notify_weekly_encouragement"]));
  const mig = ["012_settings_bio_messaging.sql", "053_settings_restructure_columns.sql", "061_break_room_extras.sql", "196_notification_trigger_types.sql"].map((f) => readFileSync(path.join(root, "../../migrations", f), "utf8")).join("\n");
  ok("those columns exist in migrations", K.PREFERENCE_COLUMNS.every((c) => mig.includes(c)));
  ok("only notify_admin_overdue is new in 196", JSON.stringify(K.MIGRATION_196_COLUMNS) === JSON.stringify(["notify_admin_overdue"]) && /add column if not exists notify_admin_overdue boolean not null default true/.test(mig));
  ok("master switch off mutes every switchable category, never 'always'", ["new_message", "prayer_invitation_received", "fruit_awarded", "contact_message_overdue", "break_room_open"].every((t) => K.isPushMuted(t, { notifications_enabled: false }))
    && !["incoming_call", "missed_call", "help_request", "verification_submitted", null].some((t) => K.isPushMuted(t, { notifications_enabled: false })));
  ok("muted only when the column is explicitly false", K.isPushMuted("new_message", { notify_messages: false }) && !K.isPushMuted("new_message", { notify_messages: true })
    && !K.isPushMuted("new_message", { notify_messages: null }) && !K.isPushMuted("new_message", {}) && !K.isPushMuted("new_message", undefined));
  ok("calls can never be muted", !K.isPushMuted("incoming_call", Object.fromEntries(K.PREFERENCE_COLUMNS.map((c) => [c, false]))));
  ok("one switch doesn't mute another category", !K.isPushMuted("prayer_invitation_received", { notify_messages: false }));

  // ── Lookup ─────────────────────────────────────────────────────────────
  const P = await bundle("src/lib/notificationPrivacy.ts", "np.mjs");
  state.tables.p2p_profiles = [{ id: "a", notify_messages: false, notify_prayer: true }];
  let prefs = await P.getPushPreferences(["a", "b"]);
  ok("preferences read by id", prefs.get("a")?.notify_messages === false && !prefs.has("b"));
  ok("only id + preference columns selected", state.profileSelects.at(-1) === ["id", ...K.PREFERENCE_COLUMNS].join(", "));
  // Before migration 196: the new column is missing → read the rest.
  state.failProfiles = (cols) => /notify_admin_overdue/.test(cols) ? { code: "42703", message: "column does not exist" } : null;
  prefs = await P.getPushPreferences(["a"]);
  ok("before 196: lookup retries without notify_admin_overdue (switches still honoured)", prefs.get("a")?.notify_messages === false && !/notify_admin_overdue/.test(state.profileSelects.at(-1)));
  state.failProfiles = true;
  prefs = await P.getPushPreferences(["a"]);
  ok("lookup failure → empty (everything sends)", prefs.size === 0 && logs.some((l) => l.level === "warn" && /push preference lookup failed/.test(l.msg)));
  state.failProfiles = false;

  // ── Dispatch end to end ─────────────────────────────────────────────────
  const D = await bundle("src/lib/pushDispatch.ts", "pd.mjs");
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const batch = JSON.parse(init.body); sent.push(...batch); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: batch.map((_, i) => ({ status: "ok", id: `t${i}` })) }) }; };
  const QUIET = "00000000-0000-4000-8000-00000000e001", LOUD = "00000000-0000-4000-8000-00000000e002";
  let seq = 0;
  const note = (user, type, extra = {}) => ({ id: `00000000-0000-4000-8000-0000000002${String(++seq).padStart(2, "0")}`, user_id: user, title: "T", message: "M", notification_type: type, data: {}, pushed_at: null, created_at: new Date().toISOString(), read: false, ...extra });
  state.tables = {
    p2p_profiles: [
      { id: QUIET, notify_messages: false, notify_prayer: false, notify_groups: true, notify_message_preview: "name" },
      { id: LOUD, notify_messages: true, notify_prayer: true, notify_groups: true, notify_message_preview: "name" },
    ],
    p2p_notifications: [
      note(QUIET, "new_message"), note(QUIET, "prayer_invitation_received"), note(QUIET, "connection_request"),
      note(QUIET, "missed_call"), note(QUIET, null), note(QUIET, "verification_submitted"),
      note(LOUD, "new_message"), note(LOUD, "prayer_invitation_received"),
    ],
    p2p_push_tokens: [
      { id: "q", user_id: QUIET, token: "ExponentPushToken[quiet]", is_active: true, platform: "ios" },
      { id: "l", user_id: LOUD, token: "ExponentPushToken[loud]", is_active: true, platform: "android" },
    ],
  };
  const r = await D.dispatchPendingPushes();
  const to = (tok) => sent.filter((m) => m.to === tok).map((m) => m.data.notificationType);
  ok("muted categories send no push to that user", !to("ExponentPushToken[quiet]").includes("new_message") && !to("ExponentPushToken[quiet]").includes("prayer_invitation_received"), JSON.stringify(to("ExponentPushToken[quiet]")));
  ok("their other categories, calls, untyped and account alerts still send", ["connection_request", "missed_call", null, "verification_submitted"].every((t) => to("ExponentPushToken[quiet]").includes(t)));
  ok("another user's switches don't affect them", to("ExponentPushToken[loud]").includes("new_message") && to("ExponentPushToken[loud]").includes("prayer_invitation_received"));
  ok("verdicts report 2 muted", r.verdicts?.muted === 2, JSON.stringify(r.verdicts));
  ok("every row handled (muted ones too) — nothing retried", state.tables.p2p_notifications.every((n) => n.pushed_at) && r.retrying === 0);
  ok("muted rows stay unread in the Notification Center", state.tables.p2p_notifications.filter((n) => n.user_id === QUIET).every((n) => n.read === false) && state.tables.p2p_notifications.length === 8);
  const before = sent.length;
  await D.dispatchPendingPushes();
  ok("idempotent: a second run sends nothing", sent.length === before);

  // Lookup failure: all pushes go out (fail open).
  state.tables.p2p_notifications = [note(QUIET, "new_message")];
  state.failProfiles = true;
  sent.length = 0;
  await D.dispatchPendingPushes();
  ok("preference lookup failure → the push still goes out", sent.length === 1 && sent[0].to === "ExponentPushToken[quiet]");
  state.failProfiles = false;

  // Immediate path honours the same switch.
  const imm = note(QUIET, "new_message");
  state.tables.p2p_notifications = [imm];
  sent.length = 0;
  await D.dispatchNotificationNow(imm.id);
  ok("immediate dispatch: muted → no push, row stays claimed (no cron re-send)", sent.length === 0 && !!imm.pushed_at);
  const ring = note(QUIET, "incoming_call", { data: { callId: "c1" } });
  state.tables.p2p_notifications = [ring];
  await D.dispatchNotificationNow(ring.id);
  ok("immediate dispatch: a ringing call always sends", sent.some((m) => m.data.notificationType === "incoming_call"));
  globalThis.fetch = realFetch;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
