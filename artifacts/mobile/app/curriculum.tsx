import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function CurriculumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modules } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Curriculum</Text>
      </View>

      <View style={styles.intro}>
        <Text style={styles.introText}>
          A structured discipleship curriculum spanning five growth levels — from new believer to multiplying disciple-maker.
        </Text>
      </View>

      <FlatList
        data={modules}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => {
          const pct = item.lessonCount > 0 ? (item.completedLessons / item.lessonCount) * 100 : 0;
          return (
            <TouchableOpacity
              style={styles.currCard}
              onPress={() => router.push(`/module/${item.id}`)}
              activeOpacity={0.85}
            >
              <View style={styles.currTop}>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>Level {item.level}</Text>
                </View>
                <Text style={styles.lessonCount}>{item.lessonCount} lessons</Text>
              </View>
              <Text style={styles.currTitle}>{item.title}</Text>
              <Text style={styles.currDesc}>{item.description}</Text>
              <View style={styles.currProgress}>
                <View style={styles.progressBg}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.progressText}>{Math.round(pct)}%</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  intro: {
    margin: 16,
    padding: 14,
    backgroundColor: colors.cardBeige,
    borderRadius: 12, borderWidth: 1, borderColor: colors.warmBeige,
  },
  introText: { fontSize: 13, color: colors.textMid, lineHeight: 20, fontFamily: "Inter_400Regular" },
  list: { paddingHorizontal: 16 },
  currCard: {
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 12,
  },
  currTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  levelBadge: {
    backgroundColor: "rgba(29,158,117,0.12)",
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  levelBadgeText: { fontSize: 11, color: colors.accentGreen, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  lessonCount: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  currTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  currDesc: { fontSize: 13, color: colors.textMuted, lineHeight: 20, fontFamily: "Inter_400Regular", marginBottom: 12 },
  currProgress: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressBg: { flex: 1, height: 5, backgroundColor: colors.progressTrack, borderRadius: 3 },
  progressFill: { height: 5, backgroundColor: colors.progressFill, borderRadius: 3 },
  progressText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", minWidth: 28 },
});
