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
// Same reasoning as discipleship.ts / prayer.ts: this reads across every
// user's profile/progress and writes notifications for OTHER users
// (peer guide alerts) — needs a service-role client throughout.
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const DAY_MS = 24 * 60 * 60 * 1000;

const DORMANT_SEED_MESSAGES = [
  "A seed knows when it is ready. There is no rush. We are here when you are.",
  "{name}, your journey is waiting whenever you are. No pressure — just an open door.",
  "The roots begin before anything is visible. Your story is still unfolding.",
  "Someone in the network is praying for you today. You are not forgotten.",
  "Whenever you are ready, your peer guide is one step ahead — waiting to walk with you.",
];

interface CareProfile {
  id: string;
  full_name: string | null;
  last_active_at: string | null;
  dormant_seed_opt_in: boolean | null;
  elijah_protocol_sent_at: string | null;
  elijah_rest_until: string | null;
}

async function getActiveCoreCurriculumId(): Promise<string | null> {
  const { data } = await db.rpc("p2p_active_curriculum_id");
  return (data as string) ?? null;
}

async function hasCompletedModule1(userId: string): Promise<boolean> {
  const curriculumId = await getActiveCoreCurriculumId();
  if (!curriculumId) return false;
  const { data: module1 } = await db
    .from("p2p_modules")
    .select("id")
    .eq("curriculum_id", curriculumId)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  const module1Id = (module1 as Record<string, unknown> | null)?.id as string | undefined;
  if (!module1Id) return false;
  const { data: done } = await db.rpc("p2p_module_fully_completed", { p_user_id: userId, p_module_id: module1Id });
  return !!done;
}

async function hasCompletedAnyLesson(userId: string): Promise<boolean> {
  const { count } = await db
    .from("p2p_lesson_progress")
    .select("lesson_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true);
  return (count ?? 0) > 0;
}

export async function getActivePeerGuideId(userId: string): Promise<string | null> {
  const { data } = await db
    .from("p2p_discipleship_links")
    .select("mentor_id")
    .eq("disciple_id", userId)
    .eq("active", true)
    .maybeSingle();
  return (data as Record<string, unknown> | null)?.mentor_id as string | undefined ?? null;
}

// Has the peer guide sent this user a direct message in the last N days? —
// gates the peer-guide-alert tier so we don't nag a guide who already
// reached out on their own.
async function peerGuideRecentlyMessaged(userId: string, peerGuideId: string, sinceDays: number): Promise<boolean> {
  const { data: guideConvos } = await db.from("p2p_conversation_members").select("conversation_id").eq("user_id", peerGuideId);
  const { data: userConvos } = await db.from("p2p_conversation_members").select("conversation_id").eq("user_id", userId);
  const guideIds = new Set((guideConvos ?? []).map((c: Record<string, unknown>) => c.conversation_id as string));
  const sharedIds = (userConvos ?? []).map((c: Record<string, unknown>) => c.conversation_id as string).filter((id) => guideIds.has(id));
  if (sharedIds.length === 0) return false;

  const since = new Date(Date.now() - sinceDays * DAY_MS).toISOString();
  const { count } = await db
    .from("p2p_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", sharedIds)
    .eq("sender_id", peerGuideId)
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

async function lastDormantSeedLog(userId: string): Promise<{ sentAt: string; message: string } | null> {
  const { data } = await db
    .from("p2p_pastoral_care_log")
    .select("sent_at, message_sent")
    .eq("user_id", userId)
    .eq("care_type", "dormant_seed_message")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return { sentAt: row.sent_at as string, message: row.message_sent as string };
}

function pickNextDormantSeedMessage(lastMessageTemplate: string | null, name: string): string {
  const lastIndex = lastMessageTemplate ? DORMANT_SEED_MESSAGES.indexOf(lastMessageTemplate) : -1;
  const nextIndex = (lastIndex + 1) % DORMANT_SEED_MESSAGES.length;
  return DORMANT_SEED_MESSAGES[nextIndex].replace("{name}", name);
}

async function sendDormantSeedMessage(profile: CareProfile): Promise<void> {
  const lastLog = await lastDormantSeedLog(profile.id);
  if (lastLog && Date.now() - new Date(lastLog.sentAt).getTime() < 7 * DAY_MS) return;

  const name = profile.full_name?.split(" ")[0] ?? "Friend";
  const message = pickNextDormantSeedMessage(lastLog?.message ?? null, name);

  await db.from("p2p_notifications").insert({ user_id: profile.id, title: "A gentle word", message });
  await db.from("p2p_pastoral_care_log").insert({ user_id: profile.id, care_type: "dormant_seed_message", message_sent: message });
}

async function sendElijahProtocol(profile: CareProfile): Promise<void> {
  const title = "We noticed you have been quiet";
  const message = "Elijah sat under a tree and said it was enough. The angel did not rebuke him — he fed him. What do you need right now?";

  await db.from("p2p_notifications").insert({ user_id: profile.id, title, message });
  await db.from("p2p_pastoral_care_log").insert({ user_id: profile.id, care_type: "elijah_protocol", message_sent: message });
  await db.from("p2p_profiles").update({ elijah_protocol_sent_at: new Date().toISOString() }).eq("id", profile.id);
}

async function sendPeerGuideAlert(profile: CareProfile, peerGuideId: string): Promise<void> {
  const name = profile.full_name ?? "Your disciple";
  const message = `${name} has been quiet for 21 days. A gentle personal check-in could make all the difference.`;
  await db.from("p2p_notifications").insert({
    user_id: peerGuideId,
    title: "A gentle check-in",
    message,
    notification_type: "pastoral_alert",
    data: { discipleId: profile.id, discipleName: name },
  });
  await db.from("p2p_pastoral_care_log").insert({
    user_id: profile.id,
    care_type: "peer_guide_alert",
    message_sent: message,
    peer_guide_notified: true,
    peer_guide_notified_at: new Date().toISOString(),
    peer_guide_id: peerGuideId,
  });
}

const CRISIS_RING_TIMEOUT_MS = 5 * 60 * 1000;
const ESCALATION_ROLES = ["church_leader", "regional_admin", "super_admin"];

// Cron sweep (see index.ts) — a crisis call that's gone unanswered for 5
// minutes spawns exactly one escalation, to a church-admin-tier profile, on
// the SAME Agora channel so whoever answers joins the person already
// waiting. escalated_from_id both chains and caps this at one hop.
//
// Checks status IN (ringing, missed) rather than just ringing: the incoming
// call screen itself auto-marks a call "missed" client-side after only 30s
// of no answer (see incoming.tsx's RING_TIMEOUT_MS) — that's just the local
// ringing UI giving up, not evidence the crisis was ever actually handled,
// so a 30s-old "missed" row still needs this 5-minute escalation exactly
// like a still-"ringing" one would.
export async function escalateCrisisCalls(): Promise<{ escalated: number }> {
  const cutoff = new Date(Date.now() - CRISIS_RING_TIMEOUT_MS).toISOString();
  const { data: stale } = await db
    .from("p2p_incoming_calls")
    .select("id, channel_name, caller_id, recipient_id, conversation_id, call_log_id")
    .eq("call_type", "crisis")
    .in("status", ["ringing", "missed"])
    .is("escalated_from_id", null)
    .lt("created_at", cutoff);

  let escalated = 0;
  for (const call of stale ?? []) {
    // "escalated", not "missed" — a terminal status distinct from the
    // ringing/missed pair this query matches on, so this exact row can never
    // be picked up by a later tick and re-escalated (that bug produced one
    // duplicate escalation per minute in testing before this fix).
    await db.from("p2p_incoming_calls").update({ status: "escalated", responded_at: new Date().toISOString() }).eq("id", call.id);

    const { data: candidates } = await db
      .from("p2p_profiles")
      .select("id")
      .in("role", ESCALATION_ROLES)
      .neq("id", call.recipient_id as string)
      .neq("id", call.caller_id as string)
      .limit(1);
    const fallbackId = candidates?.[0]?.id as string | undefined;
    if (!fallbackId) continue;

    await db.from("p2p_incoming_calls").insert({
      channel_name: call.channel_name, call_type: "crisis",
      caller_id: call.caller_id, recipient_id: fallbackId, status: "ringing",
      conversation_id: call.conversation_id ?? null, call_log_id: call.call_log_id ?? null,
      escalated_from_id: call.id,
    });
    escalated++;
  }
  return { escalated };
}

export async function detectInactiveUsers(): Promise<{ dormantSeedSent: number; elijahSent: number; peerGuideAlertsSent: number; scanned: number }> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const { data: candidates } = await db
    .from("p2p_profiles")
    .select("id, full_name, last_active_at, dormant_seed_opt_in, elijah_protocol_sent_at, elijah_rest_until")
    .lt("last_active_at", fourteenDaysAgo);

  const profiles = (candidates ?? []) as CareProfile[];
  let dormantSeedSent = 0, elijahSent = 0, peerGuideAlertsSent = 0;

  for (const profile of profiles) {
    const lastActive = profile.last_active_at ? new Date(profile.last_active_at).getTime() : Date.now();
    const daysInactive = Math.floor((Date.now() - lastActive) / DAY_MS);
    const onRest = profile.elijah_rest_until && new Date(profile.elijah_rest_until).getTime() > Date.now();

    try {
      // ── Dormant Seed tier: 14-60 days inactive, never completed Module 1 ──
      if (profile.dormant_seed_opt_in !== false && daysInactive >= 14 && daysInactive <= 60 && daysInactive <= 90) {
        const completedModule1 = await hasCompletedModule1(profile.id);
        if (!completedModule1) {
          await sendDormantSeedMessage(profile);
          dormantSeedSent += 1;
        }
      }

      // ── Elijah Protocol + Peer Guide Alert tiers: 21+ days inactive, has
      // completed at least one lesson before ──
      if (daysInactive >= 21 && !onRest) {
        const alreadySentRecently = profile.elijah_protocol_sent_at
          && Date.now() - new Date(profile.elijah_protocol_sent_at).getTime() < 60 * DAY_MS;
        if (!alreadySentRecently) {
          const hasHistory = await hasCompletedAnyLesson(profile.id);
          if (hasHistory) {
            await sendElijahProtocol(profile);
            elijahSent += 1;

            const peerGuideId = await getActivePeerGuideId(profile.id);
            if (peerGuideId) {
              const guideAlreadyReachedOut = await peerGuideRecentlyMessaged(profile.id, peerGuideId, 7);
              if (!guideAlreadyReachedOut) {
                await sendPeerGuideAlert(profile, peerGuideId);
                peerGuideAlertsSent += 1;
              }
            }
          }
        }
      }
    } catch (e) {
      logger.error({ err: e, userId: profile.id }, "Pastoral care check failed for user");
    }
  }

  return { dormantSeedSent, elijahSent, peerGuideAlertsSent, scanned: profiles.length };
}