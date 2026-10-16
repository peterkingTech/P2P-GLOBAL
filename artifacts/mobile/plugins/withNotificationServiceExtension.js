// iOS Notification Service Extension ("NotificationService").
//
// Runs on the iPhone when a push with mutable-content arrives (the API sets it
// only when there is a sender photo or a preview token —
// api-server lib/notificationPrivacy.ts). Swift source + Info.plist in
// ./notification-service/:
//   * sender photo → Communication Notification (photo + name), falling back
//     to an image attachment;
//   * "Name and message" recipients: exchanges the push's short-lived
//     preview token for the message text / voice link at the P2P API
//     (POST /notifications/preview) — content never travels through
//     Expo/APNs — and attaches a voice note (<= 5 MB, our storage only);
//   * hands the long-press view (Notification Content Extension) what it may
//     show, in userInfo["p2pPreview"];
//   * any error or timeout → the original notification, unchanged.
//
// Build-time values written into the extension's Info.plist: the API base URL
// and the trusted storage host, from the same resolver the app uses
// (config/supabaseEnv.js) — so staging builds talk to staging. No secrets.
//
// Main app: Communication Notifications entitlement + NSUserActivityTypes
// INSendMessageIntent (Apple requires both for the photo-and-name style).
// extra.eas…appExtensions declares the target so EAS signs it.
// Opt out for a build with P2P_IOS_SENDER_PHOTOS=0.
const fs = require("fs");
const path = require("path");
const { withXcodeProject, withEntitlementsPlist, withInfoPlist, withDangerousMod } = require("expo/config-plugins");
const { declareAppExtension, addExtensionTarget, EMPTY_ENTITLEMENTS } = require("./appExtensionTarget");

const TARGET = "NotificationService";
const SRC_DIR = path.join(__dirname, "notification-service");
const COMM_ENTITLEMENT = "com.apple.developer.usernotifications.communication";

const extensionBundleId = (config) => `${config.ios.bundleIdentifier}.${TARGET}`;

/** API base + trusted storage host for this build (empty when unknown → previews off). */
function previewEndpoints(env = process.env) {
  let apiUrl = "", mediaHost = "";
  try {
    const { resolveSupabaseConfig } = require("../config/supabaseEnv");
    const r = resolveSupabaseConfig(env, { url: null, anonKey: null });
    if (r.ok) {
      mediaHost = new URL(r.config.url).host;
      apiUrl = r.config.apiUrl || "";
    }
  } catch { /* leave empty */ }
  apiUrl = apiUrl || env.EXPO_PUBLIC_API_URL || "";
  try { if (new URL(apiUrl).protocol !== "https:") apiUrl = ""; } catch { apiUrl = ""; }
  return { apiUrl: apiUrl.replace(/\/+$/, ""), mediaHost };
}

const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function withMainAppSettings(config) {
  config = withEntitlementsPlist(config, (c) => {
    c.modResults[COMM_ENTITLEMENT] = true;
    return c;
  });
  return withInfoPlist(config, (c) => {
    const types = new Set(c.modResults.NSUserActivityTypes ?? []);
    types.add("INSendMessageIntent");
    c.modResults.NSUserActivityTypes = [...types];
    return c;
  });
}

function withExtensionFiles(config) {
  return withDangerousMod(config, ["ios", (c) => {
    const dest = path.join(c.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(SRC_DIR, "NotificationService.swift"), path.join(dest, "NotificationService.swift"));
    const { apiUrl, mediaHost } = previewEndpoints();
    const plist = fs.readFileSync(path.join(SRC_DIR, "NotificationService-Info.plist"), "utf8")
      .replace("__P2P_API_BASE_URL__", xmlEscape(apiUrl))
      .replace("__P2P_TRUSTED_MEDIA_HOST__", xmlEscape(mediaHost));
    fs.writeFileSync(path.join(dest, "NotificationService-Info.plist"), plist);
    fs.writeFileSync(path.join(dest, "NotificationService.entitlements"), EMPTY_ENTITLEMENTS);
    return c;
  }]);
}

function withExtensionTarget(config) {
  return withXcodeProject(config, (c) => {
    addExtensionTarget(c.modResults, c, {
      name: TARGET,
      bundleId: extensionBundleId(c),
      files: ["NotificationService.swift", "NotificationService-Info.plist", "NotificationService.entitlements"],
      sources: ["NotificationService.swift"],
      infoPlist: "NotificationService-Info.plist",
      entitlements: "NotificationService.entitlements",
    });
    return c;
  });
}

function withNotificationServiceExtension(config) {
  if (process.env.P2P_IOS_SENDER_PHOTOS === "0") return config;
  config = declareAppExtension(config, { targetName: TARGET, bundleIdentifier: extensionBundleId(config), entitlements: {} });
  config = withMainAppSettings(config);
  config = withExtensionFiles(config);
  return withExtensionTarget(config);
}

module.exports = withNotificationServiceExtension;
module.exports.previewEndpoints = previewEndpoints;
