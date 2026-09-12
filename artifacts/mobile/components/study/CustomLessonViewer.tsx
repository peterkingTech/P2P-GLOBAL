import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";

// Stage 1 forensic finding: this app does not actually have one "Study
// Workspace" screen today — app/lesson/[id].tsx (P2P Curriculum, deeply
// coupled to the normalized p2p_lesson_sections/p2p_scriptures/
// p2p_reflection_questions tables, translation, and Kingdom School's
// sequential-progress tracking), Family Worship's "teaching" panel, and
// Study Together's StudyLessonTab are three independent implementations
// with no shared renderer. Forcing a Custom Lesson through app/lesson/[id]
// tsx's CMS/submission/progress pipeline would risk that protected system;
// instead this component reuses the genuinely reusable PIECES already
// established elsewhere — the Scripture-reference "tap to open bible.com"
// pattern (identical to app/lesson/[id].tsx), and the real, already-fixed
// GET /youtube-embed server page (the same Error-152 fix YouTubePlayer.
// native.tsx depends on) — without touching either, and without the
// synced-playback clock machinery that page's other consumer (Family
// Worship's simultaneous-viewing use case) needs but a standalone lesson
// view does not.
export interface CustomLessonContent {
  title: string;
  description?: string | null;
  scriptureReferences?: unknown[];
  teachingMaterial?: string | null;
  questions?: unknown[];
  prayerFocus?: string | null;
  media?: { provider: string; id: string; url: string | null } | null;
}

function scriptureLabel(ref: any): string {
  if (!ref || typeof ref !== "object") return "";
  const range = ref.endVerse && ref.endVerse !== ref.startVerse ? `${ref.startVerse}-${ref.endVerse}` : `${ref.startVerse}`;
  return `${ref.book} ${ref.chapter}:${range}${ref.translation ? ` (${ref.translation})` : ""}`;
}

export function CustomLessonViewer({ lesson }: { lesson: CustomLessonContent }) {
  const scripture = lesson.scriptureReferences?.[0];
  const questions = (lesson.questions as string[] | undefined)?.filter(Boolean) ?? [];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{lesson.title}</Text>
      {!!lesson.description && <Text style={styles.description}>{lesson.description}</Text>}

      {!!scripture && (
        <TouchableOpacity
          style={styles.scriptureCard}
          onPress={() => Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(scriptureLabel(scripture))}`).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel={`Open ${scriptureLabel(scripture)} on Bible.com`}
        >
          <Ionicons name="book" size={16} color={colors.accentGreen} />
          <Text style={styles.scriptureText}>{scriptureLabel(scripture)}</Text>
          <Ionicons name="open-outline" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {!!lesson.media && lesson.media.provider === "youtube" && (
        <View style={styles.mediaWrap}>
          <WebView
            style={styles.mediaPlayer}
            source={{ uri: `${getApiUrl()}/youtube-embed?v=${encodeURIComponent(lesson.media.id)}&autoplay=0&start=0&volume=1` }}
            javaScriptEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={Platform.OS !== "web"}
            originWhitelist={["*"]}
            domStorageEnabled
          />
        </View>
      )}

      {!!lesson.teachingMaterial && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TEACHING & STUDY MATERIAL</Text>
          <Text style={styles.bodyText}>{lesson.teachingMaterial}</Text>
        </View>
      )}

      {questions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DISCUSSION QUESTIONS</Text>
          {questions.map((q, i) => (
            <View key={i} style={styles.questionRow}>
              <Text style={styles.questionNumber}>{i + 1}</Text>
              <Text style={styles.questionText}>{q}</Text>
            </View>
          ))}
        </View>
      )}

      {!!lesson.prayerFocus && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>🙏 PRAYER FOCUS</Text>
          <Text style={styles.bodyText}>{lesson.prayerFocus}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 60, gap: 6 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  description: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 20 },
  scriptureCard: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(29,158,117,0.1)",
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, padding: 12, marginTop: 14,
  },
  scriptureText: { flex: 1, color: colors.textDark, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mediaWrap: { marginTop: 16, borderRadius: 14, overflow: "hidden" },
  mediaPlayer: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  section: { marginTop: 20 },
  sectionLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
  bodyText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 21 },
  questionRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  questionNumber: { color: colors.accentGreen, fontSize: 13, fontFamily: "Inter_700Bold", width: 18 },
  questionText: { flex: 1, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
