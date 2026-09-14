import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Linking, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getMissionStory, saveMissionStory, unsaveMissionStory, getSavedMissionStories,
  MISSION_FOCUS_LABELS, type MissionStoryDetail,
} from "@/lib/missionsApi";
import { getScriptureReference, type ScriptureReference } from "@/lib/prayerTopicsApi";
import MissionVideoPlayer from "@/components/MissionVideoPlayer";
import SignedPhotoView from "@/components/SignedPhotoView";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Missions Stage 2-4 — story-first detail page. Primary actions are Pray /
// Scripture / Watch / Save, never a like/share/follow row.
export default function MissionStoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<MissionStoryDetail | null>(null);
  const [scripture, setScripture] = useState<ScriptureReference | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const s = await getMissionStory(id);
        setStory(s);
        if (s.scriptureReferenceId) {
          getScriptureReference(s.scriptureReferenceId).then(setScripture).catch(() => {});
        }
        const savedList = await getSavedMissionStories();
        setSaved(savedList.some((x) => x.story?.id === id));
      } catch (e: any) {
        showAlert("Couldn't open this story", e.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function handleSaveToggle() {
    if (!story) return;
    try {
      if (saved) { await unsaveMissionStory(story.id); setSaved(false); }
      else { await saveMissionStory(story.id); setSaved(true); }
    } catch (e: any) {
      showAlert("Couldn't update", e.message ?? "Please try again.");
    }
  }

  function handlePray() {
    // Leads into the existing private Prayer experience — the Journal's
    // own quick-compose entry point (already supports ?compose=true) —
    // rather than guessing a Pray the Word TOPIC slug from a mission-focus
    // tag, which is a different, incompatible curated vocabulary.
    router.push("/prayer/journal?compose=true" as any);
  }

  if (loading) return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  if (!story) return <View style={[styles.screen, styles.centerFill]}><Text style={styles.emptyText}>This story isn't available.</Text></View>;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerType}>{story.storyType.replace("_", " ").toUpperCase()}</Text>
        <TouchableOpacity onPress={handleSaveToggle}>
          <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={20} color={c.accentGreen} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.title}>{story.title}</Text>
        <View style={styles.metaRow}>
          {!!story.missionField && (
            <TouchableOpacity onPress={() => router.push(`/missions/field/${story.missionField!.slug}` as any)}>
              <Text style={styles.fieldLink}>{story.missionField.title}, {story.missionField.country}</Text>
            </TouchableOpacity>
          )}
        </View>
        {story.missionFocus.length > 0 && (
          <View style={styles.focusRow}>
            {story.missionFocus.map((f) => <View key={f} style={styles.focusTag}><Text style={styles.focusTagText}>{MISSION_FOCUS_LABELS[f]}</Text></View>)}
          </View>
        )}
        {!!story.authorName && <Text style={styles.authorText}>Shared by {story.authorName}</Text>}

        {story.mediaType === "video" && story.mediaPath && (
          <View style={{ marginTop: 14 }}><MissionVideoPlayer mediaPath={story.mediaPath} durationSeconds={story.mediaDurationSeconds} /></View>
        )}
        {story.mediaType === "photo" && story.mediaPath && (
          <View style={{ marginTop: 14 }}><SignedPhotoView bucket="mission-media" path={story.mediaPath} /></View>
        )}

        <Text style={styles.body}>{story.body}</Text>

        {scripture && (
          <TouchableOpacity style={styles.scriptureRow} onPress={() => Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(scripture.referenceDisplay)}`)}>
            <Ionicons name="book" size={14} color={c.accentGreen} />
            <Text style={styles.scriptureText}>{scripture.referenceDisplay}</Text>
            <Ionicons name="open-outline" size={13} color={c.accentGreen} />
          </TouchableOpacity>
        )}

        {story.prayerPoints.length > 0 && (
          <View style={styles.prayerPointsWrap}>
            <Text style={styles.sectionHeading}>Prayer Points</Text>
            {story.prayerPoints.map((p) => (
              <View key={p.id} style={styles.prayerPointCard}>
                <Text style={styles.prayerPointTitle}>{p.title}</Text>
                <Text style={styles.prayerPointDesc}>{p.description}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.actionsWrap}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handlePray}>
            <Ionicons name="hand-left-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Pray</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push({ pathname: "/prayer/pray-with-me", params: { topicTitle: story.title, missionStoryId: story.id } } as any)}
          >
            <Ionicons name="people-outline" size={16} color={c.accentGreen} />
            <Text style={styles.secondaryBtnText}>Pray With Me</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/curriculum" as any)}>
            <Ionicons name="school-outline" size={16} color={c.accentGreen} />
            <Text style={styles.secondaryBtnText}>Study</Text>
          </TouchableOpacity>
        </View>

        {story.relatedStories.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.sectionHeading}>Related Stories</Text>
            {story.relatedStories.map((r) => (
              <TouchableOpacity key={r.id} style={styles.relatedCard} onPress={() => router.push(`/missions/story/${r.id}` as any)}>
                <Text style={styles.relatedTitle}>{r.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
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
    headerType: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    title: { fontSize: 21, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 6 },
    metaRow: { marginTop: 4 },
    fieldLink: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    focusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    focusTag: { backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    focusTagText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    authorText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 21, marginTop: 16 },
    scriptureRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 14 },
    scriptureText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    prayerPointsWrap: { marginTop: 24, gap: 8 },
    sectionHeading: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
    prayerPointCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, gap: 4 },
    prayerPointTitle: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    prayerPointDesc: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
    actionsWrap: { gap: 10, marginTop: 24 },
    primaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14 },
    primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    secondaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12 },
    secondaryBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    relatedCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12, marginBottom: 8 },
    relatedTitle: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
