import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const HERO_HEIGHT = 230;

function HeroImage({ uri, isLocked }: { uri?: string; isLocked: boolean }) {
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { opacity: isLocked ? 0.45 : 1 }]}
        resizeMode="cover"
        onError={() => setErr(true)}
      />
    );
  }
  // Tasteful placeholder — deep-green texture via color + icon
  return (
    <View style={[StyleSheet.absoluteFill, styles.heroPlaceholder]}>
      <Ionicons name="book-outline" size={52} color="rgba(157,225,203,0.25)" />
    </View>
  );
}

export default function ModuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { modules, lessons } = useData();

  const module = modules.find((m) => m.id === id) ?? modules[0];
  const moduleLessons = lessons
    .filter((l) => l.moduleId === module?.id)
    .sort((a, b) => a.order - b.order);

  const completed = moduleLessons.filter((l) => l.isCompleted).length;
  const pct = moduleLessons.length > 0 ? Math.round((completed / moduleLessons.length) * 100) : 0;
  const isLocked = module?.isLocked ?? false;

  const topOffset = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* ── Hero ── */}
        <View style={[styles.hero, { height: HERO_HEIGHT + topOffset }]}>
          <HeroImage uri={module?.imageUrl} isLocked={isLocked} />

          {/* Dark gradient overlay — top is transparent, bottom is rich dark */}
          <View style={styles.heroOverlay} />

          {/* Back button — floating on image */}
          <TouchableOpacity
            style={[styles.backBtn, { top: topOffset + 12 }]}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.cream} />
          </TouchableOpacity>

          {/* Level badge + title pinned to bottom of hero */}
          <View style={styles.heroCopy}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>Level {module?.level ?? 1}</Text>
            </View>
            <Text style={styles.heroTitle} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.75}>
              {module?.title ?? "Module"}
            </Text>
          </View>
        </View>

        {/* ── Progress / locked banner ── */}
        <View style={styles.metaBlock}>
          {module?.description ? (
            <Text style={styles.moduleDesc}>{module.description}</Text>
          ) : null}

          {isLocked ? (
            <View style={styles.lockedBanner}>
              <Ionicons name="lock-closed" size={15} color={colors.textMuted} />
              <Text style={styles.lockedBannerText}>
                Finish the previous level to unlock this one
              </Text>
            </View>
          ) : (
            <View style={styles.progressBlock}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>{pct}% complete</Text>
                <Text style={styles.progressCount}>
                  {completed}/{moduleLessons.length} lessons
                </Text>
              </View>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
              </View>
            </View>
          )}
        </View>

        {/* ── Lessons list ── */}
        <View style={styles.lessonsBlock}>
          <Text style={styles.sectionTitle}>Lessons</Text>
          <View style={styles.lessonList}>
            {moduleLessons.map((lesson, idx) => {
              const locked = lesson.isLocked;
              return (
                <TouchableOpacity
                  key={lesson.id}
                  style={[styles.lessonRow, locked && styles.lessonRowLocked]}
                  onPress={() => !locked && router.push(`/lesson/${lesson.id}`)}
                  activeOpacity={locked ? 1 : 0.8}
                >
                  <View style={[
                    styles.lessonBullet,
                    lesson.isCompleted && styles.lessonBulletDone,
                    locked && styles.lessonBulletLocked,
                  ]}>
                    {lesson.isCompleted ? (
                      <Ionicons name="checkmark" size={12} color={colors.cream} />
                    ) : (
                      <Text style={styles.lessonBulletText}>{idx + 1}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lessonTitle, locked && styles.lessonTitleLocked]}>
                      {lesson.title}
                    </Text>
                  </View>
                  {locked ? (
                    <Ionicons name="lock-closed" size={15} color={colors.borderBeige} />
                  ) : (
                    <Ionicons
                      name="play-circle"
                      size={20}
                      color={lesson.isCompleted ? colors.accentGreen : colors.textMuted}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },

  // Hero
  hero: {
    width: "100%",
    backgroundColor: colors.navBg,
    overflow: "hidden",
    position: "relative",
  },
  heroPlaceholder: {
    backgroundColor: "#0B3A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(6,17,13,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 60,
    // Scrim behind the text
    backgroundColor: "rgba(6,17,13,0.58)",
  },
  levelBadge: {
    backgroundColor: "rgba(29,158,117,0.85)",
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  levelBadgeText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },

  // Meta block (description + progress)
  metaBlock: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 14,
  },
  moduleDesc: {
    fontSize: 14,
    color: colors.textMid,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  lockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderBeige,
  },
  lockedBannerText: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  progressBlock: { gap: 8 },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryGreen,
    fontFamily: "Inter_600SemiBold",
  },
  progressCount: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
  progressBg: {
    height: 7,
    backgroundColor: colors.progressTrack,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 7,
    backgroundColor: colors.progressFill,
    borderRadius: 4,
  },

  // Lessons
  lessonsBlock: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textDark,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  lessonList: { gap: 8 },
  lessonRow: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  lessonRowLocked: { opacity: 0.5 },
  lessonBullet: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.borderBeige,
    alignItems: "center",
    justifyContent: "center",
  },
  lessonBulletDone: { backgroundColor: colors.accentGreen },
  lessonBulletLocked: { backgroundColor: colors.borderBeige },
  lessonBulletText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMid,
    fontFamily: "Inter_700Bold",
  },
  lessonTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textDark,
    fontFamily: "Inter_600SemiBold",
  },
  lessonTitleLocked: { color: colors.textMuted },
});
