// Kingdom Wins moderation policy (migration 189) — the API-side mirror of the
// database allowlists. The database is authoritative: these lists only decide
// which routes a role may reach and which friendly message to show.

/** May moderate other people's Wins, resolve Wins reports, release screening holds and restrict posting. */
export const WINS_MODERATOR_ROLES = ["moderator", "admin_moderation", "admin_supervisor", "super_admin"] as const;
/** May also approve/reject pending P2P Impact submissions (admin_content: the designated P2P Impact reviewer). */
export const IMPACT_REVIEWER_ROLES = [...WINS_MODERATOR_ROLES, "admin_content"] as const;

export const isWinsModeratorRole = (role: string | null | undefined) => !!role && (WINS_MODERATOR_ROLES as readonly string[]).includes(role);
export const isImpactReviewerRole = (role: string | null | undefined) => !!role && (IMPACT_REVIEWER_ROLES as readonly string[]).includes(role);

// Refusals raised by migration 189 (SQLSTATE W04xx; the message is the key).
export const WINS_DB_MESSAGES: Record<string, string> = {
  wins_unauthenticated: "Sign in again to continue.",
  wins_forbidden: "Your role cannot moderate Kingdom Wins.",
  wins_not_owner: "You can only post and edit as yourself.",
  wins_invalid_status: "That status is not allowed.",
  wins_invalid_transition: "That change is not allowed for this entry.",
  wins_removed_locked: "This entry was removed by a moderator and can't be changed. You can still delete it.",
  wins_moderation_fields: "Only moderators can change moderation details.",
  wins_moderator_content_edit: "Moderators can change an entry's status, not its content.",
  wins_resubmit_for_review: "This entry wasn't approved. Revise it and submit it for review.",
  wins_held_for_review: "This entry is waiting for a moderator's review.",
  wins_impact_requires_review: "P2P Impact stories are reviewed before they're shared. Submit it for review instead.",
  wins_consent_required: "Please confirm the consent statement before sharing this testimony.",
  wins_media_not_owned: "That media file doesn't belong to this entry.",
  wins_link_not_owned: "You can only link your own Prayer 2.0 request.",
  wins_posting_restricted: "You can't share Kingdom Wins right now because of a posting restriction.",
  wins_cannot_restrict_self: "You can't restrict your own account.",
  wins_cannot_restrict_moderator: "Only a super admin can restrict another moderator.",
  wins_user_missing: "That member could not be found.",
  wins_reason_required: "Please give a reason (3–1000 characters).",
  wins_invalid_expiry: "Choose an end time between one minute and five years from now, or no end time.",
  wins_restriction_missing: "That restriction could not be found.",
  wins_restriction_not_active: "That restriction has already ended.",
  wins_restriction_immutable: "That restriction can no longer be changed.",
};
/** Screening rejections: "wins_content_rejected:<category>". */
export const CONTENT_REJECTED_MESSAGES: Record<string, string> = {
  advertising: "Kingdom Wins can't include advertising or commercial promotion.",
  fundraising: "Kingdom Wins can't include fundraising or donation requests.",
  payment: "Kingdom Wins can't include payment details, account numbers or money-transfer instructions.",
  money_scheme: "Kingdom Wins can't promote investments or money-making schemes.",
  scam: "This looks like a common scam pattern, so it can't be shared.",
  policy: "This can't be shared under the Kingdom Wins community rules.",
};
const STATUS: Record<string, number> = { W0401: 401, W0403: 403, W0404: 404, W0409: 409, W0422: 422, W0423: 403 };

/** Maps a migration 189 refusal to { status, error, code }; null for any other error. */
export function winsDbRefusal(error: { code?: string; message?: string } | null | undefined): { status: number; error: string; code: string } | null {
  if (!error?.code || !(error.code in STATUS)) return null;
  const key = error.message ?? "";
  if (key.startsWith("wins_content_rejected:")) {
    const category = key.slice("wins_content_rejected:".length);
    return { status: 422, error: CONTENT_REJECTED_MESSAGES[category] ?? CONTENT_REJECTED_MESSAGES.policy, code: "wins_content_rejected" };
  }
  return { status: STATUS[error.code], error: WINS_DB_MESSAGES[key] ?? "This change isn't allowed.", code: key };
}
