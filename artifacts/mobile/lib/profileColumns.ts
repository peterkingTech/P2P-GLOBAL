// Columns of p2p_profiles the app may read directly (Supabase client).
// Everything except latitude, longitude and location_point: other people's
// coordinates are never readable from the app (migration 178 grants exactly
// these columns), and the user's own coordinates come from the
// p2p_my_coordinates() RPC. Keep in sync with migration 178 — a column added
// to p2p_profiles must be granted there AND listed here before the app can
// read it. Never use select("*") on p2p_profiles.
export const PROFILE_COLUMNS = `  id,email,full_name,photo_url,role,country,language,church_id,created_at,streak_days,
  last_active_date,app_language,content_language,growth_level,gifts,is_praying,
  servant_score,wisdom_points,evaluations_completed,bio,notifications_enabled,
  notify_prayer,notify_messages,notify_groups,profile_visibility,region,skills,
  date_of_birth,mission,calling,occupation,onboarding_journey_completed_at,tree_name,
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
  app_style_favorites,tree_growth_score,tree_environment_preference,tree_reduced_motion`.replace(/s+/g, "");
