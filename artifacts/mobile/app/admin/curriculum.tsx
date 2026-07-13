import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
  Modal,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = "draft" | "published" | "archived";

type Curriculum = {
  id: string; title: string; description: string | null; status: Status; created_at: string;
};
type Module = {
  id: string; curriculum_id: string; title: string; description: string | null;
  status: Status; order_index: number; image_url?: string | null;
};
type LessonStub = {
  id: string; module_id: string; title: string; subtitle: string | null;
  status: Status; order_index: number;
};
type Section = { id?: string; title?: string; content: string; sort_order: number };
type Scripture = { id?: string; verse_ref: string; verse_text: string; sort_order: number };
type Question = { id?: string; question: string; sort_order: number };
type Assignment = { id?: string; title: string; instructions: string; sort_order: number };
type Language = { code: string; name: string; is_default: boolean };
type Coverage = { done: number; total: number; label: string };

type Selection =
  | { kind: "curriculum"; item: Curriculum }
  | { kind: "module"; item: Module }
  | { kind: "lesson"; item: LessonStub }
  | null;

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<Status, string> = {
  draft: "#B45309",
  published: colors.accentGreen,
  archived: colors.textMuted,
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <View style={[badgeStyles.wrap, { borderColor: STATUS_COLORS[status] }]}>
      <Text style={[badgeStyles.text, { color: STATUS_COLORS[status] }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
});

function uid() {
  return Math.random().toString(36).slice(2);
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function CurriculumManagerScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isSplit = width >= 768;

  // Tree state
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [modulesMap, setModulesMap] = useState<Record<string, Module[]>>({});
  const [lessonsMap, setLessonsMap] = useState<Record<string, LessonStub[]>>({});
  const [expandedCurricula, setExpandedCurricula] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [coverageMap, setCoverageMap] = useState<Record<string, Coverage>>({});

  // Selection & editor
  const [selected, setSelected] = useState<Selection>(null);
  const [showEditor, setShowEditor] = useState(false);

  // Languages
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedLang, setSelectedLang] = useState("en");

  // Tab
  const [adminTab, setAdminTab] = useState<"curriculum" | "plans">("curriculum");

  // Loading
  const [treeLoading, setTreeLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Create-new modal
  const [createModal, setCreateModal] = useState<null | "curriculum" | "module" | "lesson">(null);
  const [createParentId, setCreateParentId] = useState<string>("");
  const [createTitle, setCreateTitle] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // ── Load tree ──────────────────────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    const [{ data: cData }, { data: mData }, { data: lData }, { data: langData }] =
      await Promise.all([
        supabase.from("p2p_curriculums").select("*").order("created_at"),
        supabase.from("p2p_modules").select("*").order("order_index"),
        supabase.from("p2p_lessons")
          .select("id,module_id,title,subtitle,status,order_index")
          .order("order_index"),
        supabase.from("p2p_languages").select("*").order("name"),
      ]);

    const mMap: Record<string, Module[]> = {};
    for (const m of (mData ?? []) as Module[]) {
      (mMap[m.curriculum_id] ??= []).push(m);
    }

    const lMap: Record<string, LessonStub[]> = {};
    for (const l of (lData ?? []) as LessonStub[]) {
      (lMap[l.module_id] ??= []).push(l);
    }

    setCurricula((cData ?? []) as Curriculum[]);
    setModulesMap(mMap);
    setLessonsMap(lMap);

    const langs = (langData ?? []) as Language[];
    if (langs.length > 0) setLanguages(langs);
    else setLanguages([{ code: "en", name: "English", is_default: true }]);

    setTreeLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  // ── Translation coverage fetch ─────────────────────────────────────────────

  const fetchCoverage = useCallback(async (lessonId: string) => {
    const { data: total } = await supabase
      .from("p2p_languages").select("code").eq("is_default", false);
    const { data: done } = await supabase
      .from("p2p_lesson_translations").select("language_code").eq("lesson_id", lessonId);
    const t = (total ?? []).length;
    const d = new Set((done ?? []).map((r: any) => r.language_code)).size;
    setCoverageMap((prev) => ({
      ...prev,
      [lessonId]: { done: d, total: t, label: `${d + 1} of ${t + 1} languages` },
    }));
  }, []);

  // ── Tree toggles ───────────────────────────────────────────────────────────

  function toggleCurriculum(id: string) {
    setExpandedCurricula((p) => {
      const s = new Set(p);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleModule(id: string, moduleId: string) {
    setExpandedModules((p) => {
      const s = new Set(p);
      s.has(moduleId) ? s.delete(moduleId) : s.add(moduleId);
      return s;
    });
    // Fetch coverage for lessons in this module
    const lessons = lessonsMap[moduleId] ?? [];
    for (const l of lessons) {
      if (!coverageMap[l.id]) fetchCoverage(l.id);
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function select(s: Selection) {
    setSelected(s);
    if (!isSplit) setShowEditor(true);
    if (s?.kind === "lesson") fetchCoverage(s.item.id);
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  function openCreate(kind: "curriculum" | "module" | "lesson", parentId = "") {
    setCreateModal(kind);
    setCreateParentId(parentId);
    setCreateTitle("");
  }

  async function handleCreate() {
    if (!createTitle.trim()) { Alert.alert("Title required"); return; }
    setCreateLoading(true);

    let error: any = null;
    let newId = "";

    if (createModal === "curriculum") {
      const { data, error: e } = await supabase
        .from("p2p_curriculums")
        .insert({ title: createTitle.trim(), status: "draft" })
        .select().single();
      error = e; if (data) newId = data.id;
    } else if (createModal === "module") {
      const sibs = modulesMap[createParentId] ?? [];
      const sortOrder = sibs.length ? Math.max(...sibs.map((m) => m.order_index)) + 1 : 0;
      const { data, error: e } = await supabase
        .from("p2p_modules")
        .insert({ curriculum_id: createParentId, title: createTitle.trim(), status: "draft", order_index: sortOrder })
        .select().single();
      error = e; if (data) newId = data.id;
    } else if (createModal === "lesson") {
      const sibs = lessonsMap[createParentId] ?? [];
      const sortOrder = sibs.length ? Math.max(...sibs.map((l) => l.order_index)) + 1 : 0;
      const { data, error: e } = await supabase
        .from("p2p_lessons")
        .insert({ module_id: createParentId, title: createTitle.trim(), status: "draft", order_index: sortOrder })
        .select().single();
      error = e; if (data) newId = data.id;
    }

    setCreateLoading(false);
    if (error) { Alert.alert("Error", error.message); return; }

    setCreateModal(null);
    await loadTree();

    // Auto-expand parent and select new item
    if (createModal === "curriculum") {
      setExpandedCurricula((p) => new Set([...p, newId]));
    } else if (createModal === "module") {
      setExpandedCurricula((p) => new Set([...p, createParentId]));
      setExpandedModules((p) => new Set([...p, newId]));
    } else if (createModal === "lesson") {
      setExpandedModules((p) => new Set([...p, createParentId]));
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function confirmDelete(kind: string, id: string, table: string) {
    Alert.alert(
      `Delete ${kind}?`,
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await supabase.from(table).delete().eq("id", id);
            setSelected(null);
            loadTree();
          },
        },
      ]
    );
  }

  // ── Reorder ────────────────────────────────────────────────────────────────

  async function moveItem(
    table: string,
    orderCol: string,
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
      supabase.from(table).update({ [orderCol]: b.order_index }).eq("id", a.id),
      supabase.from(table).update({ [orderCol]: a.order_index }).eq("id", b.id),
    ]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const PLANS_CURRICULUM_ID = "b0000000-0000-0000-0000-000000000001";
  const coreCurricula = curricula.filter((c) => (c as any).type !== "plan");
  const planModules = modulesMap[PLANS_CURRICULUM_ID] ?? [];

  const treePanel = (
    <ScrollView style={styles.treePanel} contentContainerStyle={[styles.treePanelContent, { paddingBottom: insets.bottom + 20 }]}>
      {/* Tab switcher */}
      <View style={styles.adminTabRow}>
        <TouchableOpacity
          style={[styles.adminTab, adminTab === "curriculum" && styles.adminTabActive]}
          onPress={() => setAdminTab("curriculum")}
        >
          <Ionicons name="book-outline" size={13} color={adminTab === "curriculum" ? "#fff" : colors.textMid} />
          <Text style={[styles.adminTabText, adminTab === "curriculum" && styles.adminTabTextActive]}>Curriculum</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.adminTab, adminTab === "plans" && styles.adminTabActive]}
          onPress={() => setAdminTab("plans")}
        >
          <Ionicons name="radio-outline" size={13} color={adminTab === "plans" ? "#fff" : colors.textMid} />
          <Text style={[styles.adminTabText, adminTab === "plans" && styles.adminTabTextActive]}>Plans</Text>
        </TouchableOpacity>
      </View>

      {adminTab === "plans" ? (
        /* ── Plans Panel ── */
        <View>
          <View style={styles.treePanelHeader}>
            <Text style={styles.treePanelTitle}>Study Plans</Text>
            <TouchableOpacity style={styles.addBtnSmall} onPress={() => openCreate("module", PLANS_CURRICULUM_ID)}>
              <Ionicons name="add" size={16} color={colors.accentGreen} />
              <Text style={styles.addBtnSmallText}>New Plan</Text>
            </TouchableOpacity>
          </View>
          {treeLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={colors.accentGreen} />
          ) : planModules.length === 0 ? (
            <View style={styles.emptyTree}>
              <Ionicons name="radio-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyTreeText}>No plans yet</Text>
              <TouchableOpacity style={styles.emptyTreeBtn} onPress={() => openCreate("module", PLANS_CURRICULUM_ID)}>
                <Text style={styles.emptyTreeBtnText}>Create first plan</Text>
              </TouchableOpacity>
            </View>
          ) : (
            planModules.map((m) => {
              const mExpanded = expandedModules.has(m.id);
              const planLessons = lessonsMap[m.id] ?? [];
              const mSel = selected?.kind === "module" && selected.item.id === m.id;
              return (
                <View key={m.id} style={styles.treeLevel0}>
                  <TouchableOpacity
                    style={[styles.treeRow, mSel && styles.treeRowSelected]}
                    onPress={() => select({ kind: "module", item: m })}
                    activeOpacity={0.75}
                  >
                    <TouchableOpacity onPress={() => toggleModule(PLANS_CURRICULUM_ID, m.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name={mExpanded ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                    <Ionicons name={((m as any).icon_name ?? "radio-outline") as any} size={14} color={colors.primaryGreen} style={{ marginRight: 2 }} />
                    <Text style={[styles.treeLabel, { flex: 1 }, mSel && styles.treeLabelSelected]} numberOfLines={1}>
                      {m.title}
                    </Text>
                    <Text style={[styles.covBadge, { marginRight: 4 }]}>{planLessons.length}L</Text>
                    <StatusBadge status={m.status} />
                  </TouchableOpacity>

                  {mExpanded && (
                    <View style={styles.treeLevel1}>
                      {planLessons.map((l) => {
                        const lSel = selected?.kind === "lesson" && selected.item.id === l.id;
                        const cov = coverageMap[l.id];
                        return (
                          <TouchableOpacity
                            key={l.id}
                            style={[styles.treeRow, styles.treeRowL, lSel && styles.treeRowSelected]}
                            onPress={() => select({ kind: "lesson", item: l })}
                            activeOpacity={0.75}
                          >
                            <Ionicons name="document-text" size={12} color={colors.textMuted} style={{ marginRight: 2 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.treeLabel, { fontSize: 12 }, lSel && styles.treeLabelSelected]} numberOfLines={1}>
                                {l.title}
                              </Text>
                              {cov && <Text style={styles.covBadge}>{cov.label}</Text>}
                            </View>
                            <View style={styles.reorderBtns}>
                              <TouchableOpacity onPress={() => moveItem("p2p_lessons", "order_index", planLessons, l.id, "up", m.id, setLessonsMap)}>
                                <Ionicons name="arrow-up" size={11} color={colors.textMuted} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => moveItem("p2p_lessons", "order_index", planLessons, l.id, "down", m.id, setLessonsMap)}>
                                <Ionicons name="arrow-down" size={11} color={colors.textMuted} />
                              </TouchableOpacity>
                            </View>
                            <StatusBadge status={l.status} />
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity style={styles.addInTreeBtn} onPress={() => openCreate("lesson", m.id)}>
                        <Ionicons name="add" size={12} color={colors.accentGreen} />
                        <Text style={styles.addInTreeText}>Add lesson</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      ) : (
        /* ── Curriculum Panel ── */
        <View>
      <View style={styles.treePanelHeader}>
        <Text style={styles.treePanelTitle}>Curriculum Tree</Text>
        <TouchableOpacity style={styles.addBtnSmall} onPress={() => openCreate("curriculum")}>
          <Ionicons name="add" size={16} color={colors.accentGreen} />
          <Text style={styles.addBtnSmallText}>New Curriculum</Text>
        </TouchableOpacity>
      </View>

      {treeLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.accentGreen} />
      ) : coreCurricula.length === 0 ? (
        <View style={styles.emptyTree}>
          <Ionicons name="book-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTreeText}>No curricula yet</Text>
          <TouchableOpacity style={styles.emptyTreeBtn} onPress={() => openCreate("curriculum")}>
            <Text style={styles.emptyTreeBtnText}>Create first curriculum</Text>
          </TouchableOpacity>
        </View>
      ) : (
        coreCurricula.map((c) => {
          const cExpanded = expandedCurricula.has(c.id);
          const mods = modulesMap[c.id] ?? [];
          const isSel = selected?.kind === "curriculum" && selected.item.id === c.id;

          return (
            <View key={c.id} style={styles.treeLevel0}>
              {/* Curriculum row */}
              <TouchableOpacity
                style={[styles.treeRow, isSel && styles.treeRowSelected]}
                onPress={() => select({ kind: "curriculum", item: c })}
                activeOpacity={0.75}
              >
                <TouchableOpacity onPress={() => toggleCurriculum(c.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons
                    name={cExpanded ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
                <Ionicons name="book" size={14} color={colors.primaryGreen} style={{ marginRight: 2 }} />
                <Text style={[styles.treeLabel, { flex: 1 }, isSel && styles.treeLabelSelected]} numberOfLines={1}>
                  {c.title}
                </Text>
                <StatusBadge status={c.status} />
              </TouchableOpacity>

              {cExpanded && (
                <View style={styles.treeLevel1}>
                  {mods.map((m, mi) => {
                    const mExpanded = expandedModules.has(m.id);
                    const lessons = lessonsMap[m.id] ?? [];
                    const mSel = selected?.kind === "module" && selected.item.id === m.id;

                    return (
                      <View key={m.id}>
                        {/* Module row */}
                        <TouchableOpacity
                          style={[styles.treeRow, styles.treeRowM, mSel && styles.treeRowSelected]}
                          onPress={() => select({ kind: "module", item: m })}
                          activeOpacity={0.75}
                        >
                          <TouchableOpacity onPress={() => toggleModule(c.id, m.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                            <Ionicons
                              name={mExpanded ? "chevron-down" : "chevron-forward"}
                              size={13}
                              color={colors.textMuted}
                            />
                          </TouchableOpacity>
                          <Ionicons name="folder" size={13} color={colors.amber} style={{ marginRight: 2 }} />
                          <Text style={[styles.treeLabel, { flex: 1, fontSize: 13 }, mSel && styles.treeLabelSelected]} numberOfLines={1}>
                            {m.title}
                          </Text>
                          <View style={styles.reorderBtns}>
                            <TouchableOpacity onPress={() => moveItem("p2p_modules", "order_index", mods, m.id, "up", c.id, setModulesMap)}>
                              <Ionicons name="arrow-up" size={12} color={colors.textMuted} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => moveItem("p2p_modules", "order_index", mods, m.id, "down", c.id, setModulesMap)}>
                              <Ionicons name="arrow-down" size={12} color={colors.textMuted} />
                            </TouchableOpacity>
                          </View>
                          <StatusBadge status={m.status} />
                        </TouchableOpacity>

                        {mExpanded && (
                          <View style={styles.treeLevel2}>
                            {lessons.map((l, li) => {
                              const lSel = selected?.kind === "lesson" && selected.item.id === l.id;
                              const cov = coverageMap[l.id];
                              return (
                                <TouchableOpacity
                                  key={l.id}
                                  style={[styles.treeRow, styles.treeRowL, lSel && styles.treeRowSelected]}
                                  onPress={() => select({ kind: "lesson", item: l })}
                                  activeOpacity={0.75}
                                >
                                  <Ionicons name="document-text" size={12} color={colors.textMuted} style={{ marginRight: 2 }} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={[styles.treeLabel, { fontSize: 12 }, lSel && styles.treeLabelSelected]} numberOfLines={1}>
                                      {l.title}
                                    </Text>
                                    {cov && (
                                      <Text style={styles.covBadge}>{cov.label}</Text>
                                    )}
                                  </View>
                                  <View style={styles.reorderBtns}>
                                    <TouchableOpacity onPress={() => moveItem("p2p_lessons", "order_index", lessons, l.id, "up", m.id, setLessonsMap)}>
                                      <Ionicons name="arrow-up" size={11} color={colors.textMuted} />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => moveItem("p2p_lessons", "order_index", lessons, l.id, "down", m.id, setLessonsMap)}>
                                      <Ionicons name="arrow-down" size={11} color={colors.textMuted} />
                                    </TouchableOpacity>
                                  </View>
                                  <StatusBadge status={l.status} />
                                </TouchableOpacity>
                              );
                            })}
                            {/* Add lesson */}
                            <TouchableOpacity
                              style={styles.addInTreeBtn}
                              onPress={() => openCreate("lesson", m.id)}
                            >
                              <Ionicons name="add" size={12} color={colors.accentGreen} />
                              <Text style={styles.addInTreeText}>Add lesson</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {/* Add module */}
                  <TouchableOpacity
                    style={styles.addInTreeBtn}
                    onPress={() => openCreate("module", c.id)}
                  >
                    <Ionicons name="add" size={12} color={colors.accentGreen} />
                    <Text style={styles.addInTreeText}>Add module</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })
      )}
      </View>
      )}
    </ScrollView>
  );

  const editorContent = selected ? (
    <EditorPanel
      key={`${selected.kind}-${selected.item.id}-${selectedLang}`}
      selection={selected}
      languages={languages}
      selectedLang={selectedLang}
      onLangChange={setSelectedLang}
      onSaved={(updated) => {
        // Optimistically update tree labels
        if (updated.kind === "curriculum") {
          setCurricula((p) => p.map((c) => c.id === updated.item.id ? { ...c, ...updated.item } : c));
          setSelected(updated);
        } else if (updated.kind === "module") {
          const m = updated.item as Module;
          setModulesMap((p) => ({
            ...p,
            [m.curriculum_id]: (p[m.curriculum_id] ?? []).map((x) => x.id === m.id ? { ...x, ...m } : x),
          }));
          setSelected(updated);
        } else if (updated.kind === "lesson") {
          const l = updated.item as LessonStub;
          setLessonsMap((p) => ({
            ...p,
            [l.module_id]: (p[l.module_id] ?? []).map((x) => x.id === l.id ? { ...x, ...l } : x),
          }));
          setSelected(updated);
        }
      }}
      onDelete={() => {
        const kind = selected.kind;
        const table = kind === "curriculum" ? "p2p_curriculums" : kind === "module" ? "p2p_modules" : "p2p_lessons";
        confirmDelete(kind, selected.item.id, table);
      }}
    />
  ) : (
    <View style={styles.editorEmpty}>
      <Ionicons name="create-outline" size={40} color={colors.textMuted} />
      <Text style={styles.editorEmptyText}>
        Select a curriculum, module, or lesson from the tree to edit it.
      </Text>
      <TouchableOpacity style={styles.newCurrBtn} onPress={() => openCreate("curriculum")}>
        <Ionicons name="add" size={16} color={colors.cream} />
        <Text style={styles.newCurrBtnText}>New Curriculum</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      {isSplit ? (
        // Wide: split panel
        <View style={styles.splitWrap}>
          <View style={[styles.treeContainer, { borderRightWidth: 1, borderRightColor: colors.borderBeige }]}>
            {treePanel}
          </View>
          <View style={styles.editorContainer}>
            {editorContent}
          </View>
        </View>
      ) : (
        // Narrow: tree only; editor as modal/overlay
        <>
          {treePanel}
          <Modal
            visible={showEditor}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setShowEditor(false)}
          >
            <View style={[styles.mobileEditorHeader, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity onPress={() => setShowEditor(false)}>
                <Ionicons name="close" size={22} color={colors.textDark} />
              </TouchableOpacity>
              <Text style={styles.mobileEditorTitle}>Edit</Text>
              <View style={{ width: 22 }} />
            </View>
            <ScrollView style={{ flex: 1 }}>
              {editorContent}
            </ScrollView>
          </Modal>
        </>
      )}

      {/* Create modal */}
      <Modal
        visible={!!createModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>
              New {createModal === "curriculum" ? "Curriculum" : createModal === "module" ? "Module" : "Lesson"}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={createTitle}
              onChangeText={setCreateTitle}
              placeholder="Title"
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateModal(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreate, createLoading && { opacity: 0.7 }]}
                onPress={handleCreate}
                disabled={createLoading}
              >
                {createLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalCreateText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Editor Panel ──────────────────────────────────────────────────────────────

function EditorPanel({
  selection,
  languages,
  selectedLang,
  onLangChange,
  onSaved,
  onDelete,
}: {
  selection: Selection;
  languages: Language[];
  selectedLang: string;
  onLangChange: (lang: string) => void;
  onSaved: (updated: Selection) => void;
  onDelete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const defaultLang = languages.find((l) => l.is_default)?.code ?? "en";
  const isDefaultLang = selectedLang === defaultLang;

  if (!selection) return null;

  return (
    <ScrollView
      style={styles.editorScroll}
      contentContainerStyle={[styles.editorContent, { paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Language selector */}
      <View style={styles.langBar}>
        <Text style={styles.langBarLabel}>Language:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.langPills}>
          {languages.map((l) => {
            const active = selectedLang === l.code;
            return (
              <TouchableOpacity
                key={l.code}
                style={[styles.langPill, active && styles.langPillActive]}
                onPress={() => onLangChange(l.code)}
              >
                <Text style={[styles.langPillText, active && styles.langPillTextActive]}>
                  {l.name}{l.is_default ? " (default)" : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {!isDefaultLang && (
        <View style={styles.translationBanner}>
          <Ionicons name="language" size={14} color="#1D4ED8" />
          <Text style={styles.translationBannerText}>
            Editing: {languages.find((l) => l.code === selectedLang)?.name} translation.
            Original English content shown alongside for reference.
          </Text>
        </View>
      )}

      {selection.kind === "curriculum" && (
        <CurriculumEditor
          curriculum={selection.item as Curriculum}
          lang={selectedLang}
          isDefaultLang={isDefaultLang}
          onSaved={(item) => onSaved({ kind: "curriculum", item })}
          onDelete={onDelete}
        />
      )}
      {selection.kind === "module" && (
        <ModuleEditor
          module={selection.item as Module}
          lang={selectedLang}
          isDefaultLang={isDefaultLang}
          onSaved={(item) => onSaved({ kind: "module", item })}
          onDelete={onDelete}
        />
      )}
      {selection.kind === "lesson" && (
        <LessonEditor
          lesson={selection.item as LessonStub}
          lang={selectedLang}
          isDefaultLang={isDefaultLang}
          onSaved={(item) => onSaved({ kind: "lesson", item })}
          onDelete={onDelete}
        />
      )}
    </ScrollView>
  );
}

// ── Curriculum Editor ─────────────────────────────────────────────────────────

function CurriculumEditor({
  curriculum,
  lang,
  isDefaultLang,
  onSaved,
  onDelete,
}: {
  curriculum: Curriculum;
  lang: string;
  isDefaultLang: boolean;
  onSaved: (c: Curriculum) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(isDefaultLang ? curriculum.title : "");
  const [description, setDescription] = useState(isDefaultLang ? (curriculum.description ?? "") : "");
  const [status, setStatus] = useState<Status>(curriculum.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing translation
  useEffect(() => {
    if (!isDefaultLang) {
      (async () => {
        const { data } = await supabase
          .from("p2p_curriculum_translations")
          .select("*")
          .eq("curriculum_id", curriculum.id)
          .eq("language_code", lang)
          .maybeSingle();
        if (data) {
          setTitle(data.title ?? "");
          setDescription(data.description ?? "");
        }
      })();
    }
  }, [curriculum.id, lang, isDefaultLang]);

  async function save() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null);

    if (isDefaultLang) {
      const { data, error: e } = await supabase
        .from("p2p_curriculums")
        .update({ title: title.trim(), description: description.trim() || null, status })
        .eq("id", curriculum.id)
        .select().single();
      setSaving(false);
      if (e) { setError(e.message); return; }
      onSaved(data as Curriculum);
    } else {
      const { error: e } = await supabase.from("p2p_curriculum_translations").upsert({
        curriculum_id: curriculum.id,
        language_code: lang,
        title: title.trim(),
        description: description.trim() || null,
      }, { onConflict: "curriculum_id,language_code" });
      setSaving(false);
      if (e) { setError(e.message); return; }
      onSaved(curriculum); // canonical unchanged
    }
  }

  return (
    <View style={styles.editorForm}>
      <EditorHeader icon="book" label="Curriculum" onDelete={onDelete} />

      {!isDefaultLang && (
        <RefCard label="Original title" value={curriculum.title} />
      )}

      <EditorField label={isDefaultLang ? "Title *" : "Title (translated) *"}>
        <TextInput style={styles.edInput} value={title} onChangeText={setTitle} placeholder="Curriculum title" placeholderTextColor={colors.textMuted} />
      </EditorField>

      {!isDefaultLang && curriculum.description && (
        <RefCard label="Original description" value={curriculum.description} />
      )}

      <EditorField label="Description">
        <TextInput
          style={[styles.edInput, { minHeight: 80 }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Short description"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />
      </EditorField>

      {isDefaultLang && (
        <EditorField label="Status">
          <StatusSelector value={status} onChange={setStatus} />
        </EditorField>
      )}

      {error && <Text style={styles.edError}>{error}</Text>}
      <SaveButton onPress={save} saving={saving} />
    </View>
  );
}

// ── Module Editor ─────────────────────────────────────────────────────────────

function ModuleEditor({
  module,
  lang,
  isDefaultLang,
  onSaved,
  onDelete,
}: {
  module: Module;
  lang: string;
  isDefaultLang: boolean;
  onSaved: (m: Module) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(isDefaultLang ? module.title : "");
  const [description, setDescription] = useState(isDefaultLang ? (module.description ?? "") : "");
  const [status, setStatus] = useState<Status>(module.status);
  const [imageUrl, setImageUrl] = useState<string | null>(module.image_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDefaultLang) {
      (async () => {
        const { data } = await supabase
          .from("p2p_module_translations")
          .select("*")
          .eq("module_id", module.id)
          .eq("language_code", lang)
          .maybeSingle();
        if (data) { setTitle(data.title ?? ""); setDescription(data.description ?? ""); }
      })();
    }
  }, [module.id, lang, isDefaultLang]);

  async function pickAndUploadImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Allow photo access to upload a thumbnail."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [4, 3], quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const ext = (asset.uri.split(".").pop() ?? "jpg").toLowerCase();
      const path = `module-thumbnails/${module.id}.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: upErr } = await supabase.storage
        .from("Module Title Pictures")
        .upload(path, blob, { upsert: true, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` });
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

    if (isDefaultLang) {
      const { data, error: e } = await supabase
        .from("p2p_modules")
        .update({ title: title.trim(), description: description.trim() || null, status, image_url: imageUrl })
        .eq("id", module.id)
        .select().single();
      setSaving(false);
      if (e) { setError(e.message); return; }
      onSaved(data as Module);
    } else {
      const { error: e } = await supabase.from("p2p_module_translations").upsert({
        module_id: module.id,
        language_code: lang,
        title: title.trim(),
        description: description.trim() || null,
      }, { onConflict: "module_id,language_code" });
      setSaving(false);
      if (e) { setError(e.message); return; }
      onSaved(module);
    }
  }

  return (
    <View style={styles.editorForm}>
      <EditorHeader icon="folder" label="Module" onDelete={onDelete} />

      {!isDefaultLang && <RefCard label="Original title" value={module.title} />}

      <EditorField label={isDefaultLang ? "Title *" : "Title (translated) *"}>
        <TextInput style={styles.edInput} value={title} onChangeText={setTitle} placeholder="Module title" placeholderTextColor={colors.textMuted} />
      </EditorField>

      {!isDefaultLang && module.description && <RefCard label="Original description" value={module.description} />}

      <EditorField label="Description">
        <TextInput
          style={[styles.edInput, { minHeight: 80 }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Short description"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />
      </EditorField>

      {isDefaultLang && (
        <EditorField label="Status">
          <StatusSelector value={status} onChange={setStatus} />
        </EditorField>
      )}

      {isDefaultLang && (
        <EditorField label="Thumbnail Image">
          {imageUrl ? (
            <View style={{ gap: 8 }}>
              <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 120, borderRadius: 10 }} resizeMode="cover" />
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: "rgba(255,255,255,0.05)" }]}
                onPress={pickAndUploadImage}
                disabled={uploading}
              >
                {uploading
                  ? <ActivityIndicator size="small" color={colors.accentGreen} />
                  : <><Ionicons name="swap-horizontal" size={15} color={colors.accentGreen} /><Text style={styles.addBtnText}>Replace image</Text></>}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addBtn} onPress={pickAndUploadImage} disabled={uploading}>
              {uploading
                ? <ActivityIndicator size="small" color={colors.accentGreen} />
                : <><Ionicons name="image-outline" size={15} color={colors.accentGreen} /><Text style={styles.addBtnText}>Upload thumbnail</Text></>}
            </TouchableOpacity>
          )}
        </EditorField>
      )}

      {error && <Text style={styles.edError}>{error}</Text>}
      <SaveButton onPress={save} saving={saving} />
    </View>
  );
}

// ── Lesson Editor ─────────────────────────────────────────────────────────────

function LessonEditor({
  lesson,
  lang,
  isDefaultLang,
  onSaved,
  onDelete,
}: {
  lesson: LessonStub;
  lang: string;
  isDefaultLang: boolean;
  onSaved: (l: LessonStub) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(isDefaultLang ? lesson.title : "");
  const [subtitle, setSubtitle] = useState(isDefaultLang ? (lesson.subtitle ?? "") : "");
  const [status, setStatus] = useState<Status>(lesson.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Content
  const [sections, setSections] = useState<Section[]>([]);
  const [scriptures, setScriptures] = useState<Scripture[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [contentLoading, setContentLoading] = useState(true);

  // Translation originals (shown when non-default lang)
  const [origContent, setOrigContent] = useState<{ sections: Section[]; scriptures: Scripture[]; questions: Question[] } | null>(null);

  useEffect(() => {
    loadContent();
  }, [lesson.id, lang, isDefaultLang]);

  async function loadContent() {
    setContentLoading(true);

    // Always load canonical content for reference / IDs
    const [{ data: sec }, { data: scr }, { data: qs }, { data: asg }] = await Promise.all([
      supabase.from("p2p_lesson_sections").select("id,lesson_id,title,content,section_order").eq("lesson_id", lesson.id).order("section_order"),
      supabase.from("p2p_scriptures").select("id,lesson_id,reference,verse,display_order").eq("lesson_id", lesson.id).order("display_order"),
      supabase.from("p2p_reflection_questions").select("id,lesson_id,question,display_order").eq("lesson_id", lesson.id).order("display_order"),
      supabase.from("p2p_assignments").select("id,lesson_id,title,instructions,due_after_days").eq("lesson_id", lesson.id).order("id"),
    ]);

    const canonSections = (sec ?? []) as Section[];
    const canonScriptures = (scr ?? []) as Scripture[];
    const canonQuestions = (qs ?? []) as Question[];

    if (isDefaultLang) {
      setSections(((sec ?? []) as any[]).map((s) => ({
        id: s.id, sort_order: s.section_order ?? 0, title: s.title ?? "", content: s.content ?? "",
      })));
      setScriptures(((scr ?? []) as any[]).map((s) => ({
        id: s.id, sort_order: s.display_order ?? 0, verse_ref: s.reference ?? "", verse_text: s.verse ?? "",
      })));
      setQuestions(((qs ?? []) as any[]).map((q) => ({
        id: q.id, sort_order: q.display_order ?? 0, question: q.question ?? "",
      })));
      setAssignments(((asg ?? []) as any[]).map((a) => ({
        id: a.id, title: a.title ?? "", instructions: a.instructions ?? "", sort_order: 0,
      })));
    } else {
      // Load translation data
      const secIds = canonSections.map((s: any) => s.id);
      const scrIds = canonScriptures.map((s: any) => s.id);
      const qIds = canonQuestions.map((q: any) => q.id);

      const [{ data: ltrans }, { data: strans }, { data: scrtrans }, { data: qtrans }] = await Promise.all([
        supabase.from("p2p_lesson_translations").select("*").eq("lesson_id", lesson.id).eq("language_code", lang).maybeSingle(),
        secIds.length
          ? supabase.from("p2p_lesson_section_translations").select("*").in("section_id", secIds).eq("language_code", lang)
          : Promise.resolve({ data: [] }),
        scrIds.length
          ? supabase.from("p2p_scripture_translations").select("*").in("scripture_id", scrIds).eq("language_code", lang)
          : Promise.resolve({ data: [] }),
        qIds.length
          ? supabase.from("p2p_reflection_question_translations").select("*").in("question_id", qIds).eq("language_code", lang)
          : Promise.resolve({ data: [] }),
      ]);

      if (ltrans) { setTitle((ltrans as any).title ?? ""); setSubtitle((ltrans as any).subtitle ?? ""); }

      const stMap = Object.fromEntries(((strans ?? []) as any[]).map((t) => [t.section_id, t]));
      const scrMap = Object.fromEntries(((scrtrans ?? []) as any[]).map((t) => [t.scripture_id, t]));
      const qMap = Object.fromEntries(((qtrans ?? []) as any[]).map((t) => [t.question_id, t]));

      setSections(canonSections.map((s: any) => ({
        id: s.id, sort_order: s.section_order,
        title: stMap[s.id]?.title ?? "", content: stMap[s.id]?.content ?? "",
      })));
      setScriptures(canonScriptures.map((s: any) => ({
        id: s.id, sort_order: s.display_order,
        verse_ref: s.reference, // ref never translates
        verse_text: scrMap[s.id]?.verse ?? "",
      })));
      setQuestions(canonQuestions.map((q: any) => ({
        id: q.id, sort_order: q.display_order,
        question: qMap[q.id]?.question ?? "",
      })));
      setAssignments([]);

      // Store originals for reference
      setOrigContent({ sections: canonSections, scriptures: canonScriptures, questions: canonQuestions });
    }

    setContentLoading(false);
  }

  async function save() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null);

    try {
      if (isDefaultLang) {
        // Save lesson metadata
        const { data: lData, error: lErr } = await supabase
          .from("p2p_lessons")
          .update({ title: title.trim(), subtitle: subtitle.trim() || null, status })
          .eq("id", lesson.id)
          .select().single();
        if (lErr) throw new Error(lErr.message);

        // Save content: delete + reinsert for simplicity
        await supabase.from("p2p_lesson_sections").delete().eq("lesson_id", lesson.id);
        if (sections.length) {
          await supabase.from("p2p_lesson_sections").insert(
            sections.map((s, i) => ({ lesson_id: lesson.id, title: s.title || null, content: s.content, section_order: i }))
          );
        }

        await supabase.from("p2p_scriptures").delete().eq("lesson_id", lesson.id);
        if (scriptures.length) {
          await supabase.from("p2p_scriptures").insert(
            scriptures.map((s, i) => ({ lesson_id: lesson.id, reference: s.verse_ref, verse: s.verse_text, display_order: i }))
          );
        }

        await supabase.from("p2p_reflection_questions").delete().eq("lesson_id", lesson.id);
        if (questions.length) {
          await supabase.from("p2p_reflection_questions").insert(
            questions.map((q, i) => ({ lesson_id: lesson.id, question: q.question, display_order: i }))
          );
        }

        await supabase.from("p2p_assignments").delete().eq("lesson_id", lesson.id);
        if (assignments.length) {
          await supabase.from("p2p_assignments").insert(
            assignments.map((a) => ({ lesson_id: lesson.id, title: a.title, instructions: a.instructions }))
          );
        }

        onSaved(lData as LessonStub);
      } else {
        // Save lesson translation
        await supabase.from("p2p_lesson_translations").upsert({
          lesson_id: lesson.id, language_code: lang,
          title: title.trim(), subtitle: subtitle.trim() || null,
        }, { onConflict: "lesson_id,language_code" });

        // Save section translations
        for (const s of sections) {
          if (!s.id) continue;
          await supabase.from("p2p_lesson_section_translations").upsert({
            section_id: s.id, language_code: lang, title: s.title || null, content: s.content,
          }, { onConflict: "section_id,language_code" });
        }

        // Save scripture translations (verse_ref is canonical, only verse_text translates)
        for (const s of scriptures) {
          if (!s.id) continue;
          await supabase.from("p2p_scripture_translations").upsert({
            scripture_id: s.id, language_code: lang, verse: s.verse_text,
          }, { onConflict: "scripture_id,language_code" });
        }

        // Save question translations
        for (const q of questions) {
          if (!q.id) continue;
          await supabase.from("p2p_reflection_question_translations").upsert({
            question_id: q.id, language_code: lang, question: q.question,
          }, { onConflict: "question_id,language_code" });
        }

        onSaved(lesson);
      }

      setError(null);
    } catch (ex: any) {
      setError(ex.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (contentLoading) {
    return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accentGreen} />;
  }

  return (
    <View style={styles.editorForm}>
      <EditorHeader icon="document-text" label="Lesson" onDelete={onDelete} />

      {!isDefaultLang && <RefCard label="Original title" value={lesson.title} />}

      <EditorField label={isDefaultLang ? "Title *" : "Title (translated) *"}>
        <TextInput style={styles.edInput} value={title} onChangeText={setTitle} placeholder="Lesson title" placeholderTextColor={colors.textMuted} />
      </EditorField>

      {!isDefaultLang && lesson.subtitle && <RefCard label="Original subtitle" value={lesson.subtitle} />}

      <EditorField label="Subtitle">
        <TextInput style={styles.edInput} value={subtitle} onChangeText={setSubtitle} placeholder="Optional subtitle" placeholderTextColor={colors.textMuted} />
      </EditorField>

      {isDefaultLang && (
        <EditorField label="Status">
          <StatusSelector value={status} onChange={setStatus} />
        </EditorField>
      )}

      {/* ── Teaching Content Sections ── */}
      <ContentSection title="Teaching Content" hint="Add teaching blocks. Each block has an optional heading and the main text.">
        {sections.map((s, i) => (
          <View key={i} style={styles.contentItem}>
            {origContent && <RefCard label="Original section" value={(origContent.sections[i] as any)?.content ?? ""} />}
            <TextInput
              style={styles.edInput}
              value={s.title ?? ""}
              onChangeText={(v) => setSections((p) => p.map((x, xi) => xi === i ? { ...x, title: v } : x))}
              placeholder="Section heading (optional)"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={[styles.edInput, { minHeight: 120, marginTop: 6 }]}
              value={s.content}
              onChangeText={(v) => setSections((p) => p.map((x, xi) => xi === i ? { ...x, content: v } : x))}
              placeholder="Teaching content…"
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
            />
            {isDefaultLang && (
              <TouchableOpacity style={styles.removeBtn} onPress={() => setSections((p) => p.filter((_, xi) => xi !== i))}>
                <Ionicons name="trash-outline" size={14} color="#B91C1C" />
                <Text style={styles.removeBtnText}>Remove section</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {isDefaultLang && (
          <TouchableOpacity style={styles.addItemBtn} onPress={() => setSections((p) => [...p, { title: "", content: "", sort_order: p.length }])}>
            <Ionicons name="add" size={14} color={colors.accentGreen} />
            <Text style={styles.addItemText}>Add section</Text>
          </TouchableOpacity>
        )}
        {!isDefaultLang && sections.length === 0 && <Text style={styles.noContentNote}>No teaching sections in the default language yet.</Text>}
      </ContentSection>

      {/* ── Memory Verse ── */}
      <ContentSection title="Memory Verse" hint="Scripture reference and verse text.">
        {scriptures.map((s, i) => (
          <View key={i} style={styles.contentItem}>
            {origContent && <RefCard label="Original verse text" value={(origContent.scriptures[i] as any)?.verse ?? ""} />}
            {isDefaultLang && (
              <TextInput
                style={styles.edInput}
                value={s.verse_ref}
                onChangeText={(v) => setScriptures((p) => p.map((x, xi) => xi === i ? { ...x, verse_ref: v } : x))}
                placeholder="Reference (e.g. John 3:16)"
                placeholderTextColor={colors.textMuted}
              />
            )}
            {!isDefaultLang && (
              <View style={styles.refTagRow}>
                <Ionicons name="bookmark" size={12} color={colors.amber} />
                <Text style={styles.refTag}>{s.verse_ref}</Text>
              </View>
            )}
            <TextInput
              style={[styles.edInput, { marginTop: 6, minHeight: 72 }]}
              value={s.verse_text}
              onChangeText={(v) => setScriptures((p) => p.map((x, xi) => xi === i ? { ...x, verse_text: v } : x))}
              placeholder={isDefaultLang ? "Verse text…" : "Verse text (translated)…"}
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
            />
            {isDefaultLang && (
              <TouchableOpacity style={styles.removeBtn} onPress={() => setScriptures((p) => p.filter((_, xi) => xi !== i))}>
                <Ionicons name="trash-outline" size={14} color="#B91C1C" />
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {isDefaultLang && scriptures.length === 0 && (
          <TouchableOpacity style={styles.addItemBtn} onPress={() => setScriptures((p) => [...p, { verse_ref: "", verse_text: "", sort_order: 0 }])}>
            <Ionicons name="add" size={14} color={colors.accentGreen} />
            <Text style={styles.addItemText}>Add verse</Text>
          </TouchableOpacity>
        )}
      </ContentSection>

      {/* ── Discussion Questions ── */}
      <ContentSection title="Discussion Questions" hint="Repeatable list of reflection or discussion questions.">
        {questions.map((q, i) => (
          <View key={i} style={styles.contentItem}>
            {origContent && <RefCard label="Original question" value={(origContent.questions[i] as any)?.question ?? ""} />}
            <View style={styles.questionRow}>
              <Text style={styles.questionNum}>{i + 1}.</Text>
              <TextInput
                style={[styles.edInput, { flex: 1 }]}
                value={q.question}
                onChangeText={(v) => setQuestions((p) => p.map((x, xi) => xi === i ? { ...x, question: v } : x))}
                placeholder="Discussion question…"
                placeholderTextColor={colors.textMuted}
                multiline
              />
              {isDefaultLang && (
                <TouchableOpacity onPress={() => setQuestions((p) => p.filter((_, xi) => xi !== i))} style={{ paddingLeft: 6 }}>
                  <Ionicons name="close-circle" size={18} color="#B91C1C" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
        {isDefaultLang && (
          <TouchableOpacity style={styles.addItemBtn} onPress={() => setQuestions((p) => [...p, { question: "", sort_order: p.length }])}>
            <Ionicons name="add" size={14} color={colors.accentGreen} />
            <Text style={styles.addItemText}>Add question</Text>
          </TouchableOpacity>
        )}
        {!isDefaultLang && questions.length === 0 && <Text style={styles.noContentNote}>No questions in the default language yet.</Text>}
      </ContentSection>

      {/* ── Assignment (default lang only for now) ── */}
      {isDefaultLang && (
        <ContentSection title="Assignment" hint="Optional task for students to complete before the next session.">
          {assignments.map((a, i) => (
            <View key={i} style={styles.contentItem}>
              <TextInput
                style={styles.edInput}
                value={a.title}
                onChangeText={(v) => setAssignments((p) => p.map((x, xi) => xi === i ? { ...x, title: v } : x))}
                placeholder="Assignment title"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[styles.edInput, { marginTop: 6, minHeight: 80 }]}
                value={a.instructions}
                onChangeText={(v) => setAssignments((p) => p.map((x, xi) => xi === i ? { ...x, instructions: v } : x))}
                placeholder="Instructions…"
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity style={styles.removeBtn} onPress={() => setAssignments((p) => p.filter((_, xi) => xi !== i))}>
                <Ionicons name="trash-outline" size={14} color="#B91C1C" />
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
          {assignments.length === 0 && (
            <TouchableOpacity style={styles.addItemBtn} onPress={() => setAssignments((p) => [...p, { title: "", instructions: "", sort_order: 0 }])}>
              <Ionicons name="add" size={14} color={colors.accentGreen} />
              <Text style={styles.addItemText}>Add assignment</Text>
            </TouchableOpacity>
          )}
        </ContentSection>
      )}

      {error && <Text style={styles.edError}>{error}</Text>}
      <SaveButton onPress={save} saving={saving} />
    </View>
  );
}

// ── Shared Editor Sub-components ──────────────────────────────────────────────

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
        <TouchableOpacity
          key={s}
          style={[styles.statusOpt, value === s && { backgroundColor: STATUS_COLORS[s], borderColor: STATUS_COLORS[s] }]}
          onPress={() => onChange(s)}
        >
          <Text style={[styles.statusOptText, value === s && { color: "#fff" }]}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function RefCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.refCard}>
      <Text style={styles.refCardLabel}>{label}</Text>
      <Text style={styles.refCardValue}>{value}</Text>
    </View>
  );
}

function ContentSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.contentSection}>
      <Text style={styles.contentSectionTitle}>{title}</Text>
      <Text style={styles.contentSectionHint}>{hint}</Text>
      {children}
    </View>
  );
}

function SaveButton({ onPress, saving }: { onPress: () => void; saving: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.saveBtn, saving && { opacity: 0.7 }]}
      onPress={onPress}
      disabled={saving}
    >
      {saving ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.saveBtnText}>Save</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },

  // Split layout
  splitWrap: { flex: 1, flexDirection: "row" },
  treeContainer: { width: 280 },
  editorContainer: { flex: 1 },

  // Tree panel
  treePanel: { flex: 1, backgroundColor: "#fff" },
  treePanelContent: { padding: 12 },
  treePanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  treePanelTitle: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  addBtnSmall: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  addBtnSmallText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  // Admin tab switcher
  adminTabRow: {
    flexDirection: "row", gap: 6, marginHorizontal: 12, marginVertical: 10,
    backgroundColor: colors.cardBeige, borderRadius: 10, padding: 4,
  },
  adminTab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 7, borderRadius: 8,
  },
  adminTabActive: { backgroundColor: colors.primaryGreen },
  adminTabText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  adminTabTextActive: { color: "#fff" },

  // Empty state
  emptyTree: { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTreeText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  emptyTreeBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  emptyTreeBtnText: { fontSize: 13, color: "#fff", fontFamily: "Inter_600SemiBold" },

  // Tree rows
  treeLevel0: { marginBottom: 4 },
  treeLevel1: { paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: colors.borderBeige, marginLeft: 8 },
  treeLevel2: { paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.borderBeige, marginLeft: 6 },
  treeRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8,
  },
  treeRowM: { paddingVertical: 5 },
  treeRowL: { paddingVertical: 4 },
  treeRowSelected: { backgroundColor: "rgba(29,158,117,0.1)" },
  treeLabel: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  treeLabelSelected: { color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  covBadge: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  reorderBtns: { flexDirection: "column", gap: 1 },

  addInTreeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 5, paddingHorizontal: 6, marginTop: 2,
  },
  addInTreeText: { fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  // Mobile editor header
  mobileEditorHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  mobileEditorTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  // Editor empty
  editorEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  editorEmptyText: { fontSize: 14, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  newCurrBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.accentGreen, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  newCurrBtnText: { fontSize: 14, color: "#fff", fontFamily: "Inter_600SemiBold" },

  // Editor scroll
  editorScroll: { flex: 1 },
  editorContent: { padding: 20, gap: 16 },

  // Language bar
  langBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  langBarLabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  langPills: { gap: 6 },
  langPill: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff",
  },
  langPillActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  langPillText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  langPillTextActive: { color: "#fff" },

  // Translation banner
  translationBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "rgba(29,78,216,0.07)", borderWidth: 1, borderColor: "rgba(29,78,216,0.2)",
    borderRadius: 10, padding: 10,
  },
  translationBannerText: { fontSize: 12, color: "#1D4ED8", flex: 1, fontFamily: "Inter_400Regular" },

  // Editor form
  editorForm: { gap: 16 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  editorHeaderLabel: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  deleteBtnText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium" },

  editorField: { gap: 6 },
  editorFieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },

  edInput: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, padding: 12,
    fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
  },

  statusRow: { flexDirection: "row", gap: 8 },
  statusOpt: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  statusOptText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  // Ref card
  refCard: {
    backgroundColor: colors.cardBeige, borderRadius: 8,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 10,
  },
  refCardLabel: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  refCardValue: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },

  refTagRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  refTag: { fontSize: 13, color: colors.amber, fontFamily: "Inter_600SemiBold" },

  // Content section
  contentSection: {
    gap: 8,
    padding: 14,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderBeige,
  },
  contentSectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  contentSectionHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 4 },

  contentItem: { gap: 0, borderTopWidth: 1, borderTopColor: colors.borderBeige, paddingTop: 10, marginTop: 6 },
  questionRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  questionNum: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_600SemiBold", paddingTop: 12 },

  addItemBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: colors.borderBeige,
    paddingHorizontal: 12, marginTop: 4,
  },
  addItemText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  removeBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  removeBtnText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium" },

  noContentNote: { fontSize: 12, color: colors.textMuted, fontStyle: "italic", fontFamily: "Inter_400Regular" },

  // Error
  edError: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_400Regular", textAlign: "center" },

  // Save
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 12, height: 50,
  },
  saveBtnText: { fontSize: 15, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },

  // Create modal
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center",
  },
  modalBox: {
    width: "85%", backgroundColor: "#fff", borderRadius: 18,
    padding: 24, gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  modalInput: {
    backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, padding: 12, fontSize: 15,
    color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  modalBtns: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalCancel: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  modalCancelText: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_500Medium" },
  modalCreate: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    backgroundColor: colors.accentGreen, minWidth: 80, alignItems: "center",
  },
  modalCreateText: { fontSize: 14, color: "#fff", fontFamily: "Inter_600SemiBold" },
});
