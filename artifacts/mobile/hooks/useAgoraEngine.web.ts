import { useRef } from "react";
import type { IRtcEngine, IRtcEngineEventHandler } from "react-native-agora";

// Web stub — react-native-agora is a native-only module (it statically
// imports codegenNativeComponent, which breaks the Metro web bundle if this
// file is ever resolved for web; see useAgoraEngine.native.ts). Metro's
// platform-extension resolution picks this file automatically for web
// builds, so react-native-agora is never even required here. Live audio/
// video calling isn't available on web — every consumer already calls
// engineRef.current?.method(...), so a permanently-null ref is safe.
interface UseAgoraEngineOptions {
  channelName: string;
  token: string | null;
  uid: number;
  enableVideo: boolean;
  eventHandler: IRtcEngineEventHandler;
}

export function useAgoraEngine(_options: UseAgoraEngineOptions) {
  return useRef<IRtcEngine | null>(null);
}