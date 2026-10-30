import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { loadPosition, type ReadingPosition } from "@/lib/bibleReadingPrefs";
import { bookByCode } from "@/lib/bibleReaderApi";
import { getTopics, type PrayerTopic } from "@/lib/prayerTopicsApi";
import { AppButton, IconButton } from "@/components/ui";
import { BIBLE_COVER, BIBLE_COVER_LABEL } from "@/constants/artwork";

// Bible Study — the starting point for Scripture in Learning. It reuses what
// exists and adds no Bible system of its own:
//   • Continue Reading — the last chapter read on this device (the reader
//     opens there by itself); text always comes from the licensed API.Bible
//     translations through the server.
//   • Bible Reader, Search (API.Bible search: words, phrases, references, in
//     the chosen translation), Notes, Highlights and the reader's library.
//   • Explore Scripture by Topic — the editorially curated topic → reference
//     lists already published for Pray the Word (same records, read only;
//     opening a passage never changes anyone's Pray the Word progress).
// Reading plans are not offered here: no plan with a real reading schedule
// exists yet, and an empty plan must not look like a working feature.

export default function BibleStudyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useLayout();
  const [pos, setPos] = useState<ReadingPosition | null>(null);
  const [topics, setTopics] = useState<PrayerTopic[] | null>(null);
  const [topicsFailed, setTopicsFailed] = useState(false);

  const load = useCallback(() => {
    loadPosition().then(setPos).catch(() => {});
    getTopics().then((t) => { setTopics(t.filter((x) => x.status === "published")); setTopicsFailed(false); }).catch(() => setTopicsFailed(true));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const book = pos ? bookByCode(pos.book)?.name ?? pos.book : null;
  const tools = [
    { icon: "book-outline", title: "Bible Reader", sub: "Books, chapters and translations", route: "/bible" },
    { icon: "search-outline", title: "Search Scripture", sub: "Words, phrases or a reference", route: "/bible/search" },
    { icon: "document-text-outline", title: "Notes", sub: "Your private notes", route: "/notes" },
    { icon: "bookmark-outline", title: "Highlights", sub: "Saved passages and quotes", route: "/highlights" },
    { icon: "people-outline", title: "Study Together", sub: "Shared studies with your people", route: "/study-together" },
  ] as const;

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }, centeredMaxWidth(contentMaxWidth)]}>
        <View style={s.header}>
          <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/learn" as any))} color={colors.textDark} style={{ marginLeft: -10 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.title} accessibilityRole="header">Bible Study</Text>
            <Text style={s.meta}>Read, search and explore Scripture.</Text>
          </View>
        </View>

        {/* The Bible cover — shown whole (it is square, so nothing is cut off); opens the Bible. */}
        <TouchableOpacity onPress={() => router.push("/bible" as any)} activeOpacity={0.92} accessibilityRole="button" accessibilityLabel={`${BIBLE_COVER_LABEL}. Open the Bible`}>
          <Image source={BIBLE_COVER} style={s.cover} resizeMode="cover" />
        </TouchableOpacity>

        <TouchableOpacity style={s.continue} onPress={() => router.push("/bible" as any)} activeOpacity={0.88} accessibilityRole="button"
          accessibilityLabel={pos ? `Continue reading ${book} ${pos.chapter}, ${pos.translation}` : "Start reading the Bible"}>
          <Image source={BIBLE_COVER} style={s.continueArt} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
          <View style={{ flex: 1 }}>
            <Text style={s.continueKicker}>{pos ? "Continue Reading" : "Start Reading"}</Text>
            <Text style={s.continueTitle}>{pos ? `${book} ${pos.chapter}` : "Open the Bible"}</Text>
            {pos ? <Text style={s.continueMeta}>{pos.translation}</Text> : null}
          </View>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={s.grid}>
          {tools.map((t) => (
            <TouchableOpacity key={t.route} style={s.tile} onPress={() => router.push(t.route as any)} accessibilityRole="button" accessibilityLabel={`${t.title}. ${t.sub}`}>
              <Ionicons name={t.icon} size={20} color={colors.accentGreen} />
              <Text style={s.tileTitle}>{t.title}</Text>
              <Text style={s.meta} numberOfLines={2}>{t.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.section} accessibilityRole="header">Explore Scripture by Topic</Text>
        <Text style={[s.meta, { marginBottom: 10 }]}>Passages chosen by P2P editors for each topic. Open any passage to read it in context.</Text>
        {topics === null && !topicsFailed ? <ActivityIndicator color={colors.accentGreen} accessibilityLabel="Loading topics" />
          : topicsFailed ? (
            <AppButton label="Topics couldn't load. Try again" onPress={load} variant="tertiary" />
          ) : topics && topics.length ? (
            <View style={s.chips}>
              {topics.map((t) => (
                <AppButton label={`${t.title}`} onPress={() => router.push({ pathname: "/bible-study/topic/[slug]", params: { slug: t.slug } } as any)} variant="secondary" accessibilityLabel={`Topic: ${t.title}`} key={t.id} />
              ))}
            </View>
          ) : <Text style={s.meta}>No topics are published yet.</Text>}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { paddingHorizontal: 16 },
    header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
    back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -10 },
    title: { fontSize: 24, lineHeight: 30, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    cover: { width: "100%", maxWidth: 560, alignSelf: "center", aspectRatio: 1, borderRadius: 18, marginBottom: 14, backgroundColor: "#0B1430" },
    continueArt: { width: 52, height: 52, borderRadius: 10 },
    continue: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18, backgroundColor: c.primaryGreen, minHeight: 88 },
    continueKicker: { fontSize: 11, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase" },
    continueTitle: { fontSize: 20, lineHeight: 26, color: "#fff", fontFamily: "Inter_700Bold" },
    continueMeta: { fontSize: 12, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_500Medium" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
    tile: { flexBasis: "47%", flexGrow: 1, minHeight: 92, padding: 12, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    tileTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 17, lineHeight: 23, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 26, marginBottom: 4 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    chipText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    retry: { minHeight: 44, justifyContent: "center" },
    retryText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
