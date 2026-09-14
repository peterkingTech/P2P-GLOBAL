import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getSavedScriptures, getSavedPrayers, getSavedPaths, getAnsweredPrayers, getRecentPrayerActivity,
  unsaveScripture, unsavePath, unsavePrayer,
  type SavedScripture, type SavedPrayer, type SavedPath, type AnsweredJournalEntry, type RecentActivity,
} from "@/lib/prayerLibraryApi";
import { getTopics, type PrayerTopic } from "@/lib/prayerTopicsApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// "Pray the Word" Stage 5 — MY PRAYER LIBRARY. Every section here reads
// from an existing source of truth (saved-item tables, the Journal, or the
// activity timeline) — nothing is duplicated, nothing is gamified, no
// counts double as a status symbol.
export default function MyPrayerLibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [loading, setLoading] = useState(true);
  const [savedScriptures, setSavedScriptures] = useState<SavedScripture[]>([]);
  const [savedPrayers, setSavedPrayers] = useState<SavedPrayer[]>([]);
  const [savedPaths, setSavedPaths] = useState<SavedPath[]>([]);
  const [answered, setAnswered] = useState<AnsweredJournalEntry[]>([]);
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  const [topics, setTopics] = useState<PrayerTopic[]>([]);

  const load = useCallback(async () => {
    try {
      const [ss, sp, spa, ans, rec, tp] = await Promise.all([
        getSavedScriptures(), getSavedPrayers(), getSavedPaths(), getAnsweredPrayers(), getRecentPrayerActivity(), getTopics(),
      ]);
      setSavedScriptures(ss); setSavedPrayers(sp); setSavedPaths(spa); setAnswered(ans); setRecent(rec); setTopics(tp);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleUnsaveScripture(id: string) {
    try { await unsaveScripture(id); load(); } catch (e: any) { showAlert("Couldn't remove", e.message ?? "Please try again."); }
  }
  async function handleUnsavePath(id: string) {
    try { await unsavePath(id); load(); } catch (e: any) { showAlert("Couldn't remove", e.message ?? "Please try again."); }
  }
  async function handleUnsavePrayer(id: string) {
    try { await unsavePrayer(id); load(); } catch (e: any) { showAlert("Couldn't remove", e.message ?? "Please try again."); }
  }

  if (loading) return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>My Prayer Library</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.sectionHeading}>Saved Scriptures</Text>
        {savedScriptures.length === 0 ? (
          <Text style={styles.emptyText}>You haven't saved any Scriptures yet. Explore a topic and save Scriptures that speak to your season.</Text>
        ) : savedScriptures.map((s) => (
          <View key={s.id} style={styles.row}>
            <Ionicons name="book-outline" size={16} color={c.accentGreen} />
            <Text style={styles.rowText}>{s.scripture?.referenceDisplay ?? "Scripture"}</Text>
            <TouchableOpacity onPress={() => s.scripture && handleUnsaveScripture(s.scripture.id)}>
              <Ionicons name="close-circle-outline" size={18} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Prayer Paths</Text>
        {savedPaths.length === 0 ? (
          <Text style={styles.emptyText}>No saved Prayer Paths yet.</Text>
        ) : savedPaths.map((p) => (
          <View key={p.id} style={styles.row}>
            <Ionicons name="trail-sign-outline" size={16} color={c.accentGreen} />
            <TouchableOpacity style={{ flex: 1 }} onPress={() => p.path && router.push(`/prayer/paths/${p.path.slug}` as any)}>
              <Text style={styles.rowText}>{p.path?.title ?? "Prayer Path"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => p.path && handleUnsavePath(p.path.id)}>
              <Ionicons name="close-circle-outline" size={18} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Saved Prayers</Text>
        {savedPrayers.length === 0 ? (
          <Text style={styles.emptyText}>No saved prayers yet — save one from the Prayer Library.</Text>
        ) : savedPrayers.map((p) => (
          <View key={p.id} style={styles.row}>
            <Ionicons name="heart-outline" size={16} color={c.accentGreen} />
            <Text style={styles.rowText} numberOfLines={1}>{p.prayer?.title ?? "Prayer"}</Text>
            <TouchableOpacity onPress={() => p.prayer && handleUnsavePrayer(p.prayer.id)}>
              <Ionicons name="close-circle-outline" size={18} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Recent</Text>
        {recent.length === 0 ? (
          <Text style={styles.emptyText}>Nothing recent yet.</Text>
        ) : recent.slice(0, 8).map((r, i) => (
          <View key={i} style={styles.row}>
            <Ionicons name={r.eventType === "prayer_path_started" ? "trail-sign-outline" : r.eventType === "prayer_topic_viewed" ? "grid-outline" : "book-outline"} size={16} color={c.textMuted} />
            <Text style={styles.rowTextMuted}>{r.eventType === "prayer_path_started" ? "Started a prayer path" : r.eventType === "prayer_topic_viewed" ? "Viewed a topic" : "Viewed a Scripture"}</Text>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Topics</Text>
        <View style={styles.topicChipsRow}>
          {topics.slice(0, 12).map((t) => (
            <TouchableOpacity key={t.id} style={styles.topicChip} onPress={() => router.push(`/prayer/pray-the-word/${t.slug}` as any)}>
              <Text style={styles.topicChipText}>{t.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeading}>Answered Prayers</Text>
        {answered.length === 0 ? (
          <Text style={styles.emptyText}>None marked answered yet — that's alright. Keep praying.</Text>
        ) : answered.map((a) => (
          <View key={a.id} style={styles.answeredCard}>
            <View style={styles.rowTopLine}>
              <Ionicons name="checkmark-circle" size={16} color={c.accentGreen} />
              <Text style={styles.answeredDate}>{a.answeredAt ? new Date(a.answeredAt).toLocaleDateString() : ""}</Text>
            </View>
            <Text style={styles.rowText} numberOfLines={2}>{a.prayerText}</Text>
            {!!a.answerNotes && <Text style={styles.answerNotesText}>{a.answerNotes}</Text>}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
    emptyText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8 },
    rowText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    rowTextMuted: { flex: 1, fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    topicChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    topicChip: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
    topicChipText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },
    answeredCard: { backgroundColor: c.card, borderWidth: 1, borderColor: "rgba(29,158,117,0.25)", borderRadius: 12, padding: 12, marginBottom: 8, gap: 4 },
    rowTopLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    answeredDate: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    answerNotesText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 17 },
  });
}
