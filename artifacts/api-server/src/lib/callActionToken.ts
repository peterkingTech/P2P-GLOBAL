import crypto from "node:crypto";

// A per-call secret that lets the recipient's native call UI (Android
// Telecom notification / iOS CallKit) decline a call without the app's JS —
// and so without a signed-in session — running. It only travels inside the
// incoming-call push to that recipient's own devices, and only authorizes
// moving that one ringing call to "declined" (POST /calls/native-decline).
const SECRET = process.env.CALL_ACTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function declineToken(incomingCallId: string, recipientId: string): string {
  return crypto.createHmac("sha256", SECRET).update(`decline:${incomingCallId}:${recipientId}`).digest("hex");
}

export function verifyDeclineToken(incomingCallId: string, recipientId: string, token: string): boolean {
  if (!SECRET || !token) return false;
  const expected = Buffer.from(declineToken(incomingCallId, recipientId));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
