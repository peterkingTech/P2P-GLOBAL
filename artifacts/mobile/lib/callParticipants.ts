import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "./apiUrl";
import { uidFromUserId } from "./agoraUid";

export interface CallParticipant {
  userId: string;
  uid: number;
  name: string;
}

// Resolves the real identities behind a p2p_ call's joined Agora uids,
// for group calls only (Study Together C1). There is no server-side uid
// registry — uidFromUserId is a pure client-side hash — so this fetches
// the call's authorized participant list (GET /calls/participants) and
// matches each known id's hash against the uids Agora actually reported.
// Only called when there's more than one remote participant; the
// existing 1:1 path never invokes this and keeps using its own
// otherUserId/otherUserName route params unchanged.
export async function resolveCallParticipants(channelName: string, remoteUids: number[]): Promise<CallParticipant[]> {
  if (remoteUids.length === 0) return [];
  try {
    const res = await fetch(`${getApiUrl()}/calls/participants?channelName=${encodeURIComponent(channelName)}`);
    const data = await res.json();
    const ids: string[] = Array.isArray(data.participants) ? data.participants : [];
    const uidToUserId = new Map(ids.map((id) => [uidFromUserId(id), id]));
    const resolvedIds = remoteUids.map((u) => uidToUserId.get(u)).filter((id): id is string => !!id);

    let profileById = new Map<string, { full_name: string }>();
    if (resolvedIds.length) {
      const { data: profiles } = await supabase.from("p2p_profiles").select("id, full_name").in("id", resolvedIds);
      profileById = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p]));
    }

    return remoteUids.map((uid) => {
      const userId = uidToUserId.get(uid);
      const name = userId ? (profileById.get(userId)?.full_name ?? "Someone") : "Someone";
      return { userId: userId ?? "", uid, name };
    });
  } catch {
    return remoteUids.map((uid) => ({ userId: "", uid, name: "Someone" }));
  }
}