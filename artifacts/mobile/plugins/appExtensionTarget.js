// Shared helpers for the iOS app-extension config plugins
// (withNotificationServiceExtension.js, withNotificationContentExtension.js).
// Adds one extension target to the generated Xcode project with node-xcode —
// sources, resources, embed + dependency on the app — idempotently (a
// prebuild re-run never adds a second target).

// Expo SDK 57's iOS minimum (bare template Podfile default) unless app.json
// sets ios.deploymentTarget. Extensions must not require a newer iOS than
// the app.
const DEFAULT_IOS_DEPLOYMENT_TARGET = "16.4";
const iosDeploymentTarget = (config) => config.ios?.deploymentTarget ?? DEFAULT_IOS_DEPLOYMENT_TARGET;

function hasTarget(project, name) {
  return Object.values(project.pbxNativeTargetSection()).some((t) => typeof t === "object" && String(t.name).replace(/"/g, "") === name);
}

/** Declare an extension to EAS so it creates the bundle id + provisioning profile. */
function declareAppExtension(config, entry) {
  const eas = config.extra?.eas ?? {};
  const existing = eas.build?.experimental?.ios?.appExtensions ?? [];
  const appExtensions = [...existing.filter((e) => e.targetName !== entry.targetName), entry];
  return {
    ...config,
    extra: {
      ...config.extra,
      eas: { ...eas, build: { ...eas.build, experimental: { ...eas.build?.experimental, ios: { ...eas.build?.experimental?.ios, appExtensions } } } },
    },
  };
}

/**
 * Adds `name` as an app-extension target. files: everything in the group;
 * sources: compiled; resources: copied into the extension bundle.
 */
function addExtensionTarget(project, c, { name, bundleId, files, sources, resources = [], infoPlist, entitlements }) {
  if (hasTarget(project, name)) return;
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

  const group = project.addPbxGroup(files, name, name);
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  const target = project.addTarget(name, "app_extension", name, bundleId);
  project.addBuildPhase(sources, "PBXSourcesBuildPhase", "Sources", target.uuid);
  project.addBuildPhase(resources, "PBXResourcesBuildPhase", "Resources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

  const configs = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configs)) {
    const s = configs[key].buildSettings;
    if (!s || s.PRODUCT_NAME !== `"${name}"`) continue;
    Object.assign(s, {
      ...(entitlements ? { CODE_SIGN_ENTITLEMENTS: `${name}/${entitlements}` } : {}),
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: appSettings.CURRENT_PROJECT_VERSION ?? c.ios.buildNumber ?? "1",
      MARKETING_VERSION: appSettings.MARKETING_VERSION ?? c.version ?? "1.0.0",
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${name}/${infoPlist}`,
      IPHONEOS_DEPLOYMENT_TARGET: iosDeploymentTarget(c),
      PRODUCT_BUNDLE_IDENTIFIER: bundleId,
      SKIP_INSTALL: "YES",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: '"1,2"',
      ...(appSettings.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: appSettings.DEVELOPMENT_TEAM } : {}),
    });
  }
}

const EMPTY_ENTITLEMENTS = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict/>\n</plist>\n';

module.exports = { DEFAULT_IOS_DEPLOYMENT_TARGET, iosDeploymentTarget, hasTarget, declareAppExtension, addExtensionTarget, EMPTY_ENTITLEMENTS };
