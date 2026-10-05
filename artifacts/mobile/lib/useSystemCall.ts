import { useEffect, useRef } from "react";
import {
  reportSystemCallConnected, startSystemOutgoingCall, subscribeCallSystemEvents,
} from "@/lib/callSystem";

/**
 * Keeps the OS's view of a 1:1 call (Android Telecom / iOS CallKit) in step
 * with a call screen: registers an outgoing call, marks it active once media
 * connects, and ends the screen's call when the user hangs up from the
 * system UI (lock screen, Bluetooth headset, car, CallKit). The screen still
 * reports its own end through endSystemCall in handleEndCall. Media is never
 * touched here.
 */
export function useSystemCall(opts: {
  callId?: string;
  isInitiator: boolean;
  callType: "audio" | "video";
  peerId?: string;
  peerName?: string;
  channelName?: string;
  conversationId?: string;
  callLogId?: string;
  connected: boolean;
  onSystemEnd: () => void;
}) {
  const onSystemEndRef = useRef(opts.onSystemEnd);
  onSystemEndRef.current = opts.onSystemEnd;

  useEffect(() => {
    if (!opts.isInitiator || !opts.callId) return;
    startSystemOutgoingCall({
      callId: opts.callId, channelName: opts.channelName ?? "", callType: opts.callType,
      callerId: opts.peerId ?? "", callerName: opts.peerName ?? "",
      conversationId: opts.conversationId ?? null, callLogId: opts.callLogId ?? null,
    });
    // Registered once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.callId]);

  useEffect(() => {
    if (opts.connected) reportSystemCallConnected(opts.callId);
  }, [opts.connected, opts.callId]);

  useEffect(() => {
    if (!opts.callId) return;
    const callId = opts.callId;
    return subscribeCallSystemEvents((event) => {
      if (event.type === "ended" && event.callId === callId) onSystemEndRef.current();
    });
  }, [opts.callId]);
}
