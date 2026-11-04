import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { stageInfo } from "../lib/growthStages";

// Discipleship genealogy (migrations 233–234). Generations come only from
// discipleship relationships (active or paused) — never connections, Family or
// Church membership, invitations or dates.
//   • GET /genealogy/me — my mentors (primary first) and the primary line above
//     them, my direct disciples, and how many people are at each generation
//     below me. Nothing is loaded all at once: deeper people come a page and a
//     branch at a time;
//   • GET /genealogy/branch/:personId — the disciples of someone in MY lineage
//     (expanding a branch); anyone else's → 404;
//   • GET /genealogy/me/generation/:n — one generation below me, 50 at a time;
//   • GET /genealogy/me/search?q= — find someone within my own lineage only;
//   • GET /genealogy/collective — Forest of Nations: totals only, no names.
// Privacy: people I'm directly in a relationship with appear by name; anyone
// further away follows their own settings (a private profile is "A disciple",
// the real name only if they show it, their stage only if they share their
// progress). Nothing private (journals, reflections, prayers, messages,
// evaluations) is ever read here.

const router = Router();
const PAGE = 50;

type Person = { id: string; full_name: string | null; username: string | null; photo_url: string | null; country: string | null; profile_visibility: string | null; show_real_name_publicly: boolean | null; show_progress_publicly: boolean | null };
const PERSON_COLS = "id,full_name,username,photo_url,country,profile_visibility,show_real_name_publicly,show_progress_publicly";

async function people(ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("p2p_profiles").select(PERSON_COLS).in("id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as Person[]) out.set(p.id, p);
  }
  return out;
}
async function stages(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("p2p_growth_status").select("user_id,stage").in("user_id", ids.slice(i, i + 200));
    for (const s of (data ?? []) as { user_id: string; stage: number }[]) out.set(s.user_id, s.stage);
  }
  return out;
}
async function childCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("p2p_discipleship_links").select("mentor_id").in("mentor_id", ids.slice(i, i + 200)).in("status", ["active", "paused"]);
    for (const l of (data ?? []) as { mentor_id: string }[]) out.set(l.mentor_id, (out.get(l.mentor_id) ?? 0) + 1);
  }
  return out;
}

/** One person as the viewer may see them. `direct`: the viewer's own mentor or disciple (or the viewer). */
function card(id: string, p: Person | undefined, stage: number | undefined, direct: boolean, extra: Record<string, unknown> = {}) {
  const hidden = !direct && (!p || p.profile_visibility === "private");
  const showName = direct || (p?.show_real_name_publicly ?? true);
  const showStage = direct || (p?.show_progress_publicly ?? true);
  const s = stage && showStage && !hidden ? stageInfo(stage) : null;
  return {
    id: hidden ? null : id,
    name: hidden ? "A disciple" : (showName ? p?.full_name : null) || (p?.username ? `@${p.username}` : "A disciple"),
    username: hidden ? null : p?.username ?? null,
    photoUrl: hidden ? null : p?.photo_url ?? null,
    private: hidden,
    stage: s ? { number: s.stage, name: s.name, emoji: s.emoji } : null,
    ...extra,
  };
}

type Desc = { person_id: string; mentor_id: string; generation: number; is_primary: boolean; status: string; started_at: string | null };
async function descendants(root: string): Promise<Desc[]> {
  const { data, error } = await db.rpc("p2p_lineage_descendants", { p_root: root, p_max_depth: 200 });
  if (error) throw error;
  return (data ?? []) as Desc[];
}

router.get("/me", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  try {
    const [{ data: anc, error: ae }, desc] = await Promise.all([
      db.rpc("p2p_lineage_ancestors", { p_person: caller, p_max_depth: 200 }),
      descendants(caller),
    ]);
    if (ae) throw ae;
    const ancestors = (anc ?? []) as { person_id: string; generation: number; is_primary: boolean; status: string; started_at: string | null }[];
    const direct = desc.filter((d) => d.generation === 1);
    const ids = [...new Set([caller, ...ancestors.map((a) => a.person_id), ...direct.map((d) => d.person_id)])];
    const [ps, ss, cc] = await Promise.all([people(ids), stages(ids), childCounts(direct.map((d) => d.person_id))]);
    const counts = new Map<number, number>();
    for (const d of desc) counts.set(d.generation, (counts.get(d.generation) ?? 0) + 1);
    const directMentorIds = new Set(ancestors.filter((a) => a.generation === 1).map((a) => a.person_id));
    return res.json({
      me: card(caller, ps.get(caller), ss.get(caller), true),
      mentors: ancestors.filter((a) => a.generation === 1).map((a) => card(a.person_id, ps.get(a.person_id), ss.get(a.person_id), true, { isPrimary: a.is_primary, status: a.status, since: a.started_at })),
      // Above my primary mentor: their mentor, and so on (followed through primary mentors).
      lineAbove: ancestors.filter((a) => a.generation > 1).map((a) => card(a.person_id, ps.get(a.person_id), ss.get(a.person_id), directMentorIds.has(a.person_id), { generationsAbove: a.generation })),
      disciples: direct.map((d) => card(d.person_id, ps.get(d.person_id), ss.get(d.person_id), true, { status: d.status, since: d.started_at, disciples: cc.get(d.person_id) ?? 0 })),
      generations: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([generation, n]) => ({ generation, people: n })),
      totalDescendants: desc.length,
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load your lineage." });
  }
});

router.get("/branch/:personId", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const personId = String(req.params.personId);
  try {
    const desc = await descendants(caller);
    const here = desc.find((d) => d.person_id === personId);
    if (personId !== caller && !here) return res.status(404).json({ error: "Not in your lineage." });
    const children = desc.filter((d) => d.mentor_id === personId && d.generation === (here?.generation ?? 0) + 1);
    const ids = children.map((c) => c.person_id);
    const [ps, ss, cc] = await Promise.all([people(ids), stages(ids), childCounts(ids)]);
    return res.json({
      generation: (here?.generation ?? 0) + 1,
      people: children.map((c) => card(c.person_id, ps.get(c.person_id), ss.get(c.person_id), personId === caller, { status: c.status, disciples: cc.get(c.person_id) ?? 0 })),
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load this branch." });
  }
});

router.get("/me/generation/:n", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const n = Math.max(1, Math.min(200, Number(req.params.n) || 1));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  try {
    const all = (await descendants(caller)).filter((d) => d.generation === n);
    const page = all.slice(offset, offset + PAGE);
    const ids = page.map((p) => p.person_id);
    const [ps, ss, cc] = await Promise.all([people(ids), stages(ids), childCounts(ids)]);
    return res.json({
      generation: n, total: all.length, offset, nextOffset: offset + PAGE < all.length ? offset + PAGE : null,
      people: page.map((d) => card(d.person_id, ps.get(d.person_id), ss.get(d.person_id), n === 1, { disciples: cc.get(d.person_id) ?? 0 })),
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load this generation." });
  }
});

router.get("/me/search", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  const term = String(req.query.q ?? "").trim().toLowerCase().replace(/^@/, "");
  if (term.length < 2) return res.json({ people: [] });
  try {
    const desc = await descendants(caller);
    const ids = desc.map((d) => d.person_id);
    const ps = await people(ids);
    const genOf = new Map(desc.map((d) => [d.person_id, d.generation]));
    // Only what the viewer may see is searchable (a hidden name can't be found by it).
    const hits = ids.filter((id) => {
      const p = ps.get(id); if (!p) return false;
      const direct = genOf.get(id) === 1;
      if (!direct && p.profile_visibility === "private") return false;
      const name = direct || (p.show_real_name_publicly ?? true) ? (p.full_name ?? "") : "";
      return name.toLowerCase().includes(term) || (p.username ?? "").toLowerCase().includes(term);
    }).slice(0, 30);
    const ss = await stages(hits);
    return res.json({ people: hits.map((id) => card(id, ps.get(id), ss.get(id), genOf.get(id) === 1, { generation: genOf.get(id) })) });
  } catch {
    return res.status(500).json({ error: "Couldn't search your lineage." });
  }
});

// Forest of Nations: what P2P Global's disciples are together. Totals only.
router.get("/collective", async (req, res) => {
  const caller = await verifyCaller(req);
  if (!caller) return res.status(401).json({ error: "Please sign in." });
  try {
    const { data: links } = await db.from("p2p_discipleship_links").select("mentor_id,disciple_id,started_at").in("status", ["active", "paused"]).limit(100000);
    const rows = (links ?? []) as { mentor_id: string; disciple_id: string; started_at: string | null }[];
    const mentors = new Set(rows.map((r) => r.mentor_id)), disciples = new Set(rows.map((r) => r.disciple_id));
    // Generations: the longest chain of discipleship (walked in memory over the current relationships).
    const kids = new Map<string, string[]>();
    for (const r of rows) kids.set(r.mentor_id, [...(kids.get(r.mentor_id) ?? []), r.disciple_id]);
    const roots = [...mentors].filter((m) => !disciples.has(m));
    let deepest = 0;
    for (const root of roots) {
      let frontier = [root]; const seen = new Set([root]); let depth = 0;
      while (frontier.length && depth < 200) {
        const next = frontier.flatMap((f) => kids.get(f) ?? []).filter((x) => !seen.has(x));
        next.forEach((x) => seen.add(x));
        if (next.length) depth++;
        frontier = next;
      }
      deepest = Math.max(deepest, depth);
    }
    const everyone = [...new Set([...mentors, ...disciples])];
    const countries = new Set<string>();
    for (let i = 0; i < everyone.length; i += 200) {
      const { data } = await db.from("p2p_profiles").select("country").in("id", everyone.slice(i, i + 200));
      for (const p of (data ?? []) as { country: string | null }[]) if (p.country) countries.add(p.country.trim().toLowerCase());
    }
    const { data: st } = await db.from("p2p_growth_status").select("stage");
    const byStage = [1, 2, 3, 4, 5].map((n) => ({ stage: n, name: stageInfo(n).name, people: ((st ?? []) as { stage: number }[]).filter((s) => s.stage === n).length }));
    const byMonth = new Map<string, number>();
    for (const r of rows) if (r.started_at) { const m = r.started_at.slice(0, 7); byMonth.set(m, (byMonth.get(m) ?? 0) + 1); }
    return res.json({
      activeRelationships: rows.length, peopleBeingDiscipled: disciples.size, peopleDiscipling: mentors.size,
      // Generations as levels of people: the first mentor is generation 1, their disciples generation 2, …
      generations: rows.length ? deepest + 1 : 0, countries: countries.size, stages: byStage,
      relationshipsBegun: [...byMonth.entries()].sort().slice(-12).map(([month, n]) => ({ month, relationships: n })),
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load the Forest of Nations." });
  }
});

export default router;
