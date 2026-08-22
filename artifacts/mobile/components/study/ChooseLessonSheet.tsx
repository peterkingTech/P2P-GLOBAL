import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import type { StudyLessonMeta } from "@/hooks/useStudySession";

// Shown the moment "Study Together" is tapped. Reuses the exact same
// "current lesson" logic progress.tsx already uses (first lesson that's
// neither completed nor locked) and the already-loaded modules/lessons
// arrays from DataContext — no new curriculum browsing UI, no duplicate data.
export function ChooseLessonSheet({
  visible, onClose, onChooseLesson,
}: { visible: boolean; onClose: () => void; onChooseLesson: (lesson: StudyLessonMeta) => void }) {
  const { modules, lessons } = useData();
  const [browsing, setBrowsing] = useState(false);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);

  const currentLesson = lessons.find((l) => !l.isCompleted && !l.isLocked);
  const currentModule = currentLesson ? modules.find((m) => m.id === currentLesson.moduleId) : null;

  function choose(lesson: { id: string; moduleId: string; title: string }) {
    onChooseLesson({ id: lesson.id, moduleId: lesson.moduleId, title: lesson.title });
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
              {currentLesson && currentModule && (
                <TouchableOpacity style={styles.optionCard} onPress={() => choose({ id: currentLesson.id, moduleId: currentModule.id, title: currentLesson.title })}>
                  <Ionicons name="play-circle" size={22} color="#1D9E75" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>Continue Your Current Lesson</Text>
                    <Text style={styles.optionSub}>{currentModule.title} · {currentLesson.title}</Text>
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