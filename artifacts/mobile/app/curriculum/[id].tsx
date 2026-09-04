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
  Alert,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useData, Module } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

type CurriculumDetailInfo = { id: string; title: string; description: string; coverImage: string | null; icon: string | null; colorTheme: string };

// Same split-layout card design used for the Foundations/Curriculum category
// cards: a fixed-width text column on the left and a dedicated, cropped
// photo block on the right (never an image the text overlaps), so a large
// photo can never compress the title/progress row.
function ModuleCardImage({ uri }: { uri: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={[styles.moduleCardPhoto, styles.moduleCardImageFallback]}>
        <Ionicons name="book-outline" size={26} color={colors.accentGreen} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.moduleCardPhoto}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

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
          {detail.modules.map((m) => {
            const pct = m.lessonCount > 0 ? Math.round((m.completedLessons / m.lessonCount) * 100) : 0;
            const stateLabel = m.isLocked ? "Locked" : m.lessonCount === 0 ? null : m.completedLessons === 0 ? "Not started" : m.completedLessons === m.lessonCount ? "Completed" : "In progress";
            const countsLabel = `${m.lessonCount} ${m.lessonCount === 1 ? "lesson" : "lessons"}`;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.moduleCard, m.isLocked && styles.moduleCardLocked]}
                onPress={() => {
                  if (m.isLocked) {
                    showAlert("Locked", "Complete the previous lesson to continue.");
                    return;
                  }
                  router.push(`/module/${m.id}` as any);
                }}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={`${m.title}. ${countsLabel}. ${stateLabel ? stateLabel + "." : ""} ${m.isLocked ? "Locked — complete the previous lesson to continue." : `${m.completedLessons} of ${m.lessonCount} lessons complete. Tap to open.`}`}
              >
                <View style={styles.moduleCardBody}>
                  <Text style={styles.moduleTitle} numberOfLines={2}>{m.title}</Text>
                  {!!m.description && <Text style={styles.moduleDesc} numberOfLines={2}>{m.description}</Text>}
                  <View style={styles.moduleCardFooterRow}>
                    {m.isLocked ? (
                      <Text style={styles.progressText}>Complete the previous lesson to continue</Text>
                    ) : m.lessonCount > 0 ? (
                      <View style={styles.moduleProgress}>
                        <View style={styles.progressBg}>
                          <View style={[styles.progressFill, { width: `${pct}%` }]} />
                        </View>
                        <Text style={styles.progressText}>{stateLabel} · {m.completedLessons}/{m.lessonCount}</Text>
                      </View>
                    ) : (
                      <Text style={styles.progressText}>{countsLabel}</Text>
                    )}
                  </View>
                </View>

                {/* A dedicated block, not an overlapping background — the
                    text column above is never affected no matter how large
                    this photo is. */}
                <View style={styles.moduleCardPhotoWrap}>
                  <ModuleCardImage uri={m.imageUrl} />
                  {m.isLocked ? (
                    <View style={styles.moduleLockOverlay} accessibilityElementsHidden importantForAccessibility="no">
                      <Ionicons name="lock-closed" size={20} color="#fff" />
                    </View>
                  ) : (
                    <View style={styles.moduleCardArrow} accessibilityElementsHidden importantForAccessibility="no">
                      <Ionicons name="chevron-forward" size={16} color={colors.textDark} />
                    </View>
                  )}
                </View>
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
  moduleCard: {
    flexDirection: "row", minHeight: 120, backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige, marginBottom: 12, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  moduleCardLocked: { opacity: 0.6 },
  moduleLockOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center",
  },
  // The photo's own dedicated region on the right — same split-layout
  // convention as the category cards, so it can be as large as the design
  // wants without ever compressing moduleCardBody's text.
  moduleCardPhotoWrap: { width: 120, alignSelf: "stretch" },
  moduleCardPhoto: { width: "100%", height: "100%" },
  moduleCardImageFallback: { backgroundColor: "rgba(29,158,117,0.08)", alignItems: "center", justifyContent: "center" },
  moduleCardArrow: {
    position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center",
  },
  moduleCardBody: { flex: 1, padding: 14, justifyContent: "center" },
  moduleCardFooterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
  moduleTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  moduleDesc: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, marginBottom: 6 },
  moduleProgress: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  progressBg: { flex: 1, height: 4, backgroundColor: colors.progressTrack, borderRadius: 2, maxWidth: 100 },
  progressFill: { height: 4, backgroundColor: colors.progressFill, borderRadius: 2 },
  progressText: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
