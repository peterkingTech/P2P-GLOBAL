// Kingdom Wins community rules and moderation helpers (migration 189).
// Display-only mirrors of the server policy — the database enforces all of it.

export const WINS_COMMUNITY_RULES: string[] = [
  "Share a genuine testimony of what God has done.",
  "No advertising, selling or commercial promotion.",
  "No fundraising, donation requests, payment details or money schemes.",
  "No scams, impersonation or misleading claims.",
  "Only include people who are happy to be named or pictured.",
];
export const WINS_RULES_NOTE =
  "Posts are checked automatically before they appear. Posts in other languages are translated for this check by our AI provider (Anthropic). Posts with links or contact details may wait for a moderator's review. Photos and videos aren't checked automatically — anyone can report a post.";

/** May moderate Wins, release holds and restrict posting (same list as the API and database). */
export const WINS_MODERATOR_ROLES = ["moderator", "admin_moderation", "admin_supervisor", "super_admin"];
/** May also approve/reject pending P2P Impact submissions. */
export const IMPACT_REVIEWER_ROLES = [...WINS_MODERATOR_ROLES, "admin_content"];
export const isWinsModerator = (role: string | null | undefined) => !!role && WINS_MODERATOR_ROLES.includes(role);

export type RestrictionDuration = "7d" | "30d" | "indefinite";
export const RESTRICTION_DURATIONS: Array<{ value: RestrictionDuration; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "indefinite", label: "Until lifted" },
];
/** ISO end time for a chosen duration; null = until a moderator lifts it. */
export function restrictionExpiry(duration: RestrictionDuration, now = Date.now()): string | null {
  if (duration === "indefinite") return null;
  return new Date(now + (duration === "7d" ? 7 : 30) * 86400e3).toISOString();
}

export function formatUntil(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "until it is lifted";
}

/** Banner for the member's own posting status (never shows the reason). */
export function postingStatusMessage(status: { restricted: boolean; until: string | null } | null): string | null {
  if (!status?.restricted) return null;
  return status.until
    ? `You can't share new Kingdom Wins until ${formatUntil(status.until)}. You can still save drafts, read and encourage others.`
    : "You can't share new Kingdom Wins right now. You can still save drafts, read and encourage others.";
}

/** What to tell the author after saving, from what the server actually did. */
export function shareOutcome(requested: "draft" | "published" | "submitted", saved: { status: string; heldForReview?: boolean }): { title: string; message: string } {
  if (requested === "published" && saved.heldForReview) {
    return { title: "Waiting for review", message: "A moderator will check your story against our community rules before it appears (for example when it includes a link or contact details, or couldn't be checked automatically). It will appear once it's reviewed." };
  }
  if (saved.status === "published") return { title: "Shared!", message: "Your story is now live." };
  if (saved.status === "submitted") return { title: "Submitted for review", message: "A team member will review your story before it's shared with the community." };
  return { title: "Draft saved", message: "You can continue it later from My Stories." };
}
