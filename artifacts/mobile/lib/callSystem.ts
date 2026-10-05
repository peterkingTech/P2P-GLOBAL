import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

// Native phone-call integration (modules/call-system): Android Telecom via
// Jetpack core-telecom, iOS CallKit + PushKit. It rings incoming calls
// through the OS (lock screen, app closed) and tells the OS what state each
// call is in, which is what puts P2P calls in the system call history.
// Media is untouched — Agora and the call screens work exactly as before.
//
// Every function here is a safe no-op on web, in builds without the module,
// and when the server switches the integration off (GET /calls/config).

/** Why a call ended — one vocabulary for every end path. */
export type CallEndReason =
  | "local_end"          // this user hung up
  | "remote_end"         // the other side hung up (Agora UserOfflineQuit)
  | "declined"           // this user declined an incoming call
  | "remote_declined"    // the person called declined
  | "cancelled"          // the caller hung up before an answer
  | "missed"             // an incoming call rang out
  | "no_answer"          // an outgoing call rang out
  | "busy"
  | "answered_elsewhere" // another of this user's devices answered
  | "declined_elsewhere"
  | "network_failure"
  | "connection_failure"
  | "token_failure"
  | "unknown";

export type SystemCallInfo = {
  callId: string;
  channelName: string;
  callType: string;
  /** The other person: the caller for an incoming call, the callee for an outgoing one. */
  callerId: string;
  callerName: string;
  conversationId?: string | null;
  callLogId?: string | null;
  declineToken?: string;
};

export type CallSystemEvent =
  | { type: "answered"; call: SystemCallInfo }
  | { type: "declined"; callId: string }
  | { type: "ended"; callId: string; reason?: string }
  | { type: "callBack"; peerId: string; peerName: string; callType: string }
  | { type: "voipToken"; token: string }
  | { type: "muted"; callId: string; muted: boolean };

type NativeCallSystem = {
  isSupported(): boolean;
  configure(apiUrl: string, scheme: string, enabled: boolean): void;
  reportIncomingCall(info: Record<string, unknown>, showUi: boolean): void;
  answerCall(callId: string): void;
  startOutgoingCall(info: Record<string, unknown>): void;
  reportConnected(callId: string): void;
  endCall(callId: string, reason: string): void;
  getVoipToken(): string | null;
  consumePendingEvents(): CallSystemEvent[];
  addListener(event: string, listener: (payload: any) => void): { remove(): void };
};

const native: NativeCallSystem | null =
  Platform.OS === "ios" || Platform.OS === "android"
    ? requireOptionalNativeModule<NativeCallSystem>("P2PCallSystem")
    : null;

let enabled = true;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    console.warn("callSystem:", e instanceof Error ? e.message : String(e));
    return fallback;
  }
}

/** True when this build has the native module and the server allows it. */
export function callSystemActive(): boolean {
  return !!native && enabled && safe(() => native.isSupported(), false);
}

/** This build can handle calls natively (independent of the server switch). */
export function callSystemInstalled(): boolean {
  return !!native && safe(() => native.isSupported(), false);
}

export function configureCallSystem(apiUrl: string, scheme: string, isEnabled: boolean): void {
  enabled = isEnabled;
  if (native) safe(() => native.configure(apiUrl, scheme, isEnabled), undefined);
}

function toNative(info: SystemCallInfo): Record<string, unknown> {
  return {
    callId: info.callId, channelName: info.channelName, callType: info.callType,
    callerId: info.callerId, callerName: info.callerName,
    conversationId: info.conversationId ?? "", callLogId: info.callLogId ?? "",
    declineToken: info.declineToken ?? "",
  };
}

/** showUi=false: the app's own ringing screen is showing it (Android, foreground). */
export function reportSystemIncomingCall(info: SystemCallInfo, showUi: boolean): void {
  if (callSystemActive()) safe(() => native!.reportIncomingCall(toNative(info), showUi), undefined);
}

export function answerSystemCall(callId: string | undefined): void {
  if (native && callId) safe(() => native.answerCall(callId), undefined);
}

export function startSystemOutgoingCall(info: SystemCallInfo): void {
  if (callSystemActive()) safe(() => native!.startOutgoingCall(toNative(info)), undefined);
}

export function reportSystemCallConnected(callId: string | undefined): void {
  if (native && callId) safe(() => native.reportConnected(callId), undefined);
}

/** Safe to call for any call, reported to the OS or not, any number of times. */
export function endSystemCall(callId: string | undefined, reason: CallEndReason): void {
  if (native && callId) safe(() => native.endCall(callId, reason), undefined);
}

/** Maps a call screen's handleEndCall reason to the OS-facing end reason. */
export function systemEndReason(
  screenReason: string,
  opts: { isInitiator: boolean },
): CallEndReason {
  switch (screenReason) {
    case "remote_end": return "remote_end";
    case "failed": return "connection_failure";
    case "no_answer": return opts.isInitiator ? "no_answer" : "missed";
    case "declined": return "remote_declined";
    case "busy": return "busy";
    default: return "local_end";
  }
}

export function getVoipToken(): string | null {
  return native ? safe(() => native.getVoipToken(), null) : null;
}

// One native listener fans out to every JS subscriber: on iOS, events are
// pulled from a native queue, so two independent pullers would steal each
// other's events.
const handlers = new Set<(event: CallSystemEvent) => void>();
let nativeSubscribed = false;

function dispatch(event: CallSystemEvent) {
  handlers.forEach((h) => {
    try { h(event); } catch (e) { console.warn("callSystem handler failed", e); }
  });
}

function ensureNativeListener() {
  if (!native || nativeSubscribed) return;
  nativeSubscribed = true;
  safe(() => {
    if (Platform.OS === "ios") {
      native.addListener("onCallEvent", () => flushPendingCallSystemEvents());
    } else {
      native.addListener("onCallDeclined", (e: { callId: string }) => dispatch({ type: "declined", callId: e.callId }));
      native.addListener("onCallEnded", (e: { callId: string; reason?: string }) => dispatch({ type: "ended", callId: e.callId, reason: e.reason }));
    }
  }, undefined);
}

/**
 * Native call events, normalized across platforms. iOS queues events in
 * native code and signals; Android emits them directly (its Accept and
 * call-back open the app through deep links instead).
 */
export function subscribeCallSystemEvents(handler: (event: CallSystemEvent) => void): () => void {
  if (!native) return () => {};
  handlers.add(handler);
  ensureNativeListener();
  return () => { handlers.delete(handler); };
}

/** iOS: deliver events queued before JS was listening (e.g. Answer tapped during launch). */
export function flushPendingCallSystemEvents(): void {
  if (!native) return;
  safe(() => native.consumePendingEvents() ?? [], [] as CallSystemEvent[]).forEach(dispatch);
}
