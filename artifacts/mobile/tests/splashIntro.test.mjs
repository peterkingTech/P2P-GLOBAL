// Video splash intro (components/SplashIntro.tsx, app/_layout.tsx):
//   • a small bundled MP4 (no download at launch), replaceable in one place;
//   • once per launch — an in-memory flag only, nothing stored, so returning from the background
//     never replays it and a fresh launch always does;
//   • muted, once, no controls, fitted (not cropped) on black, full screen and centred;
//   • never stuck: start timeout, overall cap, error → skip, background → skip, reduced motion → skip;
//   • the app starts underneath unchanged (auth, navigation, deep links): the intro is a layer on top,
//     and the native splash always gets hidden.
// Run: node tests/splashIntro.test.mjs
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const intro = src("components/SplashIntro.tsx"), layout = src("app/_layout.tsx");

// Asset
const asset = path.join(root, "assets/videos/p2p-splash-intro.mp4");
const head = readFileSync(asset).subarray(0, 64);
ok("asset: bundled locally at assets/videos/p2p-splash-intro.mp4, required from one place", intro.includes('export const SPLASH_INTRO_VIDEO = require("../assets/videos/p2p-splash-intro.mp4")') && !/https?:\/\//.test(intro));
ok("asset: small (under 3 MB)", statSync(asset).size < 3_000_000, String(statSync(asset).size));
ok("asset: MP4, fast start (index before the media data)", head.includes(Buffer.from("ftyp")) && readFileSync(asset).indexOf("moov") < readFileSync(asset).indexOf("mdat"));

// Once per launch
ok("once per launch: in-memory flag, nothing persisted", intro.includes("let playedThisLaunch = false;") && !/AsyncStorage|localStorage|SecureStore/.test(intro));
ok("once per launch: the layout asks before hiding the native splash itself", layout.includes("if (!splashIntroPending()) SplashScreen.hideAsync();"));

// Playback
ok("playback: muted, once, no controls, no picture-in-picture", intro.includes("p.muted = true;") && intro.includes("p.loop = false;") && intro.includes("nativeControls={false}") && intro.includes("allowsPictureInPicture={false}"));
ok("playback: fitted on black, full screen (safe areas ignored), explicit size for web", intro.includes('contentFit="contain"') && intro.includes('video: { width: "100%", height: "100%"') && /layer: \{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0/.test(intro));
ok("playback: no logo image drawn by the intro (no flash before the video)", !/<Image|logo\.png/.test(intro));
ok("playback: video fades in on its first frame (native event, or playback advancing on web)", intro.includes("onFirstFrameRender={showVideo}") && intro.includes('"timeUpdate"'));
ok("playback: Android uses a TextureView without the ExoPlayer shutter", intro.includes('surfaceType="textureView"') && intro.includes("useExoShutter={false}"));

ok("tagline: a small 'P2P GLOBAL' at the bottom centre, above the home indicator, one line", /\n\s+P2P GLOBAL\r?\n/.test(intro) && intro.includes("bottom: insets.bottom + 28")
  && intro.includes('textAlign: "center"') && intro.includes("numberOfLines={1} adjustsFontSizeToFit") && /tagline: \{\s*position: "absolute", left: 24, right: 24/.test(intro));

// Never stuck
ok("safety: ends on playToEnd, on error, at a start timeout and at an overall cap", intro.includes('"playToEnd", () => finish()') && intro.includes('if (status === "error") finish();')
  && intro.includes("START_TIMEOUT_MS") && intro.includes("setTimeout(finish, MAX_INTRO_MS)"));
ok("safety: background ends it (inactive ignored — iOS reports it at launch)", intro.includes('if (s === "background") finish();'));
ok("safety: reduced motion skips it", intro.includes("isReduceMotionEnabled") && intro.includes("if (v) setSkip(true)"));
ok("safety: the native splash is always hidden (on show, on finish, and a 4 s fallback)", intro.includes("SplashScreen.hideAsync()") && layout.includes("setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 4000)"));
ok("resources: the player is released with the layer (unmounted when done)", intro.includes("if (done) return null;") && intro.includes("useVideoPlayer("));

// App underneath
ok("app: the intro is a layer after the app, which mounts normally (auth/navigation untouched)", /<RootLayoutNav \/>\s*<\/AppVersionGate>\s*\{[^}]*\}\s*<SplashIntro \/>/.test(layout));
ok("app: touches go to the app as soon as it starts leaving", intro.includes('pointerEvents={leaving ? "none" : "auto"}'));

console.log(`splashIntro (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
