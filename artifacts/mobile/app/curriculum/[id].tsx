import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useData, Module } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

type CurriculumDetailInfo = { id: string; title: string; description: string; coverImage: string | null; icon: string | null; colorTheme: string };

function CoverBanner({ curriculum }: { curriculum: CurriculumDetailInfo }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!curriculum.coverImage && !imageFailed;
  return (
    <View style={styles.banner}>
      {showImage ? (
        <Image source={{ uri: curriculum.coverImage! }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setImageFailed(true)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `${curriculum.colorTheme}22` }]} />
      )}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.55)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.bannerIconBadge}>
        <Ionicons name={(curriculum.icon as keyof typeof Ionicons.glyphMap) || "book-outline"} size={22} color="#fff" />
      </View>
    </View>
  );
}

export default function CurriculumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loadCurriculumDetail } = useData();
  const { profile } = useAuth();

  const [detail, setDetail] = useState<{ curriculum: CurriculumDetailInfo; modules: Module[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setDetail(await loadCurriculumDetail(id, profile?.id));
    setLoading(false);
  }, [id, profile?.id, loadCurriculumDetail]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalLessons = detail?.modules.reduce((sum, m) => sum + m.lessonCount, 0) ?? 0;
  const totalCompleted = detail?.modules.reduce((sum, m) => sum + m.completedLessons, 0) ?? 0;
  const overallPct = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{detail?.curriculum.title ?? "Curriculum"}</Text>
      </View>

      {loading || !detail ? (
        <View style={styles.loadingContainer}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <CoverBanner curriculum={detail.curriculum} />
          <View style={styles.content}>
          <Text style={styles.description}>{detail.curriculum.description}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{detail.modules.length}</Text>
              <Text style={styles.statLabel}>{detail.modules.length === 1 ? "Module" : "Modules"}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{totalLessons}</Text>
              <Text style={styles.statLabel}>{totalLessons === 1 ? "Lesson" : "Lessons"}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{overallPct}%</Text>
              <Text style={styles.statLabel}>Complete</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>MODULES</Text>
          {detail.modules.map((m, idx) => {
            const pct = m.lessonCount > 0 ? Math.round((m.completedLessons / m.lessonCount) * 100) : 0;
            const stateLabel = m.lessonCount === 0 ? null : m.completedLessons === 0 ? "Not started" : m.completedLessons === m.lessonCount ? "Completed" : "In progress";
            return (
              <TouchableOpacity
                key={m.id}
                style={styles.moduleRow}
                onPress={() => router.push(`/module/${m.id}` as any)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Module ${idx + 1}: ${m.title}. ${stateLabel ?? ""} ${m.completedLessons} of ${m.lessonCount} lessons complete.`}
              >
                <View style={styles.moduleNumberBadge}>
                  <Text style={styles.moduleNumberText}>{String(idx + 1).padStart(2, "0")}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.moduleTitle}>{m.title}</Text>
                  {!!m.description && <Text style={styles.moduleDesc} numberOfLines={2}>{m.description}</Text>}
                  {m.lessonCount > 0 && (
                    <View style={styles.moduleProgress}>
                      <View style={styles.progressBg}>
                        <View style={[styles.progressFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={styles.progressText}>{stateLabel} · {m.completedLessons}/{m.lessonCount}</Text>
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}
          </View>
        </ScrollView>
      )}
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
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", flex: 1 },
  banner: { width: "100%", height: 140, overflow: "hidden" },
  bannerIconBadge: {
    position: "absolute", bottom: 12, left: 16, width: 44, height: 44, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center",
  },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  description: { fontSize: 14, color: colors.textMid, lineHeight: 21, fontFamily: "Inter_400Regular", marginBottom: 20 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  statBox: {
    flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    paddingVertical: 14, alignItems: "center",
  },
  statNumber: { fontSize: 22, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium", marginTop: 2 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 12 },
  moduleRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  moduleNumberBadge: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  moduleNumberText: { fontSize: 13, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  moduleTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  moduleDesc: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, marginBottom: 6 },
  moduleProgress: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressBg: { flex: 1, height: 4, backgroundColor: colors.progressTrack, borderRadius: 2, maxWidth: 100 },
  progressFill: { height: 4, backgroundColor: colors.progressFill, borderRadius: 2 },
  progressText: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
