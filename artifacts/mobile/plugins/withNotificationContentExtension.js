// iOS Notification Content Extension ("NotificationContent") — the custom
// long-press view for message notifications: sender photo left, P2P mark
// right, message text, play/pause for a small attached voice note.
//
// Source, Info.plist and the P2P mark (P2PLogo.png, a 96 px copy of the app
// icon) in ./notification-content/.
// Category "p2p_message" (Info.plist) — the API sends it only to recipients
// who show sender identity; the app registers it (lib/notificationCategories.ts)
// next to incoming_call. Shows only what the Notification Service Extension
// delivered; fetches nothing itself. No React Native, no new dependencies.
// No special Apple capability; EAS signs it via extra.eas…appExtensions.
// Opt out for a build with P2P_IOS_PREVIEW_VIEW=0 (iOS then shows its
// standard expanded notification).
const fs = require("fs");
const path = require("path");
const { withXcodeProject, withDangerousMod } = require("expo/config-plugins");
const { declareAppExtension, addExtensionTarget } = require("./appExtensionTarget");

const TARGET = "NotificationContent";
const SRC_DIR = path.join(__dirname, "notification-content");
// A 96 px copy of assets/images/icon.png (the full icon is ~1 MB — too heavy
// to decode inside a memory-limited extension for a 28 pt mark).
const LOGO_SRC = path.join(SRC_DIR, "P2PLogo.png");

const extensionBundleId = (config) => `${config.ios.bundleIdentifier}.${TARGET}`;

function withExtensionFiles(config) {
  return withDangerousMod(config, ["ios", (c) => {
    const dest = path.join(c.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(SRC_DIR, "NotificationViewController.swift"), path.join(dest, "NotificationViewController.swift"));
    fs.copyFileSync(path.join(SRC_DIR, "NotificationContent-Info.plist"), path.join(dest, "NotificationContent-Info.plist"));
    fs.copyFileSync(LOGO_SRC, path.join(dest, "P2PLogo.png"));
    return c;
  }]);
}

function withExtensionTarget(config) {
  return withXcodeProject(config, (c) => {
    addExtensionTarget(c.modResults, c, {
      name: TARGET,
      bundleId: extensionBundleId(c),
      files: ["NotificationViewController.swift", "NotificationContent-Info.plist", "P2PLogo.png"],
      sources: ["NotificationViewController.swift"],
      resources: ["P2PLogo.png"],
      // Hosts the long-press view; must be linked explicitly (see appExtensionTarget.js).
      frameworks: ["UserNotificationsUI.framework", "UserNotifications.framework"],
      infoPlist: "NotificationContent-Info.plist",
    });
    return c;
  });
}

module.exports = function withNotificationContentExtension(config) {
  if (process.env.P2P_IOS_PREVIEW_VIEW === "0") return config;
  config = declareAppExtension(config, { targetName: TARGET, bundleIdentifier: extensionBundleId(config), entitlements: {} });
  config = withExtensionFiles(config);
  return withExtensionTarget(config);
};
