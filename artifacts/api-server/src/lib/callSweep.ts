import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";
import { dispatchNotificationNow } from "./pushDispatch";

// Server-side end of an unanswered 1:1 call.
//
// Normally a ringing call is settled by one of the two phones: the
// recipient's ringing screen marks it "missed" after 30s, and the caller's
// screen reports /calls/end. If neither app is alive to do that (both
// backgrounded/closed, no network), the call used to stay "ringing" and
// "initiated" forever. sweepUnansweredCalls settles it from here instead.
//
// Crisis calls are excluded: pastoralCare.ts's escalateCrisisCalls owns
// their unanswered path (escalation after 5 minutes).

// incoming.tsx rings for 30s; the extra 15s lets a phone that's still alive
// settle the call itself first, so this only catches the orphaned ones.
const UNANSWERED_AFTER_MS = 45000;
// A row older than this was abandoned long ago (e.g. before this sweep
// existed) — settle it quietly, without a "missed call" notification for a
// call from days ago.
const NOTIFY_WITHIN_MS = 10 * 60 * 1000;

const CALL_LABEL: Record<string, string> = { audio: "Audio call", video: "Video call", pastoral: "Pastoral check-in" };

/**
 * "Missed video call from Peter" for the recipient. Callers must only call
 * this from the one write that moved the call log out of "initiated", so a
 * missed call is announced exactly once however many paths settle it.
 */
export async function notifyMissedCall(opts: {
  recipientId: string; callerId: string; callType: string; callLogId: string; conversationId: string | null;
}): Promise<void> {
  const { data: caller } = await db.from("p2p_profiles").select("full_name").eq("id", opts.callerId).maybeSingle();
  const callerName = (caller?.full_name as string | undefined) ?? "Someone";
  const kind = opts.callType === "video" ? "video call" : "call";
  const { data: row, error } = await db.from("p2p_notifications").insert({
    user_id: opts.recipientId,
    title: `Missed ${kind}`,
    message: `${opts.callType === "video" ? "📹" : "📞"} Missed ${kind} from ${callerName}`,
    notification_type: "missed_call",
    data: {
      callLogId: opts.callLogId, callerId: opts.callerId, callerName,
      callType: opts.callType, conversationId: opts.conversationId,
    },
  }).select("id").single();
  if (error || !row) {
    logger.error({ err: error, callLogId: opts.callLogId }, "notifyMissedCall: insert failed");
    return;
  }
  void dispatchNotificationNow(row.id as string).catch(() => { /* the cron retries it */ });
}

export async function sweepUnansweredCalls(): Promise<{ settled: number; notified: number }> {
  const cutoff = new Date(Date.now() - UNANSWERED_AFTER_MS).toISOString();
  const { data: stale, error } = await db
    .from("p2p_incoming_calls")
    .select("id, call_type, caller_id, recipient_id, conversation_id, call_log_id, created_at")
    .eq("status", "ringing")
    .neq("call_type", "crisis")
    .lt("created_at", cutoff)
    .limit(50);
  if (error) {
    logger.error({ err: error }, "sweepUnansweredCalls: query failed");
    return { settled: 0, notified: 0 };
  }

  let settled = 0, notified = 0;
  for (const call of stale ?? []) {
    const now = new Date().toISOString();
    // Guarded on "ringing": a phone that answered/declined in the meantime wins.
    const { data: moved } = await db.from("p2p_incoming_calls")
      .update({ status: "missed", responded_at: now })
      .eq("id", call.id).eq("status", "ringing").select("id");
    if (!moved?.length) continue;
    settled++;
    if (!call.call_log_id) continue;

    // Guarded on "initiated": if the caller's /calls/end already settled the
    // log, it also already posted the summary and the missed-call notice.
    const { data: log } = await db.from("p2p_call_logs")
      .update({ status: "missed", ended_at: now, duration_seconds: 0 })
      .eq("id", call.call_log_id).eq("status", "initiated")
      .select("id, initiated_by").maybeSingle();
    if (!log) continue;

    const recent = Date.now() - new Date(call.created_at as string).getTime() < NOTIFY_WITHIN_MS;
    if (!recent) continue;

    if (call.conversation_id) {
      const icon = call.call_type === "video" ? "📹" : "📞";
      const { error: msgErr } = await db.from("p2p_messages").insert({
        conversation_id: call.conversation_id, sender_id: log.initiated_by,
        body: `${icon} ${CALL_LABEL[call.call_type as string] ?? "Call"} · No answer`,
        message_type: "call_summary", call_log_id: call.call_log_id,
      });
      // 23505: the summary already exists (migration 102's unique index).
      if (msgErr && (msgErr as { code?: string }).code !== "23505") {
        logger.error({ err: msgErr, callLogId: call.call_log_id }, "sweepUnansweredCalls: summary insert failed");
      }
    }
    await notifyMissedCall({
      recipientId: call.recipient_id as string, callerId: call.caller_id as string,
      callType: call.call_type as string, callLogId: call.call_log_id as string,
      conversationId: (call.conversation_id as string | null) ?? null,
    });
    notified++;
  }
  return { settled, notified };
}
