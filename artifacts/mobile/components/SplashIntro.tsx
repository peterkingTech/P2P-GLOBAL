import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";

// The P2P Global video intro, shown once per fresh launch on top of the app.
//
// The app starts underneath exactly as it would without the intro: authentication, session
// restore, navigation, deep links and notification taps all run normally. The intro only covers
// the screen, then fades away to reveal whatever screen the app has already chosen, so it can
// never send anyone to the wrong place.
//
// Sequence: native splash → black (the video's own background; no logo image is drawn here) →
// the video fades in once its first frame is on screen → plays muted, once → fades out into the
// app. It fills the whole display (safe areas ignored) and is fitted, not cropped, so the logo is
// centred and whole on every screen size. A small "P2P GLOBAL" line sits at the
// bottom centre, above the home indicator, on one line at every width. The player is released when
// the intro unmounts.
//
// Never stuck: it gives up if the video hasn't started within START_TIMEOUT_MS, ends at the latest
// MAX_INTRO_MS after mounting, and skips on any playback error or if the app goes to the background.
//
// "Fresh launch" = a new JavaScript runtime: the flag below lives in memory only, so returning from
// the background never replays it, and the next cold start always does. Nothing is stored.
//
// To replace the video, swap the file below (see docs/splash-intro.md for the recommended format).
export const SPLASH_INTRO_VIDEO = require("../assets/videos/p2p-splash-intro.mp4");
const VIDEO_BG = "#000000"; // the video's own background

/** Where in the clip the intro starts (0 = the beginning). The clip itself is already 0:08–end of the owner's
 * original (2026-11-10), so it starts at the beginning; a later start is skipped, never shown. */
export const SPLASH_START_SECONDS = 0;
const START_TIMEOUT_MS = 2500;
const MAX_INTRO_MS = 9000;
const VIDEO_FADE_IN_MS = 250;
const EXIT_FADE_MS = 450;

let playedThisLaunch = false;

/** True until the intro has been shown in this JavaScript runtime (i.e. this app launch). */
export function splashIntroPending(): boolean {
  return !playedThisLaunch;
}

export default function SplashIntro() {
  const [done, setDone] = useState(() => playedThisLaunch);
  const [skip, setSkip] = useState(false);
  useEffect(() => { playedThisLaunch = true; }, []);
  // People who asked their device to reduce motion go straight into the app.
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (v) setSkip(true); }).catch(() => {}); }, []);
  if (done) return null;
  return <IntroLayer skip={skip} onDone={() => setDone(true)} />;
}

function IntroLayer({ skip, onDone }: { skip: boolean; onDone: () => void }) {
  const layer = useRef(new Animated.Value(1)).current;
  const video = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const finished = useRef(false);
  const native = Platform.OS !== "web";
  const insets = useSafeAreaInsets();

  const player = useVideoPlayer(SPLASH_INTRO_VIDEO, (p) => {
    p.muted = true;
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
    p.currentTime = SPLASH_START_SECONDS;
  });

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    SplashScreen.hideAsync().catch(() => {});
    setLeaving(true);
    try { player.pause(); } catch { /* already released */ }
    Animated.timing(layer, { toValue: 0, duration: EXIT_FADE_MS, useNativeDriver: native }).start(() => onDone());
  }, [layer, onDone, player, native]);

  const showVideo = useCallback(() => {
    if (started.current) return;
    started.current = true;
    Animated.timing(video, { toValue: 1, duration: VIDEO_FADE_IN_MS, useNativeDriver: native }).start();
  }, [video, native]);

  // A frame from before the start point is never faded in (playback advancing past it shows the video).
  const firstFrame = useCallback(() => {
    try { if (player.currentTime >= SPLASH_START_SECONDS - 0.05) showVideo(); } catch { /* released */ }
  }, [player, showVideo]);

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "readyToPlay") {
      // Some platforms ignore a start time set before loading: make sure playback begins at 0.8 s.
      if (player.currentTime < SPLASH_START_SECONDS - 0.05) player.currentTime = SPLASH_START_SECONDS;
      player.play();
    }
    if (status === "error") finish();
  });
  // Web has no first-frame event; playback advancing past the start point means a frame is showing.
  useEventListener(player, "timeUpdate", ({ currentTime }) => { if (currentTime > SPLASH_START_SECONDS) showVideo(); });
  useEventListener(player, "playToEnd", () => finish());

  useEffect(() => {
    if (skip) finish();
  }, [skip, finish]);

  useEffect(() => {
    const startTimer = setTimeout(() => { if (!started.current) finish(); }, START_TIMEOUT_MS);
    const maxTimer = setTimeout(finish, MAX_INTRO_MS);
    // Leaving the app mid-intro: when it comes back, the app is simply there. ("inactive" is
    // ignored: iOS reports it briefly at launch, e.g. while a permission prompt is shown.)
    const sub = AppState.addEventListener("change", (s) => { if (s === "background") finish(); });
    return () => { clearTimeout(startTimer); clearTimeout(maxTimer); sub.remove(); };
  }, [finish]);

  return (
    <Animated.View style={[styles.layer, { opacity: layer }]} pointerEvents={leaving ? "none" : "auto"}
      accessible accessibilityRole="image" accessibilityLabel="P2P Global" accessibilityViewIsModal
      // The black layer is on screen: let the native splash fade away over it.
      onLayout={() => { SplashScreen.setOptions({ fade: true, duration: 250 }); SplashScreen.hideAsync().catch(() => {}); }}>
      <StatusBar hidden={!leaving} style="light" />
      <Animated.View style={[styles.fill, { opacity: video }]}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture={false}
          // Android: a TextureView fades with its layer; no shutter frame before the first frame.
          surfaceType="textureView"
          useExoShutter={false}
          onFirstFrameRender={firstFrame}
        />
        <Text style={[styles.tagline, { bottom: insets.bottom + 28 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
          accessibilityElementsHidden importantForAccessibility="no">
          P2P GLOBAL
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Full screen, ignoring safe areas: the video is centred on the whole display at every size.
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10000, elevation: 10000, backgroundColor: VIDEO_BG },
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: VIDEO_BG },
  // Explicit size: on web a <video> ignores insets and keeps its own 1280×720 size.
  video: { width: "100%", height: "100%", backgroundColor: VIDEO_BG },
  // Bottom centre at every width: one line, slightly smaller on very narrow screens.
  tagline: {
    position: "absolute", left: 24, right: 24, textAlign: "center",
    color: "rgba(255,255,255,0.78)", fontSize: 11, letterSpacing: 2, fontFamily: "Inter_600SemiBold",
  },
});
