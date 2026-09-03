import { useEffect, useRef } from "react";
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from "react-native-agora";

const APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID || "";

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
}

export function useAgoraEngine({ channelName, token, uid, enableVideo, eventHandler }: UseAgoraEngineOptions) {
  const engineRef = useRef<IRtcEngine | null>(null);

  useEffect(() => {
    if (!token || !channelName || uid === null) return;

    console.log("CALL DEBUG engine: initializing", { channelName, uid, enableVideo });
    const engine = createAgoraRtcEngine();
    engineRef.current = engine;
    engine.initialize({ appId: APP_ID, channelProfile: ChannelProfileType.ChannelProfileCommunication });
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

    engine.joinChannel(token, channelName, uid, {
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      publishCameraTrack: enableVideo,
      autoSubscribeAudio: true,
      autoSubscribeVideo: enableVideo,
    });

    return () => {
      console.log("CALL DEBUG engine: leaving channel and releasing", { channelName, uid });
      engine.leaveChannel();
      engine.unregisterEventHandler(eventHandler);
      engine.release();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, token, uid, enableVideo]);

  return engineRef;
}