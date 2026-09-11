import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";

interface LessonRow { id: string; title: string; order_index: number; module_id: string; status: string }
interface ModuleRow { id: string; title: string; order_index: number; curriculum_id: string }
interface CurriculumRow { id: string; title: string; display_order: number | null }

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (lessonId: string, lessonTitle: string) => void;
}

// Read-only browser over the app's real, existing curriculum tables
// (p2p_curriculums/p2p_modules/p2p_lessons) — the exact same source Kingdom
// School reads, via the exact same direct-Supabase pattern DataContext.tsx
// already uses (RLS already permits authenticated reads of published
// curriculum content, since every Kingdom School screen depends on that).
// This never creates, edits, or duplicates a single row of curriculum data —
// picking a lesson here only sets which existing lesson a Gathering is about.
export default function LessonPicker({ visible, onClose, onSelect }: Props) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const [loading, setLoading] = useState(true);
  const [curricula, setCurricula] = useState<CurriculumRow[]>([]);
  const [modulesByCurriculum, setModulesByCurriculum] = useState<Map<string, ModuleRow[]>>(new Map());
  const [lessonsByModule, setLessonsByModule] = useState<Map<string, LessonRow[]>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: curriculumsRaw } = await supabase.from("p2p_curriculums")
        .select("id,title,display_order").eq("status", "published").neq("type", "plan").neq("type", "plan_category");
      const sortedCurricula = ((curriculumsRaw ?? []) as CurriculumRow[])
        .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
      setCurricula(sortedCurricula);
      const curriculumIds = sortedCurricula.map((c) => c.id);
      if (!curriculumIds.length) { setLoading(false); return; }

      const { data: modulesRaw } = await supabase.from("p2p_modules")
        .select("id,title,order_index,curriculum_id").in("curriculum_id", curriculumIds);
      const modMap = new Map<string, ModuleRow[]>();
      for (const m of (modulesRaw ?? []) as ModuleRow[]) {
        if (!modMap.has(m.curriculum_id)) modMap.set(m.curriculum_id, []);
        modMap.get(m.curriculum_id)!.push(m);
      }
      for (const list of modMap.values()) list.sort((a, b) => a.order_index - b.order_index);
      setModulesByCurriculum(modMap);

      const moduleIds = (modulesRaw ?? []).map((m) => m.id as string);
      const { data: lessonsRaw } = moduleIds.length
        ? await supabase.from("p2p_lessons").select("id,title,order_index,module_id,status").in("module_id", moduleIds).eq("status", "published")
        : { data: [] as LessonRow[] };
      const lessonMap = new Map<string, LessonRow[]>();
      for (const l of (lessonsRaw ?? []) as LessonRow[]) {
        if (!lessonMap.has(l.module_id)) lessonMap.set(l.module_id, []);
        lessonMap.get(l.module_id)!.push(l);
      }
      for (const list of lessonMap.values()) list.sort((a, b) => a.order_index - b.order_index);
      setLessonsByModule(lessonMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Choose a Lesson</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={c.textDark} />
          </TouchableOpacity>
        </View>
        {loading ? (
          <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
            <ActivityIndicator color={c.primaryGreen} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            {curricula.length === 0 && (
              <Text style={styles.emptyText}>No published curriculum is available yet.</Text>
            )}
            {curricula.map((curriculum) => (
              <View key={curriculum.id} style={{ marginBottom: 20 }}>
                <Text style={styles.curriculumTitle}>{curriculum.title}</Text>
                {(modulesByCurriculum.get(curriculum.id) ?? []).map((mod) => (
                  <View key={mod.id} style={{ marginTop: 10 }}>
                    <Text style={styles.moduleTitle}>{mod.title}</Text>
                    {(lessonsByModule.get(mod.id) ?? []).map((lesson) => (
                      <TouchableOpacity
                        key={lesson.id}
                        style={styles.lessonRow}
                        onPress={() => onSelect(lesson.id, lesson.title)}
                        accessibilityRole="button"
                        accessibilityLabel={`Select lesson ${lesson.title}`}
                      >
                        <Text style={styles.lessonRowText}>{lesson.title}</Text>
                        <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    headerTitle: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, paddingBottom: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
    curriculumTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    moduleTitle: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
    lessonRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.card, borderRadius: 10, marginBottom: 6,
      borderWidth: 1, borderColor: c.borderBeige,
    },
    lessonRowText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", flex: 1, marginRight: 8 },
  });
}
