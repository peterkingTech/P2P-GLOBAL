// Push categories — the ONE map from a p2p_notifications.notification_type
// to the user preference that may silence its PHONE alert.
//
// Rules:
//   • A preference only stops the push. The notification row is still
//     created and stays in the in-app Notification Center (unread), so
//     turning a category off never loses anything.
//   • "always" categories can't be switched off: ringing calls and missed
//     calls, safety / account / moderation outcomes, admin operations.
//   • A type not listed here (and any untyped row) is "always" — exactly
//     the old behaviour, never a silently dropped alert. Migration 196 gives
//     the database triggers' notifications their types.
//   • The master switch (notifications_enabled = false) silences every
//     switchable category at once; "always" alerts still come through.
//   • Each switchable category uses a p2p_profiles column: the existing
//     ones from migrations 012 / 053 / 061, plus notify_admin_overdue
//     (migration 196, super admins' overdue reminders).

export type PushCategory =
  | "messages" | "community" | "prayer" | "sessions" | "peer_guide"
  | "fruit" | "encouragement" | "checkins" | "break_rooms" | "admin_overdue" | "always";

/** The profile column that switches a category's pushes on/off. */
export const CATEGORY_PREFERENCE_COLUMN: Record<Exclude<PushCategory, "always">, string> = {
  messages: "notify_messages",
  community: "notify_groups",
  prayer: "notify_prayer",
  sessions: "notify_session_reminders",
  peer_guide: "notify_peer_guide_alerts",
  fruit: "notify_fruit_awards",
  encouragement: "notify_weekly_encouragement",
  checkins: "notify_elijah_checkins",
  break_rooms: "notify_break_rooms",
  admin_overdue: "notify_admin_overdue",
};

/** Master switch: false silences every switchable category. */
export const MASTER_PREFERENCE_COLUMN = "notifications_enabled";
/** Added by migration 196 — the lookup works without it before 196 is applied. */
export const MIGRATION_196_COLUMNS: readonly string[] = ["notify_admin_overdue"];

export const PREFERENCE_COLUMNS: readonly string[] = [MASTER_PREFERENCE_COLUMN, ...Object.values(CATEGORY_PREFERENCE_COLUMN)];

const TYPE_CATEGORY: Record<string, PushCategory> = {
  // Messages
  new_message: "messages",
  official_message_received: "messages",
  contact_message_received: "messages",
  contact_message_replied: "messages",

  // Calls — always ring / always report a missed call
  incoming_call: "always",
  missed_call: "always",
  church_call_started: "always",

  // Community: connections, circles, family, church, Study Together
  connection_request: "community",
  connection_accepted: "community",
  connection_declined: "community",
  family_invitation: "community",
  family_join_request: "community",
  family_join_approved: "community",
  family_worship_invite: "community",
  church_announcement: "community",
  study_invitation_received: "community",
  study_invitation_accepted: "community",
  study_invitation_declined: "community",
  study_leader_transfer: "community",
  study_participant_removed: "community",
  study_ended: "community",
  circle_member_added: "community",
  circle_member_removed: "community",
  circle_leader_transfer: "community",
  circle_evaluation_resolved: "community", // migration 196 (p2p_process_circle_evaluation)

  // Prayer coordination
  prayer_invitation_received: "prayer",
  prayer_invitation_accepted: "prayer",
  prayer_invitation_declined: "prayer",
  prayer_invitation_cancelled: "prayer",
  prayer_gathering_ready: "prayer",
  prayer_gathering_cancelled: "prayer",
  prayer_confirmation_request: "prayer", // migration 196 ("Someone prayed for you")

  // Reminders for scheduled sessions
  church_call_reminder: "sessions",
  circle_session_start: "sessions",
  session_confirmation_request: "sessions", // migration 196

  // Peer guide / discipleship relationship
  peer_guide_request: "peer_guide",
  peer_guide_request_accepted: "peer_guide",
  peer_guide_request_declined: "peer_guide",
  pastoral_alert: "peer_guide",
  peer_guide_update: "peer_guide",
  peer_guide_match: "peer_guide",
  prayer_of_commitment: "peer_guide",
  // migration 196 — lessons, evaluations, peer confirmations
  lesson_submitted: "peer_guide",
  lesson_completed: "peer_guide",
  evaluation_waiting: "peer_guide",
  evaluation_resolved: "peer_guide",
  encouragement_confirmation_request: "peer_guide",
  peer_confirmation_confirmed: "peer_guide",

  // Awards
  grain_earned: "fruit",
  fruit_awarded: "fruit", // migration 196 (p2p_award_fruit)

  // Pastoral care nudges (lib/pastoralCare.ts)
  pastoral_gentle_word: "encouragement",
  elijah_checkin: "checkins",

  // Break Rooms
  break_room_open: "break_rooms",

  // Super admins: overdue reminders (their own switch)
  contact_message_overdue: "admin_overdue",
  admin_report_overdue: "admin_overdue",

  // Always: account, safety, moderation, admin operations
  help_request: "always", // migration 196 (p2p_notify_on_help_request)
  crisis_help_request: "always", // migration 196
  church_member_removed: "always",
  verification_submitted: "always",
  verification_admin_alert: "always",
  kingdom_win_moderation: "always",
  feedback_request: "always",
  contact_feedback_request: "always",
  admin_appointed: "always",
  admin_removed: "always",
  admin_report_ready: "always",
  admin_report_submitted: "always",
  admin_feedback_flagged: "always",
  super_admin_daily_digest: "always",
  break_room_flagged: "always",
};

export function pushCategoryFor(type: string | null | undefined): PushCategory {
  return type && Object.prototype.hasOwnProperty.call(TYPE_CATEGORY, type) ? TYPE_CATEGORY[type] : "always";
}

/** Every type this map knows (for coverage tests). */
export const KNOWN_NOTIFICATION_TYPES: readonly string[] = Object.keys(TYPE_CATEGORY);

/**
 * True when this user's preferences say: no phone alert for this type.
 * `prefs` is the user's profile row (only the preference columns); a missing
 * row or a column that isn't false means "send" (fail open = today's behaviour).
 */
export function isPushMuted(type: string | null | undefined, prefs: Record<string, unknown> | undefined): boolean {
  const cat = pushCategoryFor(type);
  if (cat === "always" || !prefs) return false;
  return prefs[MASTER_PREFERENCE_COLUMN] === false || prefs[CATEGORY_PREFERENCE_COLUMN[cat]] === false;
}
