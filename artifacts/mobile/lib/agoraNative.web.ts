import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";

// Web stub — react-native-agora is native-only (see agoraNative.native.ts).
// Video/audio calling isn't available on web (hooks/useAgoraEngine.web.ts
// keeps the engine ref permanently null), so this just needs to render
// something inert and keep the same exported shape group.tsx/video.tsx use.
// Enum values are copied from react-native-agora's real numeric values so
// comparisons against them stay meaningful even though they're never
// actually exercised (no engine ever connects on web).
interface RtcSurfaceViewProps {
  style?: StyleProp<ViewStyle>;
  canvas?: { uid: number };
  zOrderMediaOverlay?: boolean;
}

export function RtcSurfaceView({ style }: RtcSurfaceViewProps) {
  return React.createElement(View, { style });
}

export const QualityType = { QualityBad: 4 } as const;
export const BackgroundSourceType = { BackgroundBlur: 3 } as const;
export const BackgroundBlurDegree = { BlurDegreeHigh: 3 } as const;
export const SegModelType = { SegModelAi: 1 } as const;