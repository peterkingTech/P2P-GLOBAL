// Config plugin for the local call-system module (see ios/CallKitManager.swift
// and android/.../CallSystem.kt).
const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

const EXPO_FCM_SERVICE = "expo.modules.notifications.service.ExpoFirebaseMessagingService";

// Android: our P2PFirebaseMessagingService extends Expo's and must be the only
// FCM receiver, or Firebase may deliver call pushes to Expo's instead.
function withCallSystemAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";
    const app = manifest.application && manifest.application[0];
    if (app) {
      app.service = (app.service || []).filter((s) => s.$["android:name"] !== EXPO_FCM_SERVICE);
      app.service.push({ $: { "android:name": EXPO_FCM_SERVICE, "tools:node": "remove" } });
    }
    return cfg;
  });
}

// iOS: "voip" lets a PushKit push wake the app for an incoming call (allowed
// because every such push is reported to CallKit); the activity types let
// Phone → Recents hand a "call back" to the app.
function withCallSystemIos(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = new Set(cfg.modResults.UIBackgroundModes || []);
    modes.add("voip");
    cfg.modResults.UIBackgroundModes = Array.from(modes);
    const types = new Set(cfg.modResults.NSUserActivityTypes || []);
    ["INStartCallIntent", "INStartAudioCallIntent", "INStartVideoCallIntent"].forEach((t) => types.add(t));
    cfg.modResults.NSUserActivityTypes = Array.from(types);
    return cfg;
  });
}

module.exports = function withCallSystem(config) {
  return withCallSystemIos(withCallSystemAndroid(config));
};
