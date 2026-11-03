import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { bookByCode, getChapter, licensedTranslations } from "../lib/bibleReader";
import { childUserIds } from "../lib/minors";
import {
  invitablePeers, canLeadDestination, destinationMemberIds, displayName, myGroupIds, profilesById, notifyWith, isUuid,
  type Destination,
} from "../lib/sharedStudy";
import {
  GROUP_TARGETS, LINK_PERMISSIONS, LINK_TOKEN_RE, MAX_ITEMS, MAX_SHARE_TARGETS, TARGET_TYPES,
  allows, canRevoke, grantable, hashToken, linkState, newInOrigin, newLinkToken, originChangedSince, resolveAccess,
  revisionMatches, shareApplies, validReorder,
  type Access, type MemberSets, type Permission, type ShareRow, type TargetType,
} from "../lib/scriptureAccess";
import { randomUUID } from "node:crypto";
import {
  PHOTO_BUCKET, PHOTO_MAX_BYTES, PHOTO_VIEW_SECONDS, cleanCover, cleanTags, photoPath, photoPathBelongs, photoProblem, planAdd,
  type PhotoSlot,
} from "../lib/scriptureLibrary";

// Scripture collections and listening playlists (migration 220), mounted at
// /scripture-collections. Every rule lives in lib/scriptureAccess.ts; this
// file gathers the facts (who is asking, which shares exist, which groups
// they belong to right now, blocks) and applies them on EVERY request.
//   GET    /                          my collections + playlists, and those shared with me
//   POST   /                          { kind, title, description?, refs? } create
//   GET    /share-targets             people, groups and studies I may share with
//   GET    /:id                       one collection (authorized viewers only)
//   PATCH  /:id                       { title?, description?, cover?, tags?, revision } owner
//   DELETE /:id                       owner (copies others made stay theirs)
//   POST   /:id/items                 { refs, sharedNote?, allowRepeat? } owner / collaborators — appends (skips passages already there unless allowRepeat)
//   POST   /:id/photos                { slot: cover|header, mimeType, sizeBytes } owner — a signed upload link (migration 228)
//   POST   /:id/photos/complete       { slot, path } owner — checks the upload, then uses it
//   DELETE /:id/photos/:slot          owner — back to the default
//   DELETE /:id/items/:itemId         { revision } owner / collaborators
//   PUT    /:id/order                 { itemIds, revision } owner / collaborators
//   PUT    /:id/items/:itemId/note    { sharedNote } owner — the ONLY note that is ever shared
//   POST   /:id/copy                  { kind?, itemIds?, title? } a personal copy or playlist (copy permission)
//   GET    /:id/origin                for a copy: what the original has that the copy doesn't
//   POST   /:id/shares                { targets, permission, canReshare } owner / reshare-allowed recipients
//   DELETE /:id/shares/:shareId       the owner, or whoever made that share
//   POST   /:id/leave                 a recipient removes their own direct access
//   POST   /:id/links                 { permission, expiresInDays?, maxUses? } owner — returns the code ONCE
//   DELETE /:id/links/:linkId         { removeJoined? } owner
//   GET    /links/:token/preview      PUBLIC, view-only preview for the website (no sign-in)
//   POST   /links/redeem              { token } signed in — joins at the link's level
// Only references are stored — never Bible text. Private notes, highlights,
// reflections and prayers are never read here.

const router = Router();

class CollError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function caller(req: Request, res: Response): Promise<string | null> {
  const userId = await verifyCaller(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userId;
}
function fail(res: Response, e: unknown) {
  if (e instanceof CollError) return res.status(e.status).json({ error: e.message });
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "PGRST205" || code === "42703" || code === "PGRST204") return res.status(503).json({ error: "Scripture collections aren't available yet." });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
const gone = () => new CollError(404, "This collection isn't available.");
export { CollError, fail as collectionFail, photoUrls, coverOut };
const must = <T>(r: { data: T | null; error: unknown }): T => { if (r.error) throw r.error; return r.data as T; };

interface Coll {
  id: string; owner_id: string; kind: "collection" | "playlist"; title: string; description: string | null;
  origin_collection_id: string | null; origin_owner_id: string | null; copied_at: string | null;
  revision: number; created_at: string; updated_at: string; deleted_at: string | null;
  /** Migration 227 (absent before it). */
  cover_kind?: string | null; cover_ref?: string | null; tags?: string[] | null;
  /** Migration 228: the wide header photo (a path in the private bucket). */
  header_ref?: string | null;
}
type PhotoUrls = Map<string, string>;
/** Short-lived links for your own photos — only ever made for playlists the caller may see. */
async function photoUrls(colls: Coll[]): Promise<PhotoUrls> {
  const paths = Array.from(new Set(colls.flatMap((c) => [c.cover_kind === "image" ? c.cover_ref : null, c.header_ref]).filter((p): p is string => !!p)));
  const out: PhotoUrls = new Map();
  if (!paths.length) return out;
  try {
    const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_VIEW_SECONDS);
    for (const r of (data ?? []) as { path: string | null; signedUrl: string | null }[]) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  } catch { /* photos are optional — the default cover shows instead */ }
  return out;
}
const coverOut = (c: Coll, urls?: PhotoUrls) => {
  if (!c.cover_kind || !c.cover_ref) return null;
  if (c.cover_kind !== "image") return { kind: c.cover_kind, ref: c.cover_ref };
  const url = urls?.get(c.cover_ref);
  return url ? { kind: "image", ref: c.cover_ref, url } : null;
};
const headerOut = (c: Coll, urls?: PhotoUrls) => (c.header_ref && urls?.get(c.header_ref) ? { url: urls.get(c.header_ref)! } : null);
async function removePhoto(path: string | null | undefined) {
  if (path) { try { await db.storage.from(PHOTO_BUCKET).remove([path]); } catch { /* already gone */ } }
}
interface Item {
  id: string; collection_id: string; translation_code: string; book_code: string; chapter: number;
  start_verse: number; end_verse: number; position: number; shared_note: string | null; added_by: string | null; created_at: string;
}
const ITEM_COLS = "id,collection_id,translation_code,book_code,chapter,start_verse,end_verse,position,shared_note,added_by,created_at";

const reference = (r: { book_code: string; chapter: number; start_verse: number; end_verse: number }) => {
  const b = bookByCode(r.book_code);
  return `${b?.name ?? r.book_code} ${r.chapter}:${r.start_verse}${r.end_verse > r.start_verse ? `–${r.end_verse}` : ""}`;
};
const itemOut = (i: Item) => ({
  id: i.id, translationCode: i.translation_code, bookCode: i.book_code, bookName: bookByCode(i.book_code)?.name ?? i.book_code,
  chapter: i.chapter, startVerse: i.start_verse, endVerse: i.end_verse, reference: reference(i), sharedNote: i.shared_note, addedBy: i.added_by,
});

// ── Facts gathered per request ───────────────────────────────────────────────

/** Every group and Study Together study this person belongs to right now. */
async function memberSets(userId: string): Promise<MemberSets> {
  const g = await myGroupIds(userId);
  const all = [...g.family, ...g.church, ...g.circle, ...g.group];
  const [{ data: hosted }, { data: joined }, { data: groupStudies }] = await Promise.all([
    db.from("p2p_shared_studies").select("id").eq("host_id", userId).eq("status", "active"),
    db.from("p2p_shared_study_members").select("study_id").eq("user_id", userId).eq("status", "accepted"),
    all.length ? db.from("p2p_shared_studies").select("id,destination_type,destination_id").eq("status", "active").in("destination_id", all) : Promise.resolve({ data: [] as { id: string; destination_type: string; destination_id: string }[] }),
  ]);
  const studies = new Set<string>([...(hosted ?? []).map((r) => r.id as string), ...(joined ?? []).map((r) => r.study_id as string)]);
  for (const s of (groupStudies ?? []) as { id: string; destination_type: string; destination_id: string }[]) {
    if ((g[s.destination_type] ?? []).includes(s.destination_id)) studies.add(s.id);
  }
  return { family: new Set(g.family), church: new Set(g.church), circle: new Set(g.circle), group: new Set(g.group), study: studies };
}

/** Of these people, the ones this user has blocked or been blocked by. */
async function blockedWith(userId: string, others: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(others.filter((o) => o && o !== userId)));
  if (!ids.length) return new Set();
  const [{ data: a }, { data: b }] = await Promise.all([
    db.from("p2p_user_blocks").select("blocked_id").eq("blocker_id", userId).in("blocked_id", ids),
    db.from("p2p_user_blocks").select("blocker_id").eq("blocked_id", userId).in("blocker_id", ids),
  ]);
  return new Set([...(a ?? []).map((r) => r.blocked_id as string), ...(b ?? []).map((r) => r.blocker_id as string)]);
}

async function loadCollection(id: string): Promise<Coll> {
  if (!isUuid(id)) throw gone();
  const c = must(await db.from("p2p_scripture_collections").select("*").eq("id", id).maybeSingle()) as Coll | null;
  if (!c || c.deleted_at) throw gone();
  return c;
}
async function sharesOf(collectionId: string): Promise<ShareRow[]> {
  return (must(await db.from("p2p_scripture_collection_shares").select("*").eq("collection_id", collectionId).eq("status", "active")) ?? []) as ShareRow[];
}

/** The caller's access to a collection — or 404 if they have none (never revealing it exists). */
export async function access(userId: string, id: string, members?: MemberSets): Promise<{ coll: Coll; access: Access; shares: ShareRow[] }> {
  const coll = await loadCollection(id);
  if (coll.owner_id === userId) return { coll, access: resolveAccess({ userId, ownerId: coll.owner_id, deleted: false, shares: [], members: {}, blockedWithOwner: false }), shares: await sharesOf(id) };
  const [shares, sets, blocked] = await Promise.all([sharesOf(id), members ? Promise.resolve(members) : memberSets(userId), blockedWith(userId, [coll.owner_id])]);
  const a = resolveAccess({ userId, ownerId: coll.owner_id, deleted: false, shares, members: sets, blockedWithOwner: blocked.has(coll.owner_id) });
  if (a.role === "none") throw gone();
  return { coll, access: a, shares };
}
const need = (a: Access, p: Permission, message: string) => { if (!allows(a, p)) throw new CollError(403, message); };

async function log(collectionId: string, actorId: string | null, action: string, detail: Record<string, unknown> = {}) {
  await db.from("p2p_scripture_collection_activity").insert({ collection_id: collectionId, actor_id: actorId, action, detail });
}

/** Bump the revision (and updated_at) after any content change. */
async function bump(c: Coll) {
  const now = new Date().toISOString();
  const { data, error } = await db.from("p2p_scripture_collections").update({ revision: c.revision + 1, updated_at: now })
    .eq("id", c.id).eq("revision", c.revision).select("revision").maybeSingle();
  if (error) throw error;
  if (!data) throw new CollError(409, "Someone else just changed this. It has been refreshed — please try again.");
  return data.revision as number;
}

async function items(collectionId: string): Promise<Item[]> {
  return (must(await db.from("p2p_scripture_collection_items").select(ITEM_COLS).eq("collection_id", collectionId).order("position").order("created_at")) ?? []) as Item[];
}

/** Validates passage references against the canon and the licensed translations. */
export async function readRefs(raw: unknown): Promise<Omit<Item, "id" | "collection_id" | "position" | "shared_note" | "added_by" | "created_at">[]> {
  if (!Array.isArray(raw) || !raw.length) throw new CollError(400, "Choose at least one passage.");
  if (raw.length > MAX_ITEMS) throw new CollError(400, `A collection can hold up to ${MAX_ITEMS} passages.`);
  const licensed = new Set((await licensedTranslations()).map((r) => r.translation_code));
  return raw.map((r: Record<string, unknown>) => {
    const t = String(r?.translationCode ?? "");
    const book = bookByCode(String(r?.bookCode ?? ""));
    const chapter = Number(r?.chapter), sv = Number(r?.startVerse), ev = Number(r?.endVerse ?? r?.startVerse);
    if (!book || !licensed.has(t)) throw new CollError(400, "One of the passages isn't available.");
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) throw new CollError(400, "One of the passages isn't available.");
    if (!Number.isInteger(sv) || !Number.isInteger(ev) || sv < 1 || ev < sv || ev - sv > 199) throw new CollError(400, "Choose verses in order.");
    return { translation_code: t, book_code: book.code, chapter, start_verse: sv, end_verse: ev };
  });
}
const cleanTitle = (v: unknown) => {
  const t = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!t) throw new CollError(400, "Give it a name.");
  return t.slice(0, 120);
};
const cleanText = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// ── List and create ──────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const sets = await memberSets(userId);
    const groupIds = GROUP_TARGETS.flatMap((t) => Array.from(sets[t] ?? []));
    const [{ data: mine, error: e1 }, { data: direct, error: e2 }, { data: viaGroups, error: e3 }] = await Promise.all([
      db.from("p2p_scripture_collections").select("*").eq("owner_id", userId).is("deleted_at", null).order("updated_at", { ascending: false }),
      db.from("p2p_scripture_collection_shares").select("*").eq("user_id", userId).eq("status", "active"),
      groupIds.length ? db.from("p2p_scripture_collection_shares").select("*").in("target_id", groupIds).eq("status", "active") : Promise.resolve({ data: [] as ShareRow[], error: null }),
    ]);
    if (e1 || e2 || e3) throw e1 || e2 || e3;
    const applicable = [...((direct ?? []) as ShareRow[]), ...((viaGroups ?? []) as ShareRow[])].filter((s) => shareApplies(s, userId, sets));
    const byColl = new Map<string, ShareRow[]>();
    for (const s of applicable) byColl.set((s as ShareRow & { collection_id: string }).collection_id, [...(byColl.get((s as ShareRow & { collection_id: string }).collection_id) ?? []), s]);
    const sharedIds = Array.from(byColl.keys());
    const shared = sharedIds.length
      ? ((must(await db.from("p2p_scripture_collections").select("*").in("id", sharedIds).is("deleted_at", null)) ?? []) as Coll[]).filter((c) => c.owner_id !== userId)
      : [];
    const blocked = await blockedWith(userId, shared.map((c) => c.owner_id));
    const visibleShared = shared.filter((c) => !blocked.has(c.owner_id));
    const all = [...((mine ?? []) as Coll[]), ...visibleShared];
    const ids = all.map((c) => c.id);
    const counts = new Map<string, number>();
    if (ids.length) for (const r of (must(await db.from("p2p_scripture_collection_items").select("collection_id").in("collection_id", ids)) ?? []) as { collection_id: string }[]) counts.set(r.collection_id, (counts.get(r.collection_id) ?? 0) + 1);
    const shareCounts = new Map<string, number>();
    if (mine?.length) for (const r of (must(await db.from("p2p_scripture_collection_shares").select("collection_id").in("collection_id", (mine as Coll[]).map((c) => c.id)).eq("status", "active")) ?? []) as { collection_id: string }[]) shareCounts.set(r.collection_id, (shareCounts.get(r.collection_id) ?? 0) + 1);
    const people = await profilesById([...visibleShared.map((c) => c.owner_id), ...((mine ?? []) as Coll[]).map((c) => c.origin_owner_id ?? ""), ...applicable.map((s) => s.shared_by ?? "")]);
    const urls = await photoUrls(all);
    const card = (c: Coll) => ({
      id: c.id, kind: c.kind, title: c.title, description: c.description, itemCount: counts.get(c.id) ?? 0, updatedAt: c.updated_at, cover: coverOut(c, urls), tags: c.tags ?? [],
      isCopy: !!c.copied_at, originOwnerName: c.origin_owner_id ? people.get(c.origin_owner_id)?.name ?? null : null,
    });
    return res.json({
      mine: ((mine ?? []) as Coll[]).map((c) => ({ ...card(c), shareCount: shareCounts.get(c.id) ?? 0 })),
      shared: visibleShared.map((c) => {
        const a = resolveAccess({ userId, ownerId: c.owner_id, deleted: false, shares: byColl.get(c.id) ?? [], members: sets, blockedWithOwner: false });
        const by = (byColl.get(c.id) ?? []).map((s) => s.shared_by).find(Boolean) ?? c.owner_id;
        return { ...card(c), ownerName: people.get(c.owner_id)?.name ?? "Someone", sharedByName: people.get(by)?.name ?? "Someone", permission: a.permission };
      }),
    });
  } catch (e) { return fail(res, e); }
});

router.post("/", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { kind?: string; title?: string; description?: string; refs?: unknown };
  try {
    const kind = b.kind === "playlist" ? "playlist" : "collection";
    const title = cleanTitle(b.title);
    const refs = b.refs === undefined ? [] : await readRefs(b.refs);
    const c = must(await db.from("p2p_scripture_collections").insert({ owner_id: userId, kind, title, description: cleanText(b.description, 500) }).select("*").single()) as Coll;
    if (refs.length) must(await db.from("p2p_scripture_collection_items").insert(refs.map((r, i) => ({ ...r, collection_id: c.id, position: i, added_by: userId }))).select("id"));
    await log(c.id, userId, "created", { kind, items: refs.length });
    return res.json({ id: c.id });
  } catch (e) { return fail(res, e); }
});

// ── Who I can share with ─────────────────────────────────────────────────────

router.get("/share-targets", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const [peers, g, sets] = await Promise.all([invitablePeers(userId), myGroupIds(userId), memberSets(userId)]);
    const profiles = await profilesById(Array.from(peers.keys()));
    const people = Array.from(peers.entries()).map(([id, relationship]) => ({ id, relationship, name: profiles.get(id)?.name ?? "Someone", photoUrl: profiles.get(id)?.photoUrl ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const names = async (table: string, ids: string[]) => ids.length ? new Map(((must(await db.from(table).select("id,name").in("id", ids)) ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name])) : new Map<string, string>();
    // Churches are large: only their leaders share to the whole church.
    const churchIds: string[] = [];
    for (const id of g.church) if (await canLeadDestination("church", id, userId)) churchIds.push(id);
    const [fam, ch, circ, grp] = await Promise.all([names("p2p_families", g.family), names("p2p_churches", churchIds), names("p2p_peer_circles", g.circle), names("p2p_groups", g.group)]);
    const studyIds = Array.from(sets.study ?? []);
    const studies = studyIds.length ? ((must(await db.from("p2p_shared_studies").select("id,title").in("id", studyIds)) ?? []) as { id: string; title: string }[]) : [];
    const groups = [
      ...g.family.map((id) => ({ type: "family", id, name: fam.get(id) ?? "Family Circle" })),
      ...churchIds.map((id) => ({ type: "church", id, name: ch.get(id) ?? "Church" })),
      ...Array.from(new Set(g.circle)).map((id) => ({ type: "circle", id, name: circ.get(id) ?? "Circle" })),
      ...Array.from(new Set(g.group)).map((id) => ({ type: "group", id, name: grp.get(id) ?? "Group" })),
      ...studies.map((s) => ({ type: "study", id: s.id, name: s.title || "Study Together" })),
    ];
    return res.json({ people, groups });
  } catch (e) { return fail(res, e); }
});

// ── Public link preview and redeem (before /:id so they aren't taken as ids) ─

// A little protection against guessing: at most 30 previews a minute per address.
const previewHits = new Map<string, { at: number; n: number }>();
function tooMany(key: string) {
  const now = Date.now();
  const h = previewHits.get(key);
  if (!h || now - h.at > 60_000) { previewHits.set(key, { at: now, n: 1 }); if (previewHits.size > 5000) previewHits.clear(); return false; }
  h.n += 1;
  return h.n > 30;
}

router.get("/links/:token/preview", async (req, res) => {
  if (tooMany(String(req.ip ?? "?"))) return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  const unavailable = () => res.status(404).json({ error: "This link is no longer available." });
  try {
    const token = String(req.params.token ?? "");
    if (!LINK_TOKEN_RE.test(token)) return unavailable();
    const link = must(await db.from("p2p_scripture_collection_links").select("*").eq("token_hash", hashToken(token)).maybeSingle()) as
      { collection_id: string; permission: Permission; revoked_at: string | null; expires_at: string | null; max_uses: number | null; uses: number } | null;
    if (!link || linkState(link) !== "ok") return unavailable();
    const c = must(await db.from("p2p_scripture_collections").select("*").eq("id", link.collection_id).maybeSingle()) as Coll | null;
    if (!c || c.deleted_at) return unavailable();
    const list = await items(c.id);
    const owner = (await displayName(c.owner_id)).split(" ")[0];
    // The first passage's text, fetched live from the licensed Bible service — never stored.
    let firstPassage: { reference: string; translation: string; verses: { verse: number; text: string }[]; copyright: string | null } | null = null;
    if (list[0]) {
      try {
        const ch = await getChapter(list[0].book_code, list[0].chapter, list[0].translation_code);
        firstPassage = {
          reference: reference(list[0]), translation: ch.translation.name, copyright: ch.copyright,
          verses: ch.verses.filter((v) => v.verse >= list[0].start_verse && v.verse <= list[0].end_verse).map((v) => ({ verse: v.verse, text: v.text })),
        };
      } catch { firstPassage = null; }
    }
    // No notes, no recipients, no ids — just enough to see what it is.
    return res.json({
      kind: c.kind, title: c.title, description: c.description, ownerName: owner, passageCount: list.length,
      references: list.slice(0, 50).map(reference), firstPassage, permission: link.permission,
    });
  } catch { return unavailable(); }
});

router.post("/links/redeem", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const token = String((req.body ?? {}).token ?? "");
    const unavailable = new CollError(404, "This link is no longer available.");
    if (!LINK_TOKEN_RE.test(token)) throw unavailable;
    const link = must(await db.from("p2p_scripture_collection_links").select("*").eq("token_hash", hashToken(token)).maybeSingle()) as
      { id: string; collection_id: string; permission: Permission; revoked_at: string | null; expires_at: string | null; max_uses: number | null; uses: number } | null;
    if (!link) throw unavailable;
    const c = must(await db.from("p2p_scripture_collections").select("*").eq("id", link.collection_id).maybeSingle()) as Coll | null;
    if (!c || c.deleted_at) throw unavailable;
    if (c.owner_id === userId) return res.json({ id: c.id });
    // Already has access (e.g. opened the link twice): no new share, no extra use counted.
    const sets = await memberSets(userId);
    const existing = await sharesOf(c.id);
    const blocked = await blockedWith(userId, [c.owner_id]);
    if (blocked.has(c.owner_id)) throw unavailable;
    const current = resolveAccess({ userId, ownerId: c.owner_id, deleted: false, shares: existing, members: sets, blockedWithOwner: false });
    if (current.permission && allows(current, link.permission)) return res.json({ id: c.id });
    if (linkState(link) !== "ok") throw unavailable;
    if ((await childUserIds([userId])).has(userId)) throw new CollError(403, "Ask your Family Circle Shepherd to share this with your family.");
    // Count the use first (only if nobody else just used the last place).
    const { data: counted } = await db.from("p2p_scripture_collection_links").update({ uses: link.uses + 1 }).eq("id", link.id).eq("uses", link.uses).select("id").maybeSingle();
    if (!counted) throw new CollError(409, "Please try again.");
    const mine = existing.find((s) => s.target_type === "peer" && s.user_id === userId);
    if (mine) must(await db.from("p2p_scripture_collection_shares").update({ permission: link.permission, via_link_id: link.id }).eq("id", mine.id).select("id"));
    else must(await db.from("p2p_scripture_collection_shares").insert({ collection_id: c.id, target_type: "peer", user_id: userId, permission: link.permission, can_reshare: false, shared_by: c.owner_id, via_link_id: link.id }).select("id"));
    await log(c.id, userId, "joined_via_link", { linkId: link.id, permission: link.permission });
    return res.json({ id: c.id });
  } catch (e) { return fail(res, e); }
});

// ── One collection ───────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a, shares } = await access(userId, req.params.id);
    const list = await items(c.id);
    const isOwner = a.role === "owner";
    // Owners see every share; a resharer sees the shares they made.
    const visibleShares = isOwner ? shares : shares.filter((s) => s.shared_by === userId);
    const links = isOwner ? ((must(await db.from("p2p_scripture_collection_links").select("id,permission,max_uses,uses,expires_at,created_at,revoked_at").eq("collection_id", c.id).order("created_at", { ascending: false })) ?? []) as Record<string, unknown>[]) : [];
    const activity = isOwner || a.permission === "collaborate"
      ? ((must(await db.from("p2p_scripture_collection_activity").select("actor_id,action,detail,created_at").eq("collection_id", c.id).order("created_at", { ascending: false }).limit(50)) ?? []) as { actor_id: string | null; action: string; detail: Record<string, unknown>; created_at: string }[])
      : [];
    const myShares = shares.filter((s) => a.shareIds.includes(s.id));
    const sharedBy = myShares.map((s) => s.shared_by).find(Boolean) ?? null;
    const people = await profilesById([c.owner_id, c.origin_owner_id ?? "", sharedBy ?? "", ...visibleShares.flatMap((s) => [s.user_id ?? "", s.shared_by ?? ""]), ...activity.map((x) => x.actor_id ?? ""), ...list.map((i) => i.added_by ?? "")]);
    const groupNames = new Map<string, string>();
    for (const s of visibleShares) {
      if (!s.target_id || groupNames.has(s.target_id)) continue;
      const table = s.target_type === "family" ? "p2p_families" : s.target_type === "church" ? "p2p_churches" : s.target_type === "circle" ? "p2p_peer_circles" : s.target_type === "group" ? "p2p_groups" : "p2p_shared_studies";
      const { data } = await db.from(table).select(table === "p2p_shared_studies" ? "title" : "name").eq("id", s.target_id).maybeSingle();
      groupNames.set(s.target_id, ((data as Record<string, string> | null)?.name ?? (data as Record<string, string> | null)?.title) || "Group");
    }
    // A copy: is the original still there for me, and has it changed since?
    let origin: { id: string; title: string; ownerName: string; available: boolean; changed: boolean } | null = null;
    if (c.copied_at) {
      let available = false, changed = false, title = "", oid = c.origin_collection_id ?? "";
      if (c.origin_collection_id) {
        try {
          const o = await access(userId, c.origin_collection_id);
          available = true; title = o.coll.title; changed = originChangedSince(o.coll.updated_at, c.copied_at);
        } catch { available = false; }
      }
      origin = { id: oid, title, ownerName: c.origin_owner_id ? people.get(c.origin_owner_id)?.name ?? "Someone" : "Someone", available, changed };
    }
    const urls = await photoUrls([c]);
    return res.json({
      id: c.id, kind: c.kind, title: c.title, description: c.description, revision: c.revision, updatedAt: c.updated_at, createdAt: c.created_at,
      cover: coverOut(c, urls), header: headerOut(c, urls), tags: c.tags ?? [],
      owner: { id: c.owner_id, name: people.get(c.owner_id)?.name ?? "Someone", photoUrl: people.get(c.owner_id)?.photoUrl ?? null },
      status: isOwner ? (c.copied_at ? "copy" : "original") : "shared",
      access: { role: a.role, permission: a.permission, canReshare: a.canReshare },
      sharedByName: sharedBy ? people.get(sharedBy)?.name ?? null : null,
      origin,
      items: list.map((i) => ({ ...itemOut(i), addedByName: i.added_by && i.added_by !== c.owner_id ? people.get(i.added_by)?.name ?? null : null })),
      shares: visibleShares.map((s) => ({
        id: s.id, targetType: s.target_type, permission: s.permission, canReshare: s.can_reshare, viaLink: !!(s as ShareRow & { via_link_id?: string }).via_link_id,
        name: s.target_type === "peer" ? people.get(s.user_id ?? "")?.name ?? "Someone" : groupNames.get(s.target_id ?? "") ?? "Group",
        sharedByName: s.shared_by ? people.get(s.shared_by)?.name ?? null : null,
        sharedAt: (s as ShareRow & { created_at?: string }).created_at ?? null,
      })),
      links: links.map((l) => ({ id: l.id, permission: l.permission, maxUses: l.max_uses, uses: l.uses, expiresAt: l.expires_at, createdAt: l.created_at,
        state: linkState(l as { revoked_at: string | null; expires_at: string | null; max_uses: number | null; uses: number }) })),
      activity: activity.filter((x) => x.action !== "update_notified").map((x) => ({ actorName: x.actor_id ? people.get(x.actor_id)?.name ?? "Someone" : "Someone", action: x.action, detail: x.detail, at: x.created_at })),
    });
  } catch (e) { return fail(res, e); }
});

router.patch("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { title?: string; description?: string; cover?: unknown; tags?: unknown; revision?: number };
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can rename this.");
    if (!revisionMatches(c.revision, b.revision)) throw new CollError(409, "Someone else just changed this. It has been refreshed — please try again.");
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = cleanTitle(b.title);
    if (b.description !== undefined) patch.description = cleanText(b.description, 500);
    if (b.cover !== undefined) {
      const cover = cleanCover(b.cover, userId);
      if (typeof cover === "string") throw new CollError(400, cover);
      // An uploaded photo is set only through /photos (which checks the upload).
      if (cover?.kind === "image" && cover.ref !== c.cover_ref) throw new CollError(400, "Upload the photo first.");
      if (c.cover_kind === "image" && cover?.ref !== c.cover_ref) await removePhoto(c.cover_ref);
      patch.cover_kind = cover?.kind ?? null; patch.cover_ref = cover?.ref ?? null;
    }
    if (b.tags !== undefined) {
      const tags = cleanTags(b.tags);
      if (!tags) throw new CollError(400, "Tags must be a list.");
      patch.tags = tags;
    }
    if (Object.keys(patch).length) must(await db.from("p2p_scripture_collections").update(patch).eq("id", c.id).select("id"));
    const revision = await bump(c);
    await log(c.id, userId, patch.title !== undefined || patch.description !== undefined ? "renamed" : "edited", { title: patch.title ?? null });
    return res.json({ revision });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can delete this.");
    must(await db.from("p2p_scripture_collections").update({ deleted_at: new Date().toISOString() }).eq("id", c.id).select("id"));
    // Its own photos go with it (copies others saved keep their own covers).
    await removePhoto(c.cover_kind === "image" ? c.cover_ref : null); await removePhoto(c.header_ref);
    // Links stop working at once; copies other people saved are theirs and stay.
    await db.from("p2p_scripture_collection_links").update({ revoked_at: new Date().toISOString() }).eq("collection_id", c.id).is("revoked_at", null);
    await log(c.id, userId, "deleted");
    return res.json({ deleted: true });
  } catch (e) { return fail(res, e); }
});

// ── Items ────────────────────────────────────────────────────────────────────

/** At most one "updated" notification per collection in this window (never noisy). */
export const UPDATE_NOTIFY_WINDOW_MS = 6 * 60 * 60_000;
/**
 * Tell the people who share a playlist that passages were added: the owner
 * (when a collaborator added them) and everyone it's shared with, minus the
 * person who added, minus blocks — once per collection per window.
 */
async function notifyUpdate(c: Coll, actorId: string, references: string[]) {
  const recent = (must(await db.from("p2p_scripture_collection_activity").select("created_at").eq("collection_id", c.id).eq("action", "update_notified").order("created_at", { ascending: false }).limit(1)) ?? []) as { created_at: string }[];
  if (recent[0] && Date.now() - Date.parse(recent[0].created_at) < UPDATE_NOTIFY_WINDOW_MS) return;
  const ids = new Set<string>([c.owner_id]);
  for (const s of await sharesOf(c.id)) {
    if (s.target_type === "peer" && s.user_id) ids.add(s.user_id);
    else if (s.target_type === "study" && s.target_id) {
      const [{ data: host }, { data: members }] = await Promise.all([
        db.from("p2p_shared_studies").select("host_id").eq("id", s.target_id).maybeSingle(),
        db.from("p2p_shared_study_members").select("user_id").eq("study_id", s.target_id).eq("status", "accepted"),
      ]);
      if (host?.host_id) ids.add(host.host_id as string);
      for (const m of members ?? []) ids.add(m.user_id as string);
    } else if (s.target_id) for (const u of await destinationMemberIds(s.target_type as Destination, s.target_id)) ids.add(u);
  }
  ids.delete(actorId);
  const blocked = await blockedWith(actorId, Array.from(ids));
  const recipients = Array.from(ids).filter((u) => !blocked.has(u));
  if (!recipients.length) return;
  await log(c.id, actorId, "update_notified", { count: recipients.length });
  const name = await displayName(actorId);
  const refs = references.length > 2 ? `${references.slice(0, 2).join(", ")} and ${references.length - 2} more` : references.join(" and ");
  await notifyWith(recipients, { title: c.kind === "playlist" ? "Playlist updated" : "Collection updated", message: `${name} added ${refs} to "${c.title}".`, type: "scripture_collection_updated", data: { collectionId: c.id } });
}

// ── Your own photos (migration 228): owner only, private bucket, checked uploads ──

router.post("/:id/photos", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { slot?: unknown; mimeType?: unknown; sizeBytes?: unknown };
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can change the photos.");
    const problem = photoProblem(b.slot, b.mimeType, b.sizeBytes);
    if (problem) throw new CollError(400, problem);
    const path = photoPath(userId, b.slot as PhotoSlot, c.id, String(b.mimeType), randomUUID());
    const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new CollError(503, "Photos aren't available yet.");
    return res.json({ uploadUrl: data.signedUrl, path });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/photos/complete", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { slot?: unknown; path?: unknown };
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can change the photos.");
    const slot = b.slot === "header" ? "header" : b.slot === "cover" ? "cover" : null;
    if (!slot || !photoPathBelongs(b.path, userId, slot, c.id)) throw new CollError(400, "That photo can't be used here.");
    const path = String(b.path);
    // The upload must really be there, and not too big.
    const dir = path.slice(0, path.lastIndexOf("/"));
    const { data: listed } = await db.storage.from(PHOTO_BUCKET).list(dir, { search: path.slice(path.lastIndexOf("/") + 1) });
    const obj = ((listed ?? []) as { name?: string; metadata?: { size?: number } }[]).find((o) => o.name === path.slice(path.lastIndexOf("/") + 1));
    if (!obj) throw new CollError(409, "The upload didn't finish. Please try again.");
    if (Number(obj.metadata?.size ?? 0) > PHOTO_MAX_BYTES) { await removePhoto(path); throw new CollError(400, "Photos can be up to 8 MB."); }
    const previous = slot === "cover" ? (c.cover_kind === "image" ? c.cover_ref : null) : c.header_ref;
    must(await db.from("p2p_scripture_collections").update(slot === "cover" ? { cover_kind: "image", cover_ref: path } : { header_ref: path }).eq("id", c.id).select("id"));
    if (previous && previous !== path) await removePhoto(previous);
    const revision = await bump(c);
    await log(c.id, userId, slot === "cover" ? "cover_photo_changed" : "header_photo_changed");
    return res.json({ revision });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/photos/:slot", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can change the photos.");
    const slot = req.params.slot === "header" ? "header" : req.params.slot === "cover" ? "cover" : null;
    if (!slot) throw new CollError(404, "Not found.");
    if (slot === "cover") {
      if (c.cover_kind === "image") { must(await db.from("p2p_scripture_collections").update({ cover_kind: null, cover_ref: null }).eq("id", c.id).select("id")); await removePhoto(c.cover_ref); }
    } else if (c.header_ref) {
      must(await db.from("p2p_scripture_collections").update({ header_ref: null }).eq("id", c.id).select("id")); await removePhoto(c.header_ref);
    }
    return res.json({ revision: await bump(c) });
  } catch (e) { return fail(res, e); }
});

/**
 * Append passages to a playlist/collection the caller may edit. A passage
 * that's already there is skipped unless `allowRepeat` (an explicit choice).
 * Shared with the Library's multi-destination save (routes/scriptureLibrary.ts).
 */
export async function addToCollection(userId: string, collectionId: string, rawRefs: unknown, o: { sharedNote?: unknown; allowRepeat?: boolean } = {}) {
  const { coll: c, access: a } = await access(userId, collectionId);
  need(a, "collaborate", "You can view this collection but not change it.");
  const refs = await readRefs(rawRefs);
  const list = await items(c.id);
  const { add, skipped } = planAdd(list, refs, o.allowRepeat === true);
  if (!add.length) return { revision: c.revision, added: 0, skipped: skipped.length };
  if (list.length + add.length > MAX_ITEMS) throw new CollError(400, `A collection can hold up to ${MAX_ITEMS} passages.`);
  // Only the owner may attach a note for sharing.
  const note = a.role === "owner" ? cleanText(o.sharedNote, 1000) : null;
  const start = list.reduce((m, i) => Math.max(m, i.position), -1) + 1;
  must(await db.from("p2p_scripture_collection_items").insert(add.map((r, i) => ({ ...r, collection_id: c.id, position: start + i, added_by: userId, shared_note: note }))).select("id"));
  const revision = await bump(c);
  await log(c.id, userId, "added", { references: add.map(reference) });
  // Shared or collaborative: let the others know (throttled). Never blocks the add itself.
  if (a.role !== "owner" || (await sharesOf(c.id)).length) await notifyUpdate(c, userId, add.map(reference)).catch(() => {});
  return { revision, added: add.length, skipped: skipped.length };
}

router.post("/:id/items", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { refs?: unknown; sharedNote?: unknown; allowRepeat?: unknown };
  try {
    return res.json(await addToCollection(userId, req.params.id, b.refs, { sharedNote: b.sharedNote, allowRepeat: b.allowRepeat === true }));
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/items/:itemId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    need(a, "collaborate", "You can view this collection but not change it.");
    if (!revisionMatches(c.revision, (req.body ?? {}).revision ?? req.query.revision)) throw new CollError(409, "Someone else just changed this. It has been refreshed — please try again.");
    if (!isUuid(req.params.itemId)) throw new CollError(404, "That passage isn't in this collection.");
    const removed = must(await db.from("p2p_scripture_collection_items").delete().eq("id", req.params.itemId).eq("collection_id", c.id).select(ITEM_COLS)) as Item[] | null;
    if (!removed?.length) throw new CollError(404, "That passage isn't in this collection.");
    const revision = await bump(c);
    await log(c.id, userId, "removed", { reference: reference(removed[0]) });
    return res.json({ revision });
  } catch (e) { return fail(res, e); }
});

router.put("/:id/order", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { itemIds?: unknown; revision?: unknown };
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    need(a, "collaborate", "You can view this collection but not change it.");
    if (!revisionMatches(c.revision, b.revision)) throw new CollError(409, "Someone else just changed this. It has been refreshed — please try again.");
    const list = await items(c.id);
    if (!validReorder(list.map((i) => i.id), b.itemIds)) throw new CollError(409, "This collection changed while you were arranging it. It has been refreshed — please try again.");
    const order = b.itemIds as string[];
    for (let i = 0; i < order.length; i++) must(await db.from("p2p_scripture_collection_items").update({ position: i }).eq("id", order[i]).eq("collection_id", c.id).select("id"));
    const revision = await bump(c);
    await log(c.id, userId, "reordered");
    return res.json({ revision });
  } catch (e) { return fail(res, e); }
});

router.put("/:id/items/:itemId/note", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can add a note for sharing.");
    if (!isUuid(req.params.itemId)) throw new CollError(404, "That passage isn't in this collection.");
    const note = cleanText((req.body ?? {}).sharedNote, 1000);
    const updated = must(await db.from("p2p_scripture_collection_items").update({ shared_note: note }).eq("id", req.params.itemId).eq("collection_id", c.id).select("id")) as { id: string }[] | null;
    if (!updated?.length) throw new CollError(404, "That passage isn't in this collection.");
    const revision = await bump(c);
    await log(c.id, userId, "note_changed");
    return res.json({ revision });
  } catch (e) { return fail(res, e); }
});

// ── Personal copies and playlists ────────────────────────────────────────────

router.post("/:id/copy", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { kind?: string; itemIds?: unknown; title?: string };
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") need(a, "copy", "The owner hasn't allowed copies of this collection.");
    const kind = b.kind === "playlist" ? "playlist" : b.kind === "collection" ? "collection" : c.kind;
    let list = await items(c.id);
    if (Array.isArray(b.itemIds) && b.itemIds.length) {
      const pick = new Set(b.itemIds.map(String));
      list = list.filter((i) => pick.has(i.id));
      if (!list.length) throw new CollError(400, "Choose at least one passage.");
    }
    const fromOther = a.role !== "owner";
    const now = new Date().toISOString();
    const copy = must(await db.from("p2p_scripture_collections").insert({
      owner_id: userId, kind, title: b.title ? cleanTitle(b.title) : c.title, description: c.description,
      origin_collection_id: c.id, origin_owner_id: c.owner_id, copied_at: now,
    }).select("*").single()) as Coll;
    if (list.length) must(await db.from("p2p_scripture_collection_items").insert(list.map((i, n) => ({
      collection_id: copy.id, translation_code: i.translation_code, book_code: i.book_code, chapter: i.chapter,
      start_verse: i.start_verse, end_verse: i.end_verse, position: n, shared_note: i.shared_note, added_by: userId,
    }))).select("id"));
    await log(copy.id, userId, "copied_from", { originId: c.id, kind });
    if (fromOther) await log(c.id, userId, "copied", { kind });
    return res.json({ id: copy.id });
  } catch (e) { return fail(res, e); }
});

router.get("/:id/origin", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner" || !c.origin_collection_id) throw new CollError(404, "This isn't a copy.");
    const o = await access(userId, c.origin_collection_id).catch(() => null);
    if (!o) return res.json({ available: false, newItems: [] });
    const fresh = newInOrigin(await items(o.coll.id), await items(c.id));
    return res.json({ available: true, title: o.coll.title, newItems: fresh.map(itemOut) });
  } catch (e) { return fail(res, e); }
});

// ── Sharing ──────────────────────────────────────────────────────────────────

router.post("/:id/shares", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { targets?: unknown; permission?: unknown; canReshare?: unknown };
  try {
    const { coll: c, access: a, shares } = await access(userId, req.params.id);
    const grant = grantable(a, b.permission, b.canReshare);
    if (typeof grant === "string") throw new CollError(403, grant);
    const targets = Array.isArray(b.targets) ? b.targets as { type?: string; id?: string }[] : [];
    if (!targets.length) throw new CollError(400, "Choose who to share with.");
    if (targets.length > MAX_SHARE_TARGETS) throw new CollError(400, `Share with up to ${MAX_SHARE_TARGETS} at a time.`);
    const [peers, sets] = await Promise.all([invitablePeers(userId), memberSets(userId)]);
    const notifyIds = new Set<string>();
    let added = 0;
    for (const t of targets) {
      const type = t?.type as TargetType;
      const id = String(t?.id ?? "");
      if (!TARGET_TYPES.includes(type) || !isUuid(id)) throw new CollError(400, "Choose who to share with.");
      if (type === "peer") {
        if (!peers.has(id)) throw new CollError(403, "You can only share with people you're connected with on P2P.");
        if (id === c.owner_id) continue;
      } else {
        if (!sets[type]?.has(id)) throw new CollError(403, "You can only share with groups you belong to.");
        if (type === "church" && !(await canLeadDestination("church", id, userId))) throw new CollError(403, "Only church leaders can share with the whole church.");
      }
      const existing = shares.find((s) => (type === "peer" ? s.target_type === "peer" && s.user_id === id : s.target_type === type && s.target_id === id));
      if (existing) {
        must(await db.from("p2p_scripture_collection_shares").update({ permission: grant.permission, can_reshare: grant.canReshare, shared_by: userId }).eq("id", existing.id).select("id"));
      } else {
        must(await db.from("p2p_scripture_collection_shares").insert({
          collection_id: c.id, target_type: type, target_id: type === "peer" ? null : id, user_id: type === "peer" ? id : null,
          permission: grant.permission, can_reshare: grant.canReshare, shared_by: userId,
        }).select("id"));
        added++;
        if (type === "peer") notifyIds.add(id);
        else if (type === "study") {
          const [{ data: host }, { data: members }] = await Promise.all([
            db.from("p2p_shared_studies").select("host_id,destination_type,destination_id").eq("id", id).maybeSingle(),
            db.from("p2p_shared_study_members").select("user_id").eq("study_id", id).eq("status", "accepted"),
          ]);
          if (host?.host_id) notifyIds.add(host.host_id as string);
          for (const m of members ?? []) notifyIds.add(m.user_id as string);
          if (host?.destination_id) for (const u of await destinationMemberIds(host.destination_type as Destination, host.destination_id as string)) notifyIds.add(u);
        } else for (const u of await destinationMemberIds(type as Destination, id)) notifyIds.add(u);
      }
      await log(c.id, userId, "shared", { targetType: type, permission: grant.permission });
    }
    notifyIds.delete(userId); notifyIds.delete(c.owner_id);
    const blocked = await blockedWith(c.owner_id, Array.from(notifyIds));
    const recipients = Array.from(notifyIds).filter((u) => !blocked.has(u));
    if (recipients.length) {
      const name = await displayName(userId);
      const what = c.kind === "playlist" ? "a Scripture playlist" : "a Scripture collection";
      await notifyWith(recipients, { title: "Scripture shared with you", message: `${name} shared ${what}: "${c.title}".`, type: "scripture_collection_shared", data: { collectionId: c.id } });
    }
    return res.json({ shared: added });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/shares/:shareId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a, shares } = await access(userId, req.params.id);
    const s = shares.find((x) => x.id === req.params.shareId);
    if (!s) throw new CollError(404, "That access has already been removed.");
    if (!canRevoke(a, s, userId)) throw new CollError(403, "Only the owner can remove this access.");
    must(await db.from("p2p_scripture_collection_shares").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: userId }).eq("id", s.id).select("id"));
    await log(c.id, userId, "share_revoked", { targetType: s.target_type });
    return res.json({ revoked: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/leave", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a, shares } = await access(userId, req.params.id);
    if (a.role === "owner") throw new CollError(400, "You own this collection.");
    const direct = shares.filter((s) => s.target_type === "peer" && s.user_id === userId);
    if (!direct.length) throw new CollError(400, "This was shared with a group you belong to, so it stays while you're in that group.");
    must(await db.from("p2p_scripture_collection_shares").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: userId }).in("id", direct.map((s) => s.id)).select("id"));
    await log(c.id, userId, "left");
    return res.json({ left: true });
  } catch (e) { return fail(res, e); }
});

// ── Links (owner) ────────────────────────────────────────────────────────────

router.post("/:id/links", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { permission?: unknown; expiresInDays?: unknown; maxUses?: unknown };
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can create a link.");
    const permission = LINK_PERMISSIONS.includes(b.permission as Permission) ? b.permission as Permission : "view";
    const days = b.expiresInDays == null ? null : Math.round(Number(b.expiresInDays));
    if (days !== null && !(days >= 1 && days <= 365)) throw new CollError(400, "Choose when the link expires.");
    const maxUses = b.maxUses == null ? null : Math.round(Number(b.maxUses));
    if (maxUses !== null && !(maxUses >= 1 && maxUses <= 1000)) throw new CollError(400, "Choose how many people can join.");
    const token = newLinkToken();
    const link = must(await db.from("p2p_scripture_collection_links").insert({
      collection_id: c.id, token_hash: hashToken(token), permission, max_uses: maxUses,
      expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null, created_by: userId,
    }).select("id").single()) as { id: string };
    await log(c.id, userId, "link_created", { permission, days, maxUses });
    // The code is returned this once only; just its fingerprint is kept.
    return res.json({ id: link.id, token });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/links/:linkId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const { coll: c, access: a } = await access(userId, req.params.id);
    if (a.role !== "owner") throw new CollError(403, "Only the owner can turn off a link.");
    if (!isUuid(req.params.linkId)) throw new CollError(404, "That link doesn't exist.");
    const now = new Date().toISOString();
    const done = must(await db.from("p2p_scripture_collection_links").update({ revoked_at: now }).eq("id", req.params.linkId).eq("collection_id", c.id).select("id")) as { id: string }[] | null;
    if (!done?.length) throw new CollError(404, "That link doesn't exist.");
    const removeJoined = (req.body ?? {}).removeJoined === true || req.query.removeJoined === "1";
    if (removeJoined) await db.from("p2p_scripture_collection_shares").update({ status: "revoked", revoked_at: now, revoked_by: userId }).eq("collection_id", c.id).eq("via_link_id", req.params.linkId).eq("status", "active");
    await log(c.id, userId, "link_revoked", { removeJoined });
    return res.json({ revoked: true });
  } catch (e) { return fail(res, e); }
});

export default router;
