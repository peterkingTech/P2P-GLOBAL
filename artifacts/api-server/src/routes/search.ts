import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

// P2P Global Search — the EXISTING Discover search field (people-only,
// via /profiles/search) extended into one bounded, parallel, multi-domain
// query. This is a NEW, ADDITIVE endpoint; /profiles/search itself is
// untouched and unmodified, and is called internally (not duplicated) for
// the people slice below.
//
// Deliberately excluded, per forensic audit (see chat report): Families
// (p2p_families has zero SELECT policy granting non-member visibility —
// there is no existing safe discovery mechanism to reuse, and this
// feature must not invent one); Churches (RLS on p2p_churches technically
// permits any authenticated read of status='active' rows, but NO existing
// discovery route/screen surfaces this today — inventing one now would be
// "a new unrestricted directory" this feature is explicitly told not to
// create); Scripture body text (would require a duplicate Bible corpus —
// forbidden; folded into Prayer Topics/Paths search instead, since that's
// the existing safe path to Scripture-connected content); Lessons/Modules
// (the existing /plans/search route already shows these aren't
// independently status-gated in practice — rather than replicate that gap,
// v1 surfaces only top-level Curricula/Plans, a deliberate, smaller scope).
//
// No pg_trgm/GIN index exists on any of these tables except
// p2p_profiles.username (migration 064) — every query below is a plain
// ILIKE sequential scan, bounded to LIMIT 5 per domain, run in parallel,
// matching the existing codebase-wide ILIKE convention (curriculum.ts,
// profiles.ts) rather than introducing Postgres full-text search or a new
// search-engine dependency neither requested nor justified by the
// existing architecture's scale.
const router = Router();

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const PER_DOMAIN_LIMIT = 5;

// Escape ILIKE's special characters so a query containing literal %, _, or
// \ searches for those characters instead of being interpreted as a
// wildcard pattern — the closest equivalent of "injection-safe" input
// handling for a LIKE-family query (parameter binding already prevents
// actual SQL injection; this prevents wildcard-pattern abuse/DoS-by-scan).
function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  category?: string | null;
  route: string;
}

// Exact match first, then prefix match, then the rest (already
// contains-filtered by the query itself) — the same relevance ordering
// /profiles/search already uses, applied generically here.
function rank<T>(items: T[], query: string, titleOf: (item: T) => string): T[] {
  const q = query.toLowerCase();
  return [...items].sort((a, b) => {
    const ta = titleOf(a).toLowerCase(), tb = titleOf(b).toLowerCase();
    const score = (t: string) => (t === q ? 0 : t.startsWith(q) ? 1 : 2);
    return score(ta) - score(tb);
  });
}

router.get("/", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const rawQuery = (req.query.q as string | undefined) ?? "";
  const q = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < MIN_QUERY_LENGTH) return res.json({ query: q, groups: [] });
  const pattern = `%${escapeIlike(q)}%`;

  // People — the SAME visibility rule /profiles/search already enforces
  // (profile_visibility != 'private'), re-implemented inline rather than
  // an HTTP self-call, but with one deliberate improvement: the blocking
  // filter uses the caller's SERVER-VERIFIED id (from their JWT), never a
  // client-supplied viewerId the way a direct call to /profiles/search
  // would accept — /profiles/search itself is untouched.
  async function searchPeople() {
    const { data: matches } = await db.from("p2p_profiles").select("id,username,full_name")
      .or(`username.ilike.${pattern},full_name.ilike.${pattern}`).neq("profile_visibility", "private").limit(PER_DOMAIN_LIMIT);
    if (!matches?.length) return [];
    const { data: blocks } = await db.from("p2p_user_blocks").select("blocker_id,blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    const blockedIds = new Set((blocks ?? []).map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id) as string));
    return matches.filter((m) => !blockedIds.has(m.id) && m.id !== userId).map((m) => ({ userId: m.id, username: m.username as string, fullName: m.full_name as string | null }));
  }

  const [people, curricula, prayerTopics, prayerPaths, missionFields, missionStories, kingdomStories, kingdomWins] =
    await Promise.all([
      searchPeople(),

      db.from("p2p_curriculums").select("id,title,subtitle,type").eq("status", "published")
        .or(`title.ilike.${pattern},subtitle.ilike.${pattern},description.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),

      db.from("p2p_prayer_topics").select("id,slug,title,description").eq("status", "published")
        .or(`title.ilike.${pattern},description.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),

      db.from("p2p_prayer_paths").select("id,slug,title,description").eq("status", "published")
        .or(`title.ilike.${pattern},description.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),

      db.from("p2p_mission_fields").select("id,slug,title,country,context").eq("status", "published")
        .or(`title.ilike.${pattern},country.ilike.${pattern},context.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),

      db.from("p2p_mission_stories").select("id,title,summary").eq("status", "published")
        .or(`title.ilike.${pattern},summary.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),

      db.from("p2p_kingdom_stories").select("id,title,subtitle,category_id").eq("status", "published")
        .or(`title.ilike.${pattern},subtitle.ilike.${pattern},body.ilike.${pattern},learning_section.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),

      db.from("p2p_kingdom_wins").select("id,title,entry_type").eq("status", "published").eq("visibility", "p2p_network")
        .or(`title.ilike.${pattern},body.ilike.${pattern}`).limit(PER_DOMAIN_LIMIT)
        .then((r) => r.data ?? []),
    ]);

  const categoryIds = [...new Set(kingdomStories.map((s: any) => s.category_id).filter(Boolean))];
  const { data: categories } = categoryIds.length
    ? await db.from("p2p_kingdom_story_categories").select("id,title").in("id", categoryIds)
    : { data: [] as { id: string; title: string }[] };
  const categoryTitle = new Map((categories ?? []).map((c) => [c.id, c.title]));

  const groups: { type: string; label: string; results: SearchResult[] }[] = [];

  if (people.length) groups.push({
    type: "person", label: "People",
    results: rank(people, q, (p) => p.fullName ?? p.username).map((p) => ({
      type: "person", id: p.userId, title: p.fullName ?? p.username, subtitle: `@${p.username}`, route: `/profile/${p.username}`,
    })),
  });
  if (curricula.length) groups.push({
    type: "curriculum", label: "Study & Plans",
    results: rank(curricula, q, (c: any) => c.title).map((c: any) => ({
      type: c.type === "plan" ? "plan" : "curriculum", id: c.id, title: c.title, subtitle: c.subtitle, route: `/curriculum/${c.id}`,
    })),
  });
  if (prayerTopics.length || prayerPaths.length) groups.push({
    type: "pray_the_word", label: "Pray the Word",
    results: [
      ...rank(prayerTopics, q, (t: any) => t.title).map((t: any) => ({ type: "prayer_topic", id: t.id, title: t.title, subtitle: t.description, route: `/prayer/pray-the-word/${t.slug}` })),
      ...rank(prayerPaths, q, (p: any) => p.title).map((p: any) => ({ type: "prayer_path", id: p.id, title: p.title, subtitle: p.description, route: `/prayer/paths/${p.slug}` })),
    ],
  });
  if (missionFields.length || missionStories.length) groups.push({
    type: "missions", label: "Missions",
    results: [
      ...rank(missionFields, q, (f: any) => f.title).map((f: any) => ({ type: "mission_field", id: f.id, title: f.title, subtitle: f.country, route: `/missions/field/${f.slug}` })),
      ...rank(missionStories, q, (s: any) => s.title).map((s: any) => ({ type: "mission_story", id: s.id, title: s.title, subtitle: s.summary, route: `/missions/story/${s.id}` })),
    ],
  });
  if (kingdomStories.length) groups.push({
    type: "kingdom_story", label: "Kingdom Stories",
    results: rank(kingdomStories, q, (s: any) => s.title).map((s: any) => ({
      type: "kingdom_story", id: s.id, title: s.title, subtitle: s.subtitle, category: categoryTitle.get(s.category_id) ?? null, route: `/kingdom-stories/${s.id}`,
    })),
  });
  if (kingdomWins.length) groups.push({
    type: "kingdom_win", label: "Kingdom Wins & P2P Impact",
    results: rank(kingdomWins, q, (w: any) => w.title).map((w: any) => ({
      type: "kingdom_win", id: w.id, title: w.title, subtitle: w.entry_type === "p2p_impact" ? "P2P Impact" : w.entry_type === "testimony" ? "Testimony" : "Kingdom Win", route: `/kingdom-wins/${w.id}`,
    })),
  });

  return res.json({ query: q, groups });
});

export default router;
