// P2P Mail (migration 244): P2P Global's own correspondence — not e-mail, and separate from chat.
// Every request is checked here (the tables are API-only): a thread is visible only to its participants,
// a draft only to its author; official mail only within the sender's real authority:
//   p2p    — P2P Global administration (profile role in OFFICIAL_P2P_ROLES), to any participant;
//   church — an active leader (LEADERSHIP_ROLES) of THAT church, only to its active members;
//   family — THAT family's shepherd, only to its active members.
// Nothing is ever written to p2p_messages (chat) and nothing is sent outside P2P Global.
//
//   GET  /mail?folder=inbox|sent|archived&q=&with=<userId>   threads (newest first)
//   GET  /mail/unread                                          unread thread count (inbox)
//   GET  /mail/official-scopes                                 where the caller may send officially
//   GET  /mail/recipients?q=                                   people to write to (blocks respected)
//   GET  /mail/drafts · POST /mail/drafts · DELETE /mail/drafts/:id
//   POST /mail                { to[], subject, body, official?: { scope, scopeId?, toAll? }, draftId? }
//   GET  /mail/:id            the thread with its letters (participants only)
//   POST /mail/:id/reply      { body }
//   POST /mail/:id/forward    { messageId, to[], note? }   → a new thread "Fwd: …" keeping the original
//   POST /mail/:id/read · POST /mail/:id/archive { archived }
import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { dispatchNotificationNow } from "../lib/pushDispatch";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OFFICIAL_P2P_ROLES = ["super_admin", "admin_supervisor", "admin_help"];
export const CHURCH_LEADERSHIP_ROLES = ["senior_pastor", "discipleship_pastor", "small_group_leader"];
const MAX_RECIPIENTS = 50, MAX_NEW_THREADS_PER_DAY = 60;

const ok = (res: Response, data: unknown) => res.json(data);
const err = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });
class MailError extends Error { constructor(message: string, public status = 400) { super(message); } }
const fail = (res: Response, e: unknown) => (e instanceof MailError ? err(res, e.message, e.status) : err(res, "That didn't work. Please try again.", 500));
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && UUID.test(x)))];

async function caller(req: Request, res: Response): Promise<string | null> {
  const id = await verifyCaller(req);
  if (!id) { err(res, "Please sign in.", 401); return null; }
  return id;
}
async function names(userIds: string[]): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  if (!userIds.length) return new Map();
  const rows = must(await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", userIds)) as { id: string; full_name: string | null; photo_url: string | null }[];
  return new Map(rows.map((r) => [r.id, { name: r.full_name || "P2P participant", photoUrl: r.photo_url }]));
}
/** The caller's participation in a thread, or a 404 (never reveals that someone else's thread exists). */
async function membership(threadId: string, userId: string) {
  if (!UUID.test(threadId)) throw new MailError("This mail isn't available.", 404);
  const p = must(await db.from("p2p_mail_participants").select("thread_id,role,last_read_at,archived_at,removed_at").eq("thread_id", threadId).eq("user_id", userId).maybeSingle()) as
    { role: string; last_read_at: string | null; archived_at: string | null; removed_at: string | null } | null;
  if (!p || p.removed_at) throw new MailError("This mail isn't available.", 404);
  return p;
}
const audit = (row: { thread_id: string; message_id?: string | null; actor_id: string; event: string; detail?: Record<string, unknown> }) =>
  db.from("p2p_mail_events").insert({ detail: {}, ...row });

// ── Official authority ─────────────────────────────────────────────────────
type Scope = { scope: "p2p" | "church" | "family"; scopeId: string | null; label: string; members: string[] | null };
/** Where the caller may send official mail (and, for a Church/Family, exactly who may receive it). */
export async function officialScopes(userId: string): Promise<Scope[]> {
  const out: Scope[] = [];
  const prof = must(await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle()) as { role: string } | null;
  if (prof && OFFICIAL_P2P_ROLES.includes(String(prof.role))) out.push({ scope: "p2p", scopeId: null, label: "P2P Global Administration", members: null });
  const lead = must(await db.from("p2p_church_members").select("church_id,role,is_active").eq("user_id", userId).eq("is_active", true).in("role", CHURCH_LEADERSHIP_ROLES)) as { church_id: string }[];
  for (const l of lead) {
    const [ch, mem] = await Promise.all([
      db.from("p2p_churches").select("name").eq("id", l.church_id).maybeSingle(),
      db.from("p2p_church_members").select("user_id").eq("church_id", l.church_id).eq("is_active", true),
    ]);
    out.push({ scope: "church", scopeId: l.church_id, label: (ch.data as { name?: string } | null)?.name ?? "Church", members: ((mem.data ?? []) as { user_id: string }[]).map((m) => m.user_id) });
  }
  const fams = must(await db.from("p2p_families").select("id,name,shepherd_id").eq("shepherd_id", userId)) as { id: string; name: string | null }[];
  for (const f of fams) {
    const mem = must(await db.from("p2p_family_members").select("user_id,status").eq("family_id", f.id)) as { user_id: string; status: string | null }[];
    out.push({ scope: "family", scopeId: f.id, label: f.name || "Family", members: mem.filter((m) => !m.status || m.status === "active").map((m) => m.user_id) });
  }
  return out;
}

// ── Notifications (open the thread; subject only, never the letter) ──────────
async function notify(userIds: string[], threadId: string, messageId: string, senderName: string, subject: string, official: string | null) {
  if (!userIds.length) return;
  const rows = userIds.map((u) => ({
    user_id: u, title: official ? `Official P2P Mail · ${official}` : `P2P Mail from ${senderName}`, message: subject,
    notification_type: official ? "official_mail" : "p2p_mail", data: { kind: "mail", threadId, messageId },
  }));
  const { data } = await db.from("p2p_notifications").insert(rows).select("id");
  for (const n of (data ?? []) as { id: string }[]) void dispatchNotificationNow(n.id).catch(() => {});
}

// ── Listing ───────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const folder = req.query.folder === "sent" ? "sent" : req.query.folder === "archived" ? "archived" : "inbox";
    const q = text(req.query.q, 100).toLowerCase();
    const withUser = typeof req.query.with === "string" && UUID.test(req.query.with) ? req.query.with : null;
    const mine = must(await db.from("p2p_mail_participants").select("thread_id,role,last_read_at,archived_at,removed_at").eq("user_id", userId).is("removed_at", null).limit(1000)) as
      { thread_id: string; role: string; last_read_at: string | null; archived_at: string | null }[];
    let threadIds = mine.filter((m) => (folder === "archived" ? !!m.archived_at : !m.archived_at)).map((m) => m.thread_id);
    if (!threadIds.length) return ok(res, { threads: [] });
    const threads = must(await db.from("p2p_mail_threads").select("id,subject,created_by,last_message_at,is_official,official_scope,official_scope_id").in("id", threadIds).order("last_message_at", { ascending: false }).limit(300)) as
      { id: string; subject: string; created_by: string; last_message_at: string; is_official: boolean; official_scope: string | null; official_scope_id: string | null }[];
    threadIds = threads.map((t) => t.id);
    const [letters, parts] = await Promise.all([
      db.from("p2p_mail_messages").select("id,thread_id,sender_id,body,sent_at,kind").in("thread_id", threadIds).order("sent_at", { ascending: true }),
      db.from("p2p_mail_participants").select("thread_id,user_id,role,removed_at").in("thread_id", threadIds),
    ]);
    const byThread = new Map<string, { id: string; sender_id: string; body: string; sent_at: string }[]>();
    for (const l of (letters.data ?? []) as { id: string; thread_id: string; sender_id: string; body: string; sent_at: string }[]) (byThread.get(l.thread_id) ?? byThread.set(l.thread_id, []).get(l.thread_id)!).push(l);
    const people = new Map<string, string[]>();
    for (const p of (parts.data ?? []) as { thread_id: string; user_id: string; removed_at: string | null }[]) if (!p.removed_at) (people.get(p.thread_id) ?? people.set(p.thread_id, []).get(p.thread_id)!).push(p.user_id);
    const who = await names([...new Set([...people.values()].flat())]);
    const me = new Map(mine.map((m) => [m.thread_id, m]));
    const out = threads.map((t) => {
      const ls = byThread.get(t.id) ?? [];
      const last = ls[ls.length - 1];
      const others = (people.get(t.id) ?? []).filter((u) => u !== userId);
      const readAt = me.get(t.id)?.last_read_at;
      const unread = ls.filter((l) => l.sender_id !== userId && (!readAt || l.sent_at > readAt)).length;
      const iSent = ls.some((l) => l.sender_id === userId);
      return {
        id: t.id, subject: t.subject, lastMessageAt: t.last_message_at, unread, letters: ls.length,
        isOfficial: t.is_official, officialScope: t.official_scope,
        from: last ? { id: last.sender_id, name: who.get(last.sender_id)?.name ?? "P2P participant" } : null,
        with: others.map((u) => ({ id: u, name: who.get(u)?.name ?? "P2P participant", photoUrl: who.get(u)?.photoUrl ?? null })),
        snippet: last ? last.body.replace(/\s+/g, " ").slice(0, 140) : "",
        _iSent: iSent, _theyWrote: ls.some((l) => l.sender_id !== userId), _all: ls,
      };
    }).filter((t) => (folder === "sent" ? t._iSent : folder === "inbox" ? t._theyWrote : true))
      .filter((t) => !withUser || t.with.some((w) => w.id === withUser))
      .filter((t) => !q || t.subject.toLowerCase().includes(q) || t._all.some((l) => l.body.toLowerCase().includes(q)) || t.with.some((w) => w.name.toLowerCase().includes(q)))
      .map(({ _iSent, _theyWrote, _all, ...t }) => t);
    return ok(res, { threads: out });
  } catch (e) { return fail(res, e); }
});

router.get("/unread", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const mine = must(await db.from("p2p_mail_participants").select("thread_id,last_read_at").eq("user_id", userId).is("removed_at", null).is("archived_at", null).limit(1000)) as { thread_id: string; last_read_at: string | null }[];
    if (!mine.length) return ok(res, { unreadThreads: 0 });
    const letters = must(await db.from("p2p_mail_messages").select("thread_id,sender_id,sent_at").in("thread_id", mine.map((m) => m.thread_id)).neq("sender_id", userId)) as { thread_id: string; sent_at: string }[];
    const readAt = new Map(mine.map((m) => [m.thread_id, m.last_read_at]));
    return ok(res, { unreadThreads: new Set(letters.filter((l) => !readAt.get(l.thread_id) || l.sent_at > readAt.get(l.thread_id)!).map((l) => l.thread_id)).size });
  } catch (e) { return fail(res, e); }
});

router.get("/official-scopes", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try { return ok(res, { scopes: (await officialScopes(userId)).map(({ members, ...s }) => ({ ...s, memberCount: members ? members.filter((m) => m !== userId).length : null })) }); }
  catch (e) { return fail(res, e); }
});

router.get("/recipients", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const q = text(req.query.q, 60).replace(/[%,()]/g, " ").trim();
    if (q.length < 2) return ok(res, { people: [] });
    const rows = must(await db.from("p2p_profiles").select("id,full_name,username,photo_url").or(`full_name.ilike.%${q}%,username.ilike.%${q}%`).neq("id", userId).limit(20)) as
      { id: string; full_name: string | null; username: string | null; photo_url: string | null }[];
    const blocks = must(await db.from("p2p_user_blocks").select("blocker_id,blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)) as { blocker_id: string; blocked_id: string }[];
    const hidden = new Set(blocks.map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)));
    return ok(res, { people: rows.filter((r) => !hidden.has(r.id)).map((r) => ({ id: r.id, name: r.full_name || "P2P participant", username: r.username, photoUrl: r.photo_url })) });
  } catch (e) { return fail(res, e); }
});

// ── Drafts (author only) ───────────────────────────────────────────────────
router.get("/drafts", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const rows = must(await db.from("p2p_mail_drafts").select("*").eq("owner_id", userId).order("updated_at", { ascending: false }).limit(100)) as Record<string, any>[];
    const who = await names([...new Set(rows.flatMap((r) => r.to_user_ids as string[]))]);
    return ok(res, { drafts: rows.map((r) => ({ id: r.id, threadId: r.thread_id, subject: r.subject, body: r.body, updatedAt: r.updated_at, replyToId: r.reply_to_id, forwardedFromId: r.forwarded_from_id,
      official: r.official_scope ? { scope: r.official_scope, scopeId: r.official_scope_id } : null, to: (r.to_user_ids as string[]).map((u) => ({ id: u, name: who.get(u)?.name ?? "P2P participant" })) })) });
  } catch (e) { return fail(res, e); }
});
router.post("/drafts", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const b = req.body ?? {};
    const row = { owner_id: userId, to_user_ids: ids(b.to).slice(0, MAX_RECIPIENTS), subject: text(b.subject, 200), body: typeof b.body === "string" ? b.body.slice(0, 20000) : "",
      thread_id: typeof b.threadId === "string" && UUID.test(b.threadId) ? b.threadId : null, updated_at: new Date().toISOString(),
      official_scope: ["p2p", "church", "family"].includes(b.official?.scope) ? b.official.scope : null, official_scope_id: typeof b.official?.scopeId === "string" && UUID.test(b.official.scopeId) ? b.official.scopeId : null };
    if (row.thread_id) await membership(row.thread_id, userId);
    if (typeof b.id === "string" && UUID.test(b.id)) {
      const upd = must(await db.from("p2p_mail_drafts").update(row).eq("id", b.id).eq("owner_id", userId).select("id")) as { id: string }[];
      if (!upd.length) throw new MailError("This draft isn't available.", 404);
      return ok(res, { id: upd[0].id });
    }
    const ins = must(await db.from("p2p_mail_drafts").insert(row).select("id").single()) as { id: string };
    return ok(res, { id: ins.id });
  } catch (e) { return fail(res, e); }
});
router.delete("/drafts/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!UUID.test(req.params.id)) throw new MailError("This draft isn't available.", 404);
    must(await db.from("p2p_mail_drafts").delete().eq("id", req.params.id).eq("owner_id", userId));
    return ok(res, { deleted: true });
  } catch (e) { return fail(res, e); }
});

// ── Sending ────────────────────────────────────────────────────────────────
/** Who the caller may write to: no one who blocked them (or whom they blocked); official scope limits. */
async function allowedRecipients(userId: string, to: string[], official: Scope | null): Promise<string[]> {
  const list = to.filter((u) => u !== userId);
  if (!list.length) throw new MailError("Choose at least one recipient.");
  if (list.length > MAX_RECIPIENTS) throw new MailError(`A letter can go to at most ${MAX_RECIPIENTS} people.`);
  const exist = must(await db.from("p2p_profiles").select("id").in("id", list)) as { id: string }[];
  if (exist.length !== list.length) throw new MailError("One of the recipients isn't a P2P participant.");
  if (official?.members) {
    const allowed = new Set(official.members);
    if (list.some((u) => !allowed.has(u))) throw new MailError(`Official mail from ${official.label} can only go to its own members.`, 403);
  }
  const blocks = must(await db.from("p2p_user_blocks").select("blocker_id,blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)) as { blocker_id: string; blocked_id: string }[];
  const blocked = new Set(blocks.map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)));
  if (!official && list.some((u) => blocked.has(u))) throw new MailError("This letter can't be sent to one of the recipients.", 403);
  return list.filter((u) => official || !blocked.has(u));
}
async function resolveOfficial(userId: string, o: unknown): Promise<Scope | null> {
  if (!o || typeof o !== "object") return null;
  const want = o as { scope?: string; scopeId?: string };
  const scopes = await officialScopes(userId);
  const s = scopes.find((x) => x.scope === want.scope && (x.scope === "p2p" || x.scopeId === want.scopeId));
  if (!s) throw new MailError("You can't send official mail for that organisation.", 403);
  return s;
}

router.post("/", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const b = req.body ?? {};
    const subject = text(b.subject, 200), body = typeof b.body === "string" ? b.body.trim().slice(0, 20000) : "";
    if (!subject) throw new MailError("Add a subject.");
    if (!body) throw new MailError("Write your letter.");
    const official = await resolveOfficial(userId, b.official);
    const to = official?.members && b.official?.toAll === true ? official.members.filter((m) => m !== userId) : ids(b.to);
    const recipients = await allowedRecipients(userId, to, official);
    if (!official) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const { count } = await db.from("p2p_mail_threads").select("id", { count: "exact", head: true }).eq("created_by", userId).gte("created_at", since);
      if ((count ?? 0) >= MAX_NEW_THREADS_PER_DAY) throw new MailError("You've started a lot of new mail today — please try again tomorrow.", 429);
    }
    const thread = must(await db.from("p2p_mail_threads").insert({ subject, created_by: userId, is_official: !!official, official_scope: official?.scope ?? null, official_scope_id: official?.scopeId ?? null }).select("id").single()) as { id: string };
    const letter = must(await db.from("p2p_mail_messages").insert({ thread_id: thread.id, sender_id: userId, body, kind: "original", is_official: !!official }).select("id,sent_at").single()) as { id: string; sent_at: string };
    must(await db.from("p2p_mail_participants").insert([{ thread_id: thread.id, user_id: userId, role: "sender", last_read_at: letter.sent_at },
      ...recipients.map((u) => ({ thread_id: thread.id, user_id: u, role: "recipient" }))]));
    await audit({ thread_id: thread.id, message_id: letter.id, actor_id: userId, event: official ? "official_sent" : "sent", detail: { recipients: recipients.length, scope: official?.scope ?? null, scopeId: official?.scopeId ?? null } });
    if (typeof b.draftId === "string" && UUID.test(b.draftId)) await db.from("p2p_mail_drafts").delete().eq("id", b.draftId).eq("owner_id", userId);
    const me = (await names([userId])).get(userId)?.name ?? "P2P participant";
    await notify(recipients, thread.id, letter.id, me, subject, official?.label ?? null);
    return ok(res, { threadId: thread.id, messageId: letter.id, recipients: recipients.length });
  } catch (e) { return fail(res, e); }
});

router.get("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const me = await membership(req.params.id, userId);
    const thread = must(await db.from("p2p_mail_threads").select("id,subject,created_by,created_at,is_official,official_scope,official_scope_id").eq("id", req.params.id).single()) as Record<string, any>;
    const [letters, parts] = await Promise.all([
      db.from("p2p_mail_messages").select("id,sender_id,body,kind,reply_to_id,forwarded_from_id,is_official,attachments,sent_at").eq("thread_id", req.params.id).order("sent_at", { ascending: true }),
      db.from("p2p_mail_participants").select("user_id,role,removed_at").eq("thread_id", req.params.id),
    ]);
    const ls = (letters.data ?? []) as Record<string, any>[];
    const ps = ((parts.data ?? []) as { user_id: string; role: string; removed_at: string | null }[]).filter((p) => !p.removed_at);
    const who = await names([...new Set([...ls.map((l) => l.sender_id), ...ps.map((p) => p.user_id)])]);
    let officialLabel: string | null = null;
    if (thread.is_official) {
      if (thread.official_scope === "p2p") officialLabel = "P2P Global Administration";
      else if (thread.official_scope === "church") officialLabel = ((await db.from("p2p_churches").select("name").eq("id", thread.official_scope_id).maybeSingle()).data as { name?: string } | null)?.name ?? "Church";
      else officialLabel = ((await db.from("p2p_families").select("name").eq("id", thread.official_scope_id).maybeSingle()).data as { name?: string } | null)?.name ?? "Family";
    }
    return ok(res, {
      id: thread.id, subject: thread.subject, createdAt: thread.created_at, isOfficial: thread.is_official, officialLabel, archived: !!me.archived_at, lastReadAt: me.last_read_at,
      participants: ps.map((p) => ({ id: p.user_id, role: p.role, name: who.get(p.user_id)?.name ?? "P2P participant", photoUrl: who.get(p.user_id)?.photoUrl ?? null, isMe: p.user_id === userId })),
      letters: ls.map((l) => ({ id: l.id, kind: l.kind, body: l.body, sentAt: l.sent_at, replyToId: l.reply_to_id, forwardedFromId: l.forwarded_from_id, isOfficial: l.is_official, attachments: l.attachments ?? [],
        from: { id: l.sender_id, name: who.get(l.sender_id)?.name ?? "P2P participant", isMe: l.sender_id === userId } })),
    });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/reply", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await membership(req.params.id, userId);
    const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 20000) : "";
    if (!body) throw new MailError("Write your reply.");
    const thread = must(await db.from("p2p_mail_threads").select("subject,is_official,official_scope,official_scope_id,created_by").eq("id", req.params.id).single()) as Record<string, any>;
    const last = must(await db.from("p2p_mail_messages").select("id").eq("thread_id", req.params.id).order("sent_at", { ascending: false }).limit(1)) as { id: string }[];
    // Replying stays in the thread; an official thread's reply is official only from someone authorised for that scope.
    let official = false;
    if (thread.is_official) official = !!(await officialScopes(userId)).find((s) => s.scope === thread.official_scope && (s.scope === "p2p" || s.scopeId === thread.official_scope_id));
    const letter = must(await db.from("p2p_mail_messages").insert({ thread_id: req.params.id, sender_id: userId, body, kind: "reply", reply_to_id: last[0]?.id ?? null, is_official: official }).select("id,sent_at").single()) as { id: string; sent_at: string };
    await db.from("p2p_mail_threads").update({ last_message_at: letter.sent_at }).eq("id", req.params.id);
    await db.from("p2p_mail_participants").update({ last_read_at: letter.sent_at }).eq("thread_id", req.params.id).eq("user_id", userId);
    // A reply brings the thread back to everyone's inbox.
    await db.from("p2p_mail_participants").update({ archived_at: null }).eq("thread_id", req.params.id).is("removed_at", null);
    await audit({ thread_id: req.params.id, message_id: letter.id, actor_id: userId, event: "replied" });
    const others = ((must(await db.from("p2p_mail_participants").select("user_id,removed_at").eq("thread_id", req.params.id)) as { user_id: string; removed_at: string | null }[])).filter((p) => !p.removed_at && p.user_id !== userId).map((p) => p.user_id);
    const me = (await names([userId])).get(userId)?.name ?? "P2P participant";
    await notify(others, req.params.id, letter.id, me, `Re: ${thread.subject}`, null);
    return ok(res, { messageId: letter.id });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/forward", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await membership(req.params.id, userId);
    const messageId = typeof req.body?.messageId === "string" && UUID.test(req.body.messageId) ? req.body.messageId : null;
    const original = messageId ? (must(await db.from("p2p_mail_messages").select("id,sender_id,body,sent_at,thread_id").eq("id", messageId).eq("thread_id", req.params.id).maybeSingle()) as Record<string, any> | null) : null;
    if (!original) throw new MailError("Choose the letter to forward.");
    const thread = must(await db.from("p2p_mail_threads").select("subject").eq("id", req.params.id).single()) as { subject: string };
    const recipients = await allowedRecipients(userId, ids(req.body?.to), null);
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 5000) : "";
    const from = (await names([original.sender_id])).get(original.sender_id)?.name ?? "P2P participant";
    const quoted = `---------- Forwarded P2P Mail ----------\nFrom: ${from}\nDate: ${new Date(original.sent_at).toUTCString()}\nSubject: ${thread.subject}\n\n${original.body}`;
    const subject = (/^fwd:/i.test(thread.subject) ? thread.subject : `Fwd: ${thread.subject}`).slice(0, 200);
    const t = must(await db.from("p2p_mail_threads").insert({ subject, created_by: userId }).select("id").single()) as { id: string };
    const letter = must(await db.from("p2p_mail_messages").insert({ thread_id: t.id, sender_id: userId, body: note ? `${note}\n\n${quoted}` : quoted, kind: "forward", forwarded_from_id: original.id }).select("id,sent_at").single()) as { id: string; sent_at: string };
    must(await db.from("p2p_mail_participants").insert([{ thread_id: t.id, user_id: userId, role: "sender", last_read_at: letter.sent_at }, ...recipients.map((u) => ({ thread_id: t.id, user_id: u, role: "recipient" }))]));
    await audit({ thread_id: req.params.id, message_id: original.id, actor_id: userId, event: "forwarded", detail: { toThread: t.id, recipients: recipients.length } });
    await audit({ thread_id: t.id, message_id: letter.id, actor_id: userId, event: "sent", detail: { forwardOf: original.id } });
    const me = (await names([userId])).get(userId)?.name ?? "P2P participant";
    await notify(recipients, t.id, letter.id, me, subject, null);
    return ok(res, { threadId: t.id });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/read", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await membership(req.params.id, userId);
    await db.from("p2p_mail_participants").update({ last_read_at: new Date().toISOString() }).eq("thread_id", req.params.id).eq("user_id", userId);
    await audit({ thread_id: req.params.id, actor_id: userId, event: "read" });
    // The thread's mail notifications are read too (only this thread's — never another's).
    await db.from("p2p_notifications").update({ read: true }).eq("user_id", userId).in("notification_type", ["p2p_mail", "official_mail"]).contains("data", { threadId: req.params.id });
    return ok(res, { read: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/archive", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    await membership(req.params.id, userId);
    const archived = req.body?.archived !== false;
    await db.from("p2p_mail_participants").update({ archived_at: archived ? new Date().toISOString() : null }).eq("thread_id", req.params.id).eq("user_id", userId);
    await audit({ thread_id: req.params.id, actor_id: userId, event: archived ? "archived" : "unarchived" });
    return ok(res, { archived });
  } catch (e) { return fail(res, e); }
});

export default router;
