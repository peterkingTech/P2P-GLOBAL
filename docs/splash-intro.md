# Video splash intro

On every fresh launch, P2P Global plays a short branded video before the app appears. It plays once per launch and never replays when the app returns from the background.

## Launch sequence

1. The **native splash** (logo on `#06110D`, from `app.json`) shows while the app starts.
2. Once fonts are loaded, the root layout mounts the app **and** `components/SplashIntro.tsx` on top of it. The intro layer is plain black (the video's own background). The native splash fades away over it, so no logo image is drawn by the intro itself.
3. The video fades in from black when its first frame is on screen, then plays **muted, once, without controls**. It fills the whole display, ignoring safe areas, and is fitted rather than cropped, so the logo is centred and whole on every screen size. A small "P2P GLOBAL" line sits at the bottom centre, above the home indicator, on one line at every width.
4. When it ends, the layer fades out (0.45 s) and the player is released.

Throughout, the app runs normally underneath: authentication, session restore, navigation, deep links and notification taps aren't delayed or changed. When the intro fades, the screen the app has already chosen is simply revealed.

## When it plays

| Situation | Intro? |
|---|---|
| Fresh launch (signed in or not) | Yes |
| Back from the background | No: a flag lives only in memory for this JavaScript runtime, and nothing is stored |
| App closed and opened again | Yes |
| Video can't load or errors | Skipped within about 0.5 s, straight into the app |
| Video hasn't started after 2.5 s | Skipped |
| Anything else goes wrong | Gone at most 9 s after mounting; the native splash is hidden by 4 s at the latest |
| App sent to the background mid-intro | Ends; the app is there on return |
| Device asks for reduced motion | Skipped |

On Android, pressing Back on the first screen closes the window but usually keeps the app's process alive. Reopening it is then a return, not a fresh launch, so the intro doesn't play.

## The video file

`artifacts/mobile/assets/videos/p2p-splash-intro.mp4` is bundled with the app, so it works offline and is never downloaded at launch.

To replace it, put the new file at the same path (or change `SPLASH_INTRO_VIDEO` in `components/SplashIntro.tsx`) and make a new app build. Nothing else needs changing.

**Recommended format** (the current file meets all of these):

| | Recommended | Current file |
|---|---|---|
| Container | MP4, "fast start" (index at the front) | yes |
| Video | H.264 **Main** profile (plays on every iOS and Android device) | H.264 Main |
| Resolution | 1280×720 (fitted, so any aspect works; keep a plain background that matches the edges) | 1280×720, on black |
| Frame rate | 24–30 fps | 24 fps |
| Bitrate | about 2–3 Mbps | about 2.6 Mbps |
| Duration | 3–6 s (it delays the first screen) | 4.79 s |
| Audio | none (it plays muted) | none |
| Size | under 3 MB | 1.58 MB |

The current file is the owner's "P2P Splash Logo Video" (1920×1080, 10 s, 8.2 MB), cut to its first 4.79 s and re-encoded at 720p without audio.
