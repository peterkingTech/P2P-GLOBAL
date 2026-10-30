import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { communityStudyApi, type CommunityScope, type CommunityStudyLesson } from "@/lib/communityStudyApi";
import { CustomLessonViewer } from "@/components/study/CustomLessonViewer";
import LessonWork from "@/components/study/LessonWork";
import GatheringReturnBar from "@/components/family/GatheringReturnBar";
import { IconButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";

// One custom lesson of a Family Circle or Church study — the shared screen
// behind app/family/studies/lesson/[lessonId].tsx and
// app/church/studies/lesson/[lessonId].tsx. `scope` picks the community's own
// API and its own lesson work (answers, reflections), so the two never mix.
export default function CommunityLessonScreen({ scope }: { scope: CommunityScope }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { studyId, lessonId } = useLocalSearchParams<{ studyId: string; lessonId: string }>();
  const [loading, setLoading] = useState(true);
  const [lesson, setLesson] = useState<CommunityStudyLesson | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!studyId || !lessonId) return;
        setLoading(true);
        try {
          const { lessons } = await communityStudyApi(scope).getStudy(studyId);
          const found = lessons.find((l) => l.id === lessonId) ?? null;
          if (!cancelled) setLesson(found);
        } catch (e: any) {
          if (!cancelled) showAlert("Couldn't load this lesson", e.message ?? "Please try again.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [scope, studyId, lessonId])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, backgroundColor: c.lightCream }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Opened from a live Gathering: return to it (the call keeps running). */}
      <GatheringReturnBar />
      <View style={styles.header}>
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" color={c.textDark} />
        <Text style={[styles.headerTitle, { color: c.textDark }]} accessibilityRole="header">Lesson</Text>
        <View style={{ width: 44 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : !lesson ? (
        <View style={styles.centerFill}><Text style={[styles.emptyText, { color: c.textMuted }]}>This lesson is not available.</Text></View>
      ) : (
        <CustomLessonViewer lesson={lesson} footer={<LessonWork scope={scope} lessonId={lesson.id} questions={lesson.questions} />} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, marginBottom: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
