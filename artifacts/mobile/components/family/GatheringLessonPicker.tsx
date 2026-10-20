import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getLearningHome, getLibrary, getCurriculumOutline, type LearningHome, type Library, type CurriculumOutline, type GroupScope } from "@/lib/groupLearningApi";
import { getFamilyStudies, getFamilyStudy } from "@/lib/familyStudyApi";
import { getChurchStudies, getChurchStudy } from "@/lib/churchStudyApi";

// The group's own studies/lessons — same shape for Family and Church.
interface OwnStudy { id: string; title: string; description: string | null; status: string }
interface OwnLesson { id: string; title: string; status?: string }
const ownStudies = (scope: GroupScope, groupId: string): Promise<OwnStudy[]> => (scope === "church" ? getChurchStudies(groupId) : getFamilyStudies(groupId));
const ownStudy = (scope: GroupScope, studyId: string): Promise<{ lessons: OwnLesson[] }> => (scope === "church" ? getChurchStudy(studyId) : getFamilyStudy(studyId));

export interface LessonChoice { kind: "central" | "family" | "church"; id: string; title: string }

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Family Gathering or Church Gathering — decides the journey and the group's own lessons. */
  scope: GroupScope;
  groupId: string;
  onSelect: (choice: LessonChoice) => void;
}

type Source = "journey" | "core" | "plans" | "family";
const sourcesFor = (scope: GroupScope): { key: Source; label: string }[] => [
  { key: "journey", label: "Our journey" },
  { key: "core", label: "Core Foundation" },
  { key: "plans", label: "P2P Plans" },
  { key: "family", label: scope === "church" ? "Church lessons" : "Family lessons" },
];

// What a Gathering studies (Prompt 6): a lesson from the family's current
// learning journey, the central library (Core Foundation and P2P Plans —
// the same server endpoints as the Learning screens), or one of the family's
// own published lessons. Choosing only links the lesson to the Gathering;
// nothing is copied, completed or written to anyone's progress.
export default function GatheringLessonPicker({ visible, onClose, scope, groupId, onSelect }: Props) {
  const SOURCES = sourcesFor(scope);
  const ownKind: LessonChoice["kind"] = scope === "church" ? "church" : "family";
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const [source, setSource] = useState<Source>("journey");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<LearningHome | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [studies, setStudies] = useState<OwnStudy[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [outlines, setOutlines] = useState<Map<string, CurriculumOutline>>(new Map());
  const [studyLessons, setStudyLessons] = useState<Map<string, OwnLesson[]>>(new Map());

  const load = useCallback(async (s: Source) => {
    setError(null);
    try {
      if (s === "journey" && !home) { setLoading(true); setHome(await getLearningHome(scope, groupId)); }
      if ((s === "core" || s === "plans") && !library) { setLoading(true); setLibrary(await getLibrary()); }
      if (s === "family" && !studies) { setLoading(true); setStudies((await ownStudies(scope, groupId)).filter((x) => x.status === "published")); }
    } catch (e: any) {
      setError(e.message ?? "Couldn't load lessons.");
    } finally {
      setLoading(false);
    }
  }, [scope, groupId, home, library, studies]);

  useEffect(() => { if (visible) load(source); }, [visible, source, load]);

  async function toggleCurriculum(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (outlines.has(id)) return;
    try { const o = await getCurriculumOutline(id); setOutlines((m) => new Map(m).set(id, o)); }
    catch (e: any) { setError(e.message ?? "Couldn't load lessons."); }
  }
  async function toggleStudy(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (studyLessons.has(id)) return;
    try {
      const { lessons } = await ownStudy(scope, id);
      setStudyLessons((m) => new Map(m).set(id, lessons.filter((l) => (l.status ?? "published") === "published")));
    } catch (e: any) { setError(e.message ?? "Couldn't load lessons."); }
  }

  const lessonRow = (choice: LessonChoice, hint?: string) => (
    <TouchableOpacity key={`${choice.kind}:${choice.id}`} style={styles.lessonRow} onPress={() => onSelect(choice)}
      accessibilityRole="button" accessibilityLabel={`Study ${choice.title} in this Gathering`}>
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={styles.lessonRowText}>{choice.title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </TouchableOpacity>
  );

  const groupRow = (id: string, title: string, sub: string | null) => (
    <TouchableOpacity key={id} style={styles.groupRow} onPress={() => (source === "family" ? toggleStudy(id) : toggleCurriculum(id))}
      accessibilityRole="button" accessibilityState={{ expanded: openId === id }} accessibilityLabel={title}>
      <View style={{ flex: 1 }}>
        <Text style={styles.groupTitle}>{title}</Text>
        {sub ? <Text style={styles.hint}>{sub}</Text> : null}
      </View>
      <Ionicons name={openId === id ? "chevron-up" : "chevron-down"} size={16} color={c.textMuted} />
    </TouchableOpacity>
  );

  const outlineLessons = (id: string) => {
    const o = outlines.get(id);
    if (!o) return <ActivityIndicator color={c.primaryGreen} style={{ marginVertical: 8 }} />;
    return o.modules.map((m) => (
      <View key={m.id} style={{ marginTop: 6 }}>
        <Text style={styles.moduleTitle}>{m.title}</Text>
        {m.lessons.map((l) => lessonRow({ kind: "central", id: l.id, title: l.title }))}
      </View>
    ));
  };

  function body() {
    if (loading) return <ActivityIndicator color={c.primaryGreen} style={{ marginTop: 40 }} />;
    if (error) return <Text style={styles.emptyText}>{error}</Text>;
    if (source === "journey") {
      const j = home?.activeJourney;
      if (!j) return <Text style={styles.emptyText}>{`Your ${scope === "church" ? "church" : "family"} isn't on a learning journey right now. Pick from Core Foundation, P2P Plans or ${scope === "church" ? "Church" : "Family"} lessons.`}</Text>;
      return (
        <>
          <Text style={styles.curriculumTitle}>{j.curriculum.title}</Text>
          {j.currentLesson && lessonRow({ kind: "central", id: j.currentLesson.id, title: j.currentLesson.title }, `Up next for your ${scope === "church" ? "church" : "family"}`)}
          {j.modules.map((m) => (
            <View key={m.id} style={{ marginTop: 10 }}>
              <Text style={styles.moduleTitle}>{m.title}</Text>
              {m.lessons.filter((l) => l.id !== j.currentLesson?.id).map((l) =>
                lessonRow({ kind: "central", id: l.id, title: l.title }, j.group.coveredLessonIds.includes(l.id) ? "Studied together" : undefined))}
            </View>
          ))}
        </>
      );
    }
    if (source === "core" || source === "plans") {
      const items = source === "core" ? library?.core ?? [] : (library?.categories ?? []).flatMap((cat) => cat.plans);
      if (!items.length) return <Text style={styles.emptyText}>Nothing here yet.</Text>;
      return items.map((it) => (
        <View key={it.id}>
          {groupRow(it.id, it.title, `${it.lessonCount} lesson${it.lessonCount === 1 ? "" : "s"}`)}
          {openId === it.id && outlineLessons(it.id)}
        </View>
      ));
    }
    if (!studies?.length) return <Text style={styles.emptyText}>{`Your ${scope === "church" ? "church" : "family"} has no published lessons yet.`}</Text>;
    return studies.map((st) => (
      <View key={st.id}>
        {groupRow(st.id, st.title, st.description)}
        {openId === st.id && (studyLessons.has(st.id)
          ? (studyLessons.get(st.id)!.length
            ? studyLessons.get(st.id)!.map((l) => lessonRow({ kind: ownKind, id: l.id, title: l.title }))
            : <Text style={styles.hint}>No published lessons in this study.</Text>)
          : <ActivityIndicator color={c.primaryGreen} style={{ marginVertical: 8 }} />)}
      </View>
    ));
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} accessibilityRole="header">Choose a Lesson</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={c.textDark} />
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={{ flexGrow: 0 }} accessibilityRole="tablist">
          {SOURCES.map((s) => (
            <TouchableOpacity key={s.key} style={[styles.tab, source === s.key && styles.tabActive]} onPress={() => { setSource(s.key); setOpenId(null); }}
              accessibilityRole="tab" accessibilityState={{ selected: source === s.key }}>
              <Text style={[styles.tabText, source === s.key && styles.tabTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView contentContainerStyle={styles.scroll}>{body()}</ScrollView>
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
    closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    tabs: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
    tab: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center", backgroundColor: c.card },
    tabActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tabText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    tabTextActive: { color: "#fff" },
    scroll: { padding: 16, paddingBottom: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
    curriculumTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
    moduleTitle: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
    hint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    groupRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderBeige, minHeight: 44 },
    groupTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    lessonRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44,
      paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.card, borderRadius: 10, marginBottom: 6,
      borderWidth: 1, borderColor: c.borderBeige,
    },
    lessonRowText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular" },
  });
}
