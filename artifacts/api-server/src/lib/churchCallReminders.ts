import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Cron sweep (see index.ts) — Stage 3's "reminders" requirement, reusing
// the exact same idempotent-update-as-dedup-guard pattern
// churchAnnouncements.ts's publishScheduledAnnouncements() already
// established (eq(...).is(reminder_sent_at, null) here, in place of that
// function's eq(status, 'scheduled') — same shape, a nullable timestamp
// instead of a status column, since "reminder sent" isn't itself a call
// status transition). No new scheduling service, no duplicate dispatch:
// once a call's reminder_sent_at is set, this sweep will never consider
// it again, even if two ticks race (the second tick's conditional update
// simply matches zero rows).
export async function sendDueChurchCallReminders(): Promise<{ reminded: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const { data: due } = await db
    .from("p2p_church_calls")
    .select("id, church_id, title, purpose, scheduled_start_at, cohort_id, scope")
    .eq("status", "scheduled")
    .is("reminder_sent_at", null)
    .gte("scheduled_start_at", now.toISOString())
    .lte("scheduled_start_at", windowEnd);

  let reminded = 0;
  for (const call of due ?? []) {
    const { error, count } = await db
      .from("p2p_church_calls")
      .update({ reminder_sent_at: now.toISOString() }, { count: "exact" })
      .eq("id", call.id as string).is("reminder_sent_at", null);
    if (error || !count) continue; // another tick already claimed it
    reminded++;

    const recipientIds = call.scope === "cohort" && call.cohort_id
      ? (await db.from("p2p_church_cohort_members").select("user_id").eq("cohort_id", call.cohort_id as string).eq("status", "active")).data?.map((m) => m.user_id as string) ?? []
      : (await db.from("p2p_church_members").select("user_id").eq("church_id", call.church_id as string).eq("is_active", true)).data?.map((m) => m.user_id as string) ?? [];
    if (recipientIds.length) {
      await db.from("p2p_notifications").insert(
        recipientIds.map((id) => ({
          user_id: id, title: "⏰ Church Call reminder",
          message: `"${call.title}" starts in 15 minutes.`,
          notification_type: "church_call_reminder",
          data: { callId: call.id, churchId: call.church_id },
        }))
      );
    }
  }
  return { reminded };
}
