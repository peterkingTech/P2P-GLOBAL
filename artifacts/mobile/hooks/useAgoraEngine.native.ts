import { useEffect, useRef } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from "react-native-agora";

// CALL DEBUG fix — this local env constant is now only a fallback. The
// authoritative value is whatever appId the token-minting server actually
// echoed back for this specific token (see useAgora.ts's getToken) — using
// anything else risks a silent App ID mismatch between what the token was
// signed for and what the engine joins with, which Agora reports via
// onConnectionStateChanged (ConnectionStateFailed / ConnectionChangedInvalidAppId)
// rather than a JS exception, so it must not be possible to construct at all.
const FALLBACK_APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID || "";

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
}

export function useAgoraEngine({ channelName, token, uid, enableVideo, eventHandler, appId }: UseAgoraEngineOptions) {
  const engineRef = useRef<IRtcEngine | null>(null);

  useEffect(() => {
    if (!token || !channelName || uid === null) return;
    let cancelled = false;
    let engine: IRtcEngine | null = null;

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
        }
      }
      if (cancelled) return;

      const resolvedAppId = appId || FALLBACK_APP_ID;
      console.log("CALL DEBUG engine: initializing", { channelName, uid, enableVideo, usingServerAppId: !!appId });
      engine = createAgoraRtcEngine();
      engineRef.current = engine;
      engine.initialize({ appId: resolvedAppId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
      engine.registerEventHandler(eventHandler);

      if (enableVideo) engine.enableVideo();
      else engine.disableVideo();
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
        publishCameraTrack: enableVideo,
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
        engine.unregisterEventHandler(eventHandler);
        engine.release();
        if (engineRef.current === engine) engineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, token, uid, enableVideo, appId]);

  return engineRef;
}