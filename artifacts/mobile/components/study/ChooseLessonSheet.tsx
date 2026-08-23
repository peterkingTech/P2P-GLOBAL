import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import type { StudyLessonMeta } from "@/hooks/useStudySession";

// Shown the moment "Study Together" is tapped. Reuses the exact same
// "current lesson" logic progress.tsx already uses (first lesson that's
// neither completed nor locked) and the already-loaded modules/lessons
// arrays from DataContext — no new curriculum browsing UI, no duplicate data.
//
// continueOverride/initialMode let other callers reuse this same picker
// instead of building a second one: Disciple Detail passes initialMode=
// "browse" (it shows its own confirm step first, so the sheet's menu screen
// would be redundant) and could pass continueOverride to offer someone
// else's current lesson (e.g. a disciple's) instead of the viewer's own.
export function ChooseLessonSheet({
  visible, onClose, onChooseLesson, continueOverride, initialMode = "menu",
}: {
  visible: boolean; onClose: () => void; onChooseLesson: (lesson: StudyLessonMeta) => void;
  continueOverride?: { lesson: StudyLessonMeta; label: string };
  initialMode?: "menu" | "browse";
}) {
  const { modules, lessons } = useData();
  const [browsing, setBrowsing] = useState(initialMode === "browse");
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);

  // Reset to the caller's requested starting screen each time the sheet is
  // (re)opened — it stays mounted between opens, so state from a previous
  // visit (e.g. left mid-browse) would otherwise leak into the next one.
  useEffect(() => {
    if (visible) setBrowsing(initialMode === "browse");
  }, [visible, initialMode]);

  const ownCurrentLesson = lessons.find((l) => !l.isCompleted && !l.isLocked);
  const ownCurrentModule = ownCurrentLesson ? modules.find((m) => m.id === ownCurrentLesson.moduleId) : null;
  // Only offer the viewer's OWN current lesson when nobody else's lesson was
  // supplied and the caller didn't already skip straight to browsing (a
  // caller using initialMode="browse" with no override — e.g. Disciple
  // Detail — has no meaningful "continue" option to show; it isn't the
  // viewer's own progress that matters there).
  const showOwnCurrentLesson = !continueOverride && initialMode !== "browse";
  const currentLesson: StudyLessonMeta | null = continueOverride
    ? continueOverride.lesson
    : (showOwnCurrentLesson && ownCurrentLesson && ownCurrentModule
        ? { id: ownCurrentLesson.id, moduleId: ownCurrentModule.id, title: ownCurrentLesson.title }
        : null);
  const continueLabel = continueOverride?.label ?? "Continue Your Current Lesson";
  const continueSub = continueOverride
    ? currentLesson?.title ?? ""
    : (ownCurrentModule && ownCurrentLesson ? `${ownCurrentModule.title} · ${ownCurrentLesson.title}` : "");

  function choose(lesson: StudyLessonMeta) {
    onChooseLesson(lesson);
    setBrowsing(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{browsing ? "Choose a Lesson" : "Study Together"}</Text>
            <TouchableOpacity onPress={browsing ? () => setBrowsing(false) : onClose}>
              <Ionicons name={browsing ? "arrow-back" : "close"} size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {!browsing ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.sub}>Learn together through Kingdom School.</Text>
              {currentLesson && (
                <TouchableOpacity style={styles.optionCard} onPress={() => choose(currentLesson)}>
                  <Ionicons name="play-circle" size={22} color="#1D9E75" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{continueLabel}</Text>
                    <Text style={styles.optionSub}>{continueSub}</Text>
                  </View>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.optionCard} onPress={() => setBrowsing(true)}>
                <Ionicons name="book" size={22} color="#1D9E75" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Choose a Lesson to Study Together</Text>
                  <Text style={styles.optionSub}>Browse the Kingdom School curriculum</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 380 }}>
              {modules.map((m) => (
                <View key={m.id} style={{ marginBottom: 6 }}>
                  <TouchableOpacity style={styles.moduleRow} onPress={() => setExpandedModuleId((prev) => (prev === m.id ? null : m.id))}>
                    <Text style={styles.moduleTitle}>{m.title}</Text>
                    <Ionicons name={expandedModuleId === m.id ? "chevron-up" : "chevron-down"} size={16} color="rgba(255,255,255,0.6)" />
                  </TouchableOpacity>
                  {expandedModuleId === m.id && lessons.filter((l) => l.moduleId === m.id).map((l) => (
                    <TouchableOpacity key={l.id} style={styles.lessonRow} onPress={() => choose({ id: l.id, moduleId: m.id, title: l.title })}>
                      <Text style={styles.lessonRowText}>{l.title}</Text>
                      <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.4)" />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular" },
  optionCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1A241E", borderRadius: 14, padding: 14,
  },
  optionTitle: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  optionSub: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  moduleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#1A241E", borderRadius: 10, padding: 12, marginBottom: 4,
  },
  moduleTitle: { color: "#fff", fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  lessonRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 16,
  },
  lessonRowText: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "Inter_400Regular" },
});