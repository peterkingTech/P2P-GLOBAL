import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Alert, Platform, useWindowDimensions, Modal, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import BlockEditorPanel from "@/components/admin/BlockEditorPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = "draft" | "published" | "archived";
type LessonStatus = "draft" | "review" | "published" | "archived";

type Curriculum = {
  id: string; title: string; description: string | null; status: Status; created_at: string; type?: string;
};
type Module = {
  id: string; curriculum_id: string; title: string; description: string | null;
  status: Status; order_index: number; image_url?: string | null; color_theme?: string;
};
type LessonStub = {
  id: string; module_id: string; title: string; subtitle: string | null;
  status: LessonStatus; order_index: number;
};
type Language = { code: string; name: string; is_default: boolean };

const MODULE_COLOR_PALETTE = ["#1D9E75", "#1D6FA8", "#BA7517", "#7C3AED", "#DB2777", "#0F766E"];

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "#B45309",
  review: "#1D6FA8",
  published: colors.accentGreen,
  archived: colors.textMuted,
};

function StatusBadge({ status }: { status: string }) {
  return (
    <View style={[badgeStyles.wrap, { borderColor: STATUS_COLORS[status] ?? colors.textMuted }]}>
      <Text style={[badgeStyles.text, { color: STATUS_COLORS[status] ?? colors.textMuted }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
});

function showAdminError(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// ── Main Screen ───────────────────────────────────────────────────────────────

type MobilePanel = "modules" | "lessons" | "editor";

export default function CurriculumManagerScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isSplit = width >= 900;

  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [modulesMap, setModulesMap] = useState<Record<string, Module[]>>({});
  const [lessonsMap, setLessonsMap] = useState<Record<string, LessonStub[]>>({});
  const [languages, setLanguages] = useState<Language[]>([]);

  const [adminTab, setAdminTab] = useState<"curriculum" | "plans">("curriculum");
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

  const [treeLoading, setTreeLoading] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("modules");

  const [createModal, setCreateModal] = useState<null | "curriculum" | "plan" | "module" | "lesson">(null);
  const [createParentId, setCreateParentId] = useState<string>("");
  const [createTitle, setCreateTitle] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    const [{ data: cData }, { data: mData }, { data: lData }, { data: langData }] = await Promise.all([
      supabase.from("p2p_curriculums").select("*").order("created_at"),
      supabase.from("p2p_modules").select("*").order("order_index"),
      supabase.from("p2p_lessons")
        .select("id,module_id,title,subtitle,status,order_index")
        .order("order_index"),
      supabase.from("p2p_languages").select("*").order("name"),
    ]);

    const mMap: Record<string, Module[]> = {};
    for (const m of (mData ?? []) as Module[]) (mMap[m.curriculum_id] ??= []).push(m);

    const lMap: Record<string, LessonStub[]> = {};
    for (const l of (lData ?? []) as LessonStub[]) (lMap[l.module_id] ??= []).push(l);

    setCurricula((cData ?? []) as Curriculum[]);
    setModulesMap(mMap);
    setLessonsMap(lMap);

    const langs = (langData ?? []) as Language[];
    setLanguages(langs.length > 0 ? langs : [{ code: "en", name: "English", is_default: true }]);

    setTreeLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const coreCurricula = curricula.filter((c) => c.type !== "plan");
  const planCurricula = curricula.filter((c) => c.type === "plan");
  const visibleCurricula = adminTab === "plans" ? planCurricula : coreCurricula;

  const selectedCurriculum = curricula.find((c) => c.id === selectedCurriculumId) ?? null;
  const modulesForSelected = selectedCurriculumId ? (modulesMap[selectedCurriculumId] ?? []) : [];
  const selectedModule = modulesForSelected.find((m) => m.id === selectedModuleId) ?? null;
  const lessonsForSelected = selectedModuleId ? (lessonsMap[selectedModuleId] ?? []) : [];
  const selectedLesson = lessonsForSelected.find((l) => l.id === selectedLessonId) ?? null;

  function selectCurriculum(id: string) {
    setSelectedCurriculumId(id);
    setSelectedModuleId(null);
    setSelectedLessonId(null);
    if (!isSplit) setMobilePanel("lessons");
  }
  function selectModule(id: string) {
    setSelectedModuleId(id);
    setSelectedLessonId(null);
    if (!isSplit) setMobilePanel("lessons");
  }
  function selectLesson(id: string) {
    setSelectedLessonId(id);
    if (!isSplit) setMobilePanel("editor");
  }
  function editModuleSettings() {
    setSelectedLessonId(null);
    if (!isSplit) setMobilePanel("editor");
  }
  function editCurriculumSettings() {
    setSelectedModuleId(null);
    setSelectedLessonId(null);
    if (!isSplit) setMobilePanel("editor");
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  function openCreate(kind: "curriculum" | "plan" | "module" | "lesson", parentId = "") {
    setCreateModal(kind);
    setCreateParentId(parentId);
    setCreateTitle(kind === "module" ? "New Module" : kind === "lesson" ? "New Lesson" : "");
  }

  async function handleCreate() {
    if (!createTitle.trim()) { showAdminError("Title required", "Please enter a title."); return; }
    setCreateLoading(true);

    let error: any = null;
    let newId = "";

    if (createModal === "curriculum") {
      const { data, error: e } = await supabase.from("p2p_curriculums")
        .insert({ title: createTitle.trim(), status: "draft" }).select().single();
      error = e; if (data) newId = data.id;
    } else if (createModal === "plan") {
      const { data, error: e } = await supabase.from("p2p_curriculums")
        .insert({ title: createTitle.trim(), status: "draft", type: "plan" }).select().single();
      error = e; if (data) newId = data.id;
    } else if (createModal === "module") {
      const sibs = modulesMap[createParentId] ?? [];
      const sortOrder = sibs.length ? Math.max(...sibs.map((m) => m.order_index)) + 1 : 0;
      const color = MODULE_COLOR_PALETTE[sibs.length % MODULE_COLOR_PALETTE.length];
      const { data, error: e } = await supabase.from("p2p_modules")
        .insert({ curriculum_id: createParentId, title: createTitle.trim(), status: "draft", order_index: sortOrder, color_theme: color })
        .select().single();
      error = e;
      if (data) {
        newId = data.id;
        // Auto-create a starter lesson with one blank paragraph block, so a
        // freshly created module isn't an empty dead end.
        const { data: lessonData, error: lErr } = await supabase.from("p2p_lessons")
          .insert({ module_id: newId, title: "Lesson 1", status: "draft", order_index: 0 })
          .select().single();
        if (!lErr && lessonData) {
          await supabase.from("p2p_lesson_blocks").insert({
            lesson_id: lessonData.id, block_type: "paragraph", content: { text: "" }, order_index: 0,
          });
        }
      }
    } else if (createModal === "lesson") {
      const sibs = lessonsMap[createParentId] ?? [];
      const sortOrder = sibs.length ? Math.max(...sibs.map((l) => l.order_index)) + 1 : 0;
      const { data, error: e } = await supabase.from("p2p_lessons")
        .insert({ module_id: createParentId, title: createTitle.trim(), status: "draft", order_index: sortOrder })
        .select().single();
      error = e; if (data) newId = data.id;
    }

    setCreateLoading(false);
    if (error) { showAdminError("Error", error.message); return; }

    setCreateModal(null);
    await loadTree();

    if (createModal === "curriculum" || createModal === "plan") {
      selectCurriculum(newId);
    } else if (createModal === "module") {
      setSelectedModuleId(newId);
      // The auto-created starter lesson will be the only lesson — open it.
      const { data: freshLessons } = await supabase.from("p2p_lessons").select("id").eq("module_id", newId).order("order_index").limit(1);
      if (freshLessons && freshLessons[0]) selectLesson(freshLessons[0].id);
    } else if (createModal === "lesson") {
      selectLesson(newId);
    }
  }

  async function handleDuplicateLesson(lesson: LessonStub) {
    const sibs = lessonsMap[lesson.module_id] ?? [];
    const sortOrder = sibs.length ? Math.max(...sibs.map((l) => l.order_index)) + 1 : 0;
    const { data: newLesson, error } = await supabase.from("p2p_lessons")
      .insert({ module_id: lesson.module_id, title: `${lesson.title} (Copy)`, subtitle: lesson.subtitle, status: "draft", order_index: sortOrder })
      .select().single();
    if (error || !newLesson) { showAdminError("Duplicate failed", error?.message ?? "Unknown error"); return; }

    const { data: blocks } = await supabase.from("p2p_lesson_blocks").select("*").eq("lesson_id", lesson.id).order("order_index");
    if (blocks && blocks.length > 0) {
      const rows = blocks.map((b: any) => ({
        lesson_id: newLesson.id, block_type: b.block_type, content: b.content,
        order_index: b.order_index, is_required: b.is_required, is_submittable: b.is_submittable,
      }));
      await supabase.from("p2p_lesson_blocks").insert(rows);
    }
    await loadTree();
    selectLesson(newLesson.id);
  }

  function confirmDelete(kind: string, id: string, table: string, after?: () => void) {
    const doDelete = async () => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) {
        showAdminError(
          `Could not delete ${kind}`,
          error.code === "23503"
            ? `This ${kind} still has content inside it (${error.details ?? "referenced rows"}). Delete its contents first, then delete the ${kind}.`
            : error.message
        );
        return;
      }
      after?.();
      loadTree();
    };
    if (Platform.OS === "web") {
      if (window.confirm(`Delete ${kind}?\n\nThis cannot be undone.`)) doDelete();
    } else {
      Alert.alert(`Delete ${kind}?`, "This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  }

  // ── Reorder (up/down) ────────────────────────────────────────────────────────

  async function moveItem(
    table: string,
    items: Array<{ id: string; order_index: number }>,
    id: string,
    dir: "up" | "down",
    parentKey: string,
    setMap: React.Dispatch<React.SetStateAction<Record<string, any[]>>>
  ) {
    const idx = items.findIndex((i) => i.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === items.length - 1) return;

    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    const a = items[idx];
    const b = items[swapIdx];
    const newItems = [...items];
    newItems[idx] = { ...a, order_index: b.order_index };
    newItems[swapIdx] = { ...b, order_index: a.order_index };
    newItems.sort((x, y) => x.order_index - y.order_index);

    setMap((prev) => ({ ...prev, [parentKey]: newItems }));

    await Promise.all([
      supabase.from(table).update({ order_index: b.order_index }).eq("id", a.id),
      supabase.from(table).update({ order_index: a.order_index }).eq("id", b.id),
    ]);
  }

  // ── Panels ────────────────────────────────────────────────────────────────────

  const moduleNavigator = (
    <ScrollView style={styles.navPanel} contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 20 }}>
      <View style={styles.adminTabRow}>
        <TouchableOpacity style={[styles.adminTab, adminTab === "curriculum" && styles.adminTabActive]} onPress={() => setAdminTab("curriculum")}>
          <Ionicons name="book-outline" size={13} color={adminTab === "curriculum" ? "#fff" : colors.textMid} />
          <Text style={[styles.adminTabText, adminTab === "curriculum" && styles.adminTabTextActive]}>Curriculum</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.adminTab, adminTab === "plans" && styles.adminTabActive]} onPress={() => setAdminTab("plans")}>
          <Ionicons name="radio-outline" size={13} color={adminTab === "plans" ? "#fff" : colors.textMid} />
          <Text style={[styles.adminTabText, adminTab === "plans" && styles.adminTabTextActive]}>Plans</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.navPanelHeader}>
        <Text style={styles.navPanelTitle}>{adminTab === "plans" ? "Study Plans" : "Curricula"}</Text>
        <TouchableOpacity style={styles.addBtnSmall} onPress={() => openCreate(adminTab === "plans" ? "plan" : "curriculum")}>
          <Ionicons name="add" size={16} color={colors.accentGreen} />
          <Text style={styles.addBtnSmallText}>New</Text>
        </TouchableOpacity>
      </View>

      {treeLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.accentGreen} />
      ) : visibleCurricula.length === 0 ? (
        <View style={styles.emptyTree}>
          <Ionicons name={adminTab === "plans" ? "radio-outline" : "book-outline"} size={32} color={colors.textMuted} />
          <Text style={styles.emptyTreeText}>Nothing here yet</Text>
        </View>
      ) : (
        visibleCurricula.map((c) => {
          const cSel = selectedCurriculumId === c.id;
          const mods = modulesMap[c.id] ?? [];
          return (
            <View key={c.id} style={{ marginBottom: 10 }}>
              <TouchableOpacity style={[styles.navRow, cSel && !selectedModuleId && styles.navRowSelected]} onPress={() => selectCurriculum(c.id)} onLongPress={editCurriculumSettings}>
                <Ionicons name={adminTab === "plans" ? "radio-outline" : "book-outline"} size={14} color={colors.primaryGreen} />
                <Text style={[styles.navLabel, { flex: 1, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>{c.title}</Text>
                <StatusBadge status={c.status} />
              </TouchableOpacity>

              {cSel && (
                <View style={styles.moduleList}>
                  {mods.map((m) => {
                    const mSel = selectedModuleId === m.id;
                    const lessonCount = (lessonsMap[m.id] ?? []).length;
                    return (
                      <TouchableOpacity key={m.id} style={[styles.navRow, styles.moduleRow, mSel && styles.navRowSelected]} onPress={() => selectModule(m.id)}>
                        <View style={[styles.moduleColorDot, { backgroundColor: m.color_theme || colors.primaryGreen }]} />
                        <Text style={[styles.navLabel, { flex: 1 }]} numberOfLines={1}>{m.title}</Text>
                        <Text style={styles.navMeta}>{lessonCount}L</Text>
                        <View style={styles.reorderBtns}>
                          <TouchableOpacity onPress={() => moveItem("p2p_modules", mods, m.id, "up", c.id, setModulesMap)}>
                            <Ionicons name="arrow-up" size={11} color={colors.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => moveItem("p2p_modules", mods, m.id, "down", c.id, setModulesMap)}>
                            <Ionicons name="arrow-down" size={11} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                        <StatusBadge status={m.status} />
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={styles.addInTreeBtn} onPress={() => openCreate("module", c.id)}>
                    <Ionicons name="add" size={12} color={colors.accentGreen} />
                    <Text style={styles.addInTreeText}>Add module</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );

  const lessonListPanel = (
    <View style={styles.lessonPanel}>
      {selectedModule ? (
        <>
          <View style={styles.lessonPanelHeader}>
            <Text style={styles.lessonPanelTitle} numberOfLines={1}>{selectedModule.title}</Text>
            <TouchableOpacity onPress={editModuleSettings} style={styles.gearBtn}>
              <Ionicons name="settings-outline" size={16} color={colors.textMid} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 20 }}>
            {lessonsForSelected.length === 0 ? (
              <View style={styles.emptyTree}>
                <Ionicons name="document-text-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyTreeText}>No lessons yet</Text>
              </View>
            ) : (
              lessonsForSelected.map((l) => {
                const lSel = selectedLessonId === l.id;
                return (
                  <TouchableOpacity key={l.id} style={[styles.navRow, lSel && styles.navRowSelected]} onPress={() => selectLesson(l.id)}>
                    <Ionicons name="document-text" size={13} color={colors.textMuted} />
                    <Text style={[styles.navLabel, { flex: 1 }]} numberOfLines={1}>{l.title}</Text>
                    <View style={styles.reorderBtns}>
                      <TouchableOpacity onPress={() => moveItem("p2p_lessons", lessonsForSelected, l.id, "up", selectedModule.id, setLessonsMap)}>
                        <Ionicons name="arrow-up" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moveItem("p2p_lessons", lessonsForSelected, l.id, "down", selectedModule.id, setLessonsMap)}>
                        <Ionicons name="arrow-down" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => handleDuplicateLesson(l)} style={{ paddingHorizontal: 4 }}>
                      <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                    <StatusBadge status={l.status} />
                  </TouchableOpacity>
                );
              })
            )}
            <TouchableOpacity style={styles.addInTreeBtn} onPress={() => openCreate("lesson", selectedModule.id)}>
              <Ionicons name="add" size={12} color={colors.accentGreen} />
              <Text style={styles.addInTreeText}>Add lesson</Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      ) : (
        <View style={styles.editorEmpty}>
          <Ionicons name="folder-open-outline" size={32} color={colors.textMuted} />
          <Text style={styles.editorEmptyText}>Select a module to see its lessons.</Text>
        </View>
      )}
    </View>
  );

  const rightPanel = selectedLessonId ? (
    <BlockEditorPanel key={selectedLessonId} lessonId={selectedLessonId} onLessonChanged={loadTree} />
  ) : selectedModule ? (
    <ScrollView style={styles.editorScroll} contentContainerStyle={[styles.editorContent, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <ModuleEditor
        module={selectedModule}
        languages={languages}
        onSaved={(m) => {
          setModulesMap((p) => ({ ...p, [m.curriculum_id]: (p[m.curriculum_id] ?? []).map((x) => (x.id === m.id ? m : x)) }));
        }}
        onDelete={() => confirmDelete("module", selectedModule.id, "p2p_modules", () => setSelectedModuleId(null))}
      />
    </ScrollView>
  ) : selectedCurriculum ? (
    <ScrollView style={styles.editorScroll} contentContainerStyle={[styles.editorContent, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <CurriculumEditor
        curriculum={selectedCurriculum}
        languages={languages}
        onSaved={(c) => setCurricula((p) => p.map((x) => (x.id === c.id ? c : x)))}
        onDelete={() => confirmDelete("curriculum", selectedCurriculum.id, "p2p_curriculums", () => setSelectedCurriculumId(null))}
      />
    </ScrollView>
  ) : (
    <View style={styles.editorEmpty}>
      <Ionicons name="create-outline" size={40} color={colors.textMuted} />
      <Text style={styles.editorEmptyText}>Select a curriculum, module, or lesson to edit it.</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      {isSplit ? (
        <View style={styles.splitWrap}>
          <View style={[styles.navContainer, { borderRightWidth: 1, borderRightColor: colors.borderBeige }]}>{moduleNavigator}</View>
          <View style={[styles.lessonContainer, { borderRightWidth: 1, borderRightColor: colors.borderBeige }]}>{lessonListPanel}</View>
          <View style={styles.editorContainer}>{rightPanel}</View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {mobilePanel !== "modules" && (
            <View style={[styles.mobileEditorHeader, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={() => setMobilePanel(mobilePanel === "editor" && selectedModule ? "lessons" : "modules")}>
                <Ionicons name="arrow-back" size={22} color={colors.textDark} />
              </TouchableOpacity>
              <Text style={styles.mobileEditorTitle}>
                {mobilePanel === "lessons" ? "Lessons" : "Edit"}
              </Text>
              <View style={{ width: 22 }} />
            </View>
          )}
          {mobilePanel === "modules" && moduleNavigator}
          {mobilePanel === "lessons" && lessonListPanel}
          {mobilePanel === "editor" && rightPanel}
        </View>
      )}

      <Modal visible={!!createModal} transparent animationType="fade" onRequestClose={() => setCreateModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>
              New {createModal === "curriculum" ? "Curriculum" : createModal === "plan" ? "Plan" : createModal === "module" ? "Module" : "Lesson"}
            </Text>
            <TextInput style={styles.modalInput} value={createTitle} onChangeText={setCreateTitle} placeholder="Title" placeholderTextColor={colors.textMuted} autoFocus />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateModal(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalCreate, createLoading && { opacity: 0.7 }]} onPress={handleCreate} disabled={createLoading}>
                {createLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Curriculum Editor ─────────────────────────────────────────────────────────

function CurriculumEditor({
  curriculum, languages, onSaved, onDelete,
}: { curriculum: Curriculum; languages: Language[]; onSaved: (c: Curriculum) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(curriculum.title);
  const [description, setDescription] = useState(curriculum.description ?? "");
  const [status, setStatus] = useState<Status>(curriculum.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null);
    const { data, error: e } = await supabase.from("p2p_curriculums")
      .update({ title: title.trim(), description: description.trim() || null, status })
      .eq("id", curriculum.id).select().single();
    setSaving(false);
    if (e) { setError(e.message); return; }
    onSaved(data as Curriculum);
  }

  return (
    <View style={styles.editorForm}>
      <EditorHeader icon="book" label="Curriculum" onDelete={onDelete} />
      <EditorField label="Title *">
        <TextInput style={styles.edInput} value={title} onChangeText={setTitle} placeholder="Curriculum title" placeholderTextColor={colors.textMuted} />
      </EditorField>
      <EditorField label="Description">
        <TextInput style={[styles.edInput, { minHeight: 80 }]} value={description} onChangeText={setDescription} placeholder="Short description" placeholderTextColor={colors.textMuted} multiline textAlignVertical="top" />
      </EditorField>
      <EditorField label="Status">
        <StatusSelector value={status} onChange={setStatus} />
      </EditorField>
      {error && <Text style={styles.edError}>{error}</Text>}
      <SaveButton onPress={save} saving={saving} />
    </View>
  );
}

// ── Module Editor ─────────────────────────────────────────────────────────────

function ModuleEditor({
  module, languages, onSaved, onDelete,
}: { module: Module; languages: Language[]; onSaved: (m: Module) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(module.title);
  const [description, setDescription] = useState(module.description ?? "");
  const [status, setStatus] = useState<Status>(module.status);
  const [imageUrl, setImageUrl] = useState<string | null>(module.image_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(module.title);
    setDescription(module.description ?? "");
    setStatus(module.status);
    setImageUrl(module.image_url ?? null);
    setError(null);
  }, [module.id]);

  async function pickAndUploadImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Allow photo access to upload a thumbnail."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 3], quality: 0.85 });
    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const ext = (asset.uri.split(".").pop() ?? "jpg").toLowerCase();
      const path = `module-thumbnails/${module.id}.${ext}`;
      const blob = await (await fetch(asset.uri)).blob();
      const { error: upErr } = await supabase.storage.from("Module Title Pictures").upload(path, blob, { upsert: true, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from("Module Title Pictures").getPublicUrl(path);
      setImageUrl(urlData.publicUrl);
    } catch (ex: any) {
      Alert.alert("Upload failed", ex.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null);
    const { data, error: e } = await supabase.from("p2p_modules")
      .update({ title: title.trim(), description: description.trim() || null, status, image_url: imageUrl })
      .eq("id", module.id).select().single();
    setSaving(false);
    if (e) { setError(e.message); return; }
    onSaved(data as Module);
  }

  return (
    <View style={styles.editorForm}>
      <EditorHeader icon="folder" label="Module" onDelete={onDelete} />
      <EditorField label="Title *">
        <TextInput style={styles.edInput} value={title} onChangeText={setTitle} placeholder="Module title" placeholderTextColor={colors.textMuted} />
      </EditorField>
      <EditorField label="Description">
        <TextInput style={[styles.edInput, { minHeight: 80 }]} value={description} onChangeText={setDescription} placeholder="Short description" placeholderTextColor={colors.textMuted} multiline textAlignVertical="top" />
      </EditorField>
      <EditorField label="Status">
        <StatusSelector value={status} onChange={setStatus} />
      </EditorField>
      <EditorField label="Thumbnail Image">
        {imageUrl ? (
          <View style={{ gap: 8 }}>
            <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 120, borderRadius: 10 }} resizeMode="cover" />
            <TouchableOpacity style={styles.addBtn} onPress={pickAndUploadImage} disabled={uploading}>
              {uploading ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <><Ionicons name="swap-horizontal" size={15} color={colors.accentGreen} /><Text style={styles.addBtnText}>Replace image</Text></>}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={pickAndUploadImage} disabled={uploading}>
            {uploading ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <><Ionicons name="image-outline" size={15} color={colors.accentGreen} /><Text style={styles.addBtnText}>Upload thumbnail</Text></>}
          </TouchableOpacity>
        )}
      </EditorField>
      {error && <Text style={styles.edError}>{error}</Text>}
      <SaveButton onPress={save} saving={saving} />
    </View>
  );
}

// ── Shared editor bits ─────────────────────────────────────────────────────────

function EditorHeader({ icon, label, onDelete }: { icon: string; label: string; onDelete: () => void }) {
  return (
    <View style={styles.editorHeader}>
      <View style={styles.editorHeaderLeft}>
        <Ionicons name={icon as any} size={16} color={colors.primaryGreen} />
        <Text style={styles.editorHeaderLabel}>{label}</Text>
      </View>
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
        <Ionicons name="trash-outline" size={15} color="#B91C1C" />
        <Text style={styles.deleteBtnText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
}

function EditorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.editorField}>
      <Text style={styles.editorFieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function StatusSelector({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  const options: Status[] = ["draft", "published", "archived"];
  return (
    <View style={styles.statusRow}>
      {options.map((s) => (
        <TouchableOpacity key={s} style={[styles.statusOpt, value === s && { backgroundColor: STATUS_COLORS[s], borderColor: STATUS_COLORS[s] }]} onPress={() => onChange(s)}>
          <Text style={[styles.statusOptText, value === s && { color: "#fff" }]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SaveButton({ onPress, saving }: { onPress: () => void; saving: boolean }) {
  return (
    <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={onPress} disabled={saving}>
      {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.saveBtnText}>Save</Text></>}
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  splitWrap: { flex: 1, flexDirection: "row" },
  navContainer: { width: 280 },
  lessonContainer: { width: 260 },
  editorContainer: { flex: 1 },

  navPanel: { flex: 1, backgroundColor: "#fff" },
  navPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  navPanelTitle: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  addBtnSmall: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  addBtnSmallText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  adminTabRow: { flexDirection: "row", gap: 6, marginBottom: 10, backgroundColor: colors.cardBeige, borderRadius: 10, padding: 4 },
  adminTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 7, borderRadius: 8 },
  adminTabActive: { backgroundColor: colors.primaryGreen },
  adminTabText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  adminTabTextActive: { color: "#fff" },

  emptyTree: { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTreeText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  navRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
  navRowSelected: { backgroundColor: "rgba(29,158,117,0.1)" },
  navLabel: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  navMeta: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  moduleList: { paddingLeft: 8, marginLeft: 6, borderLeftWidth: 1, borderLeftColor: colors.borderBeige, marginTop: 2 },
  moduleRow: { paddingVertical: 6 },
  moduleColorDot: { width: 8, height: 8, borderRadius: 4 },
  reorderBtns: { flexDirection: "column", gap: 1 },
  addInTreeBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 6, marginTop: 4 },
  addInTreeText: { fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  lessonPanel: { flex: 1, backgroundColor: "#fff" },
  lessonPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  lessonPanelTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.textDark, flex: 1 },
  gearBtn: { padding: 4 },

  mobileEditorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  mobileEditorTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  editorEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  editorEmptyText: { fontSize: 14, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },

  editorScroll: { flex: 1 },
  editorContent: { padding: 20, gap: 16 },

  editorForm: { gap: 16 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  editorHeaderLabel: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleteBtnText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium" },

  editorField: { gap: 6 },
  editorFieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },

  edInput: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },

  statusRow: { flexDirection: "row", gap: 8 },
  statusOpt: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.borderBeige },
  statusOptText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 14, marginTop: 4 },
  addBtnText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  edError: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_400Regular", textAlign: "center" },

  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.accentGreen, borderRadius: 12, height: 50 },
  saveBtnText: { fontSize: 15, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  modalBox: { width: "85%", backgroundColor: "#fff", borderRadius: 18, padding: 24, gap: 16 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  modalInput: { backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, fontSize: 15, color: colors.textDark, fontFamily: "Inter_400Regular" },
  modalBtns: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige },
  modalCancelText: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_500Medium" },
  modalCreate: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accentGreen, minWidth: 80, alignItems: "center" },
  modalCreateText: { fontSize: 14, color: "#fff", fontFamily: "Inter_600SemiBold" },
});
