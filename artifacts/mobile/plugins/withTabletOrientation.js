// Android: phones stay portrait, tablets may rotate.
//
// app.json's "orientation": "portrait" becomes android:screenOrientation=
// "portrait" for every device. On Android 12L–15 a portrait-locked app is
// letterboxed into a narrow strip on a landscape tablet (Android 16+ ignores
// the lock on large screens). The manifest can't tell a phone from a tablet,
// so MainActivity decides at launch — before the first frame, so phones never
// see a landscape frame: smallest width >= 600dp (Android's own large-screen
// threshold) → follow the user's rotation setting; otherwise keep portrait.
//
// iOS needs no code: app.json sets UISupportedInterfaceOrientations~ipad
// (all four) next to the iPhone's portrait-only UISupportedInterfaceOrientations.
const { withMainActivity } = require("expo/config-plugins");

const MARKER = "P2P tablet orientation";
const SNIPPET = [
  `    // ${MARKER}: phones portrait, tablets (smallest width >= 600dp) rotate.`,
  "    requestedOrientation = if (resources.configuration.smallestScreenWidthDp >= 600)",
  "      android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER",
  "    else",
  "      android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT",
].join("\n");

function addTabletOrientation(contents) {
  if (contents.includes(MARKER)) return contents; // idempotent
  const anchor = /^(\s*)super\.onCreate\((null|savedInstanceState)\)/m;
  if (!anchor.test(contents)) {
    throw new Error("withTabletOrientation: MainActivity.onCreate's super.onCreate(...) call not found");
  }
  return contents.replace(anchor, (line) => `${SNIPPET}\n${line}`);
}

function withTabletOrientation(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error("withTabletOrientation: expected a Kotlin MainActivity");
    }
    cfg.modResults.contents = addTabletOrientation(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withTabletOrientation;
module.exports.addTabletOrientation = addTabletOrientation;
