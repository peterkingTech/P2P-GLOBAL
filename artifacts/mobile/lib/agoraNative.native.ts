// Real native implementation — thin re-export so call screens never import
// "react-native-agora" directly. See agoraNative.web.ts for why: that
// package is native-only (its index statically imports codegenNativeComponent),
// and expo-router's require.context route scanner pulls in .native.tsx/.web.tsx
// route files unfiltered by platform, so isolating the import in a
// non-route module (resolved through ordinary Metro platform-extension
// resolution, which DOES work correctly) is what actually keeps it out of
// the web bundle.
export { RtcSurfaceView, QualityType, BackgroundSourceType, BackgroundBlurDegree, SegModelType } from "react-native-agora";