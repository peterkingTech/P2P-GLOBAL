import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { getFamilyStudy, type FamilyStudyLesson } from "@/lib/familyStudyApi";
import { CustomLessonViewer } from "@/components/study/CustomLessonViewer";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Mirrors app/church/studies/lesson/[lessonId].tsx exactly — same shared
// CustomLessonViewer, just fetched via the Family Studies API.
export default function FamilyCustomLessonScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { studyId, lessonId } = useLocalSearchParams<{ studyId: string; lessonId: string }>();

  const [loading, setLoading] = useState(true);
  const [lesson, setLesson] = useState<FamilyStudyLesson | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!studyId || !lessonId) return;
        setLoading(true);
        try {
          const { lessons } = await getFamilyStudy(studyId);
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
    <View style={[styles.container, { paddingTop: insets.top + 12, backgroundColor: c.lightCream }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.textDark }]}>Lesson</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : !lesson ? (
        <View style={styles.centerFill}><Text style={{ fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" }}>This lesson is not available.</Text></View>
      ) : (
        <CustomLessonViewer lesson={lesson} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
