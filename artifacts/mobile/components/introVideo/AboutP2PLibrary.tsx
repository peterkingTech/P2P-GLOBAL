import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import IntroVideoPlayer from "@/components/introVideo/IntroVideoPlayer";
import { useScrollToTopOnTabReselect, useTabCapsuleTopInset } from "@/components/IPadTabCapsule";
import {
  fetchIntroManifest, formatIntroDuration, LIBRARY_GROUPS, loadIntroViews,
  type IntroManifest, type IntroVideoId, type IntroVideoInfo, type IntroViews,
} from "@/lib/introVideos";

// About P2P (brief §5): the home of all 11 introduction videos. Every video can be watched again at any time.
// Two forms, one content:
//   • embedded — a full screen inside the More tab, beside Prayer and Discover (owner 2026-11-26: "show About P2P full
//     screen like our screen tabs"); the More switch arrives as topSlot and the tab bar stays.
//   • standalone — the /about-p2p page (Settings, the admin preview, links with ?play= / ?preview=1).
export default function AboutP2PLibrary({ topSlot, embedded = false, preview = false, play }: { topSlot?: React.ReactNode; embedded?: boolean; preview?: boolean; play?: string }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const { colors } = useTheme();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [manifest, setManifest] = useState<IntroManifest | null>(null);
  const [views, setViews] = useState<IntroViews>({});
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [playing, setPlaying] = useState<IntroVideoInfo | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabReselect(embedded ? "more" : "__none__", scrollRef);

  const load = useCallback(async () => {
    try {
      const [m, v] = await Promise.all([fetchIntroManifest(i18n.language || "en", preview), loadIntroViews(profile?.id)]);
      setManifest(m); setViews(v.views); setError(false);
      if (play) { const p = m.videos.find((x) => x.id === play); if (p) setPlaying(p); }
    } catch { setError(true); }
  }, [i18n.language, profile?.id, preview, play]);
  useEffect(() => { void load(); }, [load]);

  const byId = (id: IntroVideoId) => manifest?.videos.find((v) => v.id === id);
  const featured = byId("01");
  // Laptops and tablets: the featured film beside its text, the films in a 2–3 column grid that fills the width
  const wide = width >= 720;
  const usable = Math.min(width, 1280) - 40;
  const cols = width >= 1100 ? 3 : 2;
  const cardW = wide ? Math.floor((usable - 16 * (cols - 1)) / cols) : Math.min(width - 40, 420);
  const topPad = embedded ? insets.top + capsuleTopInset + (Platform.OS === "web" ? 67 : 0) : insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {embedded ? <View style={{ alignSelf: "center", width: "100%", maxWidth: 1280 }}>{topSlot}</View> : <SettingsSubHeader title={t("introVideos.aboutP2P", "About P2P")} />}
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (embedded ? 100 : 40) }]} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {embedded ? (
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t("introVideos.aboutP2P", "About P2P")}</Text>
            <Text style={styles.headerSub}>{t("introVideos.libraryLead", "Discover the vision, purpose and experiences of P2P Global.")}</Text>
          </View>
        ) : (
          <Text style={styles.lead}>{t("introVideos.libraryLead", "Discover the vision, purpose and experiences of P2P Global.")}</Text>
        )}

        {!manifest && !error ? <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} /> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t("introVideos.libraryError", "The videos could not be loaded. Check your connection and pull down to try again.")}</Text>
          </View>
        ) : null}
        {manifest && !manifest.mediaReady ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{t("introVideos.mediaPending", "The videos are being prepared and will appear here soon.")}</Text></View>
        ) : null}

        {featured ? (
          <Pressable onPress={() => setPlaying(featured)} accessibilityRole="button" accessibilityLabel={`${featured.title}, ${formatIntroDuration(featured.duration)}`} style={[styles.featured, wide && styles.featuredWide]}>
            <View style={wide ? { width: "58%" } : undefined}><Thumb v={featured} styles={styles} big /></View>
            <View style={[styles.featuredText, wide && styles.featuredTextWide]}>
              <Text style={styles.featuredKicker}>{t("introVideos.featured", "Featured film")}</Text>
              <Text style={styles.featuredTitle}>{featured.title}</Text>
              <Text style={styles.featuredDesc} numberOfLines={3}>{featured.description}</Text>
              <View style={styles.playPill}><Ionicons name="play" size={14} color="#0B0F0C" /><Text style={styles.playPillText}>{t("introVideos.watch", "Watch")} · {formatIntroDuration(featured.duration)}</Text></View>
            </View>
          </Pressable>
        ) : null}

        {manifest ? LIBRARY_GROUPS.map((g) => {
          const list = g.ids.map(byId).filter(Boolean) as IntroVideoInfo[];
          return (
            <View key={g.key} style={styles.group}>
              <Text style={styles.groupTitle}>{t(g.titleKey, g.title)}</Text>
              <View style={[styles.grid, wide && { flexDirection: "row", flexWrap: "wrap" }]}>
                {list.map((v) => (
                  <Pressable key={v.id} onPress={() => setPlaying(v)} style={[styles.card, { width: cardW }]} accessibilityRole="button"
                    accessibilityLabel={`${v.title}, ${formatIntroDuration(v.duration)}${views[v.id]?.completedAt ? `, ${t("introVideos.watched", "Watched")}` : ""}`}>
                    <Thumb v={v} styles={styles} />
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle} numberOfLines={2}>{v.title}</Text>
                      <Text style={styles.cardDesc} numberOfLines={2}>{v.description}</Text>
                      {views[v.id]?.completedAt ? <Text style={styles.watched}><Ionicons name="checkmark-circle" size={12} /> {t("introVideos.watched", "Watched")}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }) : null}
      </ScrollView>
      <IntroVideoPlayer visible={!!playing} video={playing} mode="replay" context="library" userId={profile?.id} view={playing ? views[playing.id] : undefined} preview={preview}
        onFinished={() => { setPlaying(null); void loadIntroViews(profile?.id).then((v) => setViews(v.views)); }} />
    </View>
  );
}

function Thumb({ v, styles, big }: { v: IntroVideoInfo; styles: ReturnType<typeof makeStyles>; big?: boolean }) {
  return (
    <View style={[styles.thumb, big && styles.thumbBig]}>
      {v.media?.thumbnail ? <Image source={{ uri: v.media.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors /> : null}
      <View style={styles.thumbShade} />
      <View style={[styles.playDot, big && { width: 56, height: 56, borderRadius: 28 }]}><Ionicons name="play" size={big ? 26 : 18} color="#0B0F0C" /></View>
      <View style={styles.dur}><Text style={styles.durText}>{formatIntroDuration(v.duration)}</Text></View>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.lightCream },
  content: { paddingHorizontal: 20, paddingTop: 8, alignSelf: "center", width: "100%", maxWidth: 1280 },
  header: { paddingTop: 12, paddingBottom: 16, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: c.textDark },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: c.textMuted, marginTop: 2 },
  lead: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22, color: c.textMid, marginBottom: 16 },
  errorBox: { backgroundColor: c.cardBeige, borderRadius: 12, padding: 14, marginBottom: 14 },
  errorText: { fontFamily: "Inter_400Regular", fontSize: 14, color: c.textMid },
  featured: { backgroundColor: "#0B120E", borderRadius: 18, overflow: "hidden", marginBottom: 22 },
  featuredText: { padding: 16, gap: 6 },
  featuredWide: { flexDirection: "row", alignItems: "stretch" },
  featuredTextWide: { flex: 1, padding: 24, justifyContent: "center", gap: 10 },
  featuredKicker: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.4, color: "#E9C27A", textTransform: "uppercase" },
  featuredTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#F6F1E7" },
  featuredDesc: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, color: "#BFD3DE" },
  playPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "#E9C27A", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, marginTop: 6 },
  playPillText: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#0B0F0C" },
  group: { marginBottom: 22 },
  groupTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: c.textDark, marginBottom: 10 },
  grid: { gap: 14 },
  card: { backgroundColor: c.card, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.borderBeige },
  cardBody: { padding: 12, gap: 4 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: c.textDark },
  cardDesc: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, color: c.textMuted },
  watched: { fontFamily: "Inter_500Medium", fontSize: 12, color: c.accentGreen, marginTop: 2 },
  thumb: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#0B120E", alignItems: "center", justifyContent: "center" },
  thumbBig: {},
  thumbShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.18)" },
  playDot: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#E9C27A", alignItems: "center", justifyContent: "center" },
  dur: { position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  durText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#fff" },
});
