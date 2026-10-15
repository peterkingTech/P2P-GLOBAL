// Who a notification is "from", for the Notification Center's identity
// layout. Only types whose creating code stores the acting person's id are
// listed — each was checked at its source. Every other type is a system
// event and gets the P2P Global identity in the app; a sender is never
// guessed from other fields (several types store the RECIPIENT's or a
// subject's id, e.g. pastoral_alert.discipleId).
export const NOTIFICATION_ACTOR_FIELD: Readonly<Record<string, string>> = {
  new_message: "senderId",            // migration 104 trigger p2p_notify_on_new_message
  incoming_call: "callerId",          // routes/calls.ts (callNotification)
  missed_call: "callerId",            // lib/callSweep.ts
  peer_guide_request: "learnerId",    // routes/discipleship.ts — the learner who asked
  connection_request: "fromUserId",   // routes/connections.ts
  connection_accepted: "responderId", // routes/connections.ts
  connection_declined: "responderId", // routes/connections.ts
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The acting person's id for this notification, or null (system event / unknown). */
export function notificationActorId(notificationType: string | null | undefined, data: Record<string, unknown> | null | undefined): string | null {
  const field = notificationType ? NOTIFICATION_ACTOR_FIELD[notificationType] : undefined;
  const value = field ? data?.[field] : undefined;
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}
