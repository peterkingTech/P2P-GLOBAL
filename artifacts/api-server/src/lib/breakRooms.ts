import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MODERATOR_ROLES = ["moderator", "regional_admin", "super_admin", "church_leader"];
const DAILY_NOTIFICATION_CAP = 2;
const MAX_INTEREST_NOTIFY_RECIPIENTS = 200;

// Cron sweep (see index.ts) — Agora RTC has no server-side "end this call for
// everyone" call; the room row's is_live flag is the actual source of truth
// clients respect (room.tsx watches it over realtime and leaves when it
// flips), so ending a room here IS ending the call.
export async function sweepBreakRooms(): Promise<{ endedForTimeLimit: number; endedForAbandonment: number }> {
  const now = Date.now();
  let endedForTimeLimit = 0;
  let endedForAbandonment = 0;

  const { data: liveRooms } = await db
    .from("p2p_break_rooms")
    .select("id, host_id, created_at")
    .eq("is_live", true);

  for (const room of liveRooms ?? []) {
    const ageMs = now - new Date(room.created_at as string).getTime();
    if (ageMs > THREE_HOURS_MS) {
      await endRoom(room.id as string);
      endedForTimeLimit++;
      continue;
    }

    const { data: hostRow } = await db
      .from("p2p_break_room_participants")
      .select("left_at")
      .eq("room_id", room.id)
      .eq("user_id", room.host_id)
      .maybeSingle();

    if (hostRow?.left_at && now - new Date(hostRow.left_at as string).getTime() > FIVE_MINUTES_MS) {
      await endRoom(room.id as string);
      endedForAbandonment++;
    }
  }

  return { endedForTimeLimit, endedForAbandonment };
}

async function endRoom(roomId: string) {
  await db.from("p2p_break_rooms").update({ is_live: false, ended_at: new Date().toISOString() }).eq("id", roomId);
}

export async function notifyModerators(roomId: string, roomName: string, flagCount: number) {
  const { data: moderators } = await db.from("p2p_profiles").select("id").in("role", MODERATOR_ROLES);
  if (!moderators || moderators.length === 0) return;
  await db.from("p2p_notifications").insert(
    moderators.map((m) => ({
      user_id: m.id,
      title: "Break Room flagged for review",
      message: `"${roomName}" has received ${flagCount} reports and was auto-ended.`,
      notification_type: "break_room_flagged",
      data: { roomId },
    }))
  );
}

// Interest-matched "a room you might care about just opened" notifications —
// matched via completed/in-progress lessons in plans tagged with the room's
// category (p2p_curriculums.tags, see migrations/054_plan_categories.sql).
// No dedicated "interests" field exists on p2p_profiles, so lesson history is
// the closest real signal available. Skipped entirely for rooms with no
// category (open/custom rooms) — there's no sensible audience to compute.
// Best-effort: failures here must never block room creation.
export async function notifyInterestedUsers(room: { id: string; name: string; category: string | null; channelName: string }) {
  if (!room.category) return;
  try {
    const { data: curriculums } = await db.from("p2p_curriculums").select("id").contains("tags", [room.category]);
    const curriculumIds = (curriculums ?? []).map((c) => c.id as string);
    if (curriculumIds.length === 0) return;

    const { data: modules } = await db.from("p2p_modules").select("id").in("curriculum_id", curriculumIds);
    const moduleIds = (modules ?? []).map((m) => m.id as string);
    if (moduleIds.length === 0) return;

    const { data: lessons } = await db.from("p2p_lessons").select("id").in("module_id", moduleIds);
    const lessonIds = (lessons ?? []).map((l) => l.id as string);
    if (lessonIds.length === 0) return;

    const { data: progressRows } = await db
      .from("p2p_lesson_progress")
      .select("user_id")
      .in("lesson_id", lessonIds)
      .limit(2000);
    const candidateIds = Array.from(new Set((progressRows ?? []).map((p) => p.user_id as string))).slice(0, MAX_INTEREST_NOTIFY_RECIPIENTS);
    if (candidateIds.length === 0) return;

    const { data: eligibleProfiles } = await db
      .from("p2p_profiles")
      .select("id")
      .in("id", candidateIds)
      .eq("notify_break_rooms", true);
    if (!eligibleProfiles || eligibleProfiles.length === 0) return;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data: sentToday } = await db
      .from("p2p_notifications")
      .select("user_id")
      .eq("notification_type", "break_room_open")
      .gte("created_at", startOfToday.toISOString())
      .in("user_id", eligibleProfiles.map((p) => p.id as string));
    const sentCountByUser = new Map<string, number>();
    for (const row of sentToday ?? []) {
      const uid = row.user_id as string;
      sentCountByUser.set(uid, (sentCountByUser.get(uid) ?? 0) + 1);
    }

    const recipients = eligibleProfiles
      .map((p) => p.id as string)
      .filter((id) => (sentCountByUser.get(id) ?? 0) < DAILY_NOTIFICATION_CAP);
    if (recipients.length === 0) return;

    await db.from("p2p_notifications").insert(
      recipients.map((userId) => ({
        user_id: userId,
        title: `${room.name} is live`,
        message: "A Break Room in a topic you've studied just opened.",
        notification_type: "break_room_open",
        data: { roomId: room.id, channelName: room.channelName, roomName: room.name },
      }))
    );
  } catch (err) {
    logger.error({ err }, "notifyInterestedUsers failed (non-fatal, room creation already succeeded)");
  }
}