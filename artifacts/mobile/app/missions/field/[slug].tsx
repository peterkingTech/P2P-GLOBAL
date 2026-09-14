import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getMissionField, MISSION_FOCUS_LABELS, type MissionFieldDetail } from "@/lib/missionsApi";

export default function MissionFieldScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [loading, setLoading] = useState(true);
  const [field, setField] = useState<MissionFieldDetail | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try { setField(await getMissionField(slug)); } finally { setLoading(false); }
    })();
  }, [slug]);

  if (loading) return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  if (!field) return <View style={[styles.screen, styles.centerFill]}><Text style={styles.emptyText}>This mission field isn't available.</Text></View>;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.title}>{field.title}</Text>
        <Text style={styles.locationText}>{field.country}{field.region ? `, ${field.region}` : ""}</Text>
        {!!field.description && <Text style={styles.description}>{field.description}</Text>}

        {field.missionFocus.length > 0 && (
          <View style={styles.focusRow}>
            {field.missionFocus.map((f) => <View key={f} style={styles.focusTag}><Text style={styles.focusTagText}>{MISSION_FOCUS_LABELS[f]}</Text></View>)}
          </View>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push({ pathname: "/prayer/pray-with-me", params: { topicTitle: field.title, missionFieldId: field.id } } as any)}
        >
          <Ionicons name="hand-left-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Pray for This Mission Field</Text>
        </TouchableOpacity>

        {field.prayerPoints.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <Text style={styles.sectionHeading}>Prayer Points</Text>
            {field.prayerPoints.map((p) => (
              <View key={p.id} style={styles.prayerPointCard}>
                <Text style={styles.prayerPointTitle}>{p.title}</Text>
                <Text style={styles.prayerPointDesc}>{p.description}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ marginTop: 22 }}>
          <Text style={styles.sectionHeading}>Mission Stories</Text>
          {field.stories.length === 0 ? (
            <Text style={styles.emptyText}>No stories from this field yet.</Text>
          ) : field.stories.map((s) => (
            <TouchableOpacity key={s.id} style={styles.storyCard} onPress={() => router.push(`/missions/story/${s.id}` as any)}>
              <Text style={styles.storyTitle}>{s.title}</Text>
              {!!s.summary && <Text style={styles.storySummary} numberOfLines={2}>{s.summary}</Text>}
            </TouchableOpacity>
          ))}
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
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 6 },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    locationText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 4 },
    description: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 12 },
    focusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
    focusTag: { backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    focusTagText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    primaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, marginTop: 20 },
    primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    sectionHeading: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
    prayerPointCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, gap: 4, marginBottom: 8 },
    prayerPointTitle: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    prayerPointDesc: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
    storyCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8, gap: 4 },
    storyTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    storySummary: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
  });
}
