import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getMissionStories, MISSION_FOCUS_LABELS, type MissionFocusTag, type MissionStory } from "@/lib/missionsApi";

export default function MissionFocusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { focus } = useLocalSearchParams<{ focus: MissionFocusTag }>();

  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState<MissionStory[]>([]);

  useEffect(() => {
    if (!focus) return;
    (async () => {
      try { setStories((await getMissionStories({ focus })).stories); } finally { setLoading(false); }
    })();
  }, [focus]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>{focus ? MISSION_FOCUS_LABELS[focus] : ""}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : stories.length === 0 ? (
        <View style={styles.centerFill}><Text style={styles.emptyText}>No stories tagged with this focus yet.</Text></View>
      ) : (
        <FlatList
          data={stories} keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/missions/story/${item.id}` as any)}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!!item.summary && <Text style={styles.cardSummary} numberOfLines={2}>{item.summary}</Text>}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, gap: 6 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSummary: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
  });
}
