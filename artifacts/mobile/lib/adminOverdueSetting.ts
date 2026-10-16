import { supabase } from "@/contexts/AuthContext";

// Super admins: phone alerts for overdue reminders (contact messages unread
// for 24+ hours, overdue admin reports) — migration 196,
// p2p_profiles.notify_admin_overdue. The SERVER enforces it when it sends
// pushes (api-server lib/notificationCategories.ts); the reminder still
// appears in the in-app Notification Center either way.
//
// Read and written on its own — NOT part of AuthContext's PROFILE_COLUMNS —
// so profiles still load on a database without 196 (the switch is then
// simply not offered).

export type AdminOverdueState = { available: false } | { available: true; on: boolean };

export async function loadAdminOverdueSetting(userId: string): Promise<AdminOverdueState> {
  const { data, error } = await supabase.from("p2p_profiles").select("notify_admin_overdue").eq("id", userId).maybeSingle();
  if (error || !data) return { available: false };
  const v = (data as Record<string, unknown>).notify_admin_overdue;
  return { available: true, on: v !== false };
}

/** Saves the caller's own switch. */
export async function saveAdminOverdueSetting(userId: string, on: boolean): Promise<boolean> {
  const { error } = await supabase.from("p2p_profiles").update({ notify_admin_overdue: on }).eq("id", userId);
  return !error;
}
