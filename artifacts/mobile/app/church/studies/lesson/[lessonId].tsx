import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";
import { getChurchStudy, type ChurchStudyLesson } from "@/lib/churchStudyApi";
import { CustomLessonViewer } from "@/components/study/CustomLessonViewer";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Church Custom Lesson → the same reusable viewer a Family Custom Lesson
// uses (see app/family/studies/lesson/[lessonId].tsx) — never a second
// implementation of Scripture/Media/questions rendering.
export default function ChurchCustomLessonScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { studyId, lessonId } = useLocalSearchParams<{ studyId: string; lessonId: string }>();

  const [loading, setLoading] = useState(true);
  const [lesson, setLesson] = useState<ChurchStudyLesson | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!studyId || !lessonId) return;
        setLoading(true);
        try {
          const { lessons } = await getChurchStudy(studyId);
          const found = lessons.find((l) => l.id === lessonId) ?? null;
          if (!cancelled) setLesson(found);
        } catch (e: any) {
          if (!cancelled) showAlert("Couldn't load this lesson", e.message ?? "Please try again.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [studyId, lessonId])
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Lesson</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : !lesson ? (
        <View style={styles.centerFill}><Text style={styles.emptyText}>This lesson is not available.</Text></View>
      ) : (
        <CustomLessonViewer lesson={lesson} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
