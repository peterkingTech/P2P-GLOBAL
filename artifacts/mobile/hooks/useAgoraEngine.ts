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
  uid: number;
  enableVideo: boolean;
  eventHandler: IRtcEngineEventHandler;
}

export function useAgoraEngine({ channelName, token, uid, enableVideo, eventHandler }: UseAgoraEngineOptions) {
  const engineRef = useRef<IRtcEngine | null>(null);

  useEffect(() => {
    if (!token || !channelName) return;

    const engine = createAgoraRtcEngine();
    engineRef.current = engine;
    engine.initialize({ appId: APP_ID, channelProfile: ChannelProfileType.ChannelProfileCommunication });
    engine.registerEventHandler(eventHandler);

    if (enableVideo) engine.enableVideo();
    else engine.disableVideo();
    engine.enableAudio();

    engine.joinChannel(token, channelName, uid, {
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      publishCameraTrack: enableVideo,
      autoSubscribeAudio: true,
      autoSubscribeVideo: enableVideo,
    });

    return () => {
      engine.leaveChannel();
      engine.unregisterEventHandler(eventHandler);
      engine.release();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, token, uid, enableVideo]);

  return engineRef;
}