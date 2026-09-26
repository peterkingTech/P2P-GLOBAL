import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Share, Platform, Alert } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getKingdomStory, CONTENT_TYPE_LABELS, type KingdomStory } from "@/lib/kingdomStoriesApi";
import { getScriptureReference, type ScriptureReference } from "@/lib/prayerTopicsApi";
import KingdomStoryMediaGallery from "@/components/KingdomStoryMediaGallery";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function yearRange(story: KingdomStory): string | null {
  if (story.startYear == null && story.endYear == null && !story.historicalPeriod) return null;
  const parts: string[] = [];
  if (story.historicalPeriod) parts.push(story.historicalPeriod);
  if (story.startYear != null) parts.push(story.endYear != null && story.endYear !== story.startYear ? `${story.startYear}–${story.endYear}` : `${story.startYear}`);
  return parts.join(" · ");
}

export default function KingdomStoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<KingdomStory | null>(null);
  const [scripture, setScripture] = useState<ScriptureReference | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const s = await getKingdomStory(id);
        setStory(s);
        if (s.scriptureReferenceId) getScriptureReference(s.scriptureReferenceId).then(setScripture).catch(() => {});
      } catch (e: any) {
        showAlert("Couldn't open this story", e.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function handleShare() {
    if (!story) return;
    try { await Share.share({ message: `${story.title}\n\n${story.body}` }); } catch { /* cancelled */ }
  }

  if (loading) return <View style={[styles.screen, styles.centerFill]}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={c.accentGreen} /></View>;
  if (!story) return <View style={[styles.screen, styles.centerFill]}><Stack.Screen options={{ headerShown: false }} /><Text style={styles.emptyText}>This story isn't available.</Text></View>;

  const dateLine = yearRange(story);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerType}>{story.category?.title ?? (story.contentType ? CONTENT_TYPE_LABELS[story.contentType] : "Kingdom Story")}</Text>
        <TouchableOpacity onPress={handleShare} accessibilityLabel="Share" accessibilityRole="button">
          <Ionicons name="share-outline" size={20} color={c.textDark} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {!!story.media?.length && <View style={{ marginBottom: 14 }}><KingdomStoryMediaGallery media={story.media} /></View>}

        <View style={{ paddingHorizontal: 20 }}>
          <Text style={styles.title}>{story.title}</Text>
          {!!story.subtitle && <Text style={styles.subtitle}>{story.subtitle}</Text>}
          {!!dateLine && (
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={13} color={c.textMuted} />
              <Text style={styles.metaText}>{dateLine}</Text>
              {!!story.location && <><Text style={styles.dotSep}>·</Text><Ionicons name="location-outline" size={13} color={c.textMuted} /><Text style={styles.metaText}>{story.location}</Text></>}
            </View>
          )}

          <Text style={styles.body}>{story.body}</Text>

          {!!story.people && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>People</Text>
              <Text style={styles.infoText}>{story.people}</Text>
            </View>
          )}

          {!!story.learningSection && (
            <View style={styles.learningBox}>
              <Text style={styles.learningLabel}>What can we learn?</Text>
              <Text style={styles.learningText}>{story.learningSection}</Text>
            </View>
          )}

          {!!story.reflection && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Reflection</Text>
              <Text style={styles.infoText}>{story.reflection}</Text>
            </View>
          )}

          {scripture && (
            <TouchableOpacity
              style={styles.scriptureRow}
              onPress={() => router.push({ pathname: "/prayer/study/[scriptureId]", params: { scriptureId: scripture.id, topicTitle: story.title } } as any)}
            >
              <Ionicons name="book" size={14} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.scriptureText}>{scripture.referenceDisplay}</Text>
                <Text style={styles.scriptureSub}>Study this Scripture · Pray the Word</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.accentGreen} />
            </TouchableOpacity>
          )}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push("/(tabs)/prayer" as any)}>
              <Ionicons name="hand-left-outline" size={16} color={c.textMuted} />
              <Text style={styles.actionText}>Pray</Text>
            </TouchableOpacity>
            {story.related?.missionField && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/missions/field/${story.related!.missionField!.slug}` as any)}>
                <Ionicons name="flag-outline" size={16} color={c.textMuted} />
                <Text style={styles.actionText}>Explore Missions</Text>
              </TouchableOpacity>
            )}
            {story.related?.missionStory && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/missions/story/${story.related!.missionStory!.id}` as any)}>
                <Ionicons name="flag-outline" size={16} color={c.textMuted} />
                <Text style={styles.actionText}>Mission Story</Text>
              </TouchableOpacity>
            )}
            {story.related?.curriculum && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/curriculum/${story.related!.curriculum!.id}` as any)}>
                <Ionicons name="school-outline" size={16} color={c.textMuted} />
                <Text style={styles.actionText}>Study This</Text>
              </TouchableOpacity>
            )}
            {story.related?.kingdomWin && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/kingdom-wins/${story.related!.kingdomWin!.id}` as any)}>
                <Ionicons name="sparkles-outline" size={16} color={c.textMuted} />
                <Text style={styles.actionText}>Kingdom Win</Text>
              </TouchableOpacity>
            )}
          </View>

          {story.related?.story && (
            <TouchableOpacity style={styles.relatedCard} onPress={() => router.push(`/kingdom-stories/${story.related!.story!.id}` as any)}>
              <Ionicons name="book-outline" size={14} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.relatedLabel}>Related Kingdom Story</Text>
                <Text style={styles.relatedTitle}>{story.related.story.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          )}

          {!!story.sources?.length && (
            <View style={styles.sourcesBox}>
              <Text style={styles.sourcesLabel}>Sources & Further Reading</Text>
              {story.sources.map((s) => (
                <View key={s.id} style={styles.sourceRow}>
                  <Text style={styles.sourceTitle}>{s.title}</Text>
                  {!!s.publisher && <Text style={styles.sourceMeta}>{s.publisher}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
    headerType: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
    title: { fontSize: 21, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    subtitle: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 4 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
    metaText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    dotSep: { color: c.textMuted, marginHorizontal: 2 },
    body: { fontSize: 15, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 23, marginTop: 16 },
    infoBox: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginTop: 14, gap: 4 },
    infoLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    infoText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    learningBox: { backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 12, padding: 14, marginTop: 14, gap: 5 },
    learningLabel: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    learningText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    scriptureRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16 },
    scriptureText: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    scriptureSub: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_400Regular", marginTop: 1 },
    actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
    actionBtn: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
    actionText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    relatedCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginTop: 16 },
    relatedLabel: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    relatedTitle: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 1 },
    sourcesBox: { marginTop: 20, gap: 8 },
    sourcesLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    sourceRow: { paddingLeft: 4, borderLeftWidth: 2, borderLeftColor: c.borderBeige },
    sourceTitle: { fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },
    sourceMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
