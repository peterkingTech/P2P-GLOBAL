import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, ActivityIndicator, ScrollView, Modal } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { getFamilyDetail } from "@/lib/familyApi";
import { communityStudyApi, type CommunityScope, type CommunityStudyBase, type CommunityStudyLesson, type CustomStudyStatus } from "@/lib/communityStudyApi";
import CustomLessonSection from "@/components/study/CustomLessonSection";
import type { CustomLesson, LessonApi } from "@/lib/customLessonModel";
import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton, FilterChip, IconButton } from "@/components/ui";
import { showAlert, confirmAction } from "@/lib/alerts";

// One custom study of a Family Circle or Church — the shared screen behind
// app/family/studies/[studyId].tsx and app/church/studies/[studyId].tsx.
// What differs by community is explicit here:
//   • who may edit: Church — the server's answer for this study (falling back
//     to church leadership); Family — that family's Shepherd or Co-Shepherd;
//   • the community's own API and lesson route.
// The server enforces both rules regardless of what this screen shows.
const ARCHIVE_NOTE: Record<CommunityScope, string> = {
  church: "It will no longer be shown to church members. This can be reviewed later.",
  family: "It will no longer be shown to people in this Family Circle. This can be reviewed later.",
};

export default function CommunityStudyScreen({ scope }: { scope: CommunityScope }) {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { studyId, familyId } = useLocalSearchParams<{ studyId: string; familyId?: string }>();
  const { profile } = useAuth();
  const { isChurchLeader } = useData();
  const api = useMemo(() => communityStudyApi<CommunityStudyBase>(scope), [scope]);

  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [study, setStudy] = useState<CommunityStudyBase | null>(null);
  const [lessons, setLessons] = useState<CommunityStudyLesson[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    if (!studyId) return;
    setLoading(true);
    try {
      const { study: s, lessons: l, canManage: manage } = await api.getStudy(studyId);
      setStudy(s);
      setLessons(l);
      if (scope === "church") {
        // Leadership of THIS study's church, as the server decided it (a person
        // may belong to several churches; isChurchLeader describes the current one).
        setCanManage(manage ?? isChurchLeader);
      } else if (familyId) {
        const detail = await getFamilyDetail(familyId);
        const me = detail.members.find((m) => m.userId === profile?.id);
        setCanManage(detail.family.shepherdId === profile?.id || me?.role === "co_shepherd");
      }
    } catch (e: any) {
      showAlert("Couldn't load this Study", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [api, scope, studyId, familyId, profile?.id, isChurchLeader]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Lesson authoring goes through the shared section (components/study/
  // CustomLessonSection.tsx); this adapter points it at this community's API.
  const lessonApi: LessonApi = {
    add: (input) => api.addLesson(studyId as string, input as any) as Promise<CustomLesson>,
    update: (lessonId, input) => api.updateLesson(studyId as string, lessonId, input as any) as Promise<CustomLesson>,
    setStatus: (lessonId, status) => api.setLessonStatus(studyId as string, lessonId, status) as Promise<CustomLesson>,
    remove: (lessonId) => api.removeLesson(studyId as string, lessonId),
  };

  async function handleChangeStatus(status: CustomStudyStatus) {
    if (!study) return;
    setSavingStatus(true);
    try { setStudy(await api.updateStudy(study.id, { status })); }
    catch (e: any) { showAlert("Couldn't update the study", e.message ?? "Please try again."); }
    finally { setSavingStatus(false); }
  }

  function handleArchive() {
    if (!study) return;
    confirmAction("Archive this Study?", ARCHIVE_NOTE[scope], async () => {
      try { setStudy(await api.archiveStudy(study.id)); }
      catch (e: any) { showAlert("Couldn't archive the study", e.message ?? "Please try again."); }
    }, { confirmLabel: "Continue", destructive: true });
  }

  function openEditStudy() {
    if (!study) return;
    setEditTitle(study.title);
    setEditDescription(study.description ?? "");
    setEditOpen(true);
  }
  async function handleSaveEdit() {
    if (!study || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      setStudy(await api.updateStudy(study.id, { title: editTitle.trim(), description: editDescription.trim() || null }));
      setEditOpen(false);
    } catch (e: any) {
      showAlert("Couldn't save changes", e.message ?? "Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) return <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  if (!study) return <View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>This study is not available.</Text></View>;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" color={c.textDark} />
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{study.title}</Text>
        {canManage
          ? <IconButton icon="create-outline" onPress={openEditStudy} accessibilityLabel="Edit study" color={c.textDark} />
          : <View style={{ width: 44 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {!!study.description && <Text style={styles.description}>{study.description}</Text>}

        {canManage && (
          <View style={styles.statusRow} accessibilityRole="radiogroup" accessibilityLabel="Study status">
            {(["draft", "published"] as CustomStudyStatus[]).map((s) => (
              <FilterChip key={s} label={s === "draft" ? "Draft" : "Published"} selection="single" selected={study.status === s}
                disabled={savingStatus || study.status === "archived"} onPress={() => handleChangeStatus(s)} />
            ))}
            {study.status !== "archived" && (
              <IconButton icon="archive-outline" onPress={handleArchive} accessibilityLabel="Archive study" size="sm" color={c.textMuted} style={{ marginLeft: "auto" }} />
            )}
          </View>
        )}
        {study.status === "archived" && <Text style={styles.archivedNotice}>This study is archived.</Text>}

        <CustomLessonSection
          lessons={lessons}
          onLessonsChange={setLessons}
          canManage={canManage}
          api={lessonApi}
          onOpen={(lesson) => router.push({ pathname: `/${scope}/studies/lesson/[lessonId]`, params: { lessonId: lesson.id, studyId: study.id } } as any)}
        />
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Edit Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholderTextColor={c.textMuted} accessibilityLabel="Study title" />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={editDescription} onChangeText={setEditDescription} multiline placeholderTextColor={c.textMuted} accessibilityLabel="Study description" />
            <View style={styles.sheetRow}>
              <AppButton label="Cancel" onPress={() => setEditOpen(false)} variant="outline" disabled={savingEdit} style={{ flex: 1 }} />
              <AppButton label="Save" onPress={handleSaveEdit} disabled={savingEdit || !editTitle.trim()} loading={savingEdit} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, paddingHorizontal: 8, marginBottom: 8 },
    title: { flex: 1, fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    description: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 },
    archivedNotice: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginBottom: 14, fontStyle: "italic" },
    sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheetBox: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, width: "100%", alignSelf: "center" },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 10 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 6,
    },
    sheetRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  });
}
