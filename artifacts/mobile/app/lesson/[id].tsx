import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import colors from "@/constants/colors";

const LESSON_CONTENT = {
  title: "The Cost of Discipleship",
  verseRef: "Luke 14:27",
  verseText: "Whoever does not carry their cross and follow me cannot be my disciple.",
  body: `Discipleship was never meant to be comfortable. Jesus didn't promise safety — he promised presence. The invitation to follow him comes with a cost, and counting that cost is the first act of wisdom for any would-be disciple.

What does 'bearing a cross' mean in the 21st century? It means choosing obedience when convenience beckons the other way. It means walking toward people who are difficult to love. It means releasing ambitions that don't align with the Kingdom.

The paradox of the gospel is this: the cost that feels like loss is actually the path to the fullest kind of life. Jesus doesn't diminish you — he clarifies you. He strips away what was never truly yours, and what remains is imperishable.

As you study with your peer this week, talk honestly about what following Jesus has cost you personally. Where have you felt the weight of the cross? Where have you experienced the lightness that comes after surrender?`,
  questions: [
    "What has discipleship personally cost you in the last year?",
    "Is there an area where you have been counting the cost but have not yet made the decision?",
    "How does knowing Jesus paid an infinite cost change how you view your own sacrifice?",
  ],
};

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [completed, setCompleted] = useState(false);

  function markComplete() {
    setCompleted(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>Lesson</Text>
        {completed && (
          <View style={styles.completedTag}>
            <Ionicons name="checkmark" size={12} color={colors.cream} />
            <Text style={styles.completedTagText}>Done</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lessonTitle}>{LESSON_CONTENT.title}</Text>

        {/* Verse */}
        <View style={styles.verseCard}>
          <Text style={styles.verseText}>"{LESSON_CONTENT.verseText}"</Text>
          <Text style={styles.verseRef}>— {LESSON_CONTENT.verseRef}</Text>
        </View>

        {/* Body */}
        {LESSON_CONTENT.body.split("\n\n").map((para, idx) => (
          <Text key={idx} style={styles.bodyPara}>{para}</Text>
        ))}

        {/* Discussion Questions */}
        <View style={styles.questionsCard}>
          <View style={styles.questionsHeader}>
            <Ionicons name="people" size={16} color={colors.accentGreen} />
            <Text style={styles.questionsTitle}>Discussion Questions</Text>
          </View>
          {LESSON_CONTENT.questions.map((q, idx) => (
            <View key={idx} style={styles.questionRow}>
              <View style={styles.questionNum}>
                <Text style={styles.questionNumText}>{idx + 1}</Text>
              </View>
              <Text style={styles.questionText}>{q}</Text>
            </View>
          ))}
        </View>

        {!completed ? (
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={markComplete}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.cream} />
            <Text style={styles.completeBtnText}>Mark as Complete</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
            <Text style={styles.completedBannerText}>Lesson completed!</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerLabel: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  completedTag: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: colors.accentGreen,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  completedTagText: { color: colors.cream, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  lessonTitle: {
    fontSize: 24, fontWeight: "700", color: colors.textDark,
    fontFamily: "Inter_700Bold", marginBottom: 20,
  },
  verseCard: {
    backgroundColor: colors.cardBeige,
    borderRadius: 16, borderWidth: 1, borderColor: colors.warmBeige,
    padding: 16, marginBottom: 24,
    borderLeftWidth: 4, borderLeftColor: colors.amber,
  },
  verseText: {
    fontSize: 16, fontStyle: "italic", color: colors.textDark,
    lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 8,
  },
  verseRef: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  bodyPara: {
    fontSize: 15, color: colors.textDark, lineHeight: 26,
    fontFamily: "Inter_400Regular", marginBottom: 16,
  },
  questionsCard: {
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 28, marginTop: 8,
  },
  questionsHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 },
  questionsTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  questionRow: { flexDirection: "row", gap: 12, marginBottom: 14, alignItems: "flex-start" },
  questionNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  questionNumText: { fontSize: 11, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  questionText: { flex: 1, fontSize: 14, color: colors.textDark, lineHeight: 22, fontFamily: "Inter_400Regular" },
  completeBtn: {
    backgroundColor: colors.primaryGreen, borderRadius: 14,
    height: 54, flexDirection: "row", gap: 8,
    alignItems: "center", justifyContent: "center",
  },
  completeBtnText: { color: colors.cream, fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  completedBanner: {
    backgroundColor: "rgba(29,158,117,0.1)",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
    height: 54, flexDirection: "row", gap: 8,
    alignItems: "center", justifyContent: "center",
  },
  completedBannerText: { color: colors.accentGreen, fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
