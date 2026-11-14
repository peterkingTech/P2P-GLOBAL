import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, ActivityIndicator, Pressable, Image, Switch, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router, useSegments } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton, FilterChip, ChipRow, SegmentedControl } from "@/components/ui";
import { listen, listenUi, useListenAppState, useListenState, useListenUi, RATES, LISTEN_MODES, TEXT_SCALES, type ListenMode, type ListenState, type BibleContinue } from "@/lib/listen";
import { baseLanguage, voiceTier } from "@/lib/listen/voices";
import { getLanguageName } from "@/lib/languageNames";
import { withAlpha } from "@/lib/colorUtils";
import { ARTWORK_FILL } from "@/constants/artwork";
import { LARGE_TABLET_BREAKPOINT, TABLET_BREAKPOINT } from "@/hooks/useLayout";
import ReadAlongText from "./ReadAlongText";
import LanguageFlag from "@/components/language/LanguageFlag";
import PlaylistControls from "./PlaylistControls";
import { listenTime, playbackTiming, progressLine } from "@/lib/listen/timing";

// P2P GLOBAL — READ & LISTEN. One shared player for every Listen button:
//   • the Listen screen in front shows its own slim bar (<ListenPlayer owner=…>);
//   • everywhere else in the app a floating mini player keeps the session in
//     reach (<ListenHost/>, mounted once at the app root) — leaving a screen
//     never stops the narration; only Stop, an error or the listener does;
//   • the full Read & Listen screen (also in the host) opens over whatever is
//     on screen. Three modes over the SAME playback (switching never restarts
//     or moves the audio): Read & Listen (default), Audio Only, Read Along.
// Layout follows the space: phones stack text over controls; tablets use a
// wider column; desktops / web and phones in landscape put the text beside a
// controls panel (the text column never stretches past a readable width).
// The voice is the phone's own speech engine — said plainly, no narrator
// persona. Steps are "a sentence back / forward". Progress is a line, the
// percentage played and the time left (lib/listen/timing, owner request
// 2026-11-10): device speech reports no length, so its times are estimates
// from the words at the chosen speed and always say "about"; a studio
// recording's real length is shown as is.
// Listening never completes anything; when it finishes, the next learning
// step is offered as a button. Branding: the official P2P Global logo in the
// header and as a faint watermark; the app icon in the mini players and as
// artwork when the content has none. Colours come from the person's theme.
const LOGO = require("@/assets/images/logo.png");
const APP_ICON = require("@/assets/images/icon.png");

const langName = (code: string) => (baseLanguage(code) === "en" ? "English" : getLanguageName(baseLanguage(code)));
const TIER_LABEL: Record<string, string> = { premium: "Premium", enhanced: "Enhanced", robotic: "Basic" };
const CONTINUE_OPTIONS: { value: BibleContinue; label: string; hint: string }[] = [
  { value: "stop", label: "Stop", hint: "Stop when this chapter ends." },
  { value: "again", label: "Listen again", hint: "Play this chapter once more from the beginning, then stop." },
  { value: "next", label: "Next chapter", hint: "Carry on chapter by chapter, up to the chapter you choose. Never goes into another book." },
];

/** The app icon, cropped to its rounded square (the file has a dark margin). */
function AppArtwork({ size, radius }: { size: number; radius: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={APP_ICON} style={{ width: size * 1.12, height: size * 1.12, margin: -size * 0.06 }} resizeMode="cover" />
    </View>
  );
}

/** Status line shared by every view of the session. */
function statusLine(st: ListenState) {
  const content = st.content!;
  const many = content.sectionTitles.length > 1;
  const where = many ? `${content.sectionTitles[st.section] || `Part ${st.section + 1}`} · ${st.section + 1} of ${content.sectionTitles.length}` : content.subtitle ?? "";
  if (st.status === "error") return st.error?.message ?? "";
  if (st.previewing) return "Previewing a voice…";
  if (st.replayCountdown != null) return st.upNext ? `Continuing to ${st.upNext} in ${st.replayCountdown}…` : `Listening again in ${st.replayCountdown}…`;
  if (st.status === "completed") return "Finished";
  if (st.status === "paused") return `Paused · ${where}`;
  if (st.status === "loading") return "Preparing…";
  return where;
}

/** The slim bar: inline under the Listen screen in front, or floating elsewhere. */
function MiniBar({ st, c, s, floating, bottomInset }: { st: ListenState; c: AppColors; s: Styles; floating?: boolean; bottomInset: number }) {
  const content = st.content!;
  const playing = st.status === "playing";
  const finished = st.status === "completed";
  const err = st.status === "error" ? st.error : null;
  const timing = playbackTiming(st);
  const progress = timing?.fraction ?? (st.chunkCount ? (st.chunk + (finished ? 1 : 0)) / st.chunkCount : 0);
  // The status, then where they are: "Genesis 1 · 45% · about 3 min left".
  const text = [statusLine(st), st.status === "playing" || st.status === "paused" ? progressLine(timing) : ""].filter(Boolean).join(" · ");
  return (
    <View style={floating ? [s.floating, { bottom: bottomInset }] : [s.bar, { paddingBottom: 6 + bottomInset }]} accessibilityRole="toolbar" accessibilityLabel="Listening">
      {/* The progress line, on both the floating and the inline bar. */}
      <View style={floating ? s.floatTrack : s.barTrack}><View style={[s.trackFill, { width: `${Math.round(progress * 100)}%` as any }]} /></View>
      <View style={s.barRow}>
        <Pressable style={s.barText} onPress={() => listen.present()} accessibilityRole="button" accessibilityLabel={`${content.title}. ${text}. Open Read and Listen`}>
          <AppArtwork size={36} radius={9} />
          <View style={{ flex: 1 }}>
            <Text style={s.barTitle} numberOfLines={1}>{content.title}</Text>
            <Text style={[s.barSub, err && s.errText]} numberOfLines={floating ? 1 : 2}>{text}</Text>
          </View>
        </Pressable>
        {err?.kind === "unavailable_language" ? (
          <AppButton label="Voices" size="sm" variant="secondary" onPress={() => listen.present()} accessibilityLabel="Choose a voice" />
        ) : st.status === "loading" ? (
          <View style={s.mainBtn}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Preparing to listen" /></View>
        ) : (
          <IconButton icon={playing ? "pause" : finished ? "refresh" : "play"} variant="tinted" onPress={() => listen.toggle()} disabled={!!err && err.kind !== "speech"}
            accessibilityLabel={playing ? "Pause listening" : finished ? "Listen again" : "Resume listening"} />
        )}
        <IconButton icon="close" size="sm" accessibilityLabel="Stop listening" onPress={() => listen.stop()} />
      </View>
    </View>
  );
}

/** Under a Listen screen: its own bar while that screen is in front. */
export default function ListenPlayer({ owner, bottomInset = 0 }: { owner: string; bottomInset?: number }) {
  const { colors: c, resolvedMode } = useTheme();
  const s = useMemo(() => makeStyles(c, resolvedMode === "dark"), [c, resolvedMode]);
  const st = useListenState();
  if (!st.content || st.content.owner !== owner || st.focusedOwner !== owner || st.status === "idle") return null;
  return <MiniBar st={st} c={c} s={s} bottomInset={bottomInset} />;
}

/**
 * Mounted once at the app root: the floating mini player (on every screen that
 * isn't the content's own Listen screen) and the full Read & Listen screen.
 */
export function ListenHost() {
  const { colors: c, resolvedMode } = useTheme();
  const s = useMemo(() => makeStyles(c, resolvedMode === "dark"), [c, resolvedMode]);
  const st = useListenState();
  const insets = useSafeAreaInsets();
  const segments = useSegments() as string[];
  useListenAppState();
  if (!st.content || st.status === "idle") return null;
  // Above the tab bar on tab screens (same height as app/(tabs)/_layout), else above the home indicator.
  const inTabs = segments[0] === "(tabs)";
  const floatBottom = insets.bottom + (inTabs ? (Platform.OS === "web" ? 50 : 54) : 0) + 8;
  return (
    <>
      {st.focusedOwner !== st.content.owner && !st.presented && <MiniBar st={st} c={c} s={s} floating bottomInset={floatBottom} />}
      <ListenScreen st={st} c={c} s={s} dark={resolvedMode === "dark"} />
    </>
  );
}

function ListenScreen({ st, c, s, dark }: { st: ListenState; c: AppColors; s: Styles; dark: boolean }) {
  const ui = useListenUi();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const content = st.content!;
  const playing = st.status === "playing";
  const many = content.sectionTitles.length > 1;
  const sectionTitle = content.sectionTitles[st.section] ?? "";
  const chosenVoice = st.voice && st.voice.kind !== "unavailable" ? st.voice.voice : null;
  const err = st.status === "error" ? st.error : null;
  const finished = st.status === "completed";
  const text = statusLine(st);
  const mainLabel = playing ? "Pause listening" : finished ? "Listen again" : "Resume listening";
  const mainDisabled = !!err && err.kind !== "speech";
  const close = () => { setSettingsOpen(false); listen.dismiss(); };
  const mode: ListenMode = ui.mode;
  const reading = mode !== "audio";
  const timing = playbackTiming(st);
  const progress = timing?.fraction ?? (st.chunkCount ? (st.chunk + (finished ? 1 : 0)) / st.chunkCount : 0);
  const bible = content.kind === "bible";
  const playlist = content.kind === "playlist";
  const partWord = playlist ? "passage" : "part";
  // A whole chapter (not a selected passage) — only chapters continue.
  const bibleChapter = bible && !/:\d+-\d+$/.test(content.key);
  const bookName = String(content.meta?.bookName ?? "this book");
  const away = st.focusedOwner !== content.owner && !!content.route;

  // ── Layout for the space available ────────────────────────────────────────
  const landscapePhone = width > height && height < 600;
  const wide = width >= LARGE_TABLET_BREAKPOINT || landscapePhone;   // text beside a controls panel
  const tablet = !wide && width >= TABLET_BREAKPOINT;
  const sidePanel = wide ? Math.min(420, Math.max(300, width * 0.36)) : 0;
  const watermark = Math.min(width, height) * 0.95;
  const artwork = content.artwork ?? null;

  // ── Pieces ────────────────────────────────────────────────────────────────
  const bigPlay = st.status === "loading"
    ? <View style={s.bigBtn}><ActivityIndicator color="#fff" accessibilityLabel="Preparing to listen" /></View>
    : (
      <Pressable style={({ pressed }) => [s.bigBtn, (mainDisabled || pressed) && { opacity: mainDisabled ? 0.4 : 0.85 }]} onPress={() => listen.toggle()} disabled={mainDisabled}
        accessibilityRole="button" accessibilityLabel={mainLabel} accessibilityState={{ disabled: mainDisabled }}>
        <Ionicons name={playing ? "pause" : finished ? "refresh" : "play"} size={32} color="#fff" style={playing || finished ? undefined : { marginLeft: 3 }} />
      </Pressable>
    );
  const smallMain = st.status === "loading"
    ? <View style={s.mainBtn}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Preparing to listen" /></View>
    : <IconButton icon={playing ? "pause" : finished ? "refresh" : "play"} variant="tinted" accessibilityLabel={mainLabel} onPress={() => listen.toggle()} disabled={mainDisabled} />;

  const progressBar = (
    <View style={{ gap: 6 }}>
      <View style={s.track} accessibilityRole="progressbar" accessibilityLabel="Listening progress"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100), text: progressLine(timing) || undefined }}>
        <View style={[s.trackFill, { width: `${Math.round(progress * 100)}%` as any }]} />
      </View>
      <View style={s.progressRow}>
        {/* Percentage played and time left (lib/listen/timing): estimated for the phone's voice ("about"),
            real for a studio recording. */}
        <Text style={s.progressText}>{progressLine(timing)}</Text>
        <Text style={[s.progressText, { flex: 1, textAlign: "right" }]} numberOfLines={1}>
          {many ? sectionTitle : timing ? `${timing.exact ? "" : "about "}${listenTime(timing.totalSeconds)} in all` : ""}
        </Text>
      </View>
    </View>
  );

  const transport = (compact: boolean) => (
    <View style={[s.controls, compact && { gap: 10 }]}>
      {!compact && <IconButton icon="play-skip-back" accessibilityLabel={`Previous ${partWord}`} onPress={() => listen.previousSection()} disabled={!!err || !many} />}
      <IconButton icon="play-back" accessibilityLabel="Back one sentence" onPress={() => listen.previousSentence()} disabled={!!err || st.chunkCount === 0} />
      {compact ? smallMain : bigPlay}
      <IconButton icon="play-forward" accessibilityLabel="Forward one sentence" onPress={() => listen.nextSentence()} disabled={!!err || st.chunk >= st.chunkCount - 1} />
      {!compact && <IconButton icon="play-skip-forward" accessibilityLabel={`Next ${partWord}`} onPress={() => listen.nextSection()} disabled={!!err || !many || st.section >= content.sectionTitles.length - 1} />}
      {compact && <IconButton icon="refresh" accessibilityLabel="Listen again from the beginning" onPress={() => listen.listenAgain()} disabled={!!err} />}
      {compact && <IconButton icon="options-outline" accessibilityLabel="Listening settings" onPress={() => setSettingsOpen((o) => !o)} selected={settingsOpen} />}
    </View>
  );

  // Repeat: Listen Again, plus — for the Bible — what happens when a chapter ends
  // (its own setting, in place of Auto Listen Again, so the two never compete).
  const repeatRow = (
    <View style={s.repeatRow}>
      <AppButton label="Listen Again" icon="refresh" size="sm" variant="secondary" onPress={() => listen.listenAgain()} disabled={!!err}
        accessibilityLabel="Listen again from the beginning" />
      {bible && bibleChapter ? (
        <View style={{ gap: 8 }}>
          <Text style={s.autoLabel}>When this chapter ends</Text>
          <SegmentedControl accessibilityLabel="When this chapter ends" value={st.bibleContinue} onChange={(v) => listen.setBibleContinue(v as BibleContinue)}
            options={CONTINUE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          <Text style={s.autoHint}>{CONTINUE_OPTIONS.find((o) => o.value === st.bibleContinue)?.hint}</Text>
          {st.bibleContinue === "next" && st.range && (
            <View style={s.rangeRow}>
              <IconButton icon="remove" size="sm" accessibilityLabel="One chapter fewer" onPress={() => listen.setBibleRange(st.range!.end - 1)} disabled={st.range.end <= Number(content.meta?.chapter)} />
              <Text style={s.rangeText} accessibilityLiveRegion="polite">Continue through {bookName} {st.range.end}{st.range.end === Number(content.meta?.lastChapter) ? " (end of book)" : ""}</Text>
              <IconButton icon="add" size="sm" accessibilityLabel="One chapter more" onPress={() => listen.setBibleRange(st.range!.end + 1)} disabled={st.range.end >= Number(content.meta?.lastChapter)} />
            </View>
          )}
        </View>
      ) : playlist ? (
        <PlaylistControls st={st} />
      ) : !bible ? (
        <View style={s.autoRow}>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.autoLabel}>Auto Listen Again</Text>
            <Text style={s.autoHint}>Plays this once more from the beginning when it finishes.</Text>
          </View>
          <Switch value={st.autoAgain} onValueChange={(v) => listen.setAutoAgain(v)} accessibilityLabel="Auto Listen Again: automatically play this content once more from the beginning when it finishes"
            trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
        </View>
      ) : null}
    </View>
  );

  // When listening finishes: the next learning step, chosen by the listener.
  const rangeEnded = bible && st.bibleContinue === "next" && !!st.range && Number(content.meta?.chapter) >= st.range.end;
  const bookEnded = bible && st.bibleContinue === "next" && !content.continueTo && bibleChapter;
  const completion = finished && (
    <View style={s.donePanel} accessibilityLiveRegion="polite">
      {st.replayCountdown != null ? (
        <>
          <Text style={s.doneTitle}>{text}</Text>
          <Text style={s.doneHint}>{st.upNext ? "Next chapter, as you chose. Stop here if you'd rather pause." : bible ? "Listening to this chapter once more, then stopping." : "Auto Listen Again plays this once more, then stops."}</Text>
          <AppButton label={st.upNext ? "Stop here" : "Don't replay"} variant="tertiary" size="sm" onPress={() => listen.cancelReplay()} />
        </>
      ) : (
        <>
          <Text style={s.doneTitle}>{bookEnded ? `End of ${bookName}` : rangeEnded ? "End of your reading range" : st.replayed ? "Finished — listened twice" : "Finished"}</Text>
          <Text style={s.doneHint}>{bookEnded ? "Choose another book or passage to keep listening." : rangeEnded ? `You've listened through ${content.title}.` : "Listening doesn't complete anything. Carry on when you're ready."}</Text>
          {(content.completionActions ?? []).map((a) => (
            <AppButton key={a.label} label={a.label} icon={a.icon as any} onPress={() => { close(); a.open(); }} />
          ))}
          {content.next && <AppButton label={`Go to ${content.next.label}`} icon="chevron-forward" iconPosition="trailing" variant="secondary" size="sm" onPress={() => content.next?.open()} />}
        </>
      )}
    </View>
  );

  const voiceRow = (v: ListenState["allVoices"][number], showLang: boolean) => {
    const tier = TIER_LABEL[voiceTier(v)];
    const selected = chosenVoice === v.identifier;
    return (
      <View key={v.identifier} style={[s.voiceRow, selected && s.voiceRowOn]}>
        <Pressable style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onPress={() => listen.setVoice(v.identifier)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
          accessibilityLabel={`${v.name}${tier ? `, ${tier}` : ""}${showLang ? `, ${v.language}` : ""}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {showLang ? <LanguageFlag language={v.language} size={14} /> : null}
            <Text style={s.voiceName}>{v.name}{showLang ? ` (${v.language})` : ""}</Text>
          </View>
          {!!tier && <Text style={s.voiceTier}>{tier}</Text>}
        </Pressable>
        <IconButton icon={st.previewing === v.identifier ? "volume-high" : "play-circle-outline"} size="sm" accessibilityLabel={`Preview ${v.name}`} onPress={() => listen.previewVoice(v.identifier)} />
        {selected && <Ionicons name="checkmark" size={18} color={c.accentGreen} accessibilityElementsHidden />}
      </View>
    );
  };

  const settings = settingsOpen && (
    <View style={s.panel}>
      {away && <AppButton label="Go to the text" icon="document-text-outline" size="sm" variant="secondary" onPress={() => { close(); router.navigate(content.route as any); }} />}
      <Text style={s.label}>Speed</Text>
      <SegmentedControl accessibilityLabel="Speaking speed" value={String(st.rate)} onChange={(v) => listen.setRate(Number(v))}
        options={RATES.map((r) => ({ value: String(r), label: `${r}×` }))} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
        <LanguageFlag language={content.language} size={14} />
        <Text style={s.label}>Voice · {langName(content.language)}</Text>
      </View>
      {st.voices.length > 0 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Voices">{st.voices.slice(0, 12).map((v) => voiceRow(v, false))}</View>
      ) : st.allVoices.length === 0 ? (
        <Text style={s.note}>This phone's default voice for {langName(content.language)} is used.</Text>
      ) : (
        <>
          <Text style={s.note}>This phone has no {langName(content.language)} voice. You can add one in your phone's speech settings, keep reading silently, or choose a voice in another language below. It will read the same words, with that language's pronunciation.</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Voices in other languages">{st.allVoices.slice(0, 30).map((v) => voiceRow(v, true))}</View>
          <AppButton label="Keep reading silently" variant="tertiary" onPress={() => { close(); listen.stop(); }} />
        </>
      )}
      {st.voice?.kind === "override" && <Text style={s.note}>Reading with a {langName(st.voice.language)} voice, as you chose.</Text>}
      <Text style={s.note}>Better voices can be downloaded in your phone's settings (on iPhone: Accessibility › Spoken Content › Voices). The app never downloads voices by itself.</Text>

      <View style={s.autoRow}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.autoLabel}>Background playback</Text>
          <Text style={s.autoHint}>Continue listening while using other apps or when your screen is locked.</Text>
          <Text style={s.autoHint}>{Platform.OS === "ios" ? "Lock-screen controls aren't available for device voices yet." : Platform.OS === "android" ? "Android may stop device voices after a while with the screen off; there are no notification controls yet." : "Your browser may pause speech while this tab is in the background."}</Text>
        </View>
        <Switch value={st.background} onValueChange={(v) => listen.setBackground(v)} accessibilityLabel="Background playback: continue listening while using other apps or when your screen is locked"
          trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
      </View>

      {(content.previous || content.next) && (
        <View style={s.linkRow}>
          {content.previous && <AppButton label={content.previous.label} icon="chevron-back" size="sm" variant="secondary" style={{ flex: 1 }} onPress={() => content.previous?.open()} />}
          {content.next && <AppButton label={content.next.label} icon="chevron-forward" iconPosition="trailing" size="sm" variant="secondary" style={{ flex: 1 }} onPress={() => content.next?.open()} />}
        </View>
      )}
      <AppButton label="Stop listening" icon="stop" size="sm" variant="tertiary" onPress={() => { close(); listen.stop(); }} />
      <Text style={s.note}>Read aloud by your phone's own voice. Listening doesn't mark anything complete.</Text>
    </View>
  );

  // The cover is always small (as in the large-screen side panel), on every
  // screen and in every mode, so it never covers the background logo.
  const ART = 96;
  const artBlock = (bigTitle: boolean) => (
    <View style={s.artBlock}>
      <View style={[s.artFrame, { width: ART, height: ART, borderRadius: ART * 0.12 }]}>
        {artwork
          ? <Image source={artwork as any} style={[ARTWORK_FILL, { borderRadius: ART * 0.12 }]} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          : <AppArtwork size={ART} radius={ART * 0.12} />}
      </View>
      <Text style={bigTitle ? s.fullTitle : s.readTitle} numberOfLines={3}>{content.title}</Text>
      {!!content.subtitle && <Text style={s.fullSub} numberOfLines={2}>{content.subtitle}</Text>}
      <Text style={[s.where, err && s.errText]}>{text}</Text>
    </View>
  );

  const readingArea = (
    <View style={s.readArea}>
      {err ? <Text style={[s.where, s.errText, { marginTop: 16 }]}>{err.message}</Text> : null}
      {/* A readable column: never stretched across a wide screen. */}
      <View style={{ flex: 1, width: "100%", maxWidth: wide || tablet ? 720 : undefined, alignSelf: "center" }}>
        <ReadAlongText state={st} c={c} dark={dark} scale={ui.textScale}
          highlight={mode === "read-listen" ? true : ui.highlight}
          follow={mode === "read-listen" ? true : ui.highlight && ui.autoScroll} />
      </View>
    </View>
  );

  const fullControls = (
    <>
      {completion}
      {progressBar}
      {transport(false)}
      {repeatRow}
      <AppButton label={settingsOpen ? "Hide settings" : "Speed, voice and more"} icon="options-outline" size="sm" variant="tertiary" onPress={() => setSettingsOpen((o) => !o)} />
      {settings}
    </>
  );

  return (
    <Modal visible={st.presented} animationType="slide" onRequestClose={close} supportedOrientations={["portrait", "landscape"]}>
      <View style={s.full} accessibilityViewIsModal>
        {/* Background: the person's theme, a quiet accent glow, the logo as a faint watermark. Decorative only. */}
        <LinearGradient colors={[c.lightCream, withAlpha(c.accentGreen, dark ? 0.16 : 0.1), c.lightCream]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <LinearGradient colors={[withAlpha(c.accentGreen, dark ? 0.22 : 0.14), withAlpha(c.accentGreen, 0)]} style={s.glow} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, s.center]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Image source={LOGO} style={{ width: watermark, height: watermark * 0.66, opacity: dark ? 0.06 : 0.045 }} resizeMode="contain" />
        </View>

        <View style={[s.fullInner, { maxWidth: wide ? undefined : tablet ? 900 : 760, paddingTop: insets.top + 4, paddingBottom: insets.bottom + 10, paddingLeft: insets.left + (wide ? 24 : 18), paddingRight: insets.right + (wide ? 24 : 18) }]}>
          {/* Header: close · P2P Global identity · text size */}
          <View style={s.fullHead}>
            <IconButton icon="chevron-down" accessibilityLabel="Close Read and Listen" onPress={close} />
            <View style={s.brand} accessible accessibilityRole="header" accessibilityLabel="P2P Global, Read and Listen">
              <Image source={LOGO} style={s.brandLogo} resizeMode="contain" />
              <Text style={s.brandText}>P2P Global</Text>
            </View>
            {reading ? (
              <View style={s.sizeRow}>
                <IconButton icon="remove" size="sm" accessibilityLabel="Smaller text" onPress={() => listenUi.update({ textScale: TEXT_SCALES[Math.max(0, TEXT_SCALES.indexOf(ui.textScale as any) - 1)] })} disabled={ui.textScale <= TEXT_SCALES[0]} />
                <IconButton icon="add" size="sm" accessibilityLabel="Larger text" onPress={() => listenUi.update({ textScale: TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, TEXT_SCALES.indexOf(ui.textScale as any) + 1)] })} disabled={ui.textScale >= TEXT_SCALES[TEXT_SCALES.length - 1]} />
              </View>
            ) : <View style={{ width: 72 }} />}
          </View>
          {reading && !wide && (
            <View style={s.titleBlock}>
              <Text style={s.readTitle} numberOfLines={1}>{content.title}</Text>
              {!!content.subtitle && <Text style={s.readSub} numberOfLines={1}>{content.subtitle}</Text>}
            </View>
          )}
          <SegmentedControl accessibilityLabel="Listening mode" value={mode} onChange={(v) => listenUi.update({ mode: v as ListenMode })}
            options={LISTEN_MODES.map((m) => ({ value: m.value, label: m.label }))} style={{ marginVertical: 8, width: "100%", maxWidth: 560, alignSelf: "center" }} />

          {mode === "read-along" && (
            <View style={{ alignSelf: "center" }}>
              <ChipRow accessibilityLabel="Read Along options">
                <FilterChip label="Highlight" icon="color-wand-outline" selected={ui.highlight} onPress={() => listenUi.update({ highlight: !ui.highlight })} />
                <FilterChip label="Auto-scroll" icon="swap-vertical" selected={ui.autoScroll} onPress={() => listenUi.update({ autoScroll: !ui.autoScroll })} />
              </ChipRow>
            </View>
          )}

          {wide ? (
            // Desktop / web / large tablet / phone landscape: text (or artwork) beside a controls panel.
            <View style={s.wideRow}>
              {/* Audio Only: the space beside the panel stays open, showing the background logo. */}
              <View style={{ flex: 1 }}>{mode === "audio" ? null : readingArea}</View>
              <ScrollView style={[s.sidePanel, { width: sidePanel }]} contentContainerStyle={{ gap: 14, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
                {artBlock(false)}
                {fullControls}
              </ScrollView>
            </View>
          ) : mode === "audio" ? (
            // Phone Audio Only: what's playing at the top, controls at the bottom, the logo between.
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "space-between", gap: 16, paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
              {artBlock(true)}
              <View style={{ gap: 14 }}>{fullControls}</View>
            </ScrollView>
          ) : (
            <>
              {readingArea}
              <ScrollView style={{ maxHeight: settingsOpen ? height * 0.45 : undefined, flexGrow: 0 }} contentContainerStyle={{ gap: 12, paddingTop: 10 }} showsVerticalScrollIndicator={false}>
                {completion}
                {mode === "read-listen" ? (
                  <>
                    {progressBar}
                    {transport(false)}
                    <View style={s.footRow}>
                      <AppButton label="Listen Again" icon="refresh" size="sm" variant="secondary" onPress={() => listen.listenAgain()} disabled={!!err} accessibilityLabel="Listen again from the beginning" />
                      <AppButton label={settingsOpen ? "Hide settings" : "More"} icon="options-outline" size="sm" variant="tertiary" onPress={() => setSettingsOpen((o) => !o)} />
                    </View>
                    {settingsOpen && repeatRow}
                    {settings}
                  </>
                ) : (
                  <>
                    <Text style={[s.progressText, { textAlign: "center" }]}>{text}</Text>
                    {transport(true)}
                    {settingsOpen && repeatRow}
                    {settings}
                  </>
                )}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** "Listen" — starts the shared player. */
export function ListenButton({ onPress, label = "Listen", active, compact }: { onPress: () => void; label?: string; active?: boolean; compact?: boolean }) {
  const { colors: c } = useTheme();
  if (compact) return <IconButton icon={active ? "headset" : "headset-outline"} accessibilityLabel={label} onPress={onPress} color={active ? c.accentGreen : c.textDark} selected={active} />;
  return <AppButton label={label} icon="headset-outline" size="sm" variant="secondary" onPress={onPress} />;
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (c: AppColors, dark: boolean) => StyleSheet.create({
  bar: { paddingLeft: 10, paddingRight: 6, paddingTop: 6, backgroundColor: c.card, borderTopWidth: 1, borderColor: c.borderBeige },
  floating: {
    position: "absolute", left: 12, right: 12, maxWidth: 560, alignSelf: "center", overflow: "hidden",
    paddingLeft: 10, paddingRight: 6, paddingVertical: 6, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    shadowColor: "#000", shadowOpacity: dark ? 0.5 : 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 12,
  },
  floatTrack: { position: "absolute", top: 0, left: 0, right: 0, height: 3, backgroundColor: withAlpha(c.accentGreen, 0.15) },
  barTrack: { height: 3, borderRadius: 2, marginBottom: 6, marginRight: 4, overflow: "hidden", backgroundColor: withAlpha(c.accentGreen, 0.15) },
  barRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  barText: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  barTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  barSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  errText: { color: "#DC2626" },
  mainBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  full: { flex: 1, backgroundColor: c.lightCream },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: "45%" },
  center: { alignItems: "center", justifyContent: "center" },
  fullInner: { flex: 1, width: "100%", alignSelf: "center" },
  fullHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  brandLogo: { width: 30, height: 20 },
  brandText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold", letterSpacing: 1.1, textTransform: "uppercase" },
  sizeRow: { flexDirection: "row", width: 72, justifyContent: "flex-end" },
  titleBlock: { alignItems: "center", marginTop: 2 },
  readTitle: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  readSub: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  readArea: { flex: 1, minHeight: 160 },
  wideRow: { flex: 1, flexDirection: "row", gap: 24, marginTop: 4 },
  sidePanel: { flexGrow: 0 },
  artBlock: { alignItems: "center", gap: 8 },
  artFrame: {
    overflow: "hidden", backgroundColor: c.card, alignItems: "center", justifyContent: "center", marginBottom: 6,
    shadowColor: "#000", shadowOpacity: dark ? 0.5 : 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  fullTitle: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  fullSub: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  where: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: c.borderBeige, overflow: "hidden" },
  trackFill: { height: "100%", backgroundColor: c.accentGreen },
  progressRow: { flexDirection: "row", gap: 12 },
  progressText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  bigBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
  footRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  repeatRow: { gap: 10, padding: 12, borderRadius: 14, backgroundColor: withAlpha(c.card, 0.9), borderWidth: 1, borderColor: c.borderBeige },
  autoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 },
  autoLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  autoHint: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rangeText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium", textAlign: "center" },
  donePanel: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: withAlpha(c.card, 0.95), borderWidth: 1, borderColor: c.borderBeige },
  doneTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
  doneHint: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
  linkRow: { flexDirection: "row", gap: 10 },
  panel: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: withAlpha(c.card, dark ? 0.85 : 0.9), borderWidth: 1, borderColor: c.borderBeige },
  label: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  note: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 6 },
  voiceRowOn: { borderColor: c.accentGreen, backgroundColor: withAlpha(c.accentGreen, 0.08) },
  voiceName: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  voiceTier: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium" },
});
