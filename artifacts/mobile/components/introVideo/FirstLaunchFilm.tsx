import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import LanguageFlag from "@/components/language/LanguageFlag";
import { LANGUAGE_DISPLAY, type SupportedLanguage } from "@/lib/i18n";
import IntroVideoPlayer from "@/components/introVideo/IntroVideoPlayer";
import { fetchIntroManifest, loadIntroViews, logIntroEvent, type IntroVideoInfo, type IntroView } from "@/lib/introVideos";

const LOGO = require("@/assets/images/logo.png");
const GOLD = "#E9C27A", CREAM = "#F6F1E7", MUTED = "#BFD3DE";

// First opening of P2P on this phone (brief §3A): choose the app language, then the Movement Film (Video 01) plays
// in full — no skip — before registration. Someone who already has an account can still sign in (they are not new
// to P2P). Watching is remembered on the phone and moved to the account at registration.
// If the film cannot be loaded (offline, or not yet published) registration is not blocked: it is shown next time.
export default function FirstLaunchFilm({ onLanguagePress, onSignIn, picker, children }: { onLanguagePress: () => void; onSignIn: () => void; picker?: React.ReactNode; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<"checking" | "welcome" | "playing" | "done">("checking");
  const [video, setVideo] = useState<IntroVideoInfo | null>(null);
  const [view, setView] = useState<IntroView | undefined>();
  const lang = (i18n.language || "en") as SupportedLanguage;

  useEffect(() => {
    let off = false;
    loadIntroViews(null).then(({ views }) => {
      if (off) return;
      if (views["01"]?.completedAt) { setState("done"); return; }
      setView(views["01"]); setState("welcome");
    }).catch(() => { if (!off) setState("done"); });
    return () => { off = true; };
  }, []);

  useEffect(() => {
    if (state !== "welcome") return;
    let off = false;
    fetchIntroManifest(lang).then((m) => { if (!off) setVideo(m.videos.find((v) => v.id === "01") ?? null); }).catch(() => { if (!off) setVideo(null); });
    return () => { off = true; };
  }, [state, lang]);

  if (state === "done") return <>{children}</>;
  if (state === "checking") return <View style={styles.root}><ActivityIndicator color={GOLD} /></View>;

  const begin = () => {
    if (!video?.media) { setState("done"); return; }   // not available yet: never block registration
    logIntroEvent("01", "intro_shown", { context: "first_launch", language: lang });
    setState("playing");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
      <Text style={styles.kicker}>{t("introVideos.welcomeKicker", "Welcome to P2P Global")}</Text>
      <Text style={styles.title}>{t("introVideos.welcomeTitle", "Before you begin, watch our story")}</Text>
      <Text style={styles.body}>{t("introVideos.welcomeBody", "The Movement Film: As the Waters Cover the Sea. It shows why P2P exists and what God is doing through people who learn from someone and help someone grow.")}</Text>

      <Text style={styles.label}>{t("introVideos.chooseLanguage", "Choose your language first")}</Text>
      <Pressable style={styles.lang} onPress={onLanguagePress} accessibilityRole="button" accessibilityLabel={t("introVideos.chooseLanguage", "Choose your language first")}>
        <LanguageFlag language={lang} size={20} />
        <Text style={styles.langText}>{LANGUAGE_DISPLAY[lang]?.native ?? lang}</Text>
        <Ionicons name="chevron-down" size={16} color={MUTED} />
      </Pressable>

      <Pressable style={[styles.begin, !video && styles.dim]} onPress={begin} accessibilityRole="button">
        <Ionicons name="play" size={18} color="#0B0F0C" />
        <Text style={styles.beginText}>{view?.position ? t("introVideos.resumeFilm", "Continue the film") : t("introVideos.watchFilm", "Watch the film")}{video ? `  ·  ${Math.round(video.duration / 60)} min` : ""}</Text>
      </Pressable>
      <Pressable onPress={onSignIn} accessibilityRole="button" style={{ padding: 10 }}>
        <Text style={styles.signIn}>{t("onboarding.alreadyHaveAccount", "I already have an account")}</Text>
      </Pressable>

      <IntroVideoPlayer visible={state === "playing"} video={video} mode="required" context="first_launch" userId={null} view={view}
        onFinished={(r) => { if (r.completed) setState("done"); else setState("welcome"); }} />
      {picker}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050B08", alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 12 },
  logo: { width: 120, height: 84, marginBottom: 8 },
  kicker: { color: GOLD, fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 1.6, textTransform: "uppercase" },
  title: { color: CREAM, fontFamily: "Inter_700Bold", fontSize: 24, textAlign: "center", maxWidth: 460 },
  body: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 460 },
  label: { color: CREAM, fontFamily: "Inter_600SemiBold", fontSize: 13, marginTop: 14 },
  lang: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: "rgba(233,194,122,0.45)", backgroundColor: "rgba(233,194,122,0.08)" },
  langText: { color: CREAM, fontFamily: "Inter_600SemiBold", fontSize: 16 },
  begin: { marginTop: 18, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: GOLD, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 28 },
  dim: { opacity: 0.6 },
  beginText: { color: "#0B0F0C", fontFamily: "Inter_700Bold", fontSize: 16 },
  signIn: { color: MUTED, fontFamily: "Inter_500Medium", fontSize: 14, textDecorationLine: "underline" },
});
