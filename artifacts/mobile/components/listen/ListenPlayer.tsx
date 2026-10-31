import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, ActivityIndicator, Pressable, Image, Switch, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton, FilterChip, ChipRow, SegmentedControl } from "@/components/ui";
import { listen, listenUi, useListenState, useListenUi, RATES, LISTEN_MODES, TEXT_SCALES, type ListenMode } from "@/lib/listen";
import { baseLanguage } from "@/lib/listen/voices";
import { getLanguageName } from "@/lib/languageNames";
import { withAlpha } from "@/lib/colorUtils";
import { ARTWORK_FILL } from "@/constants/artwork";
import ReadAlongText from "./ReadAlongText";

// P2P GLOBAL — READ & LISTEN. The one shared player for every Listen button:
// a slim bar under the content, and the full Read & Listen screen that opens
// when someone presses Listen. Three modes over the SAME playback (switching
// never restarts or moves the audio):
//   • Read & Listen (first time default) — the text, the current sentence or
//     verse highlighted, following the voice;
//   • Audio Only — artwork, title, progress and controls;
//   • Read Along — the text at your own pace, with a compact player and
//     switches for highlighting and following.
// The voice is the phone's own speech engine — said plainly, no narrator
// persona. Device speech has no length or seconds, so progress is shown in
// sentences and the steps are "a sentence back / forward" (no fake times).
// Listening never completes anything and never moves on by itself: when it
// finishes, the next learning step (Personal Reflections, Comprehensive
// Check…) is offered as a button.
//
// Branding: the official assets only — the P2P Global logo (assets/images/
// logo.png) — the one logo in the header — and as a faint watermark, and the
// app icon (assets/images/icon.png) in the mini bar and as artwork when the
// content has none. Colours come from the person's P2P theme (light or dark); no
// animation beyond the Modal's slide and the text's scroll.
const LOGO = require("@/assets/images/logo.png");
const APP_ICON = require("@/assets/images/icon.png");

const langName = (code: string) => (baseLanguage(code) === "en" ? "English" : getLanguageName(baseLanguage(code)));

/** The app icon, cropped to its rounded square (the file has a dark margin). */
function AppArtwork({ size, radius }: { size: number; radius: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={APP_ICON} style={{ width: size * 1.12, height: size * 1.12, margin: -size * 0.06 }} resizeMode="cover" />
    </View>
  );
}

export default function ListenPlayer({ owner, bottomInset = 0 }: { owner: string; bottomInset?: number }) {
  const { colors: c, resolvedMode } = useTheme();
  const dark = resolvedMode === "dark";
  const s = useMemo(() => makeStyles(c, dark), [c, dark]);
  const st = useListenState();
  const ui = useListenUi();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  if (!st.content || st.content.owner !== owner || st.status === "idle") return null;

  const content = st.content;
  const playing = st.status === "playing";
  const sectionTitle = content.sectionTitles[st.section] ?? "";
  const many = content.sectionTitles.length > 1;
  const chosenVoice = st.voice && st.voice.kind !== "unavailable" ? st.voice.voice : null;
  const where = many ? `${sectionTitle || `Part ${st.section + 1}`} · ${st.section + 1} of ${content.sectionTitles.length}` : content.subtitle ?? "";
  const err = st.status === "error" ? st.error : null;
  const finished = st.status === "completed";
  const statusText = err ? err.message
    : st.replayCountdown != null ? `Listening again in ${st.replayCountdown}…`
    : finished ? "Finished" : st.status === "paused" ? `Paused · ${where}` : st.status === "loading" ? "Preparing…" : where;
  const mainLabel = playing ? "Pause listening" : finished ? "Listen again" : "Resume listening";
  const mainDisabled = !!err && err.kind !== "speech";
  const open = st.presented;
  const close = () => { setSettingsOpen(false); listen.dismiss(); };
  const mode: ListenMode = ui.mode;
  const progress = st.chunkCount ? (st.chunk + (finished ? 1 : 0)) / st.chunkCount : 0;

  const smallMain = st.status === "loading"
    ? <View style={s.mainBtn}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Preparing to listen" /></View>
    : <IconButton icon={playing ? "pause" : finished ? "refresh" : "play"} variant="tinted" accessibilityLabel={mainLabel} onPress={() => listen.toggle()} disabled={mainDisabled} />;

  // ── Pieces of the full screen ────────────────────────────────────────────
  const bigPlay = st.status === "loading"
    ? <View style={s.bigBtn}><ActivityIndicator color="#fff" accessibilityLabel="Preparing to listen" /></View>
    : (
      <Pressable style={({ pressed }) => [s.bigBtn, (mainDisabled || pressed) && { opacity: mainDisabled ? 0.4 : 0.85 }]} onPress={() => listen.toggle()} disabled={mainDisabled}
        accessibilityRole="button" accessibilityLabel={mainLabel} accessibilityState={{ disabled: mainDisabled }}>
        <Ionicons name={playing ? "pause" : finished ? "refresh" : "play"} size={32} color="#fff" style={playing || finished ? undefined : { marginLeft: 3 }} />
      </Pressable>
    );

  const progressBar = (
    <View style={{ gap: 6 }}>
      <View style={s.track} accessibilityRole="progressbar" accessibilityLabel="Listening progress" accessibilityValue={{ min: 0, max: st.chunkCount, now: Math.min(st.chunkCount, st.chunk + 1) }}>
        <View style={[s.trackFill, { width: `${Math.round(progress * 100)}%` as any }]} />
      </View>
      <View style={s.progressRow}>
        {/* Sentences, not minutes: device speech reports no length or time. */}
        <Text style={s.progressText}>{st.chunkCount ? `${Math.min(st.chunkCount, st.chunk + 1)} of ${st.chunkCount}` : ""}</Text>
        <Text style={[s.progressText, { flex: 1, textAlign: "right" }]} numberOfLines={1}>{many ? sectionTitle : ""}</Text>
      </View>
    </View>
  );

  const transport = (compact: boolean) => (
    <View style={[s.controls, compact && { gap: 10 }]}>
      {!compact && <IconButton icon="play-skip-back" accessibilityLabel="Previous part" onPress={() => listen.previousSection()} disabled={!!err || !many} />}
      <IconButton icon="play-back" accessibilityLabel="Back one sentence" onPress={() => listen.previousSentence()} disabled={!!err || st.chunkCount === 0} />
      {compact ? smallMain : bigPlay}
      <IconButton icon="play-forward" accessibilityLabel="Forward one sentence" onPress={() => listen.nextSentence()} disabled={!!err || st.chunk >= st.chunkCount - 1} />
      {!compact && <IconButton icon="play-skip-forward" accessibilityLabel="Next part" onPress={() => listen.nextSection()} disabled={!!err || !many || st.section >= content.sectionTitles.length - 1} />}
      {compact && <IconButton icon="refresh" accessibilityLabel="Listen again from the beginning" onPress={() => listen.listenAgain()} disabled={!!err} />}
      {compact && <IconButton icon="options-outline" accessibilityLabel="Listening settings" onPress={() => setSettingsOpen((o) => !o)} selected={settingsOpen} />}
    </View>
  );

  const repeatRow = (
    <View style={s.repeatRow}>
      <AppButton label="Listen Again" icon="refresh" size="sm" variant="secondary" onPress={() => listen.listenAgain()} disabled={!!err}
        accessibilityLabel="Listen again from the beginning" />
      <View style={s.autoRow}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.autoLabel}>Auto Listen Again</Text>
          <Text style={s.autoHint}>Plays this once more from the beginning when it finishes.</Text>
        </View>
        <Switch value={st.autoAgain} onValueChange={(v) => listen.setAutoAgain(v)} accessibilityLabel="Auto Listen Again: automatically play this content once more from the beginning when it finishes"
          trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
      </View>
    </View>
  );

  // When listening finishes: the next learning step, chosen by the listener.
  const completion = finished && (
    <View style={s.donePanel} accessibilityLiveRegion="polite">
      {st.replayCountdown != null ? (
        <>
          <Text style={s.doneTitle}>Listening again in {st.replayCountdown}…</Text>
          <Text style={s.doneHint}>Auto Listen Again plays this once more, then stops.</Text>
          <AppButton label="Don't replay" variant="tertiary" size="sm" onPress={() => listen.cancelReplay()} />
        </>
      ) : (
        <>
          <Text style={s.doneTitle}>{st.replayed ? "Finished — listened twice" : "Finished"}</Text>
          <Text style={s.doneHint}>Listening doesn't complete anything. Carry on when you're ready.</Text>
          {(content.completionActions ?? []).map((a) => (
            <AppButton key={a.label} label={a.label} icon={a.icon as any} onPress={() => { close(); a.open(); }} />
          ))}
          {content.next && <AppButton label={`Go to ${content.next.label}`} icon="chevron-forward" iconPosition="trailing" variant="secondary" size="sm" onPress={() => content.next?.open()} />}
        </>
      )}
    </View>
  );

  const settings = settingsOpen && (
    <View style={s.panel}>
      <Text style={s.label}>Speed</Text>
      <SegmentedControl accessibilityLabel="Speaking speed" value={String(st.rate)} onChange={(v) => listen.setRate(Number(v))}
        options={RATES.map((r) => ({ value: String(r), label: `${r}×` }))} />

      <Text style={[s.label, { marginTop: 6 }]}>Voice · {langName(content.language)}</Text>
      {st.voices.length > 0 ? (
        <ChipRow accessibilityLabel="Voices" single>
          {st.voices.slice(0, 12).map((v) => (
            <FilterChip key={v.identifier} selection="single" label={v.name} selected={chosenVoice === v.identifier} onPress={() => listen.setVoice(v.identifier)} />
          ))}
        </ChipRow>
      ) : st.allVoices.length === 0 ? (
        <Text style={s.note}>This phone's default voice for {langName(content.language)} is used.</Text>
      ) : (
        <>
          <Text style={s.note}>This phone has no {langName(content.language)} voice. You can add one in your phone's speech settings, keep reading silently, or choose a voice in another language below. It will read the same words, with that language's pronunciation.</Text>
          <ChipRow accessibilityLabel="Voices in other languages" single>
            {st.allVoices.slice(0, 40).map((v) => (
              <FilterChip key={v.identifier} selection="single" label={`${v.name} (${v.language})`} selected={chosenVoice === v.identifier} onPress={() => listen.setVoice(v.identifier)} />
            ))}
          </ChipRow>
          <AppButton label="Keep reading silently" variant="tertiary" onPress={() => { close(); listen.stop(); }} />
        </>
      )}
      {st.voice?.kind === "override" && <Text style={s.note}>Reading with a {langName(st.voice.language)} voice, as you chose.</Text>}
      {(content.previous || content.next) && (
        <View style={s.linkRow}>
          {content.previous && <AppButton label={content.previous.label} icon="chevron-back" size="sm" variant="secondary" style={{ flex: 1 }} onPress={() => content.previous?.open()} />}
          {content.next && <AppButton label={content.next.label} icon="chevron-forward" iconPosition="trailing" size="sm" variant="secondary" style={{ flex: 1 }} onPress={() => content.next?.open()} />}
        </View>
      )}
      <AppButton label="Stop listening" icon="stop" size="sm" variant="tertiary" onPress={() => { close(); listen.stop(); }} />
      <Text style={s.note}>Read aloud by your phone's own voice. Listening doesn't mark anything complete. Speech pauses when you leave this screen or the app.</Text>
    </View>
  );

  const landscape = width > height;
  const art = Math.round(Math.min(landscape ? height * 0.42 : width * 0.62, 260));
  const watermark = Math.min(width, height) * 0.95;
  const artwork = content.artwork ?? null;
  const reading = mode !== "audio";

  const audioOnly = (
    <View style={[s.artBlock, landscape && { flex: 1 }]}>
      <View style={[s.artFrame, { width: art, height: art, borderRadius: art * 0.12 }]}>
        {artwork
          ? <Image source={artwork as any} style={[ARTWORK_FILL, { borderRadius: art * 0.12 }]} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          : <AppArtwork size={art} radius={art * 0.12} />}
      </View>
      <Text style={s.fullTitle} numberOfLines={3}>{content.title}</Text>
      {!!content.subtitle && <Text style={s.fullSub} numberOfLines={2}>{content.subtitle}</Text>}
      <Text style={[s.where, err && s.errText]}>{statusText}</Text>
    </View>
  );

  return (
    <>
      <View style={[s.bar, { paddingBottom: 6 + bottomInset }]} accessibilityRole="toolbar" accessibilityLabel="Listening">
        <Pressable style={s.barText} onPress={() => listen.present()} accessibilityRole="button" accessibilityLabel={`${content.title}. ${statusText}. Open Read and Listen`}>
          <AppArtwork size={36} radius={9} />
          <View style={{ flex: 1 }}>
            <Text style={s.barTitle} numberOfLines={1}>{content.title}</Text>
            <Text style={[s.barSub, err && s.errText]} numberOfLines={2}>{statusText}</Text>
          </View>
        </Pressable>
        {err?.kind === "unavailable_language" ? (
          <AppButton label="Voices" size="sm" variant="secondary" onPress={() => { listen.present(); setSettingsOpen(true); }} accessibilityLabel="Choose a voice" />
        ) : smallMain}
        <IconButton icon="close" size="sm" accessibilityLabel="Stop listening" onPress={() => { close(); listen.stop(); }} />
      </View>

      <Modal visible={open} animationType="slide" onRequestClose={close} supportedOrientations={["portrait", "landscape"]}>
        <View style={s.full} accessibilityViewIsModal>
          {/* Background: the person's theme, a quiet accent glow, the logo as a faint watermark. Decorative only. */}
          <LinearGradient colors={[c.lightCream, withAlpha(c.accentGreen, dark ? 0.16 : 0.1), c.lightCream]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <LinearGradient colors={[withAlpha(c.accentGreen, dark ? 0.22 : 0.14), withAlpha(c.accentGreen, 0)]} style={s.glow} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, s.center]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Image source={LOGO} style={{ width: watermark, height: watermark * 0.66, opacity: dark ? 0.06 : 0.045 }} resizeMode="contain" />
          </View>

          <View style={[s.fullInner, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 10, paddingLeft: insets.left + 18, paddingRight: insets.right + 18 }]}>
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
            {reading && (
              <View style={s.titleBlock}>
                <Text style={s.readTitle} numberOfLines={1}>{content.title}</Text>
                {!!content.subtitle && <Text style={s.readSub} numberOfLines={1}>{content.subtitle}</Text>}
              </View>
            )}
            <SegmentedControl accessibilityLabel="Listening mode" value={mode} onChange={(v) => listenUi.update({ mode: v as ListenMode })}
              options={LISTEN_MODES.map((m) => ({ value: m.value, label: m.label }))} style={{ marginVertical: 8 }} />

            {mode === "read-along" && (
              <ChipRow accessibilityLabel="Read Along options">
                <FilterChip label="Highlight" icon="color-wand-outline" selected={ui.highlight} onPress={() => listenUi.update({ highlight: !ui.highlight })} />
                <FilterChip label="Auto-scroll" icon="swap-vertical" selected={ui.autoScroll} onPress={() => listenUi.update({ autoScroll: !ui.autoScroll })} />
              </ChipRow>
            )}

            {/* Body */}
            {mode === "audio" ? (
              <ScrollView contentContainerStyle={[{ gap: 16, paddingVertical: 8 }, landscape && { flexDirection: "row", alignItems: "center" }]} showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                {audioOnly}
                <View style={[{ gap: 14 }, landscape && { flex: 1.2 }]}>
                  {progressBar}
                  {transport(false)}
                  {completion}
                  {repeatRow}
                  <AppButton label={settingsOpen ? "Hide settings" : "Speed, voice and more"} icon="options-outline" size="sm" variant="tertiary" onPress={() => setSettingsOpen((o) => !o)} />
                  {settings}
                </View>
              </ScrollView>
            ) : (
              <>
                <View style={s.readArea}>
                  {err ? <Text style={[s.where, s.errText, { marginTop: 16 }]}>{err.message}</Text> : null}
                  <ReadAlongText state={st} c={c} dark={dark} scale={ui.textScale}
                    highlight={mode === "read-listen" ? true : ui.highlight}
                    follow={mode === "read-listen" ? true : ui.highlight && ui.autoScroll} />
                </View>
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
                      <Text style={[s.progressText, { textAlign: "center" }]}>{statusText}</Text>
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
    </>
  );
}

/** "Listen" — starts the shared player. */
export function ListenButton({ onPress, label = "Listen", active, compact }: { onPress: () => void; label?: string; active?: boolean; compact?: boolean }) {
  const { colors: c } = useTheme();
  if (compact) return <IconButton icon={active ? "headset" : "headset-outline"} accessibilityLabel={label} onPress={onPress} color={active ? c.accentGreen : c.textDark} selected={active} />;
  return <AppButton label={label} icon="headset-outline" size="sm" variant="secondary" onPress={onPress} />;
}

const makeStyles = (c: AppColors, dark: boolean) => StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 6, paddingTop: 6,
    backgroundColor: c.card, borderTopWidth: 1, borderColor: c.borderBeige,
  },
  barText: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  barTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  barSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  errText: { color: "#DC2626" },
  mainBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  full: { flex: 1, backgroundColor: c.lightCream },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: "45%" },
  center: { alignItems: "center", justifyContent: "center" },
  fullInner: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  fullHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  brandLogo: { width: 30, height: 20 },
  brandText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold", letterSpacing: 1.1, textTransform: "uppercase" },
  sizeRow: { flexDirection: "row", width: 72, justifyContent: "flex-end" },
  titleBlock: { alignItems: "center", marginTop: 2 },
  readTitle: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  readSub: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  readArea: { flex: 1, minHeight: 160 },
  artBlock: { alignItems: "center", gap: 8 },
  artFrame: {
    overflow: "hidden", backgroundColor: c.card, alignItems: "center", justifyContent: "center", marginBottom: 6,
    shadowColor: "#000", shadowOpacity: dark ? 0.5 : 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  fullTitle: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  fullSub: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  where: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: c.borderBeige, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: c.accentGreen },
  progressRow: { flexDirection: "row", gap: 12 },
  progressText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  bigBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
  footRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  repeatRow: { gap: 10, padding: 12, borderRadius: 14, backgroundColor: withAlpha(c.card, 0.9), borderWidth: 1, borderColor: c.borderBeige },
  autoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 },
  autoLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  autoHint: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
  donePanel: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: withAlpha(c.card, 0.95), borderWidth: 1, borderColor: c.borderBeige },
  doneTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
  doneHint: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
  linkRow: { flexDirection: "row", gap: 10 },
  panel: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: withAlpha(c.card, dark ? 0.85 : 0.9), borderWidth: 1, borderColor: c.borderBeige },
  label: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  note: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
});
