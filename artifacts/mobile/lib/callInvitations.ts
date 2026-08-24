import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "./apiUrl";

// Study Together C2 — Add People + Invitations. Unlike almost every other
// endpoint in this app, the invitation endpoints verify the caller's real
// Supabase session server-side (never a body-supplied id), so every call
// here attaches the current access token. See calls.ts's verifyCaller for
// the server side of this.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface InviteablePerson {
  userId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  relationship: "peer_guide" | "disciple" | "connection";
  invitationPending: boolean;
}

export async function getInviteablePeople(callId: string): Promise<InviteablePerson[]> {
  const res = await fetch(`${getApiUrl()}/calls/${callId}/inviteable-people`, { headers: await authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't load eligible people");
  return data.people ?? [];
}

export async function sendCallInvitation(callId: string, inviteeId: string): Promise<{ invitationId: string }> {
  const res = await fetch(`${getApiUrl()}/calls/${callId}/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ inviteeId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unable to invite this person.");
  return data;
}

export interface AcceptedInvitation {
  channelName: string;
  callLogId: string;
  callType: string;
  conversationId: string | null;
}

export async function acceptCallInvitation(invitationId: string): Promise<AcceptedInvitation> {
  const res = await fetch(`${getApiUrl()}/calls/invitations/${invitationId}/accept`, {
    method: "POST",
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unable to join this call.");
  return data;
}

export async function declineCallInvitation(invitationId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/calls/invitations/${invitationId}/decline`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Unable to decline this invitation.");
  }
}