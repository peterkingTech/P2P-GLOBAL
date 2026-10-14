// Publishing Studio — who may do what. Pure functions, enforced by the API
// (routes/studio.ts) on every request; the database adds a second layer
// (migration 188: staff-only reads, no direct client writes). Role names are
// the existing p2p_profiles.role values — no new role system.

export type SourceType = "kingdom_story" | "kingdom_win";
export const SOURCE_TYPES: readonly SourceType[] = ["kingdom_story", "kingdom_win"];
export type ReviewState = "draft" | "in_review" | "changes_requested" | "approved";
export type ScheduleAction = "publish" | "unpublish" | "archive";
export const SCHEDULE_ACTIONS: readonly ScheduleAction[] = ["publish", "unpublish", "archive"];

/** May open the Studio and read its items (mirrors p2p_is_studio_staff()). */
export const STUDIO_VIEW_ROLES = [
  "super_admin", "admin_content", "admin_supervisor", "admin_moderation",
  "moderator", "admin_translation", "admin_marketing",
] as const;

/** May edit, submit, review and schedule each content type. Kingdom Stories:
 * the same roles as p2p_is_kingdom_stories_editor() (migration 152). */
const EDITOR_ROLES: Record<SourceType, readonly string[]> = {
  kingdom_story: ["admin_content", "super_admin"],
  // Kingdom Wins are written by peers and moderated in the existing admin
  // queue; the Studio shows them but never edits or schedules them.
  kingdom_win: [],
};

/** May read an item's audit history. */
export const AUDIT_VIEW_ROLES = ["super_admin", "admin_supervisor", "admin_content"] as const;

export function canView(role: string | undefined): boolean {
  return !!role && (STUDIO_VIEW_ROLES as readonly string[]).includes(role);
}
export function canEdit(role: string | undefined, source: SourceType): boolean {
  return !!role && EDITOR_ROLES[source].includes(role);
}
export function canViewAudit(role: string | undefined): boolean {
  return !!role && (AUDIT_VIEW_ROLES as readonly string[]).includes(role);
}

export type Decision = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Decision => ({ ok: false, reason });
const yes: Decision = { ok: true };

const REVIEW_EDGES: Record<ReviewState, readonly ReviewState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "changes_requested", "draft"],
  changes_requested: ["in_review", "draft"],
  approved: ["draft"], // reopen for further edits; any schedule must be re-approved
};

/**
 * Review transition check. An approval must come from someone other than the
 * submitter ("four eyes"), except super_admin.
 */
export function reviewTransition(args: {
  source: SourceType; from: ReviewState; to: ReviewState;
  actorRole: string | undefined; actorId: string; submittedBy: string | null;
}): Decision {
  const { source, from, to, actorRole, actorId, submittedBy } = args;
  if (!canEdit(actorRole, source)) return no("Your role cannot change the review state of this content.");
  if (!REVIEW_EDGES[from]?.includes(to)) return no(`Cannot move from ${from} to ${to}.`);
  if ((to === "approved" || to === "changes_requested") && submittedBy === actorId && actorRole !== "super_admin") {
    return no("Someone other than the submitter must review this.");
  }
  return yes;
}

/** May this job be scheduled now? Publishing requires an approved review. */
export function canSchedule(args: {
  source: SourceType; action: ScheduleAction; reviewState: ReviewState; actorRole: string | undefined;
}): Decision {
  if (!SCHEDULE_ACTIONS.includes(args.action)) return no("Unknown action.");
  if (!canEdit(args.actorRole, args.source)) return no("Your role cannot schedule this content.");
  if (args.action === "publish" && args.reviewState !== "approved") return no("Content must be approved before it can be scheduled to publish.");
  return yes;
}

// ── External sharing (outside the app: share sheet, links, social) ──────────
//
// Kingdom Stories: admin-published editorial content; only Studio publishing
//   roles may share it externally, and only once published.
// Kingdom Wins: user testimonies; shared externally only when published to
//   the P2P network AND the author has given permission — the author may
//   always share their own. Anonymous testimonies are never shared with the
//   author's identity attached.
export const STORY_SHARE_ROLES = ["super_admin", "admin_content", "admin_marketing"] as const;

export function canShareExternally(args: {
  source: SourceType; actorRole: string | undefined; actorId: string;
  native: { status: string; visibility?: string | null; authorId?: string | null; sharePermission?: boolean | null };
}): Decision {
  const { source, actorRole, actorId, native } = args;
  if (native.status !== "published") return no("Only published content can be shared.");
  if (source === "kingdom_story") {
    return actorRole && (STORY_SHARE_ROLES as readonly string[]).includes(actorRole) ? yes : no("Kingdom Stories are shared by the P2P team only.");
  }
  if (native.visibility !== "p2p_network") return no("This testimony is not shared with the P2P network.");
  if (native.authorId && native.authorId === actorId) return yes;
  if (native.sharePermission === true) return yes;
  return no("The author has not given permission to share this testimony.");
}
