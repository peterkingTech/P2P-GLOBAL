import { supabase } from "@/contexts/AuthContext";

// Message notification privacy — four levels (migrations 194 + 195,
// p2p_profiles.notify_message_preview). The SERVER enforces it when it builds
// each push and when the iPhone extension asks for a preview; this screen only
// stores the choice.
//
//   'full' Name and message — the banner shows the message; on iPhone,
//          press and hold to read it all or play a voice note.
//   'hold' Name, reveal message on hold (migration 195) — the banner shows
//          only who it's from; on iPhone, press and hold to reveal the
//          message or play a voice note.
//   'name' Name only (default) — who it's from, never what it says.
//   'none' Nothing — "P2P Global — New message", no name or photo.
//
// Read and written on its own — deliberately NOT part of AuthContext's
// PROFILE_COLUMNS — so profiles still load on a database without 194/193.
// Before 194 it falls back to 193's on/off switch (on = Name only, off =
// Nothing); with neither column, the setting simply isn't offered.

export type PreviewLevel = "full" | "hold" | "name" | "none";
export const PREVIEW_LEVELS: { value: PreviewLevel; label: string; desc: string }[] = [
  { value: "full", label: "Name and message", desc: "Shows who it's from and the message. On iPhone, press and hold a notification to read it all or play a voice note. Your phone's own lock-screen setting still applies." },
  { value: "hold", label: "Name, reveal message on hold", desc: "Shows only who it's from. On iPhone, press and hold the notification to reveal the message or play a voice note. Your phone's own lock-screen setting still applies." },
  { value: "name", label: "Name only", desc: "Shows who it's from, but never what they said." },
  { value: "none", label: "Nothing", desc: "Shows only \"P2P Global — New message\": no name, photo or message." },
];

export type PreviewSettingState =
  | { available: false }
  | { available: true; level: PreviewLevel; source: "level" | "legacy" };

const isLevel = (v: unknown): v is PreviewLevel => v === "full" || v === "hold" || v === "name" || v === "none";

export async function loadPreviewSetting(userId: string): Promise<PreviewSettingState> {
  const lvl = await supabase.from("p2p_profiles").select("notify_message_preview").eq("id", userId).maybeSingle();
  if (!lvl.error && lvl.data) {
    const v = (lvl.data as Record<string, unknown>).notify_message_preview;
    return { available: true, level: isLevel(v) ? v : "name", source: "level" };
  }
  const old = await supabase.from("p2p_profiles").select("notify_show_sender_name").eq("id", userId).maybeSingle();
  if (old.error || !old.data || typeof (old.data as Record<string, unknown>).notify_show_sender_name !== "boolean") return { available: false };
  return { available: true, level: (old.data as { notify_show_sender_name: boolean }).notify_show_sender_name ? "name" : "none", source: "legacy" };
}

/**
 * Saves the caller's own choice. Before 194 only Name only / Nothing exist;
 * before 195 the database refuses 'hold' (the screen then restores the
 * previous choice).
 */
export async function savePreviewSetting(userId: string, state: { level: PreviewLevel; source: "level" | "legacy" }): Promise<boolean> {
  if (state.source === "legacy") {
    if (state.level === "full" || state.level === "hold") return false;
    const { error } = await supabase.from("p2p_profiles").update({ notify_show_sender_name: state.level !== "none" }).eq("id", userId);
    return !error;
  }
  const { error } = await supabase.from("p2p_profiles").update({ notify_message_preview: state.level }).eq("id", userId);
  return !error;
}
