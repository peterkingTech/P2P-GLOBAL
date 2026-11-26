import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LANGUAGE_DISPLAY, type SupportedLanguage } from "@/lib/i18n";
import LanguageFlag from "@/components/language/LanguageFlag";
import { languageNativeName } from "@/lib/languageRegistry";
import {
  fetchIntroText, formatIntroDuration, introSource, logIntroEvent, saveIntroView, voiceKeys, voiceLanguage,
  type IntroOverlay, type IntroText, type IntroVideoInfo, type IntroView,
} from "@/lib/introVideos";

// The one player for every About P2P introduction (brief §4, §6F, §10).
//
// mode "required": first viewing — no skip, no close, no seeking past what has been watched (going back is fine),
//                  pausing is fine; it is complete only when playback reaches the end (playToEnd).
// mode "optional": first viewing for accounts that existed before the videos — may be skipped.
// mode "replay":   from the library or a later visit — skip, close, seek and replay freely.
//
// The picture is the text-free master. The app draws, in the chosen language: subtitles (on/off) and the film's
// on-screen text (titles, quotations, captions), positioned on the 16:9 picture as in the original edit. Voice-over
// languages are audio tracks in the same HLS stream (no second download of the picture). A language that is not
// ready is said plainly — never shown as if it were.
// Native controls are off (they would allow skipping); full screen turns the player sideways inside the app so the
// translated text stays on the picture.

type Mode = "required" | "optional" | "replay";
export interface IntroVideoPlayerProps {
  visible: boolean;
  video: IntroVideoInfo | null;
  mode: Mode;
  /** Where it was shown (analytics): first_launch, registration, getting_started, peer_guide, learning, library … */
  context: string;
  userId?: string | null;
  /** The person's saved status for this video (resume position, chosen languages). */
  view?: IntroView;
  /** Offer "Don't show automatically again" after completion (feature introductions only). */
  offerAutoOff?: boolean;
  /** Reviewers: languages that are not yet published. */
  preview?: boolean;
  onFinished: (result: { completed: boolean; skipped: boolean; autoIntroOff?: boolean }) => void;
}

const GOLD = "#E9C27A", CREAM = "#F6F1E7", MUTED = "#BFD3DE", BG = "#000000";
const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, 'Times New Roman', serif" });
// v2 (2026-11-26): v1 also stored "sound: English" whenever only subtitles were chosen — those saved choices are ignored
const PREF_KEY = "introVideos:langPrefs:v2";

export default function IntroVideoPlayer(props: IntroVideoPlayerProps) {
  if (!props.visible || !props.video) return null;
  return <PlayerModal {...props} video={props.video} />;
}

function PlayerModal({ video, mode, context, userId, view, offerAutoOff, preview, onFinished }: IntroVideoPlayerProps & { video: IntroVideoInfo }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const appLang = (i18n.language || "en") as SupportedLanguage;
  const required = mode === "required";

  // ── languages: default = app language when that asset is ready ──
  const langInfo = (code: string) => video.languages.find((l) => l.code === code);
  // Start in the app language. The languages saved with a viewing are a record of what was played (often English,
  // before a translation existed) — not a choice, so they never override; only a choice made in the language menu does.
  const [audioLang, setAudioLang] = useState<string>(() => (langInfo(appLang)?.audio ? appLang : "en"));
  const [subLang, setSubLang] = useState<string>(() => (langInfo(appLang)?.subtitles ? appLang : "en"));
  const subsOn = subLang !== "off";
  const textLang = subsOn ? subLang : (langInfo(appLang)?.overlays ? appLang : "en");
  const audioMissing = appLang !== "en" && !langInfo(appLang)?.audio;
  const subsMissing = appLang !== "en" && !langInfo(appLang)?.subtitles;
  useEffect(() => {   // remembered video-language choice (per phone), if the person changed it before
    AsyncStorage.getItem(PREF_KEY).then((raw) => {
      if (!raw) return;
      const p = JSON.parse(raw) as { audio?: string; sub?: string; appLang?: string };
      if (p.appLang !== appLang) return;   // a new app language resets the defaults
      if (p.audio && voiceKeys(video).includes(p.audio)) setAudioLang(p.audio);
      if (p.sub && (p.sub === "off" || langInfo(p.sub)?.subtitles)) setSubLang(p.sub);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (audioMissing || subsMissing) logIntroEvent(video.id, "translation_unavailable", { context, language: appLang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── timed text ──
  const [text, setText] = useState<IntroText | null>(null);
  const [overlayText, setOverlayText] = useState<IntroText | null>(null);
  useEffect(() => {
    let off = false;
    if (subsOn) fetchIntroText(video.id, subLang, preview).then((x) => { if (!off) setText(x); }).catch(() => { if (!off) setText(null); });
    else setText(null);
    fetchIntroText(video.id, textLang, preview).then((x) => { if (!off) setOverlayText(x); }).catch(() => { if (!off) setOverlayText(null); });
    return () => { off = true; };
  }, [video.id, subLang, subsOn, textLang, preview]);

  // ── player ──
  const src = introSource(video, audioLang);
  const [attempt, setAttempt] = useState(0);
  const player = useVideoPlayer(src ? { uri: src, metadata: { title: video.title, artist: "P2P Global" } } : null, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.loop = false;
    p.staysActiveInBackground = false;
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(src ? "loading" : "error");
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(video.duration);
  const [ended, setEnded] = useState(false);
  const maxWatched = useRef(Math.max(view?.maxWatched ?? 0, 0));
  const startedLogged = useRef(false);
  const resumePlay = useRef(false);   // web: a new audio language loads another file — carry on where it was
  const resumeAt = useRef(!view?.completedAt && (view?.position ?? 0) > 5 && (view?.position ?? 0) < video.duration - 5 ? view!.position : 0);

  useEventListener(player, "statusChange", ({ status: s }) => {
    if (s === "readyToPlay") {
      setStatus("ready");
      if (player.duration > 0) setDuration(player.duration);
      if (resumeAt.current) { player.currentTime = resumeAt.current; resumeAt.current = 0; }
      if (resumePlay.current) { resumePlay.current = false; player.play(); }
      if (!startedLogged.current) { startedLogged.current = true; player.play(); logIntroEvent(video.id, mode === "replay" ? "replayed" : "play_started", { context, language: audioLang }); }
    } else if (s === "error") setStatus("error");
  });
  useEventListener(player, "playingChange", ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    setNow(currentTime);
    // Watched = continuous playback, not a jump: only advance when within a second of what was already watched.
    if (currentTime <= maxWatched.current + 1.5) maxWatched.current = Math.max(maxWatched.current, currentTime);
  });
  useEventListener(player, "playToEnd", () => {
    maxWatched.current = Math.max(maxWatched.current, duration);
    setEnded(true); setControls(true);
    logIntroEvent(video.id, "completed", { context, language: audioLang, position: duration });
    void saveIntroView(userId, video.id, { position: 0, maxWatched: duration, completedAt: new Date().toISOString(), audioLanguage: audioLang, subtitleLanguage: subLang });
  });

  // Voice-over: pick the stream's audio track for the chosen language (phones; the web plays the original).
  const pickAudio = useCallback(() => {
    const tracks = player.availableAudioTracks ?? [];
    // the stream names each track by its voice key ("de", "de-2"); older streams only by language
    const match = tracks.find((tr) => tr.label === audioLang)
      ?? tracks.find((tr) => tr.language?.toLowerCase().startsWith(voiceLanguage(audioLang).toLowerCase())) ?? tracks.find((tr) => tr.language?.startsWith("en"));
    if (match && player.audioTrack?.language !== match.language) player.audioTrack = match;
  }, [player, audioLang]);
  useEventListener(player, "availableAudioTracksChange", pickAudio);
  useEffect(() => { pickAudio(); }, [pickAudio]);

  // ── save progress: every few seconds, when the app goes to the background, and on close ──
  const save = useCallback(() => {
    if (ended) return;
    void saveIntroView(userId, video.id, { position: player.currentTime || now, maxWatched: maxWatched.current, audioLanguage: audioLang, subtitleLanguage: subLang });
  }, [ended, userId, video.id, player, now, audioLang, subLang]);
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const iv = setInterval(() => saveRef.current(), 5000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") { saveRef.current(); try { player.pause(); } catch {} logIntroEvent(video.id, "interrupted", { context, position: player.currentTime }); }
    });
    return () => { clearInterval(iv); sub.remove(); saveRef.current(); };
  }, [player, video.id, context]);

  // ── controls ──
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 3500);
  }, []);
  useEffect(() => { if (playing) poke(); else setControls(true); }, [playing, poke]);
  const toggle = () => { if (ended) return; if (player.playing) player.pause(); else player.play(); poke(); };
  const seekTo = (sec: number) => {
    const limit = required ? maxWatched.current : duration;
    player.currentTime = Math.max(0, Math.min(sec, limit, duration - 0.2)); poke();
  };
  const replay = () => { setEnded(false); player.currentTime = 0; player.play(); logIntroEvent(video.id, "replayed", { context }); };

  const [menu, setMenu] = useState(false);
  const [full, setFull] = useState(false);
  const [autoOff, setAutoOff] = useState(false);
  // remember only what the person actually changed (choosing subtitles must not also pin the sound to English)
  const rememberLangs = (patch: { audio?: string; sub?: string }) => {
    AsyncStorage.getItem(PREF_KEY).then((raw) => {
      let prev: { audio?: string; sub?: string; appLang?: string } = {};
      try { prev = raw ? JSON.parse(raw) : {}; } catch {}
      const keep = prev.appLang === appLang ? { audio: prev.audio, sub: prev.sub } : {};
      return AsyncStorage.setItem(PREF_KEY, JSON.stringify({ ...keep, ...patch, appLang }));
    }).catch(() => {});
  };
  const chooseAudio = (code: string) => {
    if (code !== audioLang && introSource(video, code) !== src) { resumeAt.current = player.currentTime || now; resumePlay.current = player.playing; }
    setAudioLang(code); rememberLangs({ audio: code }); logIntroEvent(video.id, "language_selected", { context, language: code }); };
  const chooseSub = (code: string) => { setSubLang(code); rememberLangs({ sub: code }); if (code !== "off") logIntroEvent(video.id, "language_selected", { context, language: code }); };

  const close = (skipped: boolean) => {
    if (required && !ended) return;
    if (!ended) { save(); if (skipped) { logIntroEvent(video.id, "skipped", { context, position: player.currentTime }); void saveIntroView(userId, video.id, { skippedAt: new Date().toISOString() }, { skipped: true }); } }
    try { player.pause(); } catch {}
    if (autoOff) void saveIntroView(userId, video.id, { autoIntroOff: true });
    onFinished({ completed: ended, skipped, autoIntroOff: autoOff });
  };

  // ── layout: the 16:9 picture as large as the screen allows, fitted (never cropped) — owner 2026-11-26: "it has to be
  // full screen, horizontally or vertically". The controls float over the picture and hide while it plays.
  // A sideways screen (laptop, tablet, a phone turned sideways) is full screen by itself; on an upright phone the
  // full-screen button turns the picture sideways.
  const landscape = win.width > win.height;
  const turned = full && !landscape;
  const stageW = turned ? win.height : win.width;
  const stageH = turned ? win.width : win.height;
  const vw = Math.min(stageW, stageH * 16 / 9), vh = vw * 9 / 16;
  const vx = (stageW - vw) / 2, vy = (stageH - vh) / 2;
  const rtl = !!text?.rtl;
  const norm = (x: string) => x.replace(/[\s“”„«»"'’.,;:!?…–—-]+/g, " ").trim().toLowerCase();
  const cue0 = subsOn && text && !ended ? text.cues.find((c) => now >= c.t0 && now <= c.t1) : undefined;
  const overlays = (ended ? [] : overlayText?.overlays ?? []).filter((o) => now >= o.t - 0.05 && now <= o.t + o.len + 0.05);
  // The film's own text at the foot of the picture (lower thirds): subtitles move to the top while it is shown.
  const lowerShown = overlays.some((o) => o.anchor === "bottom");
  // When the film's own text already says exactly what is being spoken, the subtitle would only repeat it.
  const cue = cue0 && text?.language === overlayText?.overlaysLanguage && overlays.some((o) => norm(o.text).includes(norm(cue0.text))) ? undefined : cue0;

  const stageStyle = turned
    ? { position: "absolute" as const, width: stageW, height: stageH, left: (win.width - stageW) / 2, top: (win.height - stageH) / 2, transform: [{ rotate: "90deg" }] }
    : { flex: 1 };
  const immersive = full || landscape;   // no status bar, controls tucked to the edges

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} statusBarTranslucent
      onRequestClose={() => { if (menu) setMenu(false); else if (full) setFull(false); else close(!ended); }}>
      <StatusBar hidden={immersive} style="light" />
      <View style={styles.root}>
        <View style={stageStyle}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => (controls ? setControls(false) : poke())} accessibilityLabel={t("introVideos.showControls", "Show player controls")} />
          {src && status !== "error" ? (
            <View pointerEvents="none" style={{ position: "absolute", left: vx, top: vy, width: vw, height: vh, backgroundColor: BG, overflow: "hidden" }}>
              <VideoView key={attempt} player={player} style={{ width: vw, height: vh }} nativeControls={false} contentFit="contain" allowsPictureInPicture={false} />
              {overlays.map((o) => <OverlayText key={o.id} o={o} w={vw} h={vh} now={now} rtl={!!overlayText?.rtl} />)}
            </View>
          ) : null}
          {cue ? (
            <View pointerEvents="none" style={[styles.subWrap, { left: vx, width: vw, top: lowerShown ? vy + Math.max(6, vh * 0.04) : vy + vh - Math.max(44, vh * 0.17) }]}>
              <Text style={[styles.sub, { fontSize: Math.max(14, Math.min(26, vh * 0.042)), writingDirection: rtl ? "rtl" : "ltr" }]}>{cue.text}</Text>
            </View>
          ) : null}

          {status === "loading" ? <View style={styles.center} pointerEvents="none"><ActivityIndicator color={GOLD} size="large" /><Text style={styles.dim}>{t("introVideos.loading", "Loading video…")}</Text></View> : null}
          {status === "error" ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={36} color={MUTED} />
              <Text style={styles.errTitle}>{src ? t("introVideos.errorTitle", "The video could not be played") : t("introVideos.notUploaded", "This video is not available yet")}</Text>
              <Text style={styles.dim}>{src ? t("introVideos.errorBody", "Check your connection and try again. Your place is saved.") : t("introVideos.notUploadedBody", "It will appear here as soon as it has been published.")}</Text>
              {src ? <Pressable style={styles.btn} onPress={() => { setStatus("loading"); startedLogged.current = false; resumeAt.current = player.currentTime || resumeAt.current; player.replace({ uri: src }); setAttempt((a) => a + 1); }}><Text style={styles.btnText}>{t("introVideos.retry", "Try again")}</Text></Pressable> : null}
              {(!required || !src) ? <Pressable style={styles.btnGhost} onPress={() => onFinished({ completed: false, skipped: false })}><Text style={styles.btnGhostText}>{t("introVideos.close", "Close")}</Text></Pressable> : null}
            </View>
          ) : null}

          {/* Top bar */}
          {(controls || ended) && status !== "error" ? (
            <View style={[styles.top, { paddingTop: turned ? 12 : (immersive ? 10 : insets.top + 8), paddingLeft: 14 + (turned ? 0 : insets.left), paddingRight: 14 + (turned ? 0 : insets.right) }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kicker}>{t("introVideos.aboutP2P", "About P2P")}</Text>
                <Text style={styles.title} numberOfLines={1}>{video.title}</Text>
              </View>
              <LanguagePill audioLang={audioLang} subLang={subLang} label={t("introVideos.languages", "Audio and subtitles")} onPress={() => { setMenu(true); poke(); }} />
              {landscape ? null : <IconBtn icon={full ? "contract-outline" : "expand-outline"} label={full ? t("introVideos.exitFull", "Exit full screen") : t("introVideos.full", "Full screen")} onPress={() => { setFull((f) => !f); poke(); }} />}
              {!required || ended ? <IconBtn icon="close" label={t("introVideos.close", "Close")} onPress={() => close(!ended)} /> : null}
            </View>
          ) : null}

          {/* Bottom bar */}
          {(controls || !playing) && status === "ready" && !ended ? (
            <View style={[styles.bottom, { paddingBottom: turned ? 12 : (immersive ? 10 : insets.bottom + 12), paddingLeft: 14 + (turned ? 0 : insets.left), paddingRight: 14 + (turned ? 0 : insets.right) }]}>
              {(audioMissing || subsMissing) && !immersive ? (
                <Text style={styles.notice}>
                  {audioMissing && !subsMissing ? t("introVideos.audioMissing", "Voice-over in {{lang}} is not available yet — original audio with {{lang}} subtitles.", { lang: LANGUAGE_DISPLAY[appLang]?.native ?? appLang })
                    : subsMissing ? t("introVideos.allMissing", "This video is not yet available in {{lang}} — original English audio and subtitles.", { lang: LANGUAGE_DISPLAY[appLang]?.native ?? appLang }) : ""}
                </Text>
              ) : null}
              <View style={styles.row}>
                <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={playing ? t("introVideos.pause", "Pause") : t("introVideos.play", "Play")} style={styles.play}>
                  <Ionicons name={playing ? "pause" : "play"} size={22} color="#0B0F0C" />
                </Pressable>
                <Scrubber now={now} duration={duration} watched={required ? maxWatched.current : duration} onSeek={seekTo} label={t("introVideos.position", "Playback position")} />
                <Text style={styles.time}>{formatIntroDuration(now)} / {formatIntroDuration(duration)}</Text>
                <IconBtn icon={subsOn ? "chatbox-ellipses" : "chatbox-ellipses-outline"} label={subsOn ? t("introVideos.subsOff", "Turn subtitles off") : t("introVideos.subsOn", "Turn subtitles on")}
                  onPress={() => chooseSub(subsOn ? "off" : (langInfo(appLang)?.subtitles ? appLang : "en"))} />
              </View>
              {required ? <Text style={styles.hint}>{t("introVideos.requiredHint", "Please watch this introduction to the end. You can pause at any time.")}</Text> : null}
            </View>
          ) : null}

          {/* End */}
          {ended ? (
            <View style={styles.endWrap}>
              <Ionicons name="checkmark-circle" size={40} color={GOLD} />
              <Text style={styles.endTitle}>{t("introVideos.thanks", "Thank you for watching")}</Text>
              {offerAutoOff ? (
                <View style={styles.autoRow}>
                  <Text style={styles.autoText}>{t("introVideos.autoOff", "Don't show introductions automatically again")}</Text>
                  <Switch value={autoOff} onValueChange={setAutoOff} trackColor={{ true: GOLD }} accessibilityLabel={t("introVideos.autoOff", "Don't show introductions automatically again")} />
                </View>
              ) : null}
              <Text style={styles.dim}>{t("introVideos.findAgain", "You can watch every video again in More → About P2P.")}</Text>
              <View style={styles.row}>
                <Pressable style={styles.btnGhost} onPress={replay}><Text style={styles.btnGhostText}>{t("introVideos.replay", "Watch again")}</Text></Pressable>
                <Pressable style={styles.btn} onPress={() => close(false)}><Text style={styles.btnText}>{mode === "replay" ? t("introVideos.close", "Close") : t("introVideos.continue", "Continue")}</Text></Pressable>
              </View>
            </View>
          ) : null}

          {menu ? (
            <LanguageMenu video={video} audioLang={audioLang} subLang={subLang} onAudio={chooseAudio} onSub={chooseSub} onClose={() => setMenu(false)} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function IconBtn({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.iconBtn}>
      <Ionicons name={icon} size={22} color={CREAM} />
    </Pressable>
  );
}

function Scrubber({ now, duration, watched, onSeek, label }: { now: number; duration: number; watched: number; onSeek: (s: number) => void; label: string }) {
  const [w, setW] = useState(1);
  const pct = duration > 0 ? Math.min(1, now / duration) : 0;
  const wp = duration > 0 ? Math.min(1, watched / duration) : 0;
  const at = (x: number) => onSeek((Math.max(0, Math.min(w, x)) / w) * duration);
  return (
    <View style={styles.scrub} onLayout={(e) => setW(e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true} onResponderGrant={(e) => at(e.nativeEvent.locationX)} onResponderMove={(e) => at(e.nativeEvent.locationX)}
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(now) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onSeek(now + (e.nativeEvent.actionName === "increment" ? 10 : -10))}>
      <View style={styles.track} />
      <View style={[styles.track, { width: `${wp * 100}%`, backgroundColor: "rgba(246,241,231,0.35)" }]} />
      <View style={[styles.track, { width: `${pct * 100}%`, backgroundColor: GOLD }]} />
      <View style={[styles.knob, { left: `${pct * 100}%` }]} />
    </View>
  );
}

/** One piece of the film's on-screen text, placed and sized on the picture as in the original edit. */
function OverlayText({ o, w, h, now, rtl }: { o: IntroOverlay; w: number; h: number; now: number; rtl: boolean }) {
  const fade = Math.min(0.6, o.len / 4);
  const a = Math.max(0, Math.min(1, (now - o.t) / fade, (o.t + o.len - now) / 0.4));
  const op = useRef(new Animated.Value(a)).current;
  useEffect(() => { Animated.timing(op, { toValue: a, duration: 240, useNativeDriver: true }).start(); }, [a, op]);
  const k = h / 1080;
  const color = o.color === "gold" ? GOLD : o.color === "muted" ? MUTED : CREAM;
  const family = o.font === "serif" || o.font === "serif-italic" || o.font === "script" ? SERIF : (o.font === "sans-bold" ? "Inter_700Bold" : "Inter_600SemiBold");
  const left = o.align === "center" ? w * 0.06 : o.x * w;
  const width = o.w ? o.w * w : o.align === "center" ? w * 0.88 : w * Math.max(0.2, 0.92 - o.x);
  return (
    <Animated.View style={[{ position: "absolute", left, width, opacity: op },
      o.anchor === "bottom" ? { bottom: (1 - o.y) * h } : o.anchor === "middle" ? { top: 0, bottom: 0, justifyContent: "center", transform: [{ translateY: (o.y - 0.5) * h }] } : { top: o.y * h }]}>
      <Text style={{ color, fontFamily: family, fontStyle: o.font === "serif-italic" || o.font === "script" ? "italic" : "normal", fontSize: Math.max(9, o.size * k),
        lineHeight: Math.max(11, o.size * k * 1.3), textAlign: o.align === "center" ? "center" : (rtl ? "right" : "left"), writingDirection: rtl ? "rtl" : "ltr",
        textShadowColor: "rgba(0,0,0,0.75)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 }, letterSpacing: o.role === "ref" || o.role === "label" || o.brand ? 1.2 * k * 2 : 0 }}>
        {o.text}
      </Text>
      {o.ref ? <Text style={{ color: GOLD, fontFamily: "Inter_600SemiBold", fontSize: Math.max(8, 26 * k), marginTop: 10 * k, textAlign: o.align === "center" ? "center" : "left", letterSpacing: 2 * k }}>{o.ref.toUpperCase()}</Text> : null}
    </Animated.View>
  );
}

// app languages first; others (e.g. Nigerian Pidgin, a film language but not an app language) from the language registry
const langName = (c: string) => LANGUAGE_DISPLAY[c as SupportedLanguage]?.native ?? (languageNativeName(c) || c);

/** Top-bar language button: the voice's flag, the translate sign, the subtitles' flag — plainly "change languages". */
function LanguagePill({ audioLang, subLang, label, onPress }: { audioLang: string; subLang: string; label: string; onPress: () => void }) {
  const subsOff = subLang === "off";
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.langPill} accessibilityRole="button"
      accessibilityLabel={`${label}: ${langName(voiceLanguage(audioLang))} / ${subsOff ? "—" : langName(subLang)}`}>
      <View style={styles.pillSide}>
        <LanguageFlag language={voiceLanguage(audioLang)} size={17} style={{ color: CREAM }} />
        <Ionicons name="volume-medium" size={12} color={CREAM} style={styles.pillBadge} />
      </View>
      <View style={styles.pillCenter}><Ionicons name="language" size={18} color={GOLD} /></View>
      <View style={styles.pillSide}>
        {subsOff ? <Ionicons name="close-circle-outline" size={17} color={MUTED} /> : <LanguageFlag language={subLang} size={17} style={{ color: CREAM }} />}
        <Text style={styles.pillCc}>CC</Text>
      </View>
    </Pressable>
  );
}

function LanguageMenu({ video, audioLang, subLang, onAudio, onSub, onClose }: { video: IntroVideoInfo; audioLang: string; subLang: string; onAudio: (c: string) => void; onSub: (c: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const audio = video.languages.filter((l) => l.audio);
  const subs = video.languages.filter((l) => l.subtitles);
  const voiceLine = (l: IntroVideoInfo["languages"][number], x: { key: string; name: string; gender: "male" | "female" }) => x.name
    ? `${x.name} · ${x.gender === "female" ? t("introVideos.womansVoice", "woman's voice") : t("introVideos.mansVoice", "man's voice")}${x.key === "en" ? ` · ${t("introVideos.original", "original")}` : ""}`
    : undefined;
  return (
    <View style={styles.menuShade}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("introVideos.close", "Close")} />
      <View style={styles.menu}>
        <ScrollView>
          <View style={styles.menuHeadRow}><Ionicons name="mic-outline" size={16} color={GOLD} /><Text style={styles.menuHead}>{t("introVideos.voice", "Voice")}</Text></View>
          <Text style={styles.menuNote}>{t("introVideos.voiceLead", "Choose the voice you want to listen to.")}</Text>
          {/* One row per language; its voices as buttons with a man / woman icon and the narrator's name
              (owner 2026-11-26: the choice of a man's or a woman's voice must be obvious). */}
          {audio.map((l) => {
            const vs = l.voices?.length ? l.voices : [{ key: l.code, ...(l.voice ?? { name: "", gender: "male" as const }) }];
            const langOn = vs.some((x) => x.key === audioLang);
            return (
              <View key={`a${l.code}`} style={[styles.voiceRow, langOn && styles.choiceOn]}>
                <LanguageFlag language={l.code} size={20} style={{ color: CREAM }} />
                <Text style={[styles.choiceText, styles.voiceLang]} numberOfLines={1}>{langName(l.code)}</Text>
                <View style={styles.voiceBtns}>
                  {vs.map((x) => {
                    const on = audioLang === x.key;
                    return (
                      <Pressable key={x.key} onPress={() => onAudio(x.key)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                        accessibilityLabel={`${langName(l.code)}, ${voiceLine(l, x) ?? x.name}`} style={[styles.voiceBtn, on && styles.voiceBtnOn]}>
                        <Ionicons name={x.gender === "female" ? "woman" : "man"} size={15} color={on ? "#0B0F0C" : CREAM} />
                        <Text style={[styles.voiceBtnText, on && { color: "#0B0F0C" }]} numberOfLines={1}>{x.name || langName(l.code)}</Text>
                        <Text style={[styles.voiceBtnSub, on && { color: "#0B0F0C" }]} numberOfLines={1}>{x.gender === "female" ? t("introVideos.woman", "woman") : t("introVideos.man", "man")}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          {audio.length <= 1 ? <Text style={styles.menuNote}>{t("introVideos.moreVoices", "Voice-overs in more languages are being prepared.")}</Text> : null}
          <View style={[styles.menuHeadRow, { marginTop: 16 }]}><Ionicons name="text-outline" size={16} color={GOLD} /><Text style={styles.menuHead}>{t("introVideos.subtitles", "Subtitles")}</Text></View>
          <Choice label={t("introVideos.off", "Off")} on={subLang === "off"} onPress={() => onSub("off")} />
          {subs.map((l) => <Choice key={`s${l.code}`} code={l.code} label={langName(l.code)} on={subLang === l.code} onPress={() => onSub(l.code)} />)}
        </ScrollView>
        <Pressable style={[styles.btn, { alignSelf: "stretch", marginTop: 10 }]} onPress={onClose}><Text style={styles.btnText}>{t("introVideos.done", "Done")}</Text></Pressable>
      </View>
    </View>
  );
}
function Choice({ code, label, detail, on, onPress }: { code?: string; label: string; detail?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, on && styles.choiceOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}>
      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? GOLD : MUTED} />
      {code ? <LanguageFlag language={code} size={20} style={{ color: CREAM }} /> : <View style={{ width: 25 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceText}>{label}</Text>
        {detail ? <Text style={styles.choiceDetail}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  dim: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
  errTitle: { color: CREAM, fontFamily: "Inter_600SemiBold", fontSize: 16, textAlign: "center" },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: "rgba(0,0,0,0.45)" },
  kicker: { color: GOLD, fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  title: { color: CREAM, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 10, gap: 8, backgroundColor: "rgba(0,0,0,0.5)" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  scrub: { flex: 1, height: 32, justifyContent: "center" },
  track: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: "rgba(246,241,231,0.18)" },
  knob: { position: "absolute", width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: CREAM },
  time: { color: CREAM, fontFamily: "Inter_500Medium", fontSize: 12, minWidth: 84, textAlign: "center" },
  hint: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 12, textAlign: "center" },
  notice: { color: GOLD, fontFamily: "Inter_500Medium", fontSize: 12, textAlign: "center" },
  subWrap: { position: "absolute", alignItems: "center", paddingHorizontal: 12 },
  sub: { color: CREAM, fontFamily: "Inter_500Medium", textAlign: "center", backgroundColor: "rgba(0,0,0,0.62)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  endWrap: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center", gap: 14, padding: 28 },
  endTitle: { color: CREAM, fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
  autoRow: { flexDirection: "row", alignItems: "center", gap: 12, maxWidth: 420 },
  autoText: { color: CREAM, fontFamily: "Inter_400Regular", fontSize: 14, flex: 1 },
  btn: { backgroundColor: GOLD, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, alignItems: "center" },
  btnText: { color: "#0B0F0C", fontFamily: "Inter_700Bold", fontSize: 15 },
  btnGhost: { borderColor: "rgba(246,241,231,0.4)", borderWidth: 1, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 24 },
  btnGhostText: { color: CREAM, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  menuShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  menu: { backgroundColor: "#121813", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "70%" },
  menuHeadRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  menuHead: { color: GOLD, fontFamily: "Inter_700Bold", fontSize: 13, letterSpacing: 1, textTransform: "uppercase" },
  menuNote: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 12, marginBottom: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
  choiceOn: { backgroundColor: "rgba(232,197,122,0.10)" },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, flexWrap: "wrap" },
  voiceLang: { width: 130, flexShrink: 1 },
  voiceBtns: { flexDirection: "row", gap: 8, flexWrap: "wrap", flex: 1 },
  voiceBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(232,197,122,0.45)", backgroundColor: "rgba(255,255,255,0.05)" },
  voiceBtnOn: { backgroundColor: GOLD, borderColor: GOLD },
  voiceBtnText: { color: CREAM, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  voiceBtnSub: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 12 },
  choiceText: { color: CREAM, fontFamily: "Inter_500Medium", fontSize: 15, textAlign: "left" },
  choiceDetail: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 },
  langPill: { flexDirection: "row", alignItems: "center", height: 40, borderRadius: 20, paddingHorizontal: 8, gap: 2,
    backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(232,197,122,0.45)" },
  pillSide: { flexDirection: "row", alignItems: "center", gap: 1 },
  pillCenter: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(232,197,122,0.16)", marginHorizontal: 2 },
  pillBadge: { marginLeft: -2, opacity: 0.85 },
  pillCc: { color: CREAM, fontFamily: "Inter_700Bold", fontSize: 8, opacity: 0.85, marginLeft: 1 },
});
