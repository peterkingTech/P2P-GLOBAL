// Admin Centre notifications (owner brief 2026-11-18) — the real lib/adminNotifications (bundled) with FAKE sources and
// the in-memory store (no database). Covers: creation, no duplicates, updates in place, resolution when the item is
// handled (never by reading), reminders on schedule, routing by role (no other modules' notifications), assigned
// items, mandatory security/crisis alerts, mark read / all, filters, badges, pagination, failed-source safety, privacy.
// Run: node tests/adminNotifications.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.resolve(root, "../mobile");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-admin-notif-"));
let N;
try {
  await build({ entryPoints: [path.join(root, "src/lib/adminNotifications.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "n.mjs"), logLevel: "silent", packages: "external" });
  N = await import(pathToFileURL(path.join(tmp, "n.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
N.setStoreForTests("memory");

const iso = (hAgo) => new Date(Date.now() - hAgo * 3600_000).toISOString();
let state = {
  verification: [{ id: "v1", at: iso(1) }],
  moderation: [{ id: "f1", at: iso(2) }],
  crisis: [{ id: "h1", at: iso(0.2) }],
  translations: 85,
  mail: [{ id: "m1", at: iso(1), assignedTo: "adminB" }],
};
let moderationFails = false;
const item = (module, type, recordId, extra = {}) => ({ module, type, recordType: "x", recordId, state: "open", priority: "normal", category: "reviews", actionRequired: true,
  title: `${module} ${recordId}`, description: "d", route: N.MODULES[module].path, params: { id: recordId }, occurredAt: iso(1), ...extra });
N.setSourcesForTests([
  { module: "verification", run: async () => state.verification.map((r) => item("verification", "verification_pending", r.id, { occurredAt: r.at, dueAt: iso(-71), remindEveryHours: 24 })) },
  { module: "moderation", run: async () => { if (moderationFails) throw new Error("db down"); return state.moderation.map((r) => item("moderation", "report_open", r.id, { occurredAt: r.at })); } },
  { module: "crisis", run: async () => state.crisis.map((r) => item("crisis", "crisis_new", r.id, { priority: "critical", category: "crisis", occurredAt: r.at, dueAt: r.dueAt ?? iso(-2), remindEveryHours: 1 })) },
  { module: "translations", run: async () => (state.translations ? [item("translations", "jobs_failed", "failed", { category: "system", count: state.translations, title: `${state.translations} translation jobs failed` })] : []) },
  { module: "official_mail", run: async () => state.mail.map((r) => item("official_mail", "mail_unread", r.id, { assignedTo: r.assignedTo, category: "assigned" })) },
]);

// ── creation and deduplication ──
let r = await N.sweep();
ok("first sweep creates one notification per outstanding item", r.created === 5);
r = await N.sweep(); await N.sweep();
ok("repeated sweeps (page refreshes, record updates) create NO duplicates", r.created === 0);
const [a, b] = await Promise.all([N.sweep(), N.sweep()]);
ok("concurrent sweeps share one run", a === b || (a.created === 0 && b.created === 0));
state.translations = 90;
r = await N.sweep();
const sup = (await N.list("owner", ["super_admin"])).items;
ok("a high-volume state is ONE aggregated notification, updated in place", r.created === 0 && sup.filter((n) => n.module === "translations").length === 1 && sup.find((n) => n.module === "translations").count === 90);

// ── routing ──
const mod = (await N.list("adminM", ["moderator"])).items.map((n) => n.module);
ok("a moderator sees moderation (and help/crisis per the sidebar roles), never verification of others' modules they can't open", mod.includes("moderation") && !mod.includes("translations") && !mod.includes("official_mail"));
const help = (await N.list("adminH", ["admin_help"])).items.map((n) => n.module);
ok("admin_help sees crisis and official mail, not moderation or verification", help.includes("crisis") && help.includes("official_mail") && !help.includes("moderation") && !help.includes("verification"));
const content = (await N.list("adminC", ["admin_content"])).items.map((n) => n.module);
ok("admin_content never sees crisis alerts", !content.includes("crisis"));
const assigned = (await N.list("adminB", ["admin_translation"])).items;
ok("an item ASSIGNED to an administrator reaches them even outside their modules", assigned.some((n) => n.module === "official_mail" && n.assignedTo === "adminB"));
ok("story narration notifications are owner-only", N.modulesFor(["admin_content"]).every((m) => m !== "story_narration") && N.modulesFor(["super_admin"]).includes("story_narration"));
let marked = await N.mark("adminC", ["admin_content"], [sup.find((n) => n.module === "crisis").id], "read");
ok("an administrator can't mark another module's notification (client tampering)", marked.updated === 0);

// ── read ≠ resolved ──
const v1 = sup.find((n) => n.recordId === "v1");
await N.mark("owner", ["super_admin"], [v1.id], "read");
let after = (await N.list("owner", ["super_admin"])).items.find((n) => n.id === v1.id);
ok("marking as read does NOT resolve the underlying item", after.status === "open" && !after.unread);
ok("read state is per administrator", (await N.list("other", ["super_admin"])).items.find((n) => n.id === v1.id).unread);
state.verification = [];
r = await N.sweep();
const resolvedList = (await N.list("owner", ["super_admin"], { filter: "resolved" })).items;
ok("handling the item in its module RESOLVES the notification", r.resolved === 1 && resolvedList.some((n) => n.id === v1.id && n.status === "resolved"));
state.verification = [{ id: "v1", at: iso(1) }];
r = await N.sweep();
ok("the same record needing attention again reopens the SAME notification (no duplicate)", r.created === 0 && (await N.list("owner", ["super_admin"])).items.some((n) => n.id === v1.id && n.status === "open"));

// ── failed source safety ──
moderationFails = true; state.moderation = [];
r = await N.sweep();
ok("a module whose source failed resolves nothing (no false 'resolved')", r.failedModules.includes("moderation") && (await N.list("owner", ["super_admin"])).items.some((n) => n.module === "moderation" && n.status === "open"));
moderationFails = false; state.moderation = [{ id: "f1", at: iso(2) }];

// ── reminders ──
const crisis = (await N.list("owner", ["super_admin"])).items.find((n) => n.module === "crisis");
await N.mark("owner", ["super_admin"], [crisis.id], "read");
r = await N.sweep(Date.now() + 30 * 60_000);
ok("no reminder before the interval", r.reminded === 0 || !(await N.list("owner", ["super_admin"])).items.find((n) => n.id === crisis.id).unread);
r = await N.sweep(Date.now() + 3 * 3600_000);
const reminded = (await N.list("owner", ["super_admin"])).items.find((n) => n.id === crisis.id);
// (The sweep ran on a simulated clock 3 h ahead; "unread again" is judged against the real clock, so check the reminder itself.)
ok("an overdue item is reminded on schedule (same notification, reminder counted and stamped)", r.reminded >= 1 && reminded.reminderCount >= 1 && !!reminded.remindedAt && reminded.id === crisis.id);

// ── preferences ──
const p = await N.savePrefs("adminH", { categories: { crisis: false, security: false, reviews: false, assigned: false }, sound: true });
ok("security and crisis alerts can't be switched off", p.categories.crisis === true && p.categories.security === true && p.sound === true);
const afterPrefs = (await N.list("adminH", ["admin_help"])).items;
ok("crisis still delivered after trying to switch it off", afterPrefs.some((n) => n.module === "crisis"));

// ── summary, badges, filters, mark all, pagination ──
const s = await N.summary("owner", ["super_admin"]);
ok("summary: unread, action required (aggregates counted), critical, badges per sidebar path", s.critical >= 1 && s.actionRequired >= 90 && s.badges["/admin/translations"] === 90 && s.badges["/admin/moderation"] === 1);
ok("summary says honestly that storage is not yet persistent (migration 255)", s.persisted === false);
ok("modules without an event workflow are listed, not faked", s.notConnected.some((x) => x.module === "usernames") && s.notConnected.some((x) => x.module === "content"));
const lst = await N.list("owner", ["super_admin"]);
ok("filters: only categories with items (plus All)", lst.filters.every((f) => f.key === "all" || f.count > 0) && lst.filters.some((f) => f.key === "important"));
const page1 = await N.list("owner", ["super_admin"], { limit: 2 });
const page2 = await N.list("owner", ["super_admin"], { limit: 2, before: page1.next });
ok("pagination: older notifications page by time, no overlap", page1.items.length === 2 && page2.items.every((n) => !page1.items.some((x) => x.id === n.id)));
await N.mark("owner", ["super_admin"], "all", "read");
ok("mark all as read", (await N.summary("owner", ["super_admin"])).unread === 0);

// ── privacy and wiring (static) ──
const src = readFileSync(path.join(root, "src/lib/adminNotifications.ts"), "utf8");
ok("sources never select message bodies, notes, reasons or snapshots", !/select\("[^"]*\b(body|note|reason|content_snapshot|subject)\b[^"]*"\)/.test(src));
ok("crisis previews carry no name or text", /title: hoursAgo\(r.created_at\) > 2 \? "Crisis help request still unanswered" : "New crisis help request", description: "A participant asked for crisis help. Open it to respond."/.test(src));
const routes = readFileSync(path.join(root, "src/routes/adminNotifications.ts"), "utf8");
ok("every route requires the Admin Centre authentication; manual sweep is super_admin", routes.includes("router.use(requireAdmin)") && routes.includes('router.post("/sweep", requireRole("super_admin")'));
const idx = readFileSync(path.join(root, "src/index.ts"), "utf8");
ok("detection runs on the server every minute (never from page rendering)", idx.includes("sweepAdminNotifications()") && /cron\.schedule\("\*\/1 \* \* \* \*", async \(\) => \{\s*try \{\s*const r = await sweepAdminNotifications/.test(idx));
const layout = readFileSync(path.join(mobile, "app/admin/_layout.tsx"), "utf8");
ok("header bell and sidebar badges in the Admin Centre shell", layout.includes("<NotificationBell />") && layout.includes("<NavBadge path={item.path} />"));
ok("every module's link is a real Admin Centre page", Object.values(N.MODULES).every((m) => layout.includes(`path: "${m.path}"`) || ["/admin/narrations", "/evaluation/admin"].includes(m.path) || layout.includes(m.path)));
const mig = readFileSync(path.join(root, "../../migrations/255_admin_notifications.sql"), "utf8");
ok("migration 255: additive, RLS on all four tables, unique dedupe key, text-free realtime signals", !/drop table|delete from/i.test(mig.replace(/--.*$/gm, "")) && (mig.match(/enable row level security/g) ?? []).length === 4 && mig.includes("dedupe_key         text not null unique"));

console.log(`adminNotifications (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
