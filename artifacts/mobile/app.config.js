// Dynamic Expo config: app.json stays the source of truth; this file only
// (1) refuses to build with an unsafe backend configuration and
// (2) turns a staging build into a separate app that can sit next to the
//     production app on the same device and can never be mistaken for it.
// Expo/EAS evaluates this during every build and `expo start`; a thrown
// error stops the build.
const { resolveSupabaseConfig, validateBuildProfile } = require("./config/supabaseEnv");

module.exports = ({ config }) => {
  const env = process.env;
  const profile = env.EAS_BUILD_PROFILE || null;
  const resolved = resolveSupabaseConfig(env, { url: null, anonKey: null });
  const errors = [...(resolved.ok ? [] : resolved.errors), ...validateBuildProfile(profile, env)];
  if (errors.length) {
    throw new Error(`P2P build configuration rejected${profile ? ` (EAS profile "${profile}")` : ""}:\n - ${errors.join("\n - ")}`);
  }
  // Home-screen widgets (iOS WidgetKit extension + App Group). Added here, not
  // in app.json, so it applies to every build; the plugin derives the App
  // Group from the final bundle id (staging gets its own).
  config = { ...config, plugins: [...(config.plugins ?? []), "./plugins/withP2PWidgets.js"] };
  if (resolved.config.target !== "staging") return config;

  // Staging: a distinct app (own name, bundle id/package and URL scheme), so
  // it installs beside — never over — the production app, and TestFlight /
  // Play listings for production are never involved. Push notifications are
  // not configured for these identifiers (no Firebase file, no APNs key yet).
  const android = { ...config.android, package: `${config.android.package}.staging` };
  delete android.googleServicesFile;
  return {
    ...config,
    name: `${config.name} Staging`,
    scheme: `${config.scheme}-staging`,
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.staging` },
    android,
    extra: { ...config.extra, p2pEnv: "staging" },
  };
};
