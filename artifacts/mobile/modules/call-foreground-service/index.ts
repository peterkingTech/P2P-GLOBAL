import { requireNativeModule } from "expo-modules-core";

// Raw native binding. Call screens should use lib/callBackgroundSupport.ts
// instead of this file directly — that wrapper adds the Platform.OS guard
// and safe-fallback-when-unbuilt behavior this module intentionally does
// not duplicate here.
type CallForegroundServiceNativeModule = {
  start(isVideo: boolean): void;
  stop(): void;
};

export default requireNativeModule<CallForegroundServiceNativeModule>("CallForegroundService");
