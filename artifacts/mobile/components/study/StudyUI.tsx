import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import type { Credit } from "@/lib/deepStudyApi";
import { listen } from "@/lib/listen";
import { ORIGINAL_AUDIO, pronunciationPlan } from "@/lib/listen/originalLanguage";

// Shared pieces for Deep Study, Commentaries and Study Tools.

/** Source + licence for a study resource. Always shown with its content (CC BY / BY-SA need it). */
export function Attribution({ credit, compact }: { credit: Credit | null | undefined; compact?: boolean }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!credit || typeof credit.attribution !== "string") return null;
  const s = styles(c);
  // Every part is optional at render time: a credit from an older server or an older saved copy must
  // never break the screen (2026-11-12: a missing `origin` crashed Deep Study). Links show when present.
  const links = [credit.origin, credit.licence && { label: credit.licence.name, url: credit.licence.url }]
    .filter((l): l is { label: string; url: string } => !!l && typeof l.url === "string" && typeof l.label === "string");
  const open_ = (url: string) => Linking.openURL(url).catch(() => {});
  const via = credit.via;
  return (
    <View style={[s.credit, compact && { marginTop: 6 }]}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t("deepStudy.source", { defaultValue: "Source" })}: ${credit.attribution}`} style={s.creditRow}>
        <Ionicons name="information-circle-outline" size={14} color={c.textMuted} />
        <Text style={s.creditText} numberOfLines={open ? undefined : 2}>{credit.attribution}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={c.textMuted} />
      </TouchableOpacity>
      {/* Always visible: the original source and the licence, both linked (required by STEP Bible / CC BY). */}
      {links.length ? (
        <View style={s.links}>
          {links.map((l, i) => (
            <React.Fragment key={l.url}>
              {i ? <Text style={s.creditText}>·</Text> : null}
              <TouchableOpacity onPress={() => open_(l.url)} accessibilityRole="link" hitSlop={8}><Text style={s.link}>{l.label}</Text></TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          {credit.note ? <Text style={s.creditText}>{credit.note}</Text> : null}
          {credit.providerNotice ? <Text style={s.creditText}>{t("deepStudy.providerNotice", { defaultValue: "Provider's notice" })}: {credit.providerNotice}</Text> : null}
          {credit.changes ? <Text style={s.creditText}>{t("deepStudy.changes", { defaultValue: "Changes" })}: {credit.changes}</Text> : null}
          {via?.url ? (
            <TouchableOpacity onPress={() => open_(via.url)} accessibilityRole="link">
              <Text style={s.creditText}>{t("deepStudy.via", { defaultValue: "Via" })} <Text style={s.link}>{via.label}</Text></Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Loading, error (with Try again) and "offline copy" states. */
export function StudyState({ loading, error, onRetry, offline, empty }: { loading?: boolean; error?: string | null; onRetry?: () => void; offline?: boolean; empty?: string | null }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = styles(c);
  if (loading) return <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel={t("deepStudy.loading", { defaultValue: "Loading" })} /></View>;
  if (error) return (
    <View style={s.center}>
      <Ionicons name="cloud-offline-outline" size={28} color={c.textMuted} />
      <Text style={s.muted}>{error}</Text>
      {onRetry ? <AppButton label={t("deepStudy.tryAgain", { defaultValue: "Try again" })} variant="secondary" size="sm" onPress={onRetry} /> : null}
    </View>
  );
  if (offline) return <Text style={s.offline} accessibilityLiveRegion="polite">{t("deepStudy.offlineCopy", { defaultValue: "You're offline — showing the copy saved on this device." })}</Text>;
  if (empty) return <View style={s.center}><Text style={s.muted}>{empty}</Text></View>;
  return null;
}

/** Original-language text in its own direction (Hebrew/Aramaic right to left, Greek left to right). */
export function OriginalText({ text, direction, size = 22, style }: { text: string; direction: "ltr" | "rtl"; size?: number; style?: object }) {
  const { colors: c } = useTheme();
  return (
    <Text style={[{ fontSize: size, lineHeight: size * 1.45, color: c.textDark, writingDirection: direction, textAlign: direction === "rtl" ? "right" : "left",
      fontFamily: Platform.select({ ios: direction === "rtl" ? "Arial Hebrew" : "Times New Roman", default: undefined }) }, style]}
      accessibilityLanguage={direction === "rtl" ? "he" : "el"}>
      {text}
    </Text>
  );
}

/**
 * Hear one original-language word, through the shared P2P Listen speech session (listen.speakSnippet —
 * no second player). Play / Replay / Slower. Says exactly what is heard: the device's own voice, its
 * language, and that the pronunciation is NOT verified (lib/listen/originalLanguage.ts). Aramaic: no audio.
 */
export function PronounceButton({ text, language }: { text: string; language: string }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = styles(c);
  const plan = pronunciationPlan(text, language);
  const [state, setState] = useState<{ status: "idle" | "playing" | "no_voice" | "error"; voice?: string }>({ status: "idle" });
  if (!ORIGINAL_AUDIO.words) return null;
  if (!plan.speechLanguage) return <Text style={s.pronounceNote}>{language === "aramaic"
    ? t("deepStudy.noAramaicVoice", { defaultValue: "No reliable Aramaic voice is available. Aramaic is not read with a Hebrew voice — use the transliteration." })
    : t("deepStudy.noVoiceLanguage", { defaultValue: "No voice is available for this language." })}</Text>;
  const play = async (rate: number) => {
    setState({ status: "playing" });
    const r = await listen.speakSnippet(plan.speak, { language: plan.speechLanguage!, rate });
    setState(r.result === "spoken" ? { status: "idle", voice: r.voice ? `${r.voice.name} (${r.voice.language})` : undefined } : { status: r.result });
  };
  return (
    <View style={{ gap: 4 }}>
      <View style={s.pronounceRow}>
        <AppButton label={state.voice ? t("deepStudy.replay", { defaultValue: "Replay" }) : t("deepStudy.pronounce", { defaultValue: "Hear it" })} icon="volume-high-outline" size="sm" variant="secondary"
          loading={state.status === "playing"} onPress={() => play(0.85)} accessibilityLabel={t("deepStudy.pronounceA11y", { defaultValue: "Hear the pronunciation" })} />
        <AppButton label={t("deepStudy.slower", { defaultValue: "Slower" })} icon="speedometer-outline" size="sm" variant="tertiary" onPress={() => play(0.5)} disabled={state.status === "playing"} />
      </View>
      <Text style={s.pronounceNote}>
        {language === "hebrew"
          ? t("deepStudy.conventionHebrew", { defaultValue: "Modern Israeli Hebrew (device voice) — not verified for Biblical Hebrew" })
          : t("deepStudy.conventionGreek", { defaultValue: "Modern Greek (device voice) — not a reconstructed Koine pronunciation" })}
        {state.voice ? ` · ${state.voice}` : ""}
      </Text>
      {state.status === "no_voice" ? <Text style={s.pronounceWarn} accessibilityLiveRegion="polite">{t("deepStudy.noDeviceVoice", { defaultValue: "This device has no voice for this language. Use the transliteration, or add the language's voice in your device's speech settings." })}</Text> : null}
      {state.status === "error" ? <Text style={s.pronounceWarn} accessibilityLiveRegion="polite">{t("deepStudy.pronounceError", { defaultValue: "The word couldn't be played. Please try again." })}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { colors: c } = useTheme();
  return <Text style={{ fontSize: 12, letterSpacing: 0.6, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", marginTop: 6 }} accessibilityRole="header">{children}</Text>;
}

const styles = (c: AppColors) => StyleSheet.create({
  credit: { marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
  creditRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, minHeight: 32 },
  creditText: { flex: 1, fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16 },
  link: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  links: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2, marginLeft: 20 },
  pronounceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  pronounceNote: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16 },
  pronounceWarn: { fontSize: 12, color: c.amber, fontFamily: "Inter_500Medium", lineHeight: 17 },
  center: { alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  muted: { fontSize: 13.5, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  offline: { fontSize: 12, color: c.amber, fontFamily: "Inter_500Medium", paddingVertical: 4 },
});
