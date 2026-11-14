import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, Platform, TextInput } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { loadPosition, type ReadingPosition } from "@/lib/bibleReadingPrefs";
import { bookByCode } from "@/lib/bibleReaderApi";
import { getTopics, type PrayerTopic } from "@/lib/prayerTopicsApi";
import { groupTopics, searchTopics, topicKey } from "@/lib/scriptureTopicsUi";
import { AppButton, IconButton } from "@/components/ui";
import { BIBLE_COVER, BIBLE_COVER_BG, BIBLE_COVER_LABEL, ARTWORK_FILL } from "@/constants/artwork";
import { useScrollToTopOnTabReselect, useTabCapsuleTopInset } from "@/components/IPadTabCapsule";
import { useTranslation } from "react-i18next";

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
// The same page is the Bible tab (asTab: no Back button, room for the tab bar).

export default function BibleStudyScreen() {
  return <BibleStudyHome />;
}

export function BibleStudyHome({ asTab = false }: { asTab?: boolean }) {
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollToTopOnTabReselect(asTab ? "bible" : "", scrollRef);
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useLayout();
  const [pos, setPos] = useState<ReadingPosition | null>(null);
  const [topics, setTopics] = useState<PrayerTopic[] | null>(null);
  const [topicsFailed, setTopicsFailed] = useState(false);
  const [query, setQuery] = useState("");
  const topicName = (title: string) => t(`scriptureTopics.names.${topicKey(title)}`, { defaultValue: title });
  const shownTopics = useMemo(() => searchTopics(topics ?? [], query, (k) => t(`scriptureTopics.categories.${k}`)).filter(Boolean), [topics, query, t]);

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
    { icon: "headset-outline", title: "My Scripture Library", sub: "Playlists, collections, saved Scriptures and favourites", route: "/library" },
    { icon: "people-outline", title: "Study Together", sub: "Shared studies with your people", route: "/study-together" },
  ] as const;

  return (
    <View style={[s.screen, { paddingTop: asTab ? insets.top + capsuleTopInset + (Platform.OS === "web" ? 67 : 0) + 8 : insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView ref={scrollRef} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + (asTab ? 110 : 40) }, centeredMaxWidth(contentMaxWidth)]}>
        <View style={s.header}>
          {!asTab ? (
            <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/learn" as any))} color={colors.textDark} style={{ marginLeft: -10 }} />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={s.title} accessibilityRole="header">{asTab ? "Bible" : "Bible Study"}</Text>
            <Text style={s.meta}>Read, search and explore Scripture.</Text>
          </View>
        </View>

        {/* The Bible cover — shown whole (it is square, so nothing is cut off); opens the Bible. */}
        <TouchableOpacity onPress={() => router.push("/bible" as any)} activeOpacity={0.92} accessibilityRole="button" accessibilityLabel={`${BIBLE_COVER_LABEL}. Open the Bible`}>
          <View style={s.cover}>
            <Image source={BIBLE_COVER} style={ARTWORK_FILL} resizeMode="contain" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.continue} onPress={() => router.push("/bible" as any)} activeOpacity={0.88} accessibilityRole="button"
          accessibilityLabel={pos ? `Continue reading ${book} ${pos.chapter}, ${pos.translation}` : "Start reading the Bible"}>
          <Image source={BIBLE_COVER} style={s.continueArt} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />
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

        {/* The Bible Study area: Deep Study, Commentaries, Study Tools (one set of study records behind all three).
            Scripture itself stays in the Bible above — no second Scripture destination here. */}
        <Text style={s.section} accessibilityRole="header">{t("deepStudy.areaTitle", { defaultValue: "Bible Study" })}</Text>
        <Text style={[s.meta, { marginBottom: 10 }]}>{t("deepStudy.areaSub", { defaultValue: "Go deeper: the original languages, classic commentaries and study tools." })}</Text>
        <View style={{ gap: 10 }}>
          {([
            { icon: "layers-outline", title: t("deepStudy.title", { defaultValue: "Deep Study" }), sub: t("deepStudy.titleSub", { defaultValue: "One passage: original words, commentaries, cross references" }), route: "/deep-study" },
            { icon: "text-outline", title: t("dictionary.title", { defaultValue: "Biblical Dictionary" }), sub: t("dictionary.hubSub", { defaultValue: "A–Z: Hebrew, Aramaic and Greek words, meanings and where they occur" }), route: "/dictionary" },
            { icon: "library-outline", title: t("deepStudy.commentaries", { defaultValue: "Commentaries" }), sub: t("deepStudy.commentariesSub", { defaultValue: "Classic commentaries and open study notes" }), route: "/commentaries" },
            { icon: "construct-outline", title: t("deepStudy.studyTools", { defaultValue: "Study Tools" }), sub: t("deepStudy.studyToolsSub", { defaultValue: "Hebrew, Greek and Aramaic lexicons, Strong's, cross references" }), route: "/study-tools" },
          ] as const).map((d) => (
            <TouchableOpacity key={d.route} style={s.dest} onPress={() => router.push(d.route as any)} accessibilityRole="button" accessibilityLabel={`${d.title}. ${d.sub}`}>
              <View style={s.destIcon}><Ionicons name={d.icon} size={22} color={colors.primaryGreen} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.tileTitle}>{d.title}</Text>
                <Text style={s.meta} numberOfLines={2}>{d.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Explore Scripture by Topic — searchable, grouped by category, with each topic's passage count.
            The search text stays when you open a topic and come back (this screen stays mounted). */}
        <Text style={s.section} accessibilityRole="header">{t("scriptureTopics.title", { defaultValue: "Explore Scripture by Topic" })}</Text>
        <Text style={[s.meta, { marginBottom: 10 }]}>{t("scriptureTopics.intro", { defaultValue: "Passages chosen by P2P editors for each topic. Open any passage to read it in context." })}</Text>
        {topics === null && !topicsFailed ? <ActivityIndicator color={colors.accentGreen} accessibilityLabel={t("scriptureTopics.loading")} />
          : topicsFailed ? (
            <AppButton label={t("scriptureTopics.failed")} onPress={load} variant="tertiary" />
          ) : topics && topics.length ? (
            <View style={{ gap: 12 }}>
              <View style={s.searchRow}>
                <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                <TextInput value={query} onChangeText={setQuery} placeholder={t("scriptureTopics.searchHint")} placeholderTextColor={colors.textMuted}
                  accessibilityLabel={t("scriptureTopics.search")} style={s.searchInput} autoCorrect={false} returnKeyType="search" />
                {query ? <IconButton icon="close-circle" size="sm" accessibilityLabel={t("scriptureTopics.clear")} onPress={() => setQuery("")} color={colors.textMuted} /> : null}
              </View>
              {!shownTopics.length ? <Text style={s.meta}>{t("scriptureTopics.noMatch", { query })}</Text> : groupTopics(shownTopics).map((g) => (
                <View key={g.category} style={{ gap: 8 }}>
                  <Text style={s.groupTitle} accessibilityRole="header">{t(`scriptureTopics.categories.${g.category}`)}</Text>
                  <View style={s.chips}>
                    {g.topics.map((tp) => {
                      const name = topicName(tp.title);
                      const count = typeof tp.scriptureCount === "number" ? t("scriptureTopics.count", { count: tp.scriptureCount }) : null;
                      return (
                        <AppButton key={tp.id} label={count ? `${name} · ${tp.scriptureCount}` : name} variant="secondary"
                          accessibilityLabel={t("scriptureTopics.topicA11y", { title: name, count: count ?? "" })}
                          onPress={() => router.push({ pathname: "/bible-study/topic/[slug]", params: { slug: tp.slug } } as any)} />
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : <Text style={s.meta}>{t("scriptureTopics.none")}</Text>}
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
    // A fixed square frame (the artwork is square) with the whole picture inside.
    cover: { width: "100%", maxWidth: 560, alignSelf: "center", aspectRatio: 1, borderRadius: 18, overflow: "hidden", marginBottom: 14, backgroundColor: BIBLE_COVER_BG },
    continueArt: { width: 52, height: 52, borderRadius: 10, backgroundColor: BIBLE_COVER_BG },
    continue: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18, backgroundColor: c.primaryGreen, minHeight: 88 },
    continueKicker: { fontSize: 11, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase" },
    continueTitle: { fontSize: 20, lineHeight: 26, color: "#fff", fontFamily: "Inter_700Bold" },
    continueMeta: { fontSize: 12, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_500Medium" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
    tile: { flexBasis: "47%", flexGrow: 1, minHeight: 92, padding: 12, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    tileTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    dest: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    destIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: c.lightCream },
    section: { fontSize: 17, lineHeight: 23, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 26, marginBottom: 4 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    groupTitle: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    searchInput: { flex: 1, minHeight: 44, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular" },
    chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    chipText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    retry: { minHeight: 44, justifyContent: "center" },
    retryText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
