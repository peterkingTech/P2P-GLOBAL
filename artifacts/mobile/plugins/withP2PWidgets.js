// iOS home-screen / Lock Screen widgets ("P2PWidgets", WidgetKit + SwiftUI).
//
// Source in ./p2p-widgets/. The widgets read one JSON snapshot the app writes
// into an App Group shared by the app and this extension
// (modules/p2p-widgets → P2PWidgetsModule.swift). The group id is derived from
// the bundle id, so a staging build (…​.staging) gets its own group and never
// reads production data. No network access in the extension; no new
// dependencies. Android widgets live entirely in modules/p2p-widgets (no
// plugin needed).
//
// EAS: the extension is declared in extra.eas…appExtensions with the App Group
// entitlement, so EAS creates its bundle id + provisioning profile and enables
// App Groups for both identifiers. The FIRST build after adding this needs an
// interactive `eas build` (new target credentials), like the notification
// extensions did. Opt out for a build with P2P_IOS_WIDGETS=0.
const fs = require("fs");
const path = require("path");
const { withXcodeProject, withDangerousMod, withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");
const { declareAppExtension, addExtensionTarget } = require("./appExtensionTarget");

const TARGET = "P2PWidgets";
const SRC_DIR = path.join(__dirname, "p2p-widgets");
const GROUP_KEY = "com.apple.security.application-groups";

const extensionBundleId = (config) => `${config.ios.bundleIdentifier}.${TARGET}`;
const appGroup = (config) => `group.${config.ios.bundleIdentifier}`;
const entitlementsXml = (group) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  `<plist version="1.0">\n<dict>\n  <key>${GROUP_KEY}</key>\n  <array>\n    <string>${group}</string>\n  </array>\n</dict>\n</plist>\n`;

/** The app itself joins the App Group and tells its native module which group to use. */
function withAppGroupInApp(config) {
  config = withEntitlementsPlist(config, (c) => {
    const groups = new Set(c.modResults[GROUP_KEY] ?? []);
    groups.add(appGroup(c));
    c.modResults[GROUP_KEY] = [...groups];
    return c;
  });
  return withInfoPlist(config, (c) => {
    c.modResults.P2PAppGroup = appGroup(c);
    return c;
  });
}

function withExtensionFiles(config) {
  return withDangerousMod(config, ["ios", (c) => {
    const dest = path.join(c.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(SRC_DIR, "P2PWidgets.swift"), path.join(dest, "P2PWidgets.swift"));
    const plist = fs.readFileSync(path.join(SRC_DIR, "P2PWidgets-Info.plist"), "utf8").replace("__P2P_APP_GROUP__", appGroup(c));
    fs.writeFileSync(path.join(dest, "P2PWidgets-Info.plist"), plist);
    fs.writeFileSync(path.join(dest, "P2PWidgets.entitlements"), entitlementsXml(appGroup(c)));
    return c;
  }]);
}

function withExtensionTarget(config) {
  return withXcodeProject(config, (c) => {
    addExtensionTarget(c.modResults, c, {
      name: TARGET,
      bundleId: extensionBundleId(c),
      files: ["P2PWidgets.swift", "P2PWidgets-Info.plist", "P2PWidgets.entitlements"],
      sources: ["P2PWidgets.swift"],
      frameworks: ["WidgetKit.framework", "SwiftUI.framework"],
      infoPlist: "P2PWidgets-Info.plist",
      entitlements: "P2PWidgets.entitlements",
    });
    return c;
  });
}

module.exports = function withP2PWidgets(config) {
  if (process.env.P2P_IOS_WIDGETS === "0") return config;
  config = declareAppExtension(config, {
    targetName: TARGET,
    bundleIdentifier: extensionBundleId(config),
    entitlements: { [GROUP_KEY]: [appGroup(config)] },
  });
  config = withAppGroupInApp(config);
  config = withExtensionFiles(config);
  return withExtensionTarget(config);
};
