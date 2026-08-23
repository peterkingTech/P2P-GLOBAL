import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiUrl } from "./apiUrl";

// The peer-channel -> p2p_start_direct_conversation -> calls/start sequence
// used to live copy-pasted in my-discipleship/disciple/[discipleId].tsx,
// admin/help-requests.tsx, and admin/help-mail/[helpRequestId].tsx (compared
// side by side — the only differences were cosmetic: call ordering and which
// alert mechanism to use, neither security-relevant since /calls/peer-channel
// is a pure, side-effect-free computation). This is the one shared network
// sequence; callers still own navigation and any extra side effects (e.g.
// linking a conversation to a help request) so timing there is unaffected.

export interface StartPeerCallArgs {
  supabase: SupabaseClient;
  currentUserId: string;
  otherUserId: string;
  callType?: "audio" | "video";
  onAlert: (title: string, message: string) => void;
}

export interface StartPeerCallResult {
  channelName: string;
  conversationId: string;
  callLogId: string;
  incomingCallId: string;
}

export async function startPeerCall(args: StartPeerCallArgs): Promise<StartPeerCallResult | null> {
  const { supabase, currentUserId, otherUserId, callType = "audio", onAlert } = args;
  try {
    const apiUrl = getApiUrl();
    const channelRes = await fetch(`${apiUrl}/calls/peer-channel`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentUserId, otherUserId }),
    });
    const channelData = await channelRes.json();
    if (!channelRes.ok) throw new Error(channelData.error || "Failed to start call");
    const channelName = channelData.channelName as string;

    const { data: conversationId, error: convErr } = await supabase.rpc(
      "p2p_start_direct_conversation", { target_id: otherUserId }
    );
    if (convErr || !conversationId) throw new Error(convErr?.message ?? "Couldn't start call");

    const startRes = await fetch(`${apiUrl}/calls/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName, callType, callerId: currentUserId, recipientId: otherUserId, conversationId }),
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || "Failed to start call");

    return {
      channelName, conversationId: conversationId as string,
      callLogId: startData.callLogId, incomingCallId: startData.incomingCallId,
    };
  } catch (e: any) {
    onAlert("Couldn't start call", e?.message ?? "Please try again.");
    return null;
  }
}

export function buildCallRouteParams(opts: {
  channelName: string; otherUserId: string; otherUserName: string;
  callType?: "audio" | "video"; callId: string; conversationId: string; callLogId: string;
  autoStudy?: { lessonId: string; moduleId: string; lessonTitle: string };
}): Record<string, string> {
  const params: Record<string, string> = {
    channelName: opts.channelName, otherUserId: opts.otherUserId, otherUserName: opts.otherUserName,
    callType: opts.callType ?? "audio", isInitiator: "true", callId: opts.callId,
    conversationId: opts.conversationId, callLogId: opts.callLogId,
  };
  if (opts.autoStudy) {
    params.autoStudyLessonId = opts.autoStudy.lessonId;
    params.autoStudyModuleId = opts.autoStudy.moduleId;
    params.autoStudyLessonTitle = opts.autoStudy.lessonTitle;
  }
  return params;
}