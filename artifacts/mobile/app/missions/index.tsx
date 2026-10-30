import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Platform, ActivityIndicator, TouchableOpacity, ScrollView } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useData, PrayerWallPost } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import {
  getMissionStories, getMissionFields, MISSION_FOCUS_LABELS,
  type MissionStory, type MissionField, type MissionFocusTag,
} from "@/lib/missionsApi";
import { getKingdomWinsFeed, type KingdomWin } from "@/lib/kingdomWinsApi";
import { AppButton } from "@/components/ui";
import { timeAgo } from "@/lib/timeFormat";

// Missions — rebuilt Discover-first landing (Stage 2). The old screen's
// two data sources are handled deliberately:
//  - p2p_missions (legacy, admin-seeded, 4 rows) is left untouched and not
//    read here at all — it was never actually rendered as a list before.
//  - The Prayer Wall "Kingdom Wins" testimony feed is KEPT (not deleted),
//    demoted to a clearly-labeled secondary section below the new,
//    independent Mission Story content — per the instruction to integrate
//    rather than destroy existing functionality.
const FOCUS_CHIPS: MissionFocusTag[] = [
  "evangelism", "discipleship", "church_planting", "bible_translation", "unreached_peoples",
  "compassion", "persecuted_church", "youth", "medical_missions", "digital_missions",
];


function TestimonyCard({ item }: { item: PrayerWallPost }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.avatar}>
          <Ionicons name="sparkles" size={14} color={colors.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardName}>{item.isAnonymous ? t("missions.anonymous") : (item.userName || t("missions.aBeliever"))}</Text>
          <Text style={s.cardMeta}>{timeAgo(item.createdAt, "ago")} · {t("missions.kingdomWinBadge")}</Text>
        </View>
      </View>
      <Text style={s.cardBody}>{item.body}</Text>
      <View style={s.cardFooter}>
        <Ionicons name="hand-left-outline" size={13} color={colors.textMuted} />
        <Text style={s.cardFooterText}>{t("missions.prayingAmen", { praying: item.prayingCount, amen: item.amenCount })}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: { paddingHorizontal: 20, paddingBottom: 16 },
    title: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 13, color: c.textMuted, marginTop: 4, fontFamily: "Inter_400Regular" },
    goRow: { flexDirection: "row", gap: 8, marginTop: 14 },
    goPill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingVertical: 10 },
    goPillText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 },
    sectionSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 20, marginTop: -6, marginBottom: 10 },
    loading: { alignItems: "center", paddingVertical: 30 },
    list: { paddingHorizontal: 20, paddingTop: 10 },
    empty: { alignItems: "center", paddingTop: 30, paddingHorizontal: 20, gap: 8 },
    emptyTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    emptyText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
    card: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
      padding: 14, marginBottom: 12,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
    avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(224,164,65,0.15)", alignItems: "center", justifyContent: "center" },
    cardName: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    cardMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    cardBody: { fontSize: 14, color: c.textMid, lineHeight: 21, fontFamily: "Inter_400Regular", marginBottom: 10 },
    cardFooter: { flexDirection: "row", alignItems: "center", gap: 6 },
    cardFooterText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },

    featuredCard: { marginHorizontal: 20, backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, padding: 18, gap: 8 },
    featuredBadge: { fontSize: 10, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    featuredTitle: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    featuredSummary: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    storyCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 10, gap: 5 },
    storyMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    storyFieldText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium" },
    storyTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    storySummary: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
    fieldCard: { width: 170, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginRight: 10, gap: 6 },
    fieldTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldCountry: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    focusChip: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 },
    focusChipText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },
    kingdomWinsHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 22 },
    viewAllLink: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    kingdomWinsEmptyCard: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: c.accentGreen, borderRadius: 14, padding: 16 },
    kingdomWinsEmptyText: { flex: 1, fontSize: 13, color: c.accentGreen, fontFamily: "Inter_500Medium", lineHeight: 18 },
    kingdomWinCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 10, gap: 4 },
    kingdomWinTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    kingdomWinBody: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
  });
}

// Formerly the Missions tab; now opened from Discover (see (tabs)/discover.tsx).
export default function MissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getPrayerWallPosts } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { contentMaxWidth } = useLayout();
  const { t } = useTranslation();

  const [testimonies, setTestimonies] = useState<PrayerWallPost[]>([]);
  const [wallLoading, setWallLoading] = useState(true);
  const [stories, setStories] = useState<MissionStory[]>([]);
  const [fields, setFields] = useState<MissionField[]>([]);
  const [loading, setLoading] = useState(true);
  const [kingdomWins, setKingdomWins] = useState<KingdomWin[]>([]);
  const [kingdomWinsLoading, setKingdomWinsLoading] = useState(true);

  const loadWall = useCallback(async () => {
    setWallLoading(true);
    const posts = await getPrayerWallPosts("recent");
    setTestimonies(posts.filter((p) => p.postType === "testimony"));
    setWallLoading(false);
  }, [getPrayerWallPosts]);

  const loadMissions = useCallback(async () => {
    try {
      const [storiesRes, fieldsRes] = await Promise.all([getMissionStories({ limit: 10 }), getMissionFields()]);
      setStories(storiesRes.stories);
      setFields(fieldsRes);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKingdomWins = useCallback(async () => {
    try {
      const result = await getKingdomWinsFeed({ limit: 3 });
      setKingdomWins(result.entries);
    } finally {
      setKingdomWinsLoading(false);
    }
  }, []);

  useEffect(() => { loadWall(); }, [loadWall]);
  useFocusEffect(useCallback(() => { loadMissions(); }, [loadMissions]));
  useFocusEffect(useCallback(() => { loadKingdomWins(); }, [loadKingdomWins]));

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const featured = stories[0];
  const remainingStories = stories.slice(1);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[{ flex: 1 }, centeredMaxWidth(contentMaxWidth)]}>
      <TouchableOpacity
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/discover" as any))}
        style={{ paddingHorizontal: 16, paddingTop: 8, alignSelf: "flex-start" }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="arrow-back" size={22} color={colors.textDark} />
      </TouchableOpacity>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={[styles.header, { paddingTop: 8 }]}>
          <Text style={styles.title}>🌍 Missions</Text>
          <Text style={styles.subtitle}>See the mission. Hear the story. Pray for the workers.</Text>
          <View style={styles.goRow}>
            <AppButton label="Learn" onPress={() => router.push("/missions/learn" as any)} variant="secondary" icon="school-outline" style={{ flex: 1 }} />
            <AppButton label="Go" onPress={() => router.push("/missions/go" as any)} variant="secondary" icon="compass-outline" style={{ flex: 1 }} />
            <AppButton label="Saved" onPress={() => router.push("/prayer/library" as any)} variant="secondary" icon="bookmark-outline" style={{ flex: 1 }} />
          </View>
        </View>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <>
            {featured && (
              <>
                <Text style={styles.sectionTitle}>Featured Mission Story</Text>
                <TouchableOpacity accessibilityRole="button" style={styles.featuredCard} activeOpacity={0.9} onPress={() => router.push(`/missions/story/${featured.id}` as any)}>
                  <Text style={styles.featuredBadge}>{featured.storyType.replace("_", " ").toUpperCase()}</Text>
                  <Text style={styles.featuredTitle}>{featured.title}</Text>
                  {!!featured.summary && <Text style={styles.featuredSummary} numberOfLines={3}>{featured.summary}</Text>}
                  {!!featured.mediaType && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Ionicons name="videocam" size={13} color={colors.accentGreen} />
                      <Text style={{ fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_500Medium" }}>Watch Story</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.sectionTitle}>Recent Mission Stories</Text>
            {remainingStories.length === 0 && !featured ? (
              <View style={styles.empty}>
                <Ionicons name="earth-outline" size={40} color={colors.borderBeige} />
                <Text style={styles.emptyTitle}>No mission stories yet.</Text>
                <Text style={styles.emptyText}>Check back soon to hear what God is doing around the world.</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {remainingStories.map((s) => (
                  <TouchableOpacity accessibilityRole="button" key={s.id} style={styles.storyCard} onPress={() => router.push(`/missions/story/${s.id}` as any)}>
                    <View style={styles.storyMetaRow}>
                      {!!s.missionField && <Text style={styles.storyFieldText}>{s.missionField.title}</Text>}
                      {!!s.mediaType && <Ionicons name={s.mediaType === "video" ? "videocam-outline" : "image-outline"} size={12} color={colors.textMuted} />}
                      {!!s.scriptureReferenceId && <Ionicons name="book-outline" size={12} color={colors.textMuted} />}
                    </View>
                    <Text style={styles.storyTitle}>{s.title}</Text>
                    {!!s.summary && <Text style={styles.storySummary} numberOfLines={2}>{s.summary}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Mission Fields</Text>
            {fields.length === 0 ? (
              <Text style={[styles.emptyText, { paddingHorizontal: 20 }]}>No mission fields published yet.</Text>
            ) : (
              <FlatList
                horizontal showsHorizontalScrollIndicator={false} data={fields} keyExtractor={(f) => f.id}
                contentContainerStyle={{ paddingHorizontal: 20 }}
                renderItem={({ item }) => (
                  <TouchableOpacity accessibilityRole="button" style={styles.fieldCard} onPress={() => router.push(`/missions/field/${item.slug}` as any)}>
                    <Text style={styles.fieldTitle}>{item.title}</Text>
                    <Text style={styles.fieldCountry}>{item.country}</Text>
                  </TouchableOpacity>
                )}
              />
            )}

            <Text style={styles.sectionTitle}>Explore by Mission Focus</Text>
            <FlatList
              horizontal showsHorizontalScrollIndicator={false} data={FOCUS_CHIPS} keyExtractor={(f) => f}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              renderItem={({ item }) => (
                <AppButton label={`${MISSION_FOCUS_LABELS[item]}`} onPress={() => router.push({ pathname: "/missions/focus/[focus]", params: { focus: item } } as any)} variant="secondary" size="sm" style={{ marginRight: 8 }} />
              )}
            />
          </>
        )}

        <View style={styles.kingdomWinsHeaderRow}>
          <Text style={styles.sectionTitle}>Kingdom Wins</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/kingdom-wins" as any)}>
            <Text style={styles.viewAllLink}>View All</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionSub}>Look what God has done.</Text>
        {kingdomWinsLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : kingdomWins.length === 0 ? (
          <TouchableOpacity accessibilityRole="button" style={styles.kingdomWinsEmptyCard} onPress={() => router.push("/kingdom-wins/create" as any)}>
            <Ionicons name="sparkles-outline" size={22} color={colors.accentGreen} />
            <Text style={styles.kingdomWinsEmptyText}>Your story could encourage someone. Share a Kingdom Win.</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.list}>
            {kingdomWins.map((k) => (
              <TouchableOpacity accessibilityRole="button" key={k.id} style={styles.kingdomWinCard} onPress={() => router.push(`/kingdom-wins/${k.id}` as any)}>
                <Text style={styles.kingdomWinTitle}>{k.title}</Text>
                <Text style={styles.kingdomWinBody} numberOfLines={2}>{k.body}</Text>
              </TouchableOpacity>
            ))}
            <AppButton label="Share a Kingdom Win" onPress={() => router.push("/kingdom-wins/create" as any)} variant="outline" icon="add-circle-outline" />
          </View>
        )}

        <Text style={styles.sectionTitle}>Prayer Wall Testimonies</Text>
        <Text style={styles.sectionSub}>From the Community Prayer Wall</Text>
        {wallLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <View style={styles.list}>
            {testimonies.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t("missions.noTestimonies")}</Text>
                <Text style={styles.emptyText}>{t("missions.noTestimoniesSub")}</Text>
              </View>
            ) : testimonies.slice(0, 5).map((item) => <TestimonyCard key={item.id} item={item} />)}
          </View>
        )}
      </ScrollView>
      </View>
    </View>
  );
}
