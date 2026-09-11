import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getFamilyJourney, type FamilyJourneyResponse } from "@/lib/familyApi";

function providerLabel(provider: string): string {
  if (provider === "youtube") return "YouTube";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// Family Journey — the "family memory" view (Stage 2 §7/§9/§10/§11/§12/§18):
// all-time totals and lists computed purely from the existing
// p2p_family_worship_history/session_events/prayer-requests rows. No
// rankings, no "spiritual points", no AI-generated narrative — every line
// here is either a stored fact or a plain count.
export default function FamilyJourneyScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { familyId } = useLocalSearchParams<{ familyId: string }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [journey, setJourney] = useState<FamilyJourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      setError(null);
      setJourney(await getFamilyJourney(familyId));
    } catch (e: any) {
      setError(e.message ?? "Couldn't load the Family Journey.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Family Journey" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  if (error || !journey) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Stack.Screen options={{ title: "Family Journey" }} />
        <Text style={{ color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" }}>
          {error ?? "This family's journey isn't available yet."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Family Journey" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Family Journey</Text>
          <Text style={styles.bodyText}>{journey.gatheringCount} Gathering{journey.gatheringCount === 1 ? "" : "s"}</Text>
          <Text style={styles.bodyText}>{journey.lessonsCoveredCount} Lesson{journey.lessonsCoveredCount === 1 ? "" : "s"} covered</Text>
          <Text style={styles.bodyText}>{journey.scripture.count} Scripture passage{journey.scripture.count === 1 ? "" : "s"} explored</Text>
          <Text style={styles.bodyText}>{journey.prayer.count} Prayer request{journey.prayer.count === 1 ? "" : "s"} · {journey.prayer.answeredCount} answered</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scripture Explored</Text>
          {journey.scripture.references.length === 0 ? (
            <Text style={styles.emptyText}>No Scripture has been opened in a Gathering yet.</Text>
          ) : (
            journey.scripture.references.map((ref) => <Text key={ref} style={styles.bodyText}>• {ref}</Text>)
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prayer Journey</Text>
          <Text style={styles.bodyText}>{journey.prayer.count} request{journey.prayer.count === 1 ? "" : "s"} · {journey.prayer.answeredCount} answered</Text>
          {journey.prayer.recentAnswered.length > 0 && (
            <View style={{ marginTop: 8 }}>
              {journey.prayer.recentAnswered.map((p) => (
                <Text key={p.id} style={styles.bodyText}>✓ {p.content} — Answered</Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Media Used</Text>
          {journey.media.items.length === 0 ? (
            <Text style={styles.emptyText}>No media has been played in a Gathering yet.</Text>
          ) : (
            journey.media.items.map((m) => <Text key={`${m.provider}:${m.id}`} style={styles.bodyText}>• {providerLabel(m.provider)}</Text>)
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 12 },
    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 4 },
    sectionTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
    bodyText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19 },
  });
}
