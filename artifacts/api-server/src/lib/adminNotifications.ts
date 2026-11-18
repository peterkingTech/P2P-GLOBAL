// ADMIN CENTRE NOTIFICATIONS (owner brief 2026-11-18). One notification system across every Admin Centre module.
//
// How events are detected: each module has a SOURCE — a read-only query over the module's own records for what
// genuinely needs administrative attention (a pending verification, an open content flag, an overdue evaluation…).
// A server sweep (every minute, cron in index.ts — never from page rendering) compares what is outstanding with the
// notifications already stored:
//   • new item / new state      → ONE notification (unique dedupe key = module:type:record:state — no duplicates,
//                                 however often a record is updated or a page refreshed)
//   • item no longer outstanding → the notification is RESOLVED (reading a notification never resolves anything)
//   • still outstanding & overdue → a controlled REMINDER at the module's interval (the same notification resurfaces
//                                 as unread; no new rows)
//   • high-volume states (e.g. 85 failed translation jobs) → one aggregated notification with a count
// Routing: every module lists the admin roles that may see it — the SAME roles the Admin Centre sidebar uses and the
// module's own API enforces. An admin only ever receives notifications of modules their roles open, plus items
// assigned to them. Checked on the server for every request.
// Privacy: titles and previews never contain message bodies, prayer requests, reflections or crisis details — only
// what kind of item it is; crisis items say "A participant asked for crisis help" (no name, no text).
// Storage: tables from migration 255 when applied; until then an in-memory store (flagged `persisted: false`).
import { createHash } from "node:crypto";
import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";

export type Priority = "critical" | "high" | "normal" | "info";
export type ModuleId = "registrations" | "moderation" | "kingdom_wins" | "usernames" | "verification" | "help_requests" | "official_mail" | "crisis"
  | "growth" | "peer_evaluations" | "content" | "kingdom_stories" | "studio" | "translations" | "recycle_bin" | "access_audit" | "story_narration";
export type Category = "new_submissions" | "reviews" | "assigned" | "overdue" | "system" | "security" | "crisis";
export const MANDATORY: Category[] = ["security", "crisis"]; // can't be switched off (policy)

/** Module → who may see it (mirrors the sidebar's NAV_ITEMS roles; super_admin always) and where it opens. */
export const MODULES: Record<ModuleId, { label: string; roles: string[]; path: string; section: string }> = {
  registrations: { label: "Registrations", roles: ["church_leader", "regional_admin"], path: "/admin/registrations", section: "People & Communities" },
  moderation: { label: "Moderation", roles: ["moderator", "church_leader", "regional_admin", "admin_moderation"], path: "/admin/moderation", section: "People & Communities" },
  kingdom_wins: { label: "Kingdom Wins", roles: ["moderator", "church_leader", "regional_admin", "admin_moderation", "admin_content"], path: "/admin/kingdom-wins-review", section: "People & Communities" },
  usernames: { label: "Usernames", roles: ["moderator", "church_leader", "regional_admin", "admin_username"], path: "/admin/usernames", section: "People & Communities" },
  verification: { label: "Verification", roles: ["moderator", "church_leader", "regional_admin", "admin_verification"], path: "/admin/verification", section: "People & Communities" },
  help_requests: { label: "Help Requests", roles: ["peer_guide", "church_leader", "regional_admin", "moderator", "admin_help"], path: "/admin/help-requests", section: "Help & Support" },
  official_mail: { label: "P2P Official Mail", roles: ["admin_help", "admin_marketing"], path: "/admin/email-inbox", section: "Help & Support" },
  crisis: { label: "Crisis Response", roles: ["peer_guide", "church_leader", "regional_admin", "moderator", "admin_help"], path: "/admin/help-requests", section: "Help & Support" },
  growth: { label: "Discipleship & Growth", roles: ["admin_supervisor", "regional_admin", "admin_zone", "admin_national"], path: "/admin/discipleship", section: "Discipleship & Learning" },
  peer_evaluations: { label: "Peer Evaluations", roles: ["admin_supervisor"], path: "/evaluation/admin", section: "Discipleship & Learning" },
  content: { label: "Content", roles: ["peer_guide", "church_leader", "regional_admin", "admin_content"], path: "/admin/content", section: "Content" },
  kingdom_stories: { label: "Kingdom Stories", roles: ["admin_content"], path: "/admin/kingdom-stories", section: "Content" },
  studio: { label: "Publishing Studio", roles: ["admin_content", "admin_marketing"], path: "/admin/studio", section: "Content" },
  translations: { label: "Translations", roles: ["peer_guide", "church_leader", "regional_admin", "admin_translation"], path: "/admin/translations", section: "Content" },
  recycle_bin: { label: "Recycle Bin", roles: ["peer_guide", "church_leader", "regional_admin", "admin_content"], path: "/admin/recycle-bin", section: "Content" },
  access_audit: { label: "Access & Audit", roles: ["admin_supervisor"], path: "/admin/access", section: "Platform" },
  story_narration: { label: "Story Narration", roles: [], path: "/admin/narrations", section: "Content" }, // owner only
};
export const modulesFor = (roles: string[]): ModuleId[] =>
  (Object.keys(MODULES) as ModuleId[]).filter((m) => roles.includes("super_admin") || MODULES[m].roles.some((r) => roles.includes(r)));

/** One outstanding item, as a source reports it (no message bodies, no private text). */
export interface Item {
  module: ModuleId; type: string; recordType: string; recordId: string; state: string;
  priority: Priority; category: Category; actionRequired: boolean;
  title: string; description: string; route: string; params?: Record<string, string>;
  actorLabel?: string | null; assignedTo?: string | null; occurredAt: string; dueAt?: string | null; count?: number;
  /** Remind every N hours while it stays outstanding past `dueAt` (or past occurredAt when no due date). */
  remindEveryHours?: number | null;
}
export interface Notification extends Item {
  id: string; dedupeKey: string; status: "open" | "resolved" | "archived"; createdAt: string; updatedAt: string; resolvedAt: string | null;
  remindedAt: string | null; reminderCount: number;
}
export const dedupeKeyOf = (i: Pick<Item, "module" | "type" | "recordId" | "state">) => `${i.module}:${i.type}:${i.recordId}:${i.state}`;
const idOf = (key: string) => { const h = createHash("sha256").update(key).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const hoursAgo = (iso: string) => (Date.now() - Date.parse(iso)) / 3600_000;
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

// ── Sources: one per module, each reading only what it needs ─────────────────────────────────────────────────
type Source = { module: ModuleId; run: () => Promise<Item[]> };
const rows = async <T,>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => { const { data, error } = await q; if (error) throw error; return data ?? []; };
export const SOURCES: Source[] = [
  { module: "registrations", run: async () => (await rows<{ id: string; full_name: string | null; submitted_at: string }>(
      db.from("p2p_registration_profiles").select("id,full_name,submitted_at").eq("follow_up_status", "not_contacted").order("submitted_at", { ascending: false }).limit(200)))
    .map((r) => ({ module: "registrations", type: "registration_pending", recordType: "registration", recordId: r.id, state: "not_contacted", priority: hoursAgo(r.submitted_at) > 72 ? "high" : "normal",
      category: hoursAgo(r.submitted_at) > 72 ? "overdue" : "new_submissions", actionRequired: true, title: hoursAgo(r.submitted_at) > 72 ? "Registration waiting over 3 days" : "New registration awaiting follow-up",
      description: "A new participant's registration hasn't been followed up yet.", actorLabel: r.full_name, route: "/admin/registrations", params: { id: r.id }, occurredAt: r.submitted_at, dueAt: new Date(Date.parse(r.submitted_at) + 72 * 3600_000).toISOString(), remindEveryHours: 24 })) },
  { module: "moderation", run: async () => (await rows<{ id: string; content_type: string; created_at: string; escalation_help_request_id: string | null }>(
      db.from("p2p_content_flags").select("id,content_type,created_at,escalation_help_request_id").eq("status", "open").order("created_at", { ascending: false }).limit(200)))
    .map((r) => ({ module: "moderation", type: r.escalation_help_request_id ? "report_escalated" : "report_open", recordType: "content_flag", recordId: r.id, state: "open",
      priority: r.escalation_help_request_id ? "high" : hoursAgo(r.created_at) > 48 ? "high" : "normal", category: "reviews", actionRequired: true,
      title: r.escalation_help_request_id ? "Escalated report needs action" : "New report to review", description: `A ${r.content_type.replace(/_/g, " ")} was reported and awaits a moderation decision.`,
      route: "/admin/moderation", params: { flag: r.id }, occurredAt: r.created_at, remindEveryHours: 24 })) },
  { module: "kingdom_wins", run: async () => (await rows<{ id: string; submitted_at: string | null; created_at: string }>(
      db.from("p2p_kingdom_wins").select("id,submitted_at,created_at").eq("status", "submitted").order("submitted_at", { ascending: false }).limit(200)))
    .map((r) => ({ module: "kingdom_wins", type: "win_submitted", recordType: "kingdom_win", recordId: r.id, state: "submitted", priority: "normal", category: "reviews", actionRequired: true,
      title: "Kingdom Win awaiting review", description: "A Kingdom Win was submitted and is waiting for review.", route: "/admin/kingdom-wins-review", params: { id: r.id }, occurredAt: r.submitted_at ?? r.created_at, remindEveryHours: 48 })) },
  { module: "verification", run: async () => (await rows<{ id: string; submitted_at: string }>(
      db.from("p2p_verification_applications").select("id,submitted_at").eq("status", "pending").order("submitted_at", { ascending: false }).limit(200)))
    .map((x) => ({ id: x.id, created_at: x.submitted_at })).map((r) => ({ module: "verification", type: "verification_pending", recordType: "verification_application", recordId: r.id, state: "pending", priority: hoursAgo(r.created_at) > 72 ? "high" : "normal",
      category: hoursAgo(r.created_at) > 72 ? "overdue" : "reviews", actionRequired: true, title: "Verification request awaiting review", description: "A participant applied for verification.",
      route: "/admin/verification", params: { application: r.id }, occurredAt: r.created_at, dueAt: new Date(Date.parse(r.created_at) + 72 * 3600_000).toISOString(), remindEveryHours: 24 })) },
  { module: "help_requests", run: async () => (await rows<{ id: string; tier: string; created_at: string }>(
      db.from("p2p_help_requests").select("id,tier,created_at").eq("status", "open").neq("tier", "crisis").order("created_at", { ascending: false }).limit(200)))
    .map((r) => ({ module: "help_requests", type: "help_open", recordType: "help_request", recordId: r.id, state: "open", priority: hoursAgo(r.created_at) > 24 ? "high" : "normal",
      category: hoursAgo(r.created_at) > 24 ? "overdue" : "new_submissions", actionRequired: true, title: "Help request waiting for contact", description: "A participant asked for help and hasn't been contacted yet.",
      route: "/admin/help-requests", params: { id: r.id }, occurredAt: r.created_at, dueAt: new Date(Date.parse(r.created_at) + 24 * 3600_000).toISOString(), remindEveryHours: 12 })) },
  { module: "official_mail", run: async () => (await rows<{ id: string; to_department: string; priority: string; assigned_to: string | null; created_at: string }>(
      db.from("p2p_contact_messages").select("id,to_department,priority,assigned_to,created_at").eq("status", "unread").neq("to_department", "crisis_response").eq("is_archived", false).order("created_at", { ascending: false }).limit(200)))
    .map((r) => ({ module: "official_mail", type: "mail_unread", recordType: "contact_message", recordId: r.id, state: "unread", priority: r.priority === "urgent" ? "high" : "normal", category: r.assigned_to ? "assigned" : "new_submissions",
      actionRequired: true, title: r.priority === "urgent" ? "Urgent message to P2P" : "New message to P2P", description: `A message to ${r.to_department.replace(/_/g, " ")} is unread.`,
      assignedTo: r.assigned_to, route: `/admin/email-message/${r.id}`, occurredAt: r.created_at, remindEveryHours: 24 })) },
  // Crisis Response: crisis-tier help requests, mail to Crisis Response, crisis calls nobody answered. Never a name or text.
  { module: "crisis", run: async () => {
      const [help, mail, calls] = await Promise.all([
        rows<{ id: string; created_at: string }>(db.from("p2p_help_requests").select("id,created_at").eq("status", "open").eq("tier", "crisis").limit(200)),
        rows<{ id: string; assigned_to: string | null; created_at: string }>(db.from("p2p_contact_messages").select("id,assigned_to,created_at").eq("to_department", "crisis_response").in("status", ["unread", "read", "forwarded"]).eq("is_archived", false).limit(200)),
        rows<{ id: string; created_at: string }>(db.from("p2p_incoming_calls").select("id,created_at").eq("call_type", "crisis").eq("status", "missed").gte("created_at", ago(72)).limit(100)),
      ]);
      const due = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3600_000).toISOString();
      return [
        ...help.map((r): Item => ({ module: "crisis", type: hoursAgo(r.created_at) > 2 ? "crisis_unanswered" : "crisis_new", recordType: "help_request", recordId: r.id, state: "open", priority: "critical", category: "crisis", actionRequired: true,
          title: hoursAgo(r.created_at) > 2 ? "Crisis help request still unanswered" : "New crisis help request", description: "A participant asked for crisis help. Open it to respond.",
          route: "/admin/help-requests", params: { id: r.id, filter: "crisis" }, occurredAt: r.created_at, dueAt: due(r.created_at, 2), remindEveryHours: 1 })),
        ...mail.map((r): Item => ({ module: "crisis", type: r.assigned_to ? "crisis_mail_assigned" : "crisis_mail_unassigned", recordType: "contact_message", recordId: r.id, state: r.assigned_to ? "assigned" : "unassigned",
          priority: "critical", category: "crisis", actionRequired: true, title: r.assigned_to ? "Crisis message assigned — follow up" : "Crisis message without a responder",
          description: "A message to Crisis Response needs a response.", assignedTo: r.assigned_to, route: `/admin/email-message/${r.id}`, occurredAt: r.created_at, dueAt: due(r.created_at, 4), remindEveryHours: 2 })),
        ...calls.map((r): Item => ({ module: "crisis", type: "crisis_call_missed", recordType: "incoming_call", recordId: r.id, state: "missed", priority: "critical", category: "crisis", actionRequired: true,
          title: "A crisis call was not answered", description: "Someone called for crisis help and nobody answered. Follow up today.", route: "/admin/help-requests", params: { filter: "crisis" }, occurredAt: r.created_at, remindEveryHours: 4 })),
      ];
    } },
  { module: "growth", run: async () => {
      const r = await rows<{ id: string; created_at: string }>(db.from("p2p_growth_evidence").select("id,created_at").eq("verification", "pending_review").is("voided_at", null).order("created_at", { ascending: false }).limit(500));
      if (!r.length) return [];
      return [{ module: "growth", type: "evidence_review", recordType: "growth_evidence", recordId: "queue", state: "pending", priority: "normal", category: "reviews", actionRequired: true, count: r.length,
        title: `${r.length} growth evidence item${r.length === 1 ? "" : "s"} awaiting review`, description: "Evidence that needs an authorised reviewer before it counts.", route: "/admin/discipleship", params: { tab: "evidence" }, occurredAt: r[r.length - 1].created_at, remindEveryHours: 48 }];
    } },
  { module: "peer_evaluations", run: async () => {
      const r = await rows<{ id: string; evaluator_id: string | null; queued_since: string | null; deadline_at: string | null; created_at: string }>(
        db.from("p2p_lesson_evaluations").select("id,evaluator_id,queued_since,deadline_at,created_at").eq("status", "pending").limit(1000));
      const unassigned = r.filter((x) => !x.evaluator_id && hoursAgo(x.queued_since ?? x.created_at) > 24);
      const overdue = r.filter((x) => x.evaluator_id && x.deadline_at && Date.parse(x.deadline_at) < Date.now());
      const out: Item[] = [];
      if (unassigned.length) out.push({ module: "peer_evaluations", type: "awaiting_assignment", recordType: "lesson_evaluation", recordId: "unassigned", state: "pending", priority: unassigned.length > 20 ? "high" : "normal", category: "overdue",
        actionRequired: true, count: unassigned.length, title: `${unassigned.length} evaluation${unassigned.length === 1 ? "" : "s"} waiting over a day for an evaluator`, description: "No evaluator has been assigned yet.",
        route: "/evaluation/admin", params: { filter: "waiting" }, occurredAt: unassigned.map((x) => x.queued_since ?? x.created_at).sort()[0], remindEveryHours: 24 });
      for (const x of overdue.slice(0, 50)) out.push({ module: "peer_evaluations", type: "evaluation_overdue", recordType: "lesson_evaluation", recordId: x.id, state: "overdue", priority: "high", category: "overdue", actionRequired: true,
        title: "Peer evaluation overdue", description: "An assigned evaluation passed its deadline.", route: "/evaluation/admin", params: { evaluation: x.id }, occurredAt: x.deadline_at!, dueAt: x.deadline_at, remindEveryHours: 24 });
      return out;
    } },
  { module: "kingdom_stories", run: async () => (await rows<{ id: string; title: string; updated_at: string }>(
      db.from("p2p_kingdom_stories").select("id,title,updated_at").eq("status", "review").order("updated_at", { ascending: false }).limit(100)))
    .map((r) => ({ module: "kingdom_stories", type: "story_review", recordType: "kingdom_story", recordId: r.id, state: "review", priority: "normal", category: "reviews", actionRequired: true,
      title: "Kingdom Story awaiting editorial review", description: `“${r.title}” is ready for review.`, route: "/admin/studio", params: { story: r.id }, occurredAt: r.updated_at, remindEveryHours: 72 })) },
  { module: "studio", run: async () => (await rows<{ id: string; completed_at: string | null; run_at: string; last_error?: string | null }>(
      db.from("p2p_studio_schedules").select("id,completed_at,run_at").eq("status", "failed").gte("run_at", ago(24 * 14)).order("run_at", { ascending: false }).limit(50)))
    .map((r) => ({ module: "studio", type: "schedule_failed", recordType: "studio_schedule", recordId: r.id, state: "failed", priority: "high", category: "system", actionRequired: true,
      title: "Scheduled publication failed", description: "A scheduled publishing task failed and needs attention.", route: "/admin/studio/calendar", params: { schedule: r.id }, occurredAt: r.completed_at ?? r.run_at })) },
  { module: "translations", run: async () => {
      // A true count (not capped by the API's row limit) and the latest failure's time.
      const { count, error } = await db.from("p2p_translation_jobs").select("id", { count: "exact", head: true }).eq("status", "failed");
      if (error) throw error;
      if (!count) return [];
      const r = await rows<{ id: string; completed_at: string | null; created_at: string }>(db.from("p2p_translation_jobs").select("id,completed_at,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(1));
      return [{ module: "translations", type: "jobs_failed", recordType: "translation_job", recordId: "failed", state: "failed", priority: "normal", category: "system", actionRequired: true, count,
        title: `${count} translation job${count === 1 ? "" : "s"} failed`, description: "Machine translation failed for some content; retry or review them.", route: "/admin/translation-jobs", params: { status: "failed" },
        occurredAt: r[0]?.completed_at ?? r[0]?.created_at ?? new Date().toISOString(), remindEveryHours: 72 }];
    } },
  { module: "recycle_bin", run: async () => {
      const r = await rows<{ id: string; content_type: string; deleted_at: string }>(db.from("p2p_recycle_bin").select("id,content_type,deleted_at").eq("status", "in_bin").order("deleted_at", { ascending: false }).limit(500));
      const recent = r.filter((x) => hoursAgo(x.deleted_at) < 24 * 7), old = r.filter((x) => hoursAgo(x.deleted_at) > 24 * 30);
      const out: Item[] = recent.slice(0, 30).map((x) => ({ module: "recycle_bin", type: "content_deleted", recordType: "recycle_entry", recordId: x.id, state: "in_bin", priority: "info", category: "system", actionRequired: false,
        title: "Content moved to the Recycle Bin", description: `A ${x.content_type.replace(/_/g, " ")} was deleted and can still be restored.`, route: "/admin/recycle-bin", params: { id: x.id }, occurredAt: x.deleted_at }));
      if (old.length) out.push({ module: "recycle_bin", type: "retention_review", recordType: "recycle_entry", recordId: "old", state: "in_bin", priority: "normal", category: "system", actionRequired: true, count: old.length,
        title: `${old.length} item${old.length === 1 ? "" : "s"} in the Recycle Bin over 30 days`, description: "Decide whether to restore or permanently delete them.", route: "/admin/recycle-bin", occurredAt: old[0].deleted_at, remindEveryHours: 24 * 7 });
      return out;
    } },
  { module: "access_audit", run: async () => (await rows<{ id: string; at: string; action: string; admin_role: string | null }>(
      db.from("p2p_admin_audit").select("id,at,action,admin_role").gte("at", ago(24 * 7)).order("at", { ascending: false }).limit(500)))
    .filter((r) => /role|permission|account\.(created|suspended|reactivated)|session\.revoked|mfa|denied|failed/i.test(r.action))
    .map((r) => ({ module: "access_audit", type: "security_event", recordType: "admin_audit", recordId: r.id, state: "logged", priority: /denied|failed|suspended|revoked/i.test(r.action) ? "high" : "info",
      category: "security", actionRequired: /denied|failed/i.test(r.action), title: "Administrator access changed", description: `Audit: ${r.action.replace(/[._]/g, " ")}${r.admin_role ? ` (by ${r.admin_role.replace(/_/g, " ")})` : ""}.`,
      route: "/admin/access", params: { audit: r.id }, occurredAt: r.at })) },
  { module: "story_narration", run: async () => (await rows<{ id: string; voice_name: string; uploaded_at: string | null; created_at: string }>(
      db.from("p2p_story_narrations").select("id,voice_name,uploaded_at,created_at").eq("status", "uploaded").limit(100)).catch((e) => {
        if (["42P01", "PGRST205"].includes((e as { code?: string })?.code ?? "")) return []; // migration 254 not applied yet: nothing to review
        throw e; }))
    .map((r) => ({ module: "story_narration", type: "narration_uploaded", recordType: "story_narration", recordId: r.id, state: "uploaded", priority: "normal", category: "reviews", actionRequired: true,
      title: "Story narration awaiting your approval", description: `A recording (${r.voice_name}) was uploaded and checked.`, route: "/admin/narrations", params: { id: r.id }, occurredAt: r.uploaded_at ?? r.created_at })) },
];
/** Modules with no event workflow to read from (reported honestly; nothing invented). */
export const NOT_CONNECTED: { module: ModuleId; reason: string }[] = [
  { module: "usernames", reason: "There is no username request queue: flags are set by administrators and wait for the participant, so nothing waits on an administrator." },
  { module: "content", reason: "Curriculum content has no submission or approval status to watch (edits are made directly by content administrators); content reports arrive through Moderation." },
];

// ── Store ────────────────────────────────────────────────────────────────────────────────────────────────────
interface Store {
  persisted: boolean;
  all(): Promise<Notification[]>;
  upsert(n: Notification): Promise<void>;
  reads(adminId: string): Promise<Map<string, { readAt: string | null; actionAt: string | null; archivedAt: string | null }>>;
  mark(adminId: string, ids: string[], what: "read" | "unread" | "action" | "archive"): Promise<void>;
  prefs(adminId: string): Promise<Prefs | null>;
  savePrefs(adminId: string, p: Prefs): Promise<void>;
  signal(n: Notification): Promise<void>;
}
export interface Prefs { categories: Partial<Record<Category, boolean>>; sound: boolean }
export const DEFAULT_PREFS: Prefs = { categories: { new_submissions: true, reviews: true, assigned: true, overdue: true, system: true, security: true, crisis: true }, sound: false };

function memoryStore(): Store {
  const items = new Map<string, Notification>();
  const readMap = new Map<string, Map<string, { readAt: string | null; actionAt: string | null; archivedAt: string | null }>>();
  const prefMap = new Map<string, Prefs>();
  return {
    persisted: false,
    async all() { return [...items.values()]; },
    async upsert(n) { items.set(n.id, n); },
    async reads(a) { return readMap.get(a) ?? new Map(); },
    async mark(a, ids, what) {
      const m = readMap.get(a) ?? new Map(); const now = new Date().toISOString();
      for (const id of ids) { const r = m.get(id) ?? { readAt: null, actionAt: null, archivedAt: null };
        if (what === "read") r.readAt = now; else if (what === "unread") r.readAt = null; else if (what === "action") { r.actionAt = now; r.readAt = r.readAt ?? now; } else r.archivedAt = now;
        m.set(id, r); }
      readMap.set(a, m);
    },
    async prefs(a) { return prefMap.get(a) ?? null; },
    async savePrefs(a, p) { prefMap.set(a, p); },
    async signal() { /* no realtime without the table */ },
  };
}
const toRow = (n: Notification) => ({ id: n.id, dedupe_key: n.dedupeKey, module: n.module, type: n.type, record_type: n.recordType, record_id: n.recordId, state: n.state, priority: n.priority, category: n.category,
  action_required: n.actionRequired, title: n.title, description: n.description, route: n.route, params: n.params ?? {}, actor_label: n.actorLabel ?? null, assigned_to: n.assignedTo ?? null,
  occurred_at: n.occurredAt, due_at: n.dueAt ?? null, item_count: n.count ?? null, remind_every_hours: n.remindEveryHours ?? null, status: n.status, created_at: n.createdAt, updated_at: n.updatedAt,
  resolved_at: n.resolvedAt, reminded_at: n.remindedAt, reminder_count: n.reminderCount });
const fromRow = (r: any): Notification => ({ id: r.id, dedupeKey: r.dedupe_key, module: r.module, type: r.type, recordType: r.record_type, recordId: r.record_id, state: r.state, priority: r.priority, category: r.category,
  actionRequired: r.action_required, title: r.title, description: r.description, route: r.route, params: r.params ?? {}, actorLabel: r.actor_label, assignedTo: r.assigned_to, occurredAt: r.occurred_at,
  dueAt: r.due_at, count: r.item_count ?? undefined, remindEveryHours: r.remind_every_hours, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at, remindedAt: r.reminded_at, reminderCount: r.reminder_count ?? 0 });
function dbStore(): Store {
  return {
    persisted: true,
    async all() { const { data, error } = await db.from("p2p_admin_notifications").select("*").or(`status.eq.open,resolved_at.gte.${ago(24 * 30)}`).order("occurred_at", { ascending: false }).limit(3000); if (error) throw error; return (data ?? []).map(fromRow); },
    async upsert(n) { const { error } = await db.from("p2p_admin_notifications").upsert(toRow(n), { onConflict: "dedupe_key" }); if (error) throw error; },
    async reads(a) {
      const { data } = await db.from("p2p_admin_notification_reads").select("notification_id,read_at,action_at,archived_at").eq("admin_user_id", a).limit(5000);
      return new Map(((data ?? []) as any[]).map((r) => [r.notification_id, { readAt: r.read_at, actionAt: r.action_at, archivedAt: r.archived_at }]));
    },
    async mark(a, ids, what) {
      const now = new Date().toISOString();
      const patch = what === "read" ? { read_at: now } : what === "unread" ? { read_at: null } : what === "action" ? { action_at: now, read_at: now } : { archived_at: now };
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await db.from("p2p_admin_notification_reads").upsert(ids.slice(i, i + 200).map((id) => ({ notification_id: id, admin_user_id: a, ...patch })), { onConflict: "notification_id,admin_user_id" });
        if (error) throw error;
      }
    },
    async prefs(a) { const { data } = await db.from("p2p_admin_notification_prefs").select("prefs").eq("admin_user_id", a).maybeSingle(); return (data as { prefs: Prefs } | null)?.prefs ?? null; },
    async savePrefs(a, p) { const { error } = await db.from("p2p_admin_notification_prefs").upsert({ admin_user_id: a, prefs: p, updated_at: new Date().toISOString() }, { onConflict: "admin_user_id" }); if (error) throw error; },
    // Realtime: a tiny signal row (id, module, time — no text) the Admin Centre listens to, then refetches through this API.
    async signal(n) { await db.from("p2p_admin_notification_signals").insert({ notification_id: n.id, module: n.module }); },
  };
}
let store: Store | null = null;
let storeOverride: Store | null = null;
export function setStoreForTests(s: "memory" | null) { storeOverride = s ? memoryStore() : null; }
async function getStore(): Promise<Store> {
  if (storeOverride) return storeOverride;
  if (store) return store;
  const { error } = await db.from("p2p_admin_notifications").select("id").limit(1);
  store = error ? memoryStore() : dbStore(); // migration 255 not applied → in memory, and the API says so
  return store;
}
export const isPersisted = async () => (await getStore()).persisted;

// ── Sweep ────────────────────────────────────────────────────────────────────────────────────────────────────
let sourcesOverride: Source[] | null = null;
export function setSourcesForTests(s: Source[] | null) { sourcesOverride = s; }
let sweeping: Promise<{ created: number; resolved: number; reminded: number; failedModules: string[] }> | null = null;
/** Compare outstanding items with stored notifications: create / update / resolve / remind. Never two at once. */
export function sweep(nowMs = Date.now()) {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const s = await getStore();
    const sources = sourcesOverride ?? SOURCES;
    const results = await Promise.all(sources.map(async (src) => { try { return { src, items: await src.run(), ok: true }; } catch (e) { logger.warn({ module: src.module, code: (e as { code?: string })?.code }, "admin notifications: source failed"); return { src, items: [] as Item[], ok: false }; } }));
    const existing = await s.all();
    const byKey = new Map(existing.map((n) => [n.dedupeKey, n]));
    const nowIso = new Date(nowMs).toISOString();
    let created = 0, resolved = 0, reminded = 0;
    const seen = new Set<string>();
    for (const { items } of results) for (const it of items) {
      const key = dedupeKeyOf(it);
      if (seen.has(key)) continue; // a source listing the same record twice never doubles it
      seen.add(key);
      const prev = byKey.get(key);
      if (!prev) {
        const n: Notification = { ...it, id: idOf(key), dedupeKey: key, status: "open", createdAt: nowIso, updatedAt: nowIso, resolvedAt: null, remindedAt: null, reminderCount: 0 };
        await s.upsert(n); await s.signal(n); created++; continue;
      }
      // Same event: update in place (count, priority, wording) — never a second row.
      let next: Notification = { ...prev, ...it, id: prev.id, dedupeKey: key, status: "open", resolvedAt: null, createdAt: prev.createdAt, remindedAt: prev.remindedAt, reminderCount: prev.reminderCount, updatedAt: prev.updatedAt };
      const changed = prev.status !== "open" || prev.count !== it.count || prev.priority !== it.priority || prev.title !== it.title || prev.assignedTo !== (it.assignedTo ?? null);
      const dueMs = Date.parse(it.dueAt ?? it.occurredAt);
      const last = Date.parse(prev.remindedAt ?? prev.createdAt);
      const remind = !!it.remindEveryHours && nowMs > dueMs && nowMs - last >= it.remindEveryHours * 3600_000;
      if (remind) { next = { ...next, remindedAt: nowIso, reminderCount: prev.reminderCount + 1 }; reminded++; }
      if (changed || remind) { next.updatedAt = nowIso; await s.upsert(next); await s.signal(next); }
    }
    // Resolved: no longer outstanding in a module whose source answered (a failed source resolves nothing).
    const okModules = new Set(results.filter((r) => r.ok).map((r) => r.src.module));
    for (const n of existing) if (n.status === "open" && okModules.has(n.module) && !seen.has(n.dedupeKey)) {
      await s.upsert({ ...n, status: "resolved", resolvedAt: nowIso, updatedAt: nowIso }); resolved++;
    }
    return { created, resolved, reminded, failedModules: results.filter((r) => !r.ok).map((r) => r.src.module) };
  })().finally(() => { sweeping = null; });
  return sweeping;
}

// ── What one administrator sees ──────────────────────────────────────────────────────────────────────────────
export type Filter = "all" | "unread" | "action" | "assigned" | "important" | "resolved";
export interface View extends Notification { unread: boolean; actionTakenAt: string | null; moduleLabel: string }
async function visible(adminId: string, roles: string[]) {
  const s = await getStore();
  const allowed = new Set(modulesFor(roles));
  const [all, reads, prefs] = await Promise.all([s.all(), s.reads(adminId), s.prefs(adminId)]);
  const p = prefs ?? DEFAULT_PREFS;
  return all
    .filter((n) => allowed.has(n.module) || (n.assignedTo === adminId && n.module !== "story_narration"))
    .filter((n) => MANDATORY.includes(n.category) || p.categories[n.category] !== false || n.assignedTo === adminId)
    .map((n): View => {
      const r = reads.get(n.id);
      const lastSurfaced = n.remindedAt ?? n.createdAt;
      // Unread: never read, or a reminder surfaced it again after it was read (a reminder stamped in the future —
      // clock skew — never makes a read item unread).
      const surfaced = Math.min(Date.parse(lastSurfaced), Date.now());
      return { ...n, unread: n.status === "open" && (!r?.readAt || Date.parse(r.readAt) < surfaced), actionTakenAt: r?.actionAt ?? null, moduleLabel: MODULES[n.module].label,
        ...(r?.archivedAt ? { status: "archived" as const } : {}) };
    });
}
const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, normal: 2, info: 3 };
export async function list(adminId: string, roles: string[], o: { filter?: Filter; module?: ModuleId | null; before?: string | null; limit?: number } = {}) {
  const v = await visible(adminId, roles);
  const f = o.filter ?? "all";
  const match = (n: View) => (f === "resolved" ? n.status === "resolved" : n.status === "open")
    && (f !== "unread" || n.unread) && (f !== "action" || n.actionRequired) && (f !== "assigned" || n.assignedTo === adminId) && (f !== "important" || PRIORITY_RANK[n.priority] <= 1)
    && (!o.module || n.module === o.module);
  const sorted = v.filter(match).sort((a, b) => Date.parse(b.remindedAt ?? b.occurredAt) - Date.parse(a.remindedAt ?? a.occurredAt));
  const page = (o.before ? sorted.filter((n) => Date.parse(n.remindedAt ?? n.occurredAt) < Date.parse(o.before!)) : sorted).slice(0, Math.min(100, o.limit ?? 30));
  const open = v.filter((n) => n.status === "open");
  const filters = ([["all", open.length], ["unread", open.filter((n) => n.unread).length], ["action", open.filter((n) => n.actionRequired).length],
    ["assigned", open.filter((n) => n.assignedTo === adminId).length], ["important", open.filter((n) => PRIORITY_RANK[n.priority] <= 1).length], ["resolved", v.filter((n) => n.status === "resolved").length]] as [Filter, number][])
    .filter(([k, c]) => k === "all" || c > 0).map(([key, count]) => ({ key, count }));
  return { items: page, next: page.length && sorted.length > page.length ? (page[page.length - 1].remindedAt ?? page[page.length - 1].occurredAt) : null, filters, persisted: (await getStore()).persisted };
}
/** Header bell, sidebar badges and the dashboard summary in one cheap call. */
export async function summary(adminId: string, roles: string[]) {
  const v = await visible(adminId, roles);
  const open = v.filter((n) => n.status === "open");
  const badges: Record<string, number> = {};
  for (const n of open.filter((x) => x.actionRequired)) { const path = MODULES[n.module].path; badges[path] = (badges[path] ?? 0) + (n.count ?? 1); }
  return {
    unread: open.filter((n) => n.unread).length,
    actionRequired: open.filter((n) => n.actionRequired).reduce((a, n) => a + (n.count ?? 1), 0),
    critical: open.filter((n) => n.priority === "critical").length,
    assignedToMe: open.filter((n) => n.assignedTo === adminId).length,
    overdue: open.filter((n) => n.dueAt && Date.parse(n.dueAt) < Date.now()).length,
    badges,
    recent: [...v].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8).map((n) => ({ id: n.id, title: n.title, module: n.moduleLabel, priority: n.priority, status: n.status, at: n.updatedAt, route: n.route, params: n.params ?? {} })),
    persisted: (await getStore()).persisted,
    notConnected: NOT_CONNECTED.filter((x) => modulesFor(roles).includes(x.module)),
  };
}
/** Read / unread / action taken / archive — this administrator's view only; the underlying item is untouched. */
export async function mark(adminId: string, roles: string[], ids: string[] | "all", what: "read" | "unread" | "action" | "archive") {
  const v = await visible(adminId, roles);
  const allowed = new Set(v.map((n) => n.id));
  const target = ids === "all" ? v.filter((n) => n.status === "open" && n.unread).map((n) => n.id) : ids.filter((id) => allowed.has(id)); // never another module's
  if (target.length) await (await getStore()).mark(adminId, target, what);
  return { updated: target.length };
}
export async function getPrefs(adminId: string): Promise<Prefs> { return (await (await getStore()).prefs(adminId)) ?? DEFAULT_PREFS; }
export async function savePrefs(adminId: string, raw: unknown): Promise<Prefs> {
  const r = (raw ?? {}) as Partial<Prefs>;
  const categories: Prefs["categories"] = { ...DEFAULT_PREFS.categories };
  for (const k of Object.keys(DEFAULT_PREFS.categories) as Category[]) if (typeof r.categories?.[k] === "boolean") categories[k] = r.categories[k];
  for (const k of MANDATORY) categories[k] = true; // security and crisis alerts can't be switched off
  const p: Prefs = { categories, sound: r.sound === true };
  await (await getStore()).savePrefs(adminId, p);
  return p;
}
