import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Image,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const MODULE_PLACEHOLDER_COLORS = ["#4ADE80","#60A5FA","#F472B6","#FB923C","#A78BFA","#34D399","#FBBF24"];

function ModuleThumbnail({ uri, index, size = 48 }: { uri?: string; index: number; size?: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 10 }} />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: 10,
      backgroundColor: MODULE_PLACEHOLDER_COLORS[index % MODULE_PLACEHOLDER_COLORS.length],
      alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" }}>
        L{index + 1}
      </Text>
    </View>
  );
}

export default function CurriculumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modules } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
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
        renderItem={({ item, index }) => {
          const pct = item.lessonCount > 0 ? (item.completedLessons / item.lessonCount) * 100 : 0;
          const isLocked = item.isLocked;
          return (
            <TouchableOpacity
              style={[styles.currCard, isLocked && styles.currCardLocked]}
              onPress={() => !isLocked && router.push(`/module/${item.id}`)}
              activeOpacity={isLocked ? 1 : 0.85}
              disabled={isLocked}
            >
              <View style={styles.currTop}>
                <ModuleThumbnail uri={item.imageUrl} index={index} size={48} />
                <View style={styles.currTopMeta}>
                  <View style={[styles.levelBadge, isLocked && styles.levelBadgeLocked]}>
                    <Text style={[styles.levelBadgeText, isLocked && styles.levelBadgeTextLocked]}>Level {item.level}</Text>
                  </View>
                  {isLocked ? (
                    <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                  ) : (
                    <Text style={styles.lessonCount}>{item.lessonCount} lessons</Text>
                  )}
                </View>
              </View>
              <Text style={[styles.currTitle, isLocked && styles.textLocked]}>{item.title}</Text>
              <Text style={styles.currDesc}>{item.description}</Text>
              {isLocked ? (
                <Text style={styles.lockedHint}>Complete the previous level to unlock</Text>
              ) : (
                <View style={styles.currProgress}>
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{Math.round(pct)}%</Text>
                </View>
              )}
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
  currCardLocked: { opacity: 0.55 },
  currTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  currTopMeta: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  levelBadge: {
    backgroundColor: "rgba(29,158,117,0.12)",
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  levelBadgeLocked: { backgroundColor: colors.borderBeige },
  levelBadgeText: { fontSize: 11, color: colors.accentGreen, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  levelBadgeTextLocked: { color: colors.textMuted },
  lessonCount: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  currTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  textLocked: { color: colors.textMuted },
  currDesc: { fontSize: 13, color: colors.textMuted, lineHeight: 20, fontFamily: "Inter_400Regular", marginBottom: 12 },
  lockedHint: { fontSize: 12, color: colors.textMuted, fontStyle: "italic", fontFamily: "Inter_400Regular" },
  currProgress: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressBg: { flex: 1, height: 5, backgroundColor: colors.progressTrack, borderRadius: 3 },
  progressFill: { height: 5, backgroundColor: colors.progressFill, borderRadius: 3 },
  progressText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", minWidth: 28 },
});
