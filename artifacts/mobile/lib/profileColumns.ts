// Columns of p2p_profiles the app may read directly (Supabase client).
// Everything except the owner-only fields — email, date_of_birth, latitude,
// longitude, location_point and send_read_receipts — which signed-in users
// cannot read for anyone, themselves included (migration 185 grants exactly
// the other columns). The user's OWN private fields come from functions:
// email/date_of_birth from p2p_my_private_profile(), coordinates from
// p2p_my_coordinates(), the read-receipt preference from
// p2p_get_my_read_receipts(). A column added to p2p_profiles is not readable
// from the app until it is granted. Never use select("*") on p2p_profiles.
export const PROFILE_COLUMNS = `  id,full_name,photo_url,role,country,language,church_id,created_at,streak_days,
  last_active_date,app_language,content_language,growth_level,gifts,is_praying,
  servant_score,wisdom_points,evaluations_completed,bio,notifications_enabled,
  notify_prayer,notify_messages,notify_groups,profile_visibility,region,skills,
  mission,calling,occupation,onboarding_journey_completed_at,tree_name,
  greeting_to_peer_guide,story_answers,is_peer_guide_eligible,max_mentees,
  accepting_mentees,timezone,background_sensitivity,city,elijah_protocol_sent_at,
  dormant_seed_opt_in,last_active_at,elijah_rest_until,curriculum_completed_at,
  notify_session_reminders,notify_peer_guide_alerts,notify_fruit_awards,
  notify_weekly_encouragement,notify_elijah_checkins,visible_to_church_leadership,
  show_country_on_profile,analytics_opt_out,date_format,preferred_session_length,
  reminder_day,morning_confession_enabled,morning_confession_time,
  prayer_journal_reminder_enabled,country_code,location_verified,location_verified_at,
  notify_break_rooms,username,username_changed_at,username_previous,
  username_previous_held_until,show_real_name_publicly,show_progress_publicly,
  username_change_required,is_verified,verification_status,verification_method,
  verification_submitted_at,verification_reviewed_at,verification_reviewed_by,
  verification_decline_reason,verification_approved_at,verification_badge_visible,
  can_reapply_at,grain_count,is_official_account,official_account_type,
  official_account_label,admin_zone,admin_country,admin_appointed_by,admin_appointed_at,
  admin_appointment_reason,admin_is_active,admin_last_active_at,ministry_role,
  ministry_role_updated_at,app_style_id,app_style_mode,app_style_illustration_level,
  app_style_favorites,tree_growth_score,tree_environment_preference,tree_reduced_motion`.replace(/\s+/g, "");

/** Owner-only columns: never selected directly by the app. */
export const PRIVATE_PROFILE_COLUMNS = ["email", "date_of_birth", "latitude", "longitude", "location_point", "send_read_receipts"] as const;

type RpcError = { code?: string } | null | undefined;
/** True when a function is not deployed yet (server older than the app). */
export function isMissingFunction(error: RpcError): boolean {
  return ["PGRST202", "42883"].includes(error?.code ?? "");
}
