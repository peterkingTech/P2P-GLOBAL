import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getRelatedLessons, type RelatedLesson } from "@/lib/bibleReaderApi";

// Core Foundation and P2P Plan lessons that study this chapter — found from
// the Scripture references the lessons already carry (p2p_scriptures). Only
// published lessons in published curricula are listed by the server.
interface Props {
  visible: boolean;
  book: string;
  bookName: string;
  chapter: number;
  onClose: () => void;
  onOpenLesson: (lessonId: string) => void;
}

export default function RelatedLessonsSheet({ visible, book, bookName, chapter, onClose, onOpenLesson }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [lessons, setLessons] = useState<RelatedLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLessons(null); setError(null);
    getRelatedLessons(book, chapter)
      .then((r) => { if (!cancelled) setLessons(r.lessons); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Couldn't load lessons."); });
    return () => { cancelled = true; };
  }, [visible, book, chapter, attempt]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close related lessons">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} accessibilityRole="header">Lessons on this chapter</Text>
              <Text style={styles.sub}>{bookName} {chapter}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>
          {error ? (
            <View style={styles.center}>
              <Text style={styles.muted}>{error}</Text>
              <TouchableOpacity onPress={() => setAttempt((n) => n + 1)} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
            </View>
          ) : !lessons ? (
            <View style={styles.center}><ActivityIndicator color={c.accentGreen} /></View>
          ) : lessons.length === 0 ? (
            <View style={styles.center}><Text style={styles.muted}>No Core Foundation or Plan lesson studies this chapter yet.</Text></View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              {lessons.map((l) => (
                <TouchableOpacity key={l.lessonId} style={styles.row} onPress={() => onOpenLesson(l.lessonId)} accessibilityRole="button"
                  accessibilityLabel={`${l.lessonTitle}, ${l.curriculumTitle}`}>
                  <View style={[styles.badge, l.kind === "plan" && styles.badgePlan]}>
                    <Text style={[styles.badgeText, l.kind === "plan" && styles.badgeTextPlan]}>{l.kind === "plan" ? "Plan" : "Core"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lesson} numberOfLines={2}>{l.lessonTitle}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{l.curriculumTitle}{l.moduleTitle ? ` · ${l.moduleTitle}` : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "75%", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 20 },
    header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingBottom: 6 },
    title: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 2 },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginTop: -8 },
    center: { padding: 24, alignItems: "center", gap: 10 },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    retry: { minHeight: 44, justifyContent: "center" },
    retryText: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    badgePlan: { borderColor: c.amber },
    badgeText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    badgeTextPlan: { color: c.amber },
    lesson: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  });
}
