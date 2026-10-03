import { useEffect, useRef, type MutableRefObject } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from "react-native-agora";
import { stopCallBackgroundSupport } from "../lib/callBackgroundSupport";

// CALL DEBUG fix — this local env constant is now only a fallback. The
// authoritative value is whatever appId the token-minting server actually
// echoed back for this specific token (see useAgora.ts's getToken) — using
// anything else risks a silent App ID mismatch between what the token was
// signed for and what the engine joins with, which Agora reports via
// onConnectionStateChanged (ConnectionStateFailed / ConnectionChangedInvalidAppId)
// rather than a JS exception, so it must not be possible to construct at all.
const FALLBACK_APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID || "";

// Video-call lifecycle audit — every Agora event name any call screen
// (audio/video/group/room/church) currently registers through this hook's
// `eventHandler` option. Forwarded individually (not via a Proxy) because
// react-native-agora's registerEventHandler inspects the handler object's
// own keys to decide which native events to subscribe to — an object with
// no real own keys would silently register nothing. Adding a new event to
// any call screen only requires adding its name here once.
const FORWARDED_EVENTS = [
  "onJoinChannelSuccess",
  "onConnectionStateChanged",
  "onError",
  "onTokenPrivilegeWillExpire",
  "onUserJoined",
  "onUserOffline",
  "onAudioVolumeIndication",
  "onRemoteVideoStateChanged",
  "onNetworkQuality",
] as const;

// Shared engine lifecycle for every call screen (audio/video/group/room) —
// they differ only in enableVideo and their own event callbacks, so this
// owns create -> configure -> join -> leave/release, and hands back a ref
// the screen uses for its own control calls (mute, switchCamera, etc).
//
// Note: react-native-agora v4's event API is registerEventHandler(handler),
// a single object of named callbacks — NOT an addListener('eventName', cb)
// emitter like v3/some online examples show. Passing one merged handler
// object per screen (rather than registering multiple times) keeps this
// predictable.
interface UseAgoraEngineOptions {
  channelName: string;
  token: string | null;
  // CALL DEBUG fix — nullable: the caller (a call screen) now only has a
  // uid once the authenticated profile has actually loaded (no more
  // frozen-at-mount placeholder value). This effect simply waits for a
  // real uid instead of ever joining with one.
  uid: number | null;
  enableVideo: boolean;
  eventHandler: IRtcEngineEventHandler;
  /** The appId the token was actually minted for (see useAgora.ts's
   * getToken) — always preferred over the local env fallback. */
  appId?: string;
  /** WhatsApp-style ringing lifecycle — whether to publish the camera track
   * at join time. Defaults to `enableVideo` (existing behavior, unchanged
   * for audio.tsx/group.tsx/room.tsx/church.tsx). The video caller screen
   * passes `false` here while the callee hasn't accepted yet (local preview
   * only, nothing sent), then calls `publishVideoNow()` (returned below)
   * once acceptance is confirmed. Never affects audio publishing. */
  initialPublishVideo?: boolean;
  /** Forensic calling audit — Android camera-permission denial previously
   * only logged a console.warn and otherwise vanished: the engine still
   * joined and published "video" that was actually empty frames, while the
   * screen's own cameraOn UI state stayed true (no JS-visible signal ever
   * reached it). This lets the caller reflect a real denial into its own
   * video-tile state instead of showing a permanently blank self-preview. */
  onCameraUnavailable?: () => void;
  /** CALL DEBUG fix — fired the moment the Android runtime permission
   * request (below) has resolved, whether granted or denied, right before
   * the engine is created and joinChannel() is issued. Callers use this to
   * start their own "is the join taking too long" timeout from the actual
   * start of the join attempt instead of from token-acquired time — see
   * audio.tsx/video.tsx's JOIN_CHANNEL_TIMEOUT_MS for the bug this fixes:
   * without it, a human's time spent looking at the OS mic/camera
   * permission dialog(s) silently ate into that timeout budget, so a call
   * could time out and hang up while the recipient was still tapping
   * "Allow" — never having had a real chance to connect. */
  onPermissionsResolved?: () => void;
  /** Stage 6 (network recovery/reliability audit) — mirrors
   * onCameraUnavailable exactly: a denied RECORD_AUDIO permission previously
   * only produced a console.warn below, with zero JS-visible signal that
   * this device's mic was not actually being captured — worse than the
   * camera case, since every call type (including audio-only calls)
   * depends on the mic. Lets the caller reflect a real denial into its own
   * UI instead of a silently one-way-muted "connected" call. */
  onMicUnavailable?: () => void;
}

/** engineRef's existing RefObject<IRtcEngine | null> shape, unchanged for
 * every existing caller (audio.tsx/group.tsx/room.tsx/church.tsx keep doing
 * engineRef.current?.method() exactly as before) — publishVideoNow is an
 * additional property on the same object, used only by video.tsx. */
export type AgoraEngineRef = MutableRefObject<IRtcEngine | null> & {
  /** WhatsApp-style ringing lifecycle — call once the callee has accepted,
   * to start publishing the caller's camera track (a no-op if the engine
   * isn't live, e.g. the call already ended). */
  publishVideoNow: () => void;
};

export function useAgoraEngine({ channelName, token, uid, enableVideo, eventHandler, appId, onCameraUnavailable, onPermissionsResolved, onMicUnavailable, initialPublishVideo }: UseAgoraEngineOptions): AgoraEngineRef {
  const engineRef = useRef<IRtcEngine | null>(null) as AgoraEngineRef;
  // WhatsApp-style ringing lifecycle — reads engineRef.current at CALL time
  // (not creation time), so it always reaches whichever engine instance is
  // currently live without being an effect dependency.
  engineRef.publishVideoNow = useRef(() => {
    engineRef.current?.updateChannelMediaOptions({ publishCameraTrack: true });
  }).current;

  // Video-call lifecycle audit — root cause of "engine keeps
  // reinitializing": eventHandler/onCameraUnavailable/onPermissionsResolved
  // are all inline closures created fresh by the call screen on EVERY
  // render. Previously they were read directly by the effect below and
  // three of them sat in its dependency array, so React saw "changed deps"
  // on every re-render of the screen (not just on a real new call) and tore
  // the engine down (leaveChannel/release) and recreated it
  // (createAgoraRtcEngine/joinChannel) each time. Reading them through refs
  // instead — updated unconditionally on every render, not inside an
  // effect — means whatever runs later always sees this render's latest
  // closure (no stale handlers), while the effect that owns the actual
  // engine only depends on values that represent a genuinely different
  // call: channelName/token/uid/enableVideo/appId.
  const eventHandlerRef = useRef(eventHandler);
  eventHandlerRef.current = eventHandler;
  const onCameraUnavailableRef = useRef(onCameraUnavailable);
  onCameraUnavailableRef.current = onCameraUnavailable;
  const onPermissionsResolvedRef = useRef(onPermissionsResolved);
  onPermissionsResolvedRef.current = onPermissionsResolved;
  const onMicUnavailableRef = useRef(onMicUnavailable);
  onMicUnavailableRef.current = onMicUnavailable;

  // One object, created once and never replaced for the life of this hook
  // instance, registered with Agora exactly once per real join. Each
  // forwarded method reads eventHandlerRef.current at CALL time (not at
  // registration time), so it always reaches this render's latest handler
  // logic without the object's own identity ever changing — that identity
  // stability is what lets registerEventHandler/unregisterEventHandler
  // happen exactly once per real engine lifetime instead of once per render.
  const stableHandlerRef = useRef<IRtcEngineEventHandler | null>(null);
  if (!stableHandlerRef.current) {
    const handler: Record<string, (...args: unknown[]) => void> = {};
    for (const name of FORWARDED_EVENTS) {
      handler[name] = (...args: unknown[]) => {
        (eventHandlerRef.current as unknown as Record<string, ((...a: unknown[]) => void) | undefined>)[name]?.(...args);
      };
    }
    stableHandlerRef.current = handler as unknown as IRtcEngineEventHandler;
  }

  useEffect(() => {
    if (!token || !channelName || uid === null) return;
    let cancelled = false;
    let engine: IRtcEngine | null = null;
    const stableHandler = stableHandlerRef.current!;

    (async () => {
      // Android requires an explicit runtime grant for these dangerous
      // permissions even though they're already declared in the manifest —
      // without it, Agora's native capture silently produces empty mic/
      // camera frames instead of real input: no crash, no error, no
      // JS-visible signal of any kind, so a call can "connect" while being
      // completely silent both ways. iOS prompts automatically on first
      // capture via the Info.plist usage-description strings already
      // present in app.json, so no equivalent call is needed there.
      if (Platform.OS === "android") {
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (enableVideo) permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        const results = await PermissionsAndroid.requestMultiple(permissions);
        const denied = permissions.filter((p) => results[p] !== PermissionsAndroid.RESULTS.GRANTED);
        if (denied.length > 0) {
          console.warn("CALL DEBUG engine: permission denied, joining without real audio/video", { channelName, denied });
          if (enableVideo && denied.includes(PermissionsAndroid.PERMISSIONS.CAMERA)) {
            onCameraUnavailableRef.current?.();
          }
          if (denied.includes(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
            onMicUnavailableRef.current?.();
          }
        }
      }
      if (cancelled) return;
      onPermissionsResolvedRef.current?.();

      const resolvedAppId = appId || FALLBACK_APP_ID;
      console.log("CALL DEBUG engine: initializing", { channelName, uid, enableVideo, usingServerAppId: !!appId });
      engine = createAgoraRtcEngine();
      engineRef.current = engine;
      engine.initialize({ appId: resolvedAppId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
      engine.registerEventHandler(stableHandler);

      // LOCAL VIDEO FIX (iOS local-preview investigation) — read-only audit
      // traced the blank-local-preview symptom to this missing call. The
      // installed react-native-agora source (RtcSurfaceView's own doc
      // comment) documents the required sequence before joining a channel
      // as "call startPreview first, then call enableVideo" — this app
      // called enableVideo/joinChannel but never startPreview, which left
      // the local camera capture session never explicitly bound to a
      // renderer on iOS (Android's capture pipeline tolerated the omission,
      // which is why this was never caught there). Gated on enableVideo so
      // audio-only calls (audio.tsx) never start the camera.
      if (enableVideo) engine.startPreview();

      if (enableVideo) {
        engine.enableVideo();
        // Explicit, documented call for "start camera capture and create a
        // local video stream" (enableVideo's own doc says this is already
        // the default, but making it explicit removes any ambiguity rather
        // than relying on an implicit default during the local-preview
        // investigation).
        engine.enableLocalVideo(true);
      } else {
        engine.disableVideo();
      }
      engine.enableAudio();
      // Default audio route for a normal call (section 11): speakerphone on,
      // microphone on. Previously this was never set at all here — only ever
      // toggled from the user's own mute/speaker buttons — so a fresh call
      // started in whatever route Android happened to default to (usually
      // the earpiece), silently disagreeing with the UI's speakerOn=true
      // initial state.
      engine.setEnableSpeakerphone(true);
      engine.muteLocalAudioStream(false);
      console.log("CALL DEBUG engine: configured, calling joinChannel", { channelName, uid });

      // joinChannel returns synchronously: 0 means the native call was
      // accepted (actual join/failure still arrives async via eventHandler),
      // but a negative code means the SDK rejected the call outright and
      // will NEVER fire onJoinChannelSuccess/onError/onConnectionStateChanged
      // for it at all — that path was previously invisible at this layer.
      const joinResult = engine.joinChannel(token, channelName, uid, {
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        // WhatsApp-style ringing lifecycle — defaults to enableVideo
        // (unchanged for every other caller of this hook); the video call
        // screen passes initialPublishVideo:false for the caller while
        // ringing, so the camera track is never sent to the callee before
        // they accept. Subscribing to the REMOTE side's video is unaffected
        // either way (autoSubscribeVideo below).
        publishCameraTrack: initialPublishVideo ?? enableVideo,
        autoSubscribeAudio: true,
        autoSubscribeVideo: enableVideo,
      });
      if (joinResult !== 0) {
        console.warn("CALL DEBUG engine: joinChannel rejected synchronously", { channelName, uid, joinResult });
      } else {
        console.log("CALL DEBUG engine: joinChannel accepted, awaiting async result", { channelName, uid });
      }

      // CALL DEBUG fix — this used to live in each call screen's own effect
      // keyed on `engineRef`, which looked safe but wasn't: engine creation
      // now happens after an awaited permission request, so a screen's own
      // synchronous effect always ran before engineRef.current was set,
      // silently no-oping via optional chaining. Calling it here, after the
      // engine that owns it actually exists, is the only ordering that's
      // guaranteed correct.
      engine.enableAudioVolumeIndication(500, 3, true);
    })();

    return () => {
      cancelled = true;
      if (engine) {
        console.log("CALL DEBUG engine: leaving channel and releasing", { channelName, uid });
        engine.leaveChannel();
        engine.unregisterEventHandler(stableHandler);
        engine.release();
        if (engineRef.current === engine) engineRef.current = null;
        // Stage 26B — safety net, not the primary stop path (call screens
        // already call stopCallBackgroundSupport() through their own
        // handleEndCall/handleLeave). This cleanup runs unconditionally on
        // EVERY real teardown of a real engine, including an exit path
        // that bypasses those screen-level functions entirely (e.g. an OS
        // back-gesture unmount) — the one path that reliably had no
        // guaranteed stop call otherwise, which would have left an Android
        // foreground-service notification stuck indefinitely. A no-op on
        // iOS/macOS/Windows and a no-op if background support was never
        // started for this call.
        stopCallBackgroundSupport();
      }
    };
    // Video-call lifecycle audit — deliberately NOT including eventHandler/
    // onCameraUnavailable/onPermissionsResolved (read through refs above
    // instead, see their declarations), nor initialPublishVideo (only read
    // once, at the initial joinChannel call, for whether to start
    // publishing camera immediately — a later acceptance uses
    // publishVideoNow() instead of changing this and retriggering a full
    // engine recreation). This effect — and the real
    // create/join/leave/release cycle it owns — must only run for an
    // actual new call: a genuinely different channel/token/uid/appId, or
    // video being turned on/off for the call as a whole. It must never
    // rerun just because the screen re-rendered and happened to build a new
    // inline callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, token, uid, enableVideo, appId]);

  return engineRef;
}
