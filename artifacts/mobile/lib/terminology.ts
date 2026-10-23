// Product-wide learning terminology. What the database calls an "assignment"
// (p2p_assignments, p2p_group_assignments, the 211 chapter field) is shown to
// people as a "Comprehensive Check" everywhere in P2P Global — Core
// Curriculum, Plans, Kingdom Stories, Family and Church learning. Only the
// words change: tables, ids, responses and progress are untouched.
//
// Reflections stay "Reflections"; peer review stays "peer review".

export const COMPREHENSIVE_CHECK = "Comprehensive Check";
export const COMPREHENSIVE_CHECKS = "Comprehensive Checks";

/**
 * The heading to show for a stored assignment title. Older content was
 * seeded with the generic title "Assignment" (e.g. migration 112); that, or
 * no title, reads as "Comprehensive Check". An author's own specific title
 * (e.g. "Practise honesty in an agreement") is kept as written.
 */
export function checkTitle(stored: string | null | undefined): string {
  const t = String(stored ?? "").trim();
  if (!t || /^(assignment|comprehensive check)s?$/i.test(t)) return COMPREHENSIVE_CHECK;
  return t;
}
