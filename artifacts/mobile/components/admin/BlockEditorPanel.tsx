import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Alert, Platform, Modal, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from "react-native-draggable-flatlist";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import {
  LessonBlock, BlockType, BLOCK_TYPE_META, BLOCK_SECTIONS, QUICK_TOOLBAR_TYPES,
  checkPublishRequirements, estimateReadingMinutes,
} from "@/lib/curriculumBlocks";
import BlockRenderer from "./BlockRenderer";

type SaveState = "idle" | "saving" | "saved" | "error";
type Tab = "content" | "settings" | "preview";
type LessonStatus = "draft" | "review" | "published" | "archived";

interface LessonMeta {
  id: string; module_id: string; title: string; subtitle: string | null;
  status: LessonStatus; cover_image_url: string | null; thumbnail_url: string | null;
  estimated_minutes: number; tags: string[]; version: number; published_at: string | null;
}

interface StatusLogRow { id: string; old_status: string | null; new_status: string; changed_at: string; }

function showError(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function tempId() { return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export default function BlockEditorPanel({ lessonId, onLessonChanged }: { lessonId: string; onLessonChanged?: () => void }) {
  const [lesson, setLesson] = useState<LessonMeta | null>(null);
  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("content");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuForBlock, setMenuForBlock] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<StatusLogRow[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  const savedBlocksRef = useRef<Map<string, LessonBlock>>(new Map());
  const savedOrderRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lessonRef = useRef<LessonMeta | null>(null);
  lessonRef.current = lesson;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lessonData, error: lErr }, { data: blockData, error: bErr }] = await Promise.all([
      supabase.from("p2p_lessons")
        .select("id,module_id,title,subtitle,status,cover_image_url,thumbnail_url,estimated_minutes,tags,version,published_at")
        .eq("id", lessonId).single(),
      supabase.from("p2p_lesson_blocks").select("*").eq("lesson_id", lessonId).order("order_index"),
    ]);
    if (lErr) { showError("Could not load lesson", lErr.message); setLoading(false); return; }
    if (bErr) { showError("Could not load blocks", bErr.message); setLoading(false); return; }

    setLesson(lessonData as LessonMeta);
    const loadedBlocks = (blockData ?? []) as LessonBlock[];
    setBlocks(loadedBlocks);
    savedBlocksRef.current = new Map(loadedBlocks.map((b) => [b.id, b]));
    savedOrderRef.current = loadedBlocks.map((b) => b.id);
    setLoading(false);

    const { data: logData } = await supabase
      .from("p2p_content_status_log")
      .select("id,old_status,new_status,changed_at")
      .eq("entity_type", "lesson").eq("entity_id", lessonId)
      .order("changed_at", { ascending: false })
      .limit(10);
    setStatusLog((logData ?? []) as StatusLogRow[]);
  }, [lessonId]);

  useEffect(() => { load(); }, [load]);

  // ── Debounced auto-save ──────────────────────────────────────────────────────

  const scheduleFlush = useCallback(() => {
    setSaveState("saving");
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => { flush(); }, 1000);
  }, []);

  async function flush() {
    const current = blocksRef.current;
    const saved = savedBlocksRef.current;
    const savedOrder = savedOrderRef.current;

    try {
      const currentIds = new Set(current.map((b) => b.id));
      const toDelete = savedOrder.filter((id) => !currentIds.has(id));
      const toInsert = current.filter((b) => b.id.startsWith("tmp-"));
      const toUpdate = current.filter((b) => {
        if (b.id.startsWith("tmp-")) return false;
        const prev = saved.get(b.id);
        if (!prev) return false;
        return (
          prev.order_index !== b.order_index ||
          JSON.stringify(prev.content) !== JSON.stringify(b.content) ||
          prev.is_required !== b.is_required
        );
      });

      if (toDelete.length > 0) {
        const { error } = await supabase.from("p2p_lesson_blocks").delete().in("id", toDelete);
        if (error) throw new Error(error.message);
      }

      if (toInsert.length > 0) {
        const { data: userData } = await supabase.auth.getUser();
        const rows = toInsert.map((b) => ({
          lesson_id: lessonId, block_type: b.block_type, content: b.content,
          order_index: b.order_index, is_required: b.is_required, is_submittable: b.is_submittable,
          created_by: userData?.user?.id ?? null,
        }));
        const { data: inserted, error } = await supabase.from("p2p_lesson_blocks").insert(rows).select();
        if (error) throw new Error(error.message);
        // Swap temp ids for real ones in local state, matched by insertion order.
        setBlocks((prev) => {
          const next = [...prev];
          let insertedIdx = 0;
          for (let i = 0; i < next.length; i++) {
            if (next[i].id.startsWith("tmp-") && inserted && inserted[insertedIdx]) {
              next[i] = inserted[insertedIdx] as LessonBlock;
              insertedIdx++;
            }
          }
          return next;
        });
      }

      for (const b of toUpdate) {
        const { error } = await supabase.from("p2p_lesson_blocks")
          .update({ content: b.content, order_index: b.order_index, is_required: b.is_required })
          .eq("id", b.id);
        if (error) throw new Error(error.message);
      }

      // Re-sync the "saved" snapshot against the latest local state.
      const latest = blocksRef.current;
      savedBlocksRef.current = new Map(latest.map((b) => [b.id, b]));
      savedOrderRef.current = latest.map((b) => b.id);
      setSaveState("saved");
    } catch (ex: any) {
      console.error("Autosave failed:", ex.message);
      setSaveState("error");
    }
  }

  const blocksRef = useRef<LessonBlock[]>([]);
  blocksRef.current = blocks;

  useEffect(() => () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current); }, []);

  function updateBlockContent(blockId: string, content: Record<string, any>) {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, content } : b)));
    scheduleFlush();
  }

  function addBlock(type: BlockType, afterId?: string) {
    const meta = BLOCK_TYPE_META[type];
    const newBlock: LessonBlock = {
      id: tempId(), lesson_id: lessonId, block_type: type, content: meta.defaultContent(),
      order_index: 0, is_required: false, is_submittable: type === "assignment" || type === "reflection_question",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: null,
    };
    setBlocks((prev) => {
      const insertAt = afterId ? prev.findIndex((b) => b.id === afterId) + 1 : prev.length;
      const next = [...prev.slice(0, insertAt), newBlock, ...prev.slice(insertAt)];
      return next.map((b, i) => ({ ...b, order_index: i }));
    });
    setPickerOpen(false);
    scheduleFlush();
  }

  function deleteBlock(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId).map((b, i) => ({ ...b, order_index: i })));
    setMenuForBlock(null);
    scheduleFlush();
  }

  function duplicateBlock(blockId: string) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx === -1) return prev;
      const copy: LessonBlock = { ...prev[idx], id: tempId(), content: JSON.parse(JSON.stringify(prev[idx].content)) };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      return next.map((b, i) => ({ ...b, order_index: i }));
    });
    setMenuForBlock(null);
    scheduleFlush();
  }

  function convertBlockType(blockId: string, newType: BlockType) {
    setBlocks((prev) => prev.map((b) => {
      if (b.id !== blockId) return b;
      const meta = BLOCK_TYPE_META[newType];
      // Carry over whichever text-ish field exists, drop the rest.
      const text = b.content?.text ?? b.content?.question ?? b.content?.instructions ?? "";
      return { ...b, block_type: newType, content: { ...meta.defaultContent(), text } };
    }));
    setMenuForBlock(null);
    scheduleFlush();
  }

  async function moveBlockToLesson(blockId: string, targetLessonId: string) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    setMenuForBlock(null);
    if (block.id.startsWith("tmp-")) {
      showError("Save first", "This block hasn't finished saving yet — wait a second and try again.");
      return;
    }
    const { data: targetBlocks } = await supabase.from("p2p_lesson_blocks").select("order_index").eq("lesson_id", targetLessonId).order("order_index", { ascending: false }).limit(1);
    const nextOrder = targetBlocks && targetBlocks.length > 0 ? targetBlocks[0].order_index + 1 : 0;
    const { error } = await supabase.from("p2p_lesson_blocks").update({ lesson_id: targetLessonId, order_index: nextOrder }).eq("id", blockId);
    if (error) { showError("Move failed", error.message); return; }
    setBlocks((prev) => prev.filter((b) => b.id !== blockId).map((b, i) => ({ ...b, order_index: i })));
    savedOrderRef.current = savedOrderRef.current.filter((id) => id !== blockId);
    savedBlocksRef.current.delete(blockId);
  }

  function onDragEnd({ data }: { data: LessonBlock[] }) {
    setBlocks(data.map((b, i) => ({ ...b, order_index: i })));
    scheduleFlush();
  }

  // ── Lesson metadata (title/settings) ─────────────────────────────────────────

  function patchLessonLocal(patch: Partial<LessonMeta>) {
    setLesson((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  const lessonSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleLessonSave(patch: Partial<LessonMeta>) {
    patchLessonLocal(patch);
    setSaveState("saving");
    if (lessonSaveTimerRef.current) clearTimeout(lessonSaveTimerRef.current);
    lessonSaveTimerRef.current = setTimeout(async () => {
      const l = lessonRef.current;
      if (!l) return;
      const { error } = await supabase.from("p2p_lessons").update({
        title: l.title, subtitle: l.subtitle, cover_image_url: l.cover_image_url,
        thumbnail_url: l.thumbnail_url, estimated_minutes: l.estimated_minutes, tags: l.tags,
      }).eq("id", lessonId);
      setSaveState(error ? "error" : "saved");
      if (!error) onLessonChanged?.();
    }, 1000);
  }

  async function handleStatusChange(newStatus: LessonStatus) {
    if (newStatus === "published") {
      const { ok, missing } = checkPublishRequirements(blocks);
      if (!ok) {
        showError(
          "Can't publish yet",
          `This lesson is missing: ${missing.map((t) => BLOCK_TYPE_META[t].label).join(", ")}. Add at least one of each before publishing.`
        );
        return;
      }
    }
    setPublishing(true);
    const { error } = await supabase.from("p2p_lessons").update({ status: newStatus }).eq("id", lessonId);
    setPublishing(false);
    if (error) { showError("Status change failed", error.message); return; }
    patchLessonLocal({ status: newStatus });
    onLessonChanged?.();
    load();
  }

  async function handleCoverUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showError("Permission needed", "Allow photo access to upload a cover image."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.85 });
    if (result.canceled || !result.assets.length) return;
    setCoverUploading(true);
    try {
      const asset = result.assets[0];
      const ext = (asset.uri.split(".").pop() ?? "jpg").toLowerCase();
      const path = `curriculum/${lesson?.module_id}/${lessonId}/cover-${Date.now()}.${ext}`;
      const blob = await (await fetch(asset.uri)).blob();
      const { error: upErr } = await supabase.storage.from("curriculum-media").upload(path, blob, { upsert: true, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from("curriculum-media").getPublicUrl(path);
      scheduleLessonSave({ cover_image_url: urlData.publicUrl });
    } catch (ex: any) {
      showError("Upload failed", ex.message);
    } finally {
      setCoverUploading(false);
    }
  }

  // ── Keyboard shortcuts for the block picker (web only) ────────────────────────

  useEffect(() => {
    if (Platform.OS !== "web" || !pickerOpen) return;
    function handler(e: KeyboardEvent) {
      const match = (Object.values(BLOCK_TYPE_META) as any[]).find((m) => m.shortcut && m.shortcut.toLowerCase() === e.key.toLowerCase());
      if (match) addBlock(match.type);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  const readingMinutes = useMemo(() => estimateReadingMinutes(blocks), [blocks]);

  if (loading || !lesson) {
    return <View style={styles.centerFill}><ActivityIndicator color={colors.primaryGreen} /></View>;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity style={styles.coverWrap} onPress={handleCoverUpload} disabled={coverUploading}>
        {lesson.cover_image_url ? (
          <Image source={{ uri: lesson.cover_image_url }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <View style={styles.coverPlaceholder}>
            {coverUploading ? <ActivityIndicator color={colors.primaryGreen} /> : (
              <>
                <Ionicons name="image-outline" size={22} color={colors.textMutedLight} />
                <Text style={styles.coverPlaceholderText}>Add cover image</Text>
              </>
            )}
          </View>
        )}
      </TouchableOpacity>

      <TextInput
        style={styles.titleInput}
        value={lesson.title}
        onChangeText={(t) => scheduleLessonSave({ title: t })}
        placeholder="Lesson title"
        placeholderTextColor={colors.textMutedLight}
      />

      <View style={styles.metaRow}>
        <View style={[styles.statusBadge, { borderColor: STATUS_COLORS[lesson.status] }]}>
          <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[lesson.status] }]}>{lesson.status.toUpperCase()}</Text>
        </View>
        <Ionicons name="time-outline" size={13} color={colors.textMuted} />
        <Text style={styles.metaText}>{lesson.estimated_minutes} min</Text>
        <Ionicons name="cube-outline" size={13} color={colors.textMuted} />
        <Text style={styles.metaText}>{blocks.length} block{blocks.length === 1 ? "" : "s"}</Text>
        <View style={{ marginLeft: "auto" }}>
          <SaveIndicator state={saveState} />
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {(["content", "settings", "preview"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "content" && (
        <View style={{ flex: 1 }}>
          <DraggableFlatList
            data={blocks}
            keyExtractor={(b) => b.id}
            onDragEnd={onDragEnd}
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="cube-outline" size={32} color={colors.textMutedLight} />
                <Text style={styles.emptyStateText}>No blocks yet. Tap + to add the first one.</Text>
              </View>
            }
            renderItem={({ item, drag, isActive }: RenderItemParams<LessonBlock>) => (
              <ScaleDecorator>
                <View style={[styles.blockRow, isActive && styles.blockRowActive]}>
                  <TouchableOpacity onLongPress={drag} disabled={isActive} style={styles.dragHandle}>
                    <Ionicons name="reorder-two" size={18} color={colors.textMutedLight} />
                  </TouchableOpacity>
                  <View style={styles.blockTypeIconWrap}>
                    <Ionicons name={BLOCK_TYPE_META[item.block_type].icon as any} size={14} color={colors.primaryGreen} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <BlockRenderer
                      block={item}
                      moduleId={lesson.module_id}
                      lessonId={lessonId}
                      onChangeContent={(content) => updateBlockContent(item.id, content)}
                    />
                  </View>
                  <TouchableOpacity style={styles.blockMenuBtn} onPress={() => setMenuForBlock(item.id)}>
                    <Ionicons name="ellipsis-vertical" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </ScaleDecorator>
            )}
          />

          <QuickToolbar onAdd={(type) => addBlock(type)} />

          <TouchableOpacity style={styles.fab} onPress={() => setPickerOpen(true)}>
            <Ionicons name="add" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {tab === "settings" && (
        <SettingsTab
          lesson={lesson}
          statusLog={statusLog}
          publishing={publishing}
          onPatch={scheduleLessonSave}
          onStatusChange={handleStatusChange}
        />
      )}

      {tab === "preview" && (
        <PreviewTab lesson={lesson} blocks={blocks} readingMinutes={readingMinutes} publishing={publishing} onPublish={() => handleStatusChange("published")} />
      )}

      <BlockPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(t) => addBlock(t)}
      />

      <BlockMenuModal
        visible={!!menuForBlock}
        onClose={() => setMenuForBlock(null)}
        onDuplicate={() => menuForBlock && duplicateBlock(menuForBlock)}
        onDelete={() => menuForBlock && deleteBlock(menuForBlock)}
        onConvert={(t) => menuForBlock && convertBlockType(menuForBlock, t)}
        onMove={(targetId) => menuForBlock && moveBlockToLesson(menuForBlock, targetId)}
        moduleId={lesson.module_id}
        currentLessonId={lessonId}
      />
    </View>
  );
}

const STATUS_COLORS: Record<LessonStatus, string> = {
  draft: "#B45309", review: "#1D6FA8", published: colors.accentGreen, archived: colors.textMuted,
};

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const map = {
    saving: { text: "Saving...", color: colors.textMuted, icon: "sync-outline" },
    saved: { text: "Saved", color: colors.accentGreen, icon: "checkmark-circle-outline" },
    error: { text: "Save failed", color: "#B91C1C", icon: "alert-circle-outline" },
  } as const;
  const m = map[state];
  return (
    <View style={styles.saveIndicator}>
      <Ionicons name={m.icon as any} size={13} color={m.color} />
      <Text style={[styles.saveIndicatorText, { color: m.color }]}>{m.text}</Text>
    </View>
  );
}

function QuickToolbar({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <View style={styles.quickToolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
        {QUICK_TOOLBAR_TYPES.map((t) => {
          const meta = BLOCK_TYPE_META[t];
          return (
            <TouchableOpacity key={t} style={styles.quickToolbarBtn} onPress={() => onAdd(t)}>
              <Ionicons name={meta.icon as any} size={16} color={colors.primaryGreen} />
              <Text style={styles.quickToolbarBtnText}>{meta.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function BlockPickerModal({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (t: BlockType) => void }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerCard} onStartShouldSetResponder={() => true}>
          <Text style={styles.pickerTitle}>Add a block</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {BLOCK_SECTIONS.map((section) => (
              <View key={section} style={{ marginBottom: 10 }}>
                <Text style={styles.pickerSectionLabel}>{section}</Text>
                {Object.values(BLOCK_TYPE_META).filter((m) => m.section === section).map((m) => (
                  <TouchableOpacity key={m.type} style={styles.pickerRow} onPress={() => onPick(m.type)}>
                    <Ionicons name={m.icon as any} size={18} color={colors.primaryGreen} />
                    <Text style={styles.pickerRowLabel}>{m.label}</Text>
                    {m.shortcut && Platform.OS === "web" && <Text style={styles.pickerShortcut}>{m.shortcut}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function BlockMenuModal({
  visible, onClose, onDuplicate, onDelete, onConvert, onMove, moduleId, currentLessonId,
}: {
  visible: boolean; onClose: () => void; onDuplicate: () => void; onDelete: () => void;
  onConvert: (t: BlockType) => void; onMove: (targetLessonId: string) => void; moduleId: string; currentLessonId: string;
}) {
  const [mode, setMode] = useState<"main" | "convert" | "move">("main");
  const [siblingLessons, setSiblingLessons] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    if (!visible) setMode("main");
  }, [visible]);

  useEffect(() => {
    if (mode !== "move") return;
    supabase.from("p2p_lessons").select("id,title").eq("module_id", moduleId).neq("id", currentLessonId).order("order_index")
      .then(({ data }) => setSiblingLessons((data ?? []) as any));
  }, [mode, moduleId, currentLessonId]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.menuCard} onStartShouldSetResponder={() => true}>
          {mode === "main" && (
            <>
              <TouchableOpacity style={styles.menuRow} onPress={onDuplicate}>
                <Ionicons name="copy-outline" size={18} color={colors.textDark} />
                <Text style={styles.menuRowText}>Duplicate</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuRow} onPress={() => setMode("convert")}>
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.textDark} />
                <Text style={styles.menuRowText}>Convert type</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuRow} onPress={() => setMode("move")}>
                <Ionicons name="arrow-redo-outline" size={18} color={colors.textDark} />
                <Text style={styles.menuRowText}>Move to different lesson</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuRow} onPress={onDelete}>
                <Ionicons name="trash-outline" size={18} color={"#B91C1C"} />
                <Text style={[styles.menuRowText, { color: "#B91C1C" }]}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
          {mode === "convert" && (
            <ScrollView style={{ maxHeight: 360 }}>
              {Object.values(BLOCK_TYPE_META).map((m) => (
                <TouchableOpacity key={m.type} style={styles.menuRow} onPress={() => onConvert(m.type)}>
                  <Ionicons name={m.icon as any} size={18} color={colors.primaryGreen} />
                  <Text style={styles.menuRowText}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {mode === "move" && (
            <ScrollView style={{ maxHeight: 360 }}>
              {siblingLessons.length === 0 && <Text style={styles.emptyStateText}>No other lessons in this module.</Text>}
              {siblingLessons.map((l) => (
                <TouchableOpacity key={l.id} style={styles.menuRow} onPress={() => onMove(l.id)}>
                  <Ionicons name="document-outline" size={18} color={colors.primaryGreen} />
                  <Text style={styles.menuRowText}>{l.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function SettingsTab({
  lesson, statusLog, publishing, onPatch, onStatusChange,
}: {
  lesson: LessonMeta; statusLog: StatusLogRow[]; publishing: boolean;
  onPatch: (p: Partial<LessonMeta>) => void; onStatusChange: (s: LessonStatus) => void;
}) {
  const [tagsInput, setTagsInput] = useState(lesson.tags.join(", "));

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View>
        <Text style={styles.settingsLabel}>Subtitle</Text>
        <TextInput
          style={styles.settingsInput}
          value={lesson.subtitle ?? ""}
          onChangeText={(t) => onPatch({ subtitle: t })}
          placeholder="Optional subtitle"
          placeholderTextColor={colors.textMutedLight}
        />
      </View>
      <View>
        <Text style={styles.settingsLabel}>Estimated minutes</Text>
        <TextInput
          style={styles.settingsInput}
          value={String(lesson.estimated_minutes)}
          onChangeText={(t) => onPatch({ estimated_minutes: parseInt(t, 10) || 0 })}
          keyboardType="number-pad"
        />
      </View>
      <View>
        <Text style={styles.settingsLabel}>Tags (comma separated)</Text>
        <TextInput
          style={styles.settingsInput}
          value={tagsInput}
          onChangeText={setTagsInput}
          onBlur={() => onPatch({ tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean) })}
          placeholder="prayer, discipleship"
          placeholderTextColor={colors.textMutedLight}
        />
      </View>
      <View>
        <Text style={styles.settingsLabel}>Status</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {(["draft", "review", "published", "archived"] as LessonStatus[]).map((s) => (
            <TouchableOpacity
              key={s}
              disabled={publishing}
              style={[styles.statusOption, lesson.status === s && { backgroundColor: STATUS_COLORS[s], borderColor: STATUS_COLORS[s] }]}
              onPress={() => onStatusChange(s)}
            >
              <Text style={[styles.statusOptionText, lesson.status === s && { color: "#fff" }]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View>
        <Text style={styles.settingsLabel}>Version history</Text>
        {statusLog.length === 0 && <Text style={styles.emptyStateText}>No status changes recorded yet.</Text>}
        {statusLog.map((row) => (
          <View key={row.id} style={styles.versionRow}>
            <Text style={styles.versionRowText}>
              {row.old_status ? `${row.old_status} → ${row.new_status}` : `Created as ${row.new_status}`}
            </Text>
            <Text style={styles.versionRowDate}>{new Date(row.changed_at).toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PreviewTab({
  lesson, blocks, readingMinutes, publishing, onPublish,
}: { lesson: LessonMeta; blocks: LessonBlock[]; readingMinutes: number; publishing: boolean; onPublish: () => void }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={styles.previewMetaRow}>
        <Ionicons name="time-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>~{readingMinutes} min read</Text>
      </View>
      {lesson.cover_image_url && <Image source={{ uri: lesson.cover_image_url }} style={styles.previewCover} resizeMode="cover" />}
      <Text style={styles.previewTitle}>{lesson.title}</Text>
      {lesson.subtitle ? <Text style={styles.previewSubtitle}>{lesson.subtitle}</Text> : null}
      {blocks.map((b) => (
        <View key={b.id} pointerEvents="none">
          <BlockRenderer block={b} moduleId={lesson.module_id} lessonId={lesson.id} onChangeContent={() => {}} />
        </View>
      ))}
      {lesson.status !== "published" && (
        <TouchableOpacity style={styles.publishBtn} onPress={onPublish} disabled={publishing}>
          {publishing ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>Publish</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  coverWrap: { width: "100%", height: 120 },
  coverImage: { width: "100%", height: "100%" },
  coverPlaceholder: { width: "100%", height: "100%", backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center", gap: 4 },
  coverPlaceholderText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMutedLight },
  titleInput: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.textDark, paddingHorizontal: 16, paddingTop: 12 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingVertical: 8 },
  statusBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  statusBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted, marginRight: 8 },
  saveIndicator: { flexDirection: "row", alignItems: "center", gap: 4 },
  saveIndicatorText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tabsRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, paddingHorizontal: 12 },
  tabBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primaryGreen },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.textMuted },
  tabBtnTextActive: { color: colors.primaryGreen },
  blockRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.card, borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: colors.borderBeige },
  blockRowActive: { borderColor: colors.primaryGreen, shadowOpacity: 0.15 },
  dragHandle: { paddingTop: 3, paddingRight: 2 },
  blockTypeIconWrap: { width: 22, height: 22, borderRadius: 6, backgroundColor: "#EAF6F1", alignItems: "center", justifyContent: "center", marginTop: 1 },
  blockMenuBtn: { padding: 4 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 8 },
  emptyStateText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMutedLight, textAlign: "center" },
  quickToolbar: { borderTopWidth: 1, borderTopColor: colors.borderBeige, paddingVertical: 8, backgroundColor: colors.lightCream },
  quickToolbarBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  quickToolbarBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  fab: { position: "absolute", right: 20, bottom: 76, width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 20 },
  pickerCard: { width: "100%", maxWidth: 420, backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  pickerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark, marginBottom: 8 },
  pickerSectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, marginTop: 4 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  pickerRowLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.textDark, flex: 1 },
  pickerShortcut: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.textMutedLight, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  menuCard: { width: "100%", maxWidth: 360, backgroundColor: "#fff", borderRadius: 16, padding: 8 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 10 },
  menuRowText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.textDark },
  settingsLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  settingsInput: { fontSize: 15, fontFamily: "Inter_400Regular", color: colors.textDark, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  statusOption: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  statusOptionText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  versionRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  versionRowText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.textDark },
  versionRowDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.textMuted },
  previewMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  previewCover: { width: "100%", height: 160, borderRadius: 10 },
  previewTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.textDark },
  previewSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.textMuted },
  publishBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  publishBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
