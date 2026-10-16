// iOS: sender photos on notification banners (Notification Service Extension).
//
// Adds an app-extension target "NotificationService" (Swift source and
// Info.plist in ./notification-service/) that turns a push carrying the
// sender's photo into a Communication Notification — the sender's photo and
// name, like a messaging app — falling back to an image attachment, and to
// the unchanged notification on any failure. The API attaches the photo
// (lib/notificationPrivacy.ts → Expo richContent.image + mutableContent).
//
// Also: the main app gets the "Communication Notifications" entitlement and
// NSUserActivityTypes = INSendMessageIntent, which Apple requires for the
// photo-and-name style; and extra.eas...appExtensions declares the extension
// so EAS creates its bundle id / provisioning profile. The extension's bundle
// id follows the app's (production or staging, see app.config.js).
//
// Opt out for a build with P2P_IOS_SENDER_PHOTOS=0 (no target, no entitlement).
const fs = require("fs");
const path = require("path");
const { withXcodeProject, withEntitlementsPlist, withInfoPlist, withDangerousMod } = require("expo/config-plugins");

const TARGET = "NotificationService";
const SRC_DIR = path.join(__dirname, "notification-service");
const FILES = ["NotificationService.swift", "NotificationService-Info.plist", "NotificationService.entitlements"];
const COMM_ENTITLEMENT = "com.apple.developer.usernotifications.communication";
const DEPLOYMENT_TARGET = "15.1";

const extensionBundleId = (config) => `${config.ios.bundleIdentifier}.${TARGET}`;

function withExtensionDeclaration(config) {
  const eas = config.extra?.eas ?? {};
  const existing = eas.build?.experimental?.ios?.appExtensions ?? [];
  const appExtensions = [
    ...existing.filter((e) => e.targetName !== TARGET),
    { targetName: TARGET, bundleIdentifier: extensionBundleId(config), entitlements: {} },
  ];
  return {
    ...config,
    extra: {
      ...config.extra,
      eas: { ...eas, build: { ...eas.build, experimental: { ...eas.build?.experimental, ios: { ...eas.build?.experimental?.ios, appExtensions } } } },
    },
  };
}

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
    fs.copyFileSync(path.join(SRC_DIR, "NotificationService-Info.plist"), path.join(dest, "NotificationService-Info.plist"));
    fs.writeFileSync(path.join(dest, "NotificationService.entitlements"),
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict/>\n</plist>\n');
    return c;
  }]);
}

function withExtensionTarget(config) {
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    // Already added (prebuild re-run)? node-xcode stores the name quoted.
    const targets = project.pbxNativeTargetSection();
    if (Object.values(targets).some((t) => typeof t === "object" && String(t.name).replace(/"/g, "") === TARGET)) return c;

    // node-xcode needs these sections to exist before addTarget links the
    // extension to the app (they are absent in a fresh Expo project).
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    // Version settings copied from the app target so the extension's
    // CFBundleShortVersionString / CFBundleVersion match the app's.
    const appSettings = (() => {
      const configs = project.pbxXCBuildConfigurationSection();
      for (const key of Object.keys(configs)) {
        const s = configs[key].buildSettings;
        if (s && s.PRODUCT_BUNDLE_IDENTIFIER && String(s.PRODUCT_BUNDLE_IDENTIFIER).replace(/"/g, "") === c.ios.bundleIdentifier) return s;
      }
      return {};
    })();

    const group = project.addPbxGroup(FILES, TARGET, TARGET);
    const mainGroupId = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroupId);

    const target = project.addTarget(TARGET, "app_extension", TARGET, extensionBundleId(c));
    project.addBuildPhase(["NotificationService.swift"], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const configs = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configs)) {
      const s = configs[key].buildSettings;
      if (!s || s.PRODUCT_NAME !== `"${TARGET}"`) continue;
      Object.assign(s, {
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/NotificationService.entitlements`,
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: appSettings.CURRENT_PROJECT_VERSION ?? c.ios.buildNumber ?? "1",
        MARKETING_VERSION: appSettings.MARKETING_VERSION ?? c.version ?? "1.0.0",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${TARGET}/NotificationService-Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
        PRODUCT_BUNDLE_IDENTIFIER: extensionBundleId(c),
        SKIP_INSTALL: "YES",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: '"1,2"',
        ...(appSettings.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: appSettings.DEVELOPMENT_TEAM } : {}),
      });
    }
    return c;
  });
}

module.exports = function withNotificationServiceExtension(config) {
  if (process.env.P2P_IOS_SENDER_PHOTOS === "0") return config;
  config = withExtensionDeclaration(config);
  config = withMainAppSettings(config);
  config = withExtensionFiles(config);
  return withExtensionTarget(config);
};
