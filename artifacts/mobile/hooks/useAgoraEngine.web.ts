import { useRef, type MutableRefObject } from "react";
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
  uid: number | null;
  enableVideo: boolean;
  eventHandler: IRtcEngineEventHandler;
  appId?: string;
  onCameraUnavailable?: () => void;
  onPermissionsResolved?: () => void;
  initialPublishVideo?: boolean;
}

// Same shape as useAgoraEngine.native.ts's AgoraEngineRef, so tsc (which
// resolves this stub) checks video.tsx against the real API.
type AgoraEngineRef = MutableRefObject<IRtcEngine | null> & { publishVideoNow: () => void };

const noop = () => {};

export function useAgoraEngine(_options: UseAgoraEngineOptions): AgoraEngineRef {
  const engineRef = useRef<IRtcEngine | null>(null) as AgoraEngineRef;
  engineRef.publishVideoNow = noop;
  return engineRef;
}