import { supabase } from "@/contexts/AuthContext";

// "Show sender's name in message notifications" (migration 193,
// p2p_profiles.notify_show_sender_name). Read and written on its own —
// deliberately NOT part of AuthContext's PROFILE_COLUMNS — so an app build
// that reaches people before the migration is applied still loads profiles
// normally; until then this setting simply isn't offered.

export type PreviewSettingState = { available: false } | { available: true; showSenderName: boolean };

export async function loadPreviewSetting(userId: string): Promise<PreviewSettingState> {
  const { data, error } = await supabase.from("p2p_profiles").select("notify_show_sender_name").eq("id", userId).maybeSingle();
  if (error || !data || typeof (data as Record<string, unknown>).notify_show_sender_name !== "boolean") return { available: false };
  return { available: true, showSenderName: (data as { notify_show_sender_name: boolean }).notify_show_sender_name };
}

export async function savePreviewSetting(userId: string, showSenderName: boolean): Promise<boolean> {
  const { error } = await supabase.from("p2p_profiles").update({ notify_show_sender_name: showSenderName }).eq("id", userId);
  return !error;
}
