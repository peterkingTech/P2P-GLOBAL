import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { EDITORIAL_FLOW, isUuid, validatePassage } from "../lib/studyPlans";
import { access as collectionAccess } from "./scriptureCollections";
import { BOOK_BY_CODE } from "../lib/planDiscovery";
import { discoveryIndex } from "./planDiscovery";
import { buildStudy, conceptsFrom, contentWords, eastonConcepts, stems, type SearchInputs } from "../lib/studySearch";
import { getChapter, licensedTranslations, parseReference, searchBible } from "../lib/bibleReader";
import { providerOf } from "../lib/bibleLicence";
import { articleSummary, getArticles, searchArticles } from "../lib/referenceArticles";
import { buildMeaning, meaningTerms, togetherQueries, type VerseSearch } from "../lib/studyMeaning";
import { collection as namesCollection, entry as nameEntry, namesForSearch, type CollectionQuery } from "../lib/biblicalNames";
import { getDictionary, search as dictSearch } from "../lib/dictionary";

// STUDY WORKSPACE (owner brief 2026-11-18; tables: migrations/253_study_workspace.sql), at /study-workspace.
//   Scripture emphasis (editorial categories; words of Jesus come from each translation's own markup instead):
//     GET  /emphasis/:book/:chapter            published references for one chapter, + which categories have any
//     GET  /emphasis/editor                    editors: every reference (all statuses)
//     POST /emphasis                           editors: { category, book, chapter, startVerse, endVerse, note?, source? } → a DRAFT
//     POST /emphasis/:id/status                editors: draft → under_review → approved (another editor) → published
//   Deep Study History (personal; never lessons, evaluations or growth evidence):
//     GET    /studies?q=&kind=&folder=         my studies, newest first (search title / notes / focus)
//     GET    /studies/:id                      one of mine
//     POST   /studies                          { clientKey?, kind, title, focus, state?, notes?, folder? } — retry-safe
//     PATCH  /studies/:id                      { baseVersion, ...changes } — 409 with the server copy when it changed since
//     POST   /studies/:id/opened               "continue where I stopped"
//     DELETE /studies/:id                      soft delete (mine only)
//   Study workspace search (My Plan): GET /search?q=&t= — lib/studySearch.ts
//   Playlist read marks (per person; playlists can be shared):
//     GET /collections/:id/reads · POST / DELETE /collections/items/:itemId/read
// Identity always comes from the token. Before 253 is applied the routes answer 503 "not available yet".

const router = Router();
class WsError extends Error { constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); } }
async function caller(req: Request, res: Response): Promise<string | null> {
  const u = await verifyCaller(req);
  if (!u) { res.status(401).json({ error: "Please sign in." }); return null; }
  return u;
}
function fail(res: Response, e: unknown) {
  if (e instanceof WsError) return res.status(e.status).json({ error: e.message, ...(e.extra ?? {}) });
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "PGRST205") return res.status(503).json({ error: "This isn't available yet." });
  if (code === "23505") return res.status(409).json({ error: "That already exists." });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
async function isEditor(userId: string) {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "admin_content" || role === "super_admin";
}
export const EMPHASIS_CATEGORIES = ["holy_spirit", "father", "commands", "promises", "prophecy", "prayer_worship"] as const;
const clientKeyOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// ── Scripture emphasis ─────────────────────────────────────────────────────────
let availCache: { at: number; cats: string[] } | null = null;
router.get("/emphasis/editor", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new WsError(403, "Only content editors can review Scripture emphasis.");
    const { data, error } = await db.from("p2p_scripture_emphasis").select("*").neq("editorial_status", "archived").order("book_code").order("chapter").order("start_verse");
    if (error) throw error;
    return res.json({ references: data ?? [] });
  } catch (e) { return fail(res, e); }
});
router.get("/emphasis/:book/:chapter", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const book = String(req.params.book).toUpperCase(), chapter = Number(req.params.chapter);
    if (!BOOK_BY_CODE.has(book) || !Number.isInteger(chapter) || chapter < 1 || chapter > (BOOK_BY_CODE.get(book)?.chapters ?? 0)) throw new WsError(400, "That chapter isn't in the Bible.");
    const { data, error } = await db.from("p2p_scripture_emphasis").select("category,start_verse,end_verse,note")
      .eq("editorial_status", "published").eq("book_code", book).eq("chapter", chapter);
    if (error) throw error;
    if (!availCache || Date.now() - availCache.at > 10 * 60_000) {
      const { data: all } = await db.from("p2p_scripture_emphasis").select("category").eq("editorial_status", "published");
      availCache = { at: Date.now(), cats: [...new Set(((all ?? []) as { category: string }[]).map((r) => r.category))] };
    }
    return res.json({
      references: ((data ?? []) as { category: string; start_verse: number; end_verse: number; note: string | null }[]).map((r) => ({ category: r.category, startVerse: r.start_verse, endVerse: r.end_verse, note: r.note })),
      // Categories with at least one published reference anywhere (the app says plainly which are not ready yet).
      available: availCache.cats,
    });
  } catch (e) { return fail(res, e); }
});
router.post("/emphasis", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new WsError(403, "Only content editors can add Scripture emphasis.");
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!(EMPHASIS_CATEGORIES as readonly string[]).includes(String(b.category))) throw new WsError(400, "Choose a category.");
    const p = validatePassage({ book: b.book, chapter: b.chapter, startVerse: b.startVerse, endVerse: b.endVerse ?? b.startVerse });
    if (!p || !p.startVerse) throw new WsError(400, "Give a valid reference with verses.");
    const { data, error } = await db.from("p2p_scripture_emphasis").insert({ category: b.category, book_code: p.book, chapter: p.chapter, start_verse: p.startVerse, end_verse: p.endVerse,
      note: text(b.note, 500), source: text(b.source, 300), created_by: userId }).select("id").single();
    if (error) throw error;
    return res.status(201).json({ id: (data as { id: string }).id });
  } catch (e) { return fail(res, e); }
});
router.post("/emphasis/:id/status", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new WsError(403, "Only content editors can change Scripture emphasis.");
    if (!isUuid(req.params.id)) throw new WsError(404, "That reference isn't available.");
    const { data } = await db.from("p2p_scripture_emphasis").select("id,editorial_status,submitted_by").eq("id", req.params.id).maybeSingle();
    const r = data as { id: string; editorial_status: string; submitted_by: string | null } | null;
    if (!r) throw new WsError(404, "That reference isn't available.");
    const to = String((req.body ?? {}).to ?? "");
    if (!(EDITORIAL_FLOW[r.editorial_status] ?? []).includes(to)) throw new WsError(409, `A reference can't move from ${r.editorial_status} to ${to || "that status"}.`);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { editorial_status: to, updated_at: now };
    if (to === "under_review") Object.assign(patch, { submitted_by: userId, reviewed_by: null, reviewed_at: null });
    if (to === "approved") { if (!r.submitted_by || r.submitted_by === userId) throw new WsError(409, "Another editor must approve this reference."); Object.assign(patch, { reviewed_by: userId, reviewed_at: now }); }
    if (to === "published") Object.assign(patch, { published_at: now });
    const { error } = await db.from("p2p_scripture_emphasis").update(patch).eq("id", r.id);
    if (error) throw error;
    availCache = null;
    return res.json({ id: r.id, status: to });
  } catch (e) { return fail(res, e); }
});

// ── Deep Study History ─────────────────────────────────────────────────────────
type Study = { id: string; user_id: string; kind: string; title: string; focus: Record<string, unknown>; state: Record<string, unknown>; notes: string | null; folder: string | null;
  client_key: string | null; version: number; created_at: string; updated_at: string; last_opened_at: string; deleted_at: string | null };
const KINDS = ["deep_study", "my_plan", "topic_study"];
const out = (s: Study) => ({ id: s.id, kind: s.kind, title: s.title, focus: s.focus, state: s.state, notes: s.notes, folder: s.folder, version: s.version,
  createdAt: s.created_at, updatedAt: s.updated_at, lastOpenedAt: s.last_opened_at, clientKey: s.client_key });
function readStudy(b: Record<string, unknown>, partial: boolean) {
  const v: Record<string, unknown> = {};
  if (!partial || b.title !== undefined) { const t = text(b.title, 200); if (!t) throw new WsError(400, "Give the study a name."); v.title = t; }
  if (!partial || b.kind !== undefined) { if (!KINDS.includes(String(b.kind ?? "deep_study"))) throw new WsError(400, "Unknown kind of study."); v.kind = String(b.kind ?? "deep_study"); }
  if (b.focus !== undefined) { if (!b.focus || typeof b.focus !== "object" || Array.isArray(b.focus)) throw new WsError(400, "The study's focus isn't valid."); v.focus = b.focus; }
  if (b.state !== undefined) {
    if (!b.state || typeof b.state !== "object" || Array.isArray(b.state)) throw new WsError(400, "The study's contents aren't valid.");
    if (JSON.stringify(b.state).length > 190_000) throw new WsError(413, "This study is too large to save.");
    v.state = b.state;
  }
  if (b.notes !== undefined) v.notes = b.notes === null ? null : typeof b.notes === "string" ? b.notes.slice(0, 20000) : null;
  if (b.folder !== undefined) v.folder = text(b.folder, 80);
  return v;
}
async function myStudy(id: string, userId: string): Promise<Study> {
  if (!isUuid(id)) throw new WsError(404, "This study isn't available.");
  const { data, error } = await db.from("p2p_deep_studies").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  const s = data as Study | null;
  // Only the owner — someone else's study is the same "not available" as a missing one.
  if (!s || s.user_id !== userId || s.deleted_at) throw new WsError(404, "This study isn't available.");
  return s;
}
router.get("/studies", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const q = req.query as Record<string, string | undefined>;
    let query = db.from("p2p_deep_studies").select("*").eq("user_id", userId).is("deleted_at", null).order("last_opened_at", { ascending: false }).limit(500);
    if (q.kind && KINDS.includes(q.kind)) query = query.eq("kind", q.kind);
    if (q.folder) query = query.eq("folder", q.folder.slice(0, 80));
    const { data, error } = await query;
    if (error) throw error;
    let rows = (data ?? []) as Study[];
    const words = String(q.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    if (words.length) rows = rows.filter((s) => { const hay = `${s.title} ${s.notes ?? ""} ${JSON.stringify(s.focus)}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    const folders = [...new Set(((data ?? []) as Study[]).map((s) => s.folder).filter(Boolean) as string[])].sort();
    return res.json({ studies: rows.map(out), folders });
  } catch (e) { return fail(res, e); }
});
router.get("/studies/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try { return res.json({ study: out(await myStudy(String(req.params.id), userId)) }); } catch (e) { return fail(res, e); }
});
router.post("/studies", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const clientKey = clientKeyOf(b.clientKey);
    // Sent twice (a retry, or an offline queue replaying) → the study already made.
    if (clientKey) {
      const { data: had } = await db.from("p2p_deep_studies").select("*").eq("user_id", userId).eq("client_key", clientKey).maybeSingle();
      if (had) return res.json({ study: out(had as Study), existing: true });
    }
    const v = readStudy(b, false);
    const { count } = await db.from("p2p_deep_studies").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null);
    if ((count ?? 0) >= 2000) throw new WsError(409, "You have 2,000 saved studies. Delete some to save more.");
    const { data, error } = await db.from("p2p_deep_studies").insert({ ...v, focus: v.focus ?? {}, state: v.state ?? {}, user_id: userId, client_key: clientKey }).select("*").single();
    if (error) {
      if ((error as { code?: string }).code === "23505" && clientKey) {
        const { data: had } = await db.from("p2p_deep_studies").select("*").eq("user_id", userId).eq("client_key", clientKey).maybeSingle();
        if (had) return res.json({ study: out(had as Study), existing: true });
      }
      throw error;
    }
    return res.status(201).json({ study: out(data as Study) });
  } catch (e) { return fail(res, e); }
});
router.patch("/studies/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const s = await myStudy(String(req.params.id), userId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    // Never silently overwrite: a change made from an older copy is refused, with the current copy to merge.
    if (Number.isInteger(b.baseVersion) && b.baseVersion !== s.version) throw new WsError(409, "This study changed on another device.", { current: out(s) });
    const v = readStudy(b, true);
    if (!Object.keys(v).length) return res.json({ study: out(s) });
    const now = new Date().toISOString();
    const { data, error } = await db.from("p2p_deep_studies").update({ ...v, version: s.version + 1, updated_at: now, last_opened_at: now }).eq("id", s.id).eq("version", s.version).select("*").maybeSingle();
    if (error) throw error;
    if (!data) { const cur = await myStudy(s.id, userId); throw new WsError(409, "This study changed on another device.", { current: out(cur) }); }
    return res.json({ study: out(data as Study) });
  } catch (e) { return fail(res, e); }
});
router.post("/studies/:id/opened", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const s = await myStudy(String(req.params.id), userId);
    await db.from("p2p_deep_studies").update({ last_opened_at: new Date().toISOString() }).eq("id", s.id);
    return res.json({ ok: true });
  } catch (e) { return fail(res, e); }
});
router.delete("/studies/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const s = await myStudy(String(req.params.id), userId);
    await db.from("p2p_deep_studies").update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    return res.json({ deleted: true });
  } catch (e) { return fail(res, e); }
});

// ── Study workspace search (My Plan) ───────────────────────────────────────────
//   GET /search?q=&t=   any word, subject or question → eight groups with counts, sources and reasons
router.get("/search", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const q = String(req.query.q ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (q.length < 2) throw new WsError(400, "Type at least 2 characters.");
    const ix = await discoveryIndex();
    // "John 3:16", "Psalm 23", "Romans 8:28-30": study that passage from every side.
    const pr = parseReference(q);
    const reference = pr ? { book: pr.bookCode, chapter: pr.chapter, ...(pr.startVerse ? { startVerse: pr.startVerse, endVerse: pr.endVerse ?? pr.startVerse } : {}) } : null;
    // Words in the Bible text: the person's translation when it can be searched, else the first one that can.
    const all = await licensedTranslations();
    const want = String(req.query.t ?? "");
    const searchable = all.filter((r) => providerOf(r) === "api.bible");
    const tr = searchable.find((r) => r.translation_code === want) ?? searchable.find((r) => r.translation_code === "KJV") ?? searchable[0];
    let bible: SearchInputs["bible"];
    if (!tr) bible = { unavailable: "Word search needs a searchable translation, and none is licensed yet." };
    else {
      try {
        // A question or phrase: when no verse has every word, try its main words, then its most specific word
        // (the screen says which words were searched — never presented as a match for the whole question).
        const cw = contentWords(q);
        const tries = [q, cw.join(" "), ...[...cw].sort((a, b) => b.length - a.length)].filter((x, i, a) => x && x.length >= 2 && a.indexOf(x) === i).slice(0, 4);
        let r = await searchBible(tries[0], tr.translation_code, 0), used = tries[0];
        for (const alt of tries.slice(1)) { if (r.total > 0 || r.kind === "reference") break; r = await searchBible(alt, tr.translation_code, 0); used = alt; }
        bible = { translation: tr.translation_code, total: r.total, results: r.results, usedQuery: used };
      }
      catch (e) { bible = { unavailable: (e as Error)?.message ?? "Word search isn't available right now." }; }
    }
    // WHAT IT MEANS (owner 2026-11-18): the words of the search, each studied on its own as well as together —
    // their verses (first page), and the verses where they all stand together. Not for a typed reference.
    const terms = reference ? [] : meaningTerms(q);
    const termVerses: Record<string, VerseSearch> = {};
    let togetherVerses: VerseSearch = null;
    if (tr && terms.length) {
      const one = async (term: string) => {
        const forms = [term, ...(/(ship|ness|ment)$/.test(term) ? stems(term) : [])];
        for (const f of forms) {
          try { const r = await searchBible(f, tr.translation_code, 0, { limit: 8 }); if (r.total > 0 || f === forms.at(-1)) return { translation: tr.translation_code, total: r.total, searchedAs: f, results: r.results }; }
          catch { /* that word can't be searched: the next form, else nothing */ }
        }
        return null;
      };
      // Every form of the words together (as typed, the subject words, their roots), merged; the definitions keep
      // only verses that contain every word, the exact phrase first.
      const together = async () => {
        const merged: NonNullable<VerseSearch>["results"] = []; const used: string[] = []; let total = 0;
        for (const tq of togetherQueries(q)) {
          try {
            const r = tq === (bible as { usedQuery?: string }).usedQuery && "results" in bible ? { total: bible.total, results: bible.results } : await searchBible(tq, tr.translation_code, 0, { limit: 30 });
            if (!r.total) continue;
            used.push(tq); total = Math.max(total, r.total);
            for (const v of r.results) if (!merged.some((m) => m.reference === v.reference)) merged.push(v);
          } catch { /* try the next form */ }
        }
        return merged.length ? { translation: tr.translation_code, total, searchedAs: used[0], results: merged } : null;
      };
      const [tv, ...each] = await Promise.all([terms.length >= 2 ? together() : Promise.resolve(null), ...terms.map(one)]);
      togetherVerses = tv;
      terms.forEach((t, i) => { termVerses[t] = each[i]; });
    }
    let meaning: ReturnType<typeof buildMeaning> = null;
    try { if (terms.length) meaning = buildMeaning({ q, articles: getArticles(), dict: getDictionary(), termVerses, togetherVerses }); } catch { meaning = null; }
    let articles: SearchInputs["articles"] = [];
    try {
      articles = searchArticles(getArticles(), q).sort((a, b) => a.rank - b.rank || b.mentions - a.mentions).slice(0, 14).map((h) => ({ id: h.a.id, title: h.a.title, rank: h.rank, mentions: h.mentions, preview: articleSummary(h.a).preview }));
      // Definitions: the entry for each word too (grace of God → "Grace" and "God").
      const byId = getArticles().byId;
      for (const tm of meaning?.terms ?? []) if (tm.article && !articles.some((x) => x.id === tm.article!.id)) {
        const a = byId.get(tm.article.id); if (a) articles.unshift({ id: a.id, title: a.title, rank: 3, mentions: 0, preview: articleSummary(a).preview });
      }
      if (meaning?.together?.article && !articles.some((x) => x.id === meaning!.together!.article!.id)) {
        const a = byId.get(meaning.together.article.id); if (a) articles.unshift({ id: a.id, title: a.title, rank: 3, mentions: 0, preview: articleSummary(a).preview });
      }
    } catch { articles = []; }
    let words: SearchInputs["words"] = [];
    try {
      // Original-language words for the search's main words (an English meaning that matches).
      const keys = [q, ...contentWords(q), ...terms, ...contentWords(q).flatMap(stems)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 8);
      const d = getDictionary();
      const seenW = new Set<string>();
      for (const k of keys) for (const it of dictSearch(d, k, { limit: 8 }).items) {
        if (it.type !== "term" || it.rank > 3 || seenW.has(it.key)) continue;
        seenW.add(it.key);
        const ids = d.terms.get(it.key)?.ids ?? [];
        words.push({ key: it.key, display: it.display, ids, languages: [...new Set(ids.map((id) => d.records.get(id)?.language).filter(Boolean) as string[])] });
      }
      words = words.slice(0, 12);
    } catch { words = []; }
    let concepts: NonNullable<SearchInputs["concepts"]> = [];
    // A typed reference is a passage, not a subject: no lexical/Easton concepts from its book name.
    if (!reference) try {
      const all = getArticles();
      // The article TITLED with the search, or with one of its main words (grace of God → "Grace").
      let titled: ReturnType<typeof getArticles>["list"][number] | null = null;
      for (const k of [q, ...contentWords(q), ...contentWords(q).flatMap(stems)]) {
        titled = searchArticles(all, k).filter((h) => h.rank <= 5).sort((x, y) => x.rank - y.rank)[0]?.a ?? null;
        if (titled) break;
      }
      concepts.push(...eastonConcepts(titled, ix.topics.map((t) => t.title), q));
    } catch { /* Easton unavailable: no concepts from it */ }
    if (!reference) try {
      const d = getDictionary();
      const lex = conceptsFrom(words.flatMap((w) => w.ids).map((id) => d.records.get(id)).filter((r): r is NonNullable<typeof r> => !!r && r.words >= 5), q);
      for (const c of lex) if (!concepts.some((x) => x.concept === c.concept)) concepts.push(c);
    } catch { /* lexicon unavailable */ }
    // The person's own notes, highlights and playlists (scoped to the caller; read-only here).
    const mine: NonNullable<SearchInputs["mine"]> = [];
    try {
      const fq = q.toLowerCase();
      const inRef = (r: { book_code: string; chapter: number; start_verse: number; end_verse: number }) => !!reference && r.book_code === reference.book && r.chapter === reference.chapter
        && (!reference.startVerse || (r.start_verse <= (reference.endVerse ?? reference.startVerse) && r.end_verse >= reference.startVerse));
      const label = (r: { book_code: string; chapter: number; start_verse: number; end_verse: number }) => `${BOOK_BY_CODE.get(r.book_code)?.name ?? r.book_code} ${r.chapter}:${r.start_verse}${r.end_verse !== r.start_verse ? `-${r.end_verse}` : ""}`;
      const pRef = (r: { book_code: string; chapter: number; start_verse: number; end_verse: number }) => ({ book: r.book_code, chapter: r.chapter, startVerse: r.start_verse, endVerse: r.end_verse });
      const [notes, hls, cols] = await Promise.all([
        db.from("p2p_user_notes").select("id,title,body,book_code,chapter,start_verse,end_verse").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1000),
        reference ? db.from("p2p_user_highlights").select("id,book_code,chapter,start_verse,end_verse").eq("user_id", userId).eq("book_code", reference.book).eq("chapter", reference.chapter).limit(200) : Promise.resolve({ data: [] as never[] }),
        db.from("p2p_scripture_collections").select("id,title,description,kind").eq("owner_id", userId).is("deleted_at", null).limit(500),
      ]);
      for (const n of (notes.data ?? []) as { id: string; title: string | null; body: string; book_code: string; chapter: number; start_verse: number; end_verse: number }[])
        if (inRef(n) || `${n.title ?? ""} ${n.body}`.toLowerCase().includes(fq)) mine.push({ kind: "note", id: n.id, title: n.title || label(n), subtitle: n.body.slice(0, 160), ref: pRef(n) });
      for (const h of (hls.data ?? []) as { id: string; book_code: string; chapter: number; start_verse: number; end_verse: number }[])
        if (inRef(h)) mine.push({ kind: "highlight", id: h.id, title: label(h), subtitle: null, ref: pRef(h) });
      for (const c of (cols.data ?? []) as { id: string; title: string; description: string | null; kind: string }[])
        if (`${c.title} ${c.description ?? ""}`.toLowerCase().includes(fq)) mine.push({ kind: "playlist", id: c.id, title: c.title, subtitle: c.description, ref: { id: c.id } });
    } catch { /* personal search unavailable: the rest still answers */ }
    let referenceText: SearchInputs["referenceText"] = null;
    if (reference) try {
      const tc = all.find((r) => r.translation_code === want)?.translation_code ?? tr?.translation_code;
      if (tc) {
        const ch = await getChapter(reference.book, reference.chapter, tc);
        const from = reference.startVerse ?? 1, to = reference.endVerse ?? (reference.startVerse ? reference.startVerse : 3);
        const text = ch.verses.filter((v) => v.verse >= from && v.verse <= to).map((v) => v.text).join(" ").trim();
        if (text) referenceText = { text: text.slice(0, 600), translation: tc };
      }
    } catch { /* the passage still opens in the reader */ }
    // Biblical names, titles and descriptions the search names (never for a typed reference).
    let names: ReturnType<typeof namesForSearch> = null;
    try { names = reference ? null : namesForSearch(q); } catch { names = null; }
    const perWord = terms.length >= 2 ? terms.flatMap((t) => (termVerses[t] ? [{ term: termVerses[t]!.searchedAs, translation: termVerses[t]!.translation, results: termVerses[t]!.results }] : [])) : [];
    return res.json({ ...buildStudy({ q, ix, bible, articles, words, concepts, reference, referenceText, mine: mine.slice(0, 40), termVerses: perWord }), meaning, names });
  } catch (e) { return fail(res, e); }
});

// ── Biblical names, titles and descriptions (owner brief 2026-11-18) ───────────────────────────────────────────────
//   GET /names?section=&person=&language=&testament=&kind=&interpretive=1&q=&sort=   a collection with filters
//   GET /names/:id                                                                    one entry in full
const one = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
router.get("/names", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const cq: CollectionQuery = {
      section: one(req.query.section, ["father", "son", "spirit", "god", "attributes", "devotional", "original", "history"] as const),
      person: one(req.query.person, ["father", "son", "spirit", "god"] as const),
      language: one(req.query.language, ["hebrew", "aramaic", "greek"] as const),
      testament: one(req.query.testament, ["OT", "NT"] as const),
      kind: one(req.query.kind, ["name", "title", "description", "metaphor", "attribute", "form", "devotional", "worship"] as const),
      interpretive: req.query.interpretive === "1",
      q: typeof req.query.q === "string" ? req.query.q.slice(0, 80) : null,
      sort: one(req.query.sort, ["canon", "language", "category", "alpha"] as const) ?? "canon",
    };
    return res.json(namesCollection(cq));
  } catch (e) { return fail(res, e); }
});
router.get("/names/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const e = nameEntry(String(req.params.id).slice(0, 80));
    if (!e) throw new WsError(404, "That entry isn't available.");
    return res.json({ entry: e });
  } catch (e) { return fail(res, e); }
});

// ── Playlist read marks ──────────────────────────────────────────────────────
router.get("/collections/:id/reads", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.id)) throw new WsError(404, "This playlist isn't available.");
    await collectionAccess(userId, String(req.params.id)).catch(() => { throw new WsError(404, "This playlist isn't available."); });
    const { data: items } = await db.from("p2p_scripture_collection_items").select("id").eq("collection_id", req.params.id);
    const ids = ((items ?? []) as { id: string }[]).map((r) => r.id);
    const { data, error } = ids.length ? await db.from("p2p_scripture_collection_reads").select("item_id,read_at").eq("user_id", userId).in("item_id", ids) : { data: [], error: null };
    if (error) throw error;
    return res.json({ reads: Object.fromEntries(((data ?? []) as { item_id: string; read_at: string }[]).map((r) => [r.item_id, r.read_at])) });
  } catch (e) { return fail(res, e); }
});
async function itemFor(userId: string, itemId: string) {
  if (!isUuid(itemId)) throw new WsError(404, "That passage isn't available.");
  const { data } = await db.from("p2p_scripture_collection_items").select("id,collection_id").eq("id", itemId).maybeSingle();
  const it = data as { id: string; collection_id: string } | null;
  if (!it) throw new WsError(404, "That passage isn't available.");
  await collectionAccess(userId, it.collection_id).catch(() => { throw new WsError(404, "That passage isn't available."); });
  return it;
}
router.post("/collections/items/:itemId/read", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const it = await itemFor(userId, String(req.params.itemId));
    const { error } = await db.from("p2p_scripture_collection_reads").upsert({ item_id: it.id, user_id: userId, read_at: new Date().toISOString() }, { onConflict: "item_id,user_id" });
    if (error) throw error;
    return res.json({ read: true });
  } catch (e) { return fail(res, e); }
});
router.delete("/collections/items/:itemId/read", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const it = await itemFor(userId, String(req.params.itemId));
    await db.from("p2p_scripture_collection_reads").delete().eq("item_id", it.id).eq("user_id", userId);
    return res.json({ read: false });
  } catch (e) { return fail(res, e); }
});

export default router;
