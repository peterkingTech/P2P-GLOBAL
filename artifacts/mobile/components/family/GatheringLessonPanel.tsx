import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, type } from "@/lib/togetherTheme";
import { getGatheringLesson, type GatheringLesson, type GatheringLessonRef } from "@/lib/familyApi";
import { getChurchCallLesson } from "@/lib/churchCallApi";

export type LessonScriptureRef = GatheringLesson["scripture"][number];

// The Gathering's lesson, followed together (Prompt 6). Everyone in the
// Gathering — including someone who joins late — reads the same lesson the
// Guide chose, from the server (members only). It shows lesson content and
// the questions to discuss; it never shows anyone's answers. Personal answers
// stay in each person's own lesson ("Open my lesson").
interface Props {
  /** Which Gathering: a Family Gathering session or a Church Gathering (church call). */
  gathering: { kind: "family" | "church"; id: string };
  lessonRef: GatheringLessonRef | null;
  isGuide: boolean;
  onChoose: () => void;
  onOpenMine: (lesson: GatheringLesson) => void;
  onOpenPassage: (ref: LessonScriptureRef) => void;
  /** Only for someone who may control Shared Media: play the lesson's video for everyone. */
  onPlayMedia?: ((youtubeId: string) => void) | null;
  largeText?: boolean;
}

export function scriptureLabel(r: LessonScriptureRef) {
  return `${r.book} ${r.chapter}:${r.startVerse === r.endVerse ? r.startVerse : `${r.startVerse}-${r.endVerse}`}`;
}

export default function GatheringLessonPanel({ gathering, lessonRef, isGuide, onChoose, onOpenMine, onOpenPassage, onPlayMedia, largeText = false }: Props) {
  const [lesson, setLesson] = useState<GatheringLesson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lessonKey = lessonRef ? `${lessonRef.kind}:${lessonRef.id}` : null;

  useEffect(() => {
    if (!lessonKey) { setLesson(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (gathering.kind === "church" ? getChurchCallLesson(gathering.id) : getGatheringLesson(gathering.id))
      .then((r) => { if (!cancelled) setLesson(r.lesson); })
      .catch((e) => { if (!cancelled) setError(e.message ?? "Couldn't load the lesson."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gathering.kind, gathering.id, lessonKey]);

  if (!lessonRef) {
    return (
      <View style={styles.empty}>
        <Text style={styles.muted}>{isGuide ? "Choose a lesson to study together." : "The Guide hasn't chosen a lesson yet."}</Text>
        {isGuide && (
          <TouchableOpacity style={styles.primaryBtn} onPress={onChoose} accessibilityRole="button" accessibilityLabel="Choose a lesson">
            <Text style={styles.primaryBtnText}>Choose Lesson</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          {lesson?.context ? <Text style={styles.context} numberOfLines={1}>{lesson.context}</Text> : null}
          <Text style={[styles.title, largeText && styles.titleLarge]} accessibilityRole="header">{lesson?.title ?? lessonRef.title}</Text>
        </View>
        {isGuide && (
          <TouchableOpacity onPress={onChoose} accessibilityRole="button" accessibilityLabel="Change lesson" style={styles.linkBtn}>
            <Text style={styles.link}>Change</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && <ActivityIndicator color={colors.textPrimary} style={{ marginVertical: spacing.sm }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {!loading && !error && !lesson && <Text style={styles.muted}>This lesson isn't available any more.</Text>}

      {lesson && (
        <>
          {lesson.description ? <Text style={[styles.body, largeText && styles.bodyLarge]}>{lesson.description}</Text> : null}

          {lesson.scripture.length > 0 && (
            <View style={styles.chips}>
              {lesson.scripture.map((r, i) => (
                <TouchableOpacity key={i} style={styles.chip} onPress={() => onOpenPassage(r)} accessibilityRole="button" accessibilityLabel={`Read ${scriptureLabel(r)}`}>
                  <Ionicons name="book-outline" size={14} color={colors.light} />
                  <Text style={styles.chipText}>{scriptureLabel(r)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {lesson.sections.map((s, i) => (
            <View key={i} style={styles.section}>
              {s.title ? <Text style={styles.sectionTitle}>{s.title}</Text> : null}
              <Text style={[styles.body, largeText && styles.bodyLarge]}>{s.content}</Text>
            </View>
          ))}

          {lesson.questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Questions</Text>
              {lesson.questions.map((q, i) => (
                <Text key={q.id} style={[styles.body, largeText && styles.bodyLarge]}>{i + 1}. {q.text}</Text>
              ))}
              <Text style={styles.note}>Talk about these together. Anything you write stays in your own lesson unless you choose to share it.</Text>
            </View>
          )}

          {lesson.prayerFocus ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Prayer focus</Text>
              <Text style={[styles.body, largeText && styles.bodyLarge]}>{lesson.prayerFocus}</Text>
            </View>
          ) : null}

          {lesson.media?.provider === "youtube" && onPlayMedia ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => onPlayMedia(lesson.media!.id)} accessibilityRole="button" accessibilityLabel="Play the lesson video for everyone">
              <Ionicons name="play" size={16} color={colors.textPrimary} />
              <Text style={styles.secondaryBtnText}>Play lesson video for everyone</Text>
            </TouchableOpacity>
          ) : null}

          {lesson.resources.map((r, i) => (
            <TouchableOpacity key={i} onPress={() => Linking.openURL(r.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={`Open ${r.title}`}>
              <Text style={styles.link}>{r.title}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.primaryBtn} onPress={() => onOpenMine(lesson)} accessibilityRole="button" accessibilityLabel="Open my lesson. The Gathering keeps going.">
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Open my lesson</Text>
          </TouchableOpacity>
          <Text style={styles.note}>Your call stays connected while you're in your lesson.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.xs },
  empty: { gap: spacing.sm, marginTop: spacing.xs },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  context: { color: colors.light, ...type.caption },
  title: { color: colors.textPrimary, fontSize: 17, fontFamily: "Inter_700Bold" },
  titleLarge: { fontSize: 22 },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  bodyLarge: { fontSize: 19, lineHeight: 30 },
  muted: { color: colors.textSecondary, ...type.body },
  note: { color: colors.textSecondary, ...type.caption, marginTop: spacing.xs },
  error: { color: colors.rest, ...type.caption },
  section: { gap: 4, marginTop: spacing.xs },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: radii.xl, backgroundColor: colors.lightSoft },
  chipText: { color: colors.textPrimary, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  linkBtn: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  link: { color: colors.connection, fontSize: 14, fontFamily: "Inter_600SemiBold", paddingVertical: 6 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 22, backgroundColor: colors.growth, marginTop: spacing.sm, paddingHorizontal: 16 },
  primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, paddingHorizontal: 16 },
  secondaryBtnText: { color: colors.textPrimary, fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
