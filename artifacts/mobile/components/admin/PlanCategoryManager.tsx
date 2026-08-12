import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Modal, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { PLAN_CATEGORIES } from "@/lib/planCategories";
import type { Curriculum } from "@/app/admin/curriculum";
import {
  createPlanCategory, updatePlanCategory, deletePlanCategory, reorderPlanCategories,
  getPlanCategoryStats, movePlanToCategory, reorderPlan, togglePlanLock, duplicatePlan,
  type CategoryStats,
} from "@/lib/adminPlanCategories";

// Full admin management surface for plan categories + the plans inside them
// (STEP 2-9 of the Plan Category Management build). Category/lock/move/
// reorder/duplicate go through the admin.ts endpoints in lib/adminPlanCategories
// (they carry business logic — slug generation, lock-chain recalculation,
// plan-count safety checks). Simple field edits (visibility, featured,
// admin notes) are direct Supabase updates, matching the rest of this
// admin panel's convention.

const ICON_PRESETS = ["👑", "🧭", "🌱", "❤️", "✝️", "💼", "🙏", "🕊️", "🩹", "⛪", "📖", "⭐", "🔥", "💡", "🎯", "🌟", "🕯️", "📚", "🤝", "🛡️"];
const COLOR_PRESETS = Array.from(new Set(PLAN_CATEGORIES.map((c) => c.color)));

function showConfirm(title: string, message: string, onConfirm: () => void, destructive = true) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: destructive ? "destructive" : "default", onPress: onConfirm },
    ]);
  }
}

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

type ActionItem = { label: string; icon: string; onPress: () => void; danger?: boolean; disabled?: boolean };

function ActionSheet({ title, items, onClose }: { title: string; items: ActionItem[]; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheetBox} onStartShouldSetResponder={() => true}>
          <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
          {items.map((it, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.sheetItem, it.disabled && { opacity: 0.4 }]}
              disabled={it.disabled}
              onPress={() => { onClose(); it.onPress(); }}
            >
              <Ionicons name={it.icon as any} size={17} color={it.danger ? "#B91C1C" : colors.textMid} />
              <Text style={[styles.sheetItemText, it.danger && { color: "#B91C1C" }]}>{it.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function StatusPill({ status }: { status: string }) {
  const c = status === "published" ? colors.accentGreen : status === "archived" ? colors.textMuted : "#B45309";
  return (
    <View style={[pillStyles.wrap, { borderColor: c }]}>
      <Text style={[pillStyles.text, { color: c }]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
    </View>
  );
}
const pillStyles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
});

// ── Category form (create + edit) ──────────────────────────────────────────

function CategoryFormModal({
  category, onClose, onSaved,
}: { category: Curriculum | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!category;
  const [title, setTitle] = useState(category?.title ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [colorTheme, setColorTheme] = useState(category?.color_theme ?? COLOR_PRESETS[0]);
  const [icon, setIcon] = useState(category?.icon ?? ICON_PRESETS[0]);
  const [status, setStatus] = useState(category?.status ?? "draft");
  const [isVisible, setIsVisible] = useState(category?.is_visible ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null);
    try {
      if (isEdit && category) {
        await updatePlanCategory(category.id, {
          title: title.trim(), description: description.trim(), color_theme: colorTheme, icon, status, is_visible: isVisible,
        } as any);
      } else {
        await createPlanCategory({ title: title.trim(), description: description.trim(), color_theme: colorTheme, icon });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to save category");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!category) return;
    setDeleting(true);
    try {
      await deletePlanCategory(category.id);
      onSaved();
      onClose();
    } catch (e: any) {
      showAlert("Can't delete category", e.message ?? "Unknown error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{isEdit ? "Edit Category" : "New Category"}</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.textMid} /></TouchableOpacity>
            </View>

            <View style={[styles.previewCard, { borderLeftColor: colorTheme }]}>
              <Text style={styles.previewIcon}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle} numberOfLines={1}>{title.trim() || "Category title"}</Text>
                {!!description.trim() && <Text style={styles.previewDesc} numberOfLines={2}>{description}</Text>}
              </View>
            </View>

            <Field label="Title *">
              <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Prayer" placeholderTextColor={colors.textMuted} />
            </Field>
            <Field label="Description">
              <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} placeholder="What this category covers" placeholderTextColor={colors.textMuted} multiline textAlignVertical="top" />
            </Field>

            <Field label="Color">
              <View style={styles.swatchRow}>
                {COLOR_PRESETS.map((c) => (
                  <TouchableOpacity key={c} style={[styles.swatch, { backgroundColor: c }, colorTheme === c && styles.swatchSelected]} onPress={() => setColorTheme(c)}>
                    {colorTheme === c && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={[styles.input, { marginTop: 8 }]} value={colorTheme} onChangeText={setColorTheme} placeholder="#RRGGBB (custom)" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
            </Field>

            <Field label="Icon">
              <View style={styles.swatchRow}>
                {ICON_PRESETS.map((e) => (
                  <TouchableOpacity key={e} style={[styles.iconOpt, icon === e && styles.iconOptSelected]} onPress={() => setIcon(e)}>
                    <Text style={{ fontSize: 18 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={[styles.input, { marginTop: 8 }]} value={icon} onChangeText={setIcon} placeholder="Custom emoji" placeholderTextColor={colors.textMuted} />
            </Field>

            {isEdit && (
              <Field label="Status">
                <View style={styles.statusRow}>
                  {(["draft", "published", "archived"] as const).map((s) => (
                    <TouchableOpacity key={s} style={[styles.statusOpt, status === s && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen }]} onPress={() => setStatus(s)}>
                      <Text style={[styles.statusOptText, status === s && { color: "#fff" }]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Field>
            )}

            <TouchableOpacity style={styles.toggleRow} onPress={() => setIsVisible((v) => !v)}>
              <View style={[styles.toggleTrack, isVisible && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, isVisible && styles.toggleThumbOn]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Visible to users</Text>
                <Text style={styles.hintText}>Hidden categories stay editable in admin but disappear from the app.</Text>
              </View>
            </TouchableOpacity>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>{isEdit ? "Save Changes" : "Create Category"}</Text>}
            </TouchableOpacity>

            {isEdit && category && (
              <View style={styles.dangerZone}>
                <Text style={styles.dangerZoneTitle}>Danger Zone</Text>
                <TouchableOpacity
                  style={styles.dangerBtn}
                  onPress={() => showConfirm("Archive category?", `"${category.title}" will be hidden from users but kept in admin.`, async () => {
                    try { await updatePlanCategory(category.id, { status: "archived" } as any); onSaved(); onClose(); }
                    catch (e: any) { showAlert("Error", e.message); }
                  }, false)}
                >
                  <Ionicons name="archive-outline" size={15} color="#B45309" />
                  <Text style={[styles.dangerBtnText, { color: "#B45309" }]}>Archive Category</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dangerBtn, deleting && { opacity: 0.7 }]}
                  disabled={deleting}
                  onPress={() => showConfirm("Delete category?", "This cannot be undone. Categories with plans inside them can't be deleted — move or delete the plans first.", handleDelete)}
                >
                  {deleting ? <ActivityIndicator size="small" color="#B91C1C" /> : <><Ionicons name="trash-outline" size={15} color="#B91C1C" /><Text style={styles.dangerBtnText}>Delete Category</Text></>}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Move plan modal ─────────────────────────────────────────────────────────

function MovePlanModal({
  plan, categories, plansByCategory, onClose, onMoved,
}: { plan: Curriculum; categories: Curriculum[]; plansByCategory: Map<string, Curriculum[]>; onClose: () => void; onMoved: () => void }) {
  const [creating, setCreating] = useState(false);
  const [newCatTitle, setNewCatTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  async function move(categoryId: string) {
    setBusy(true);
    try {
      await movePlanToCategory(plan.id, categoryId);
      onMoved();
      onClose();
    } catch (e: any) {
      showAlert("Move failed", e.message ?? "Unknown error");
      setBusy(false);
    }
  }

  async function createAndMove() {
    if (!newCatTitle.trim()) return;
    setCreateBusy(true);
    try {
      const cat = await createPlanCategory({ title: newCatTitle.trim() });
      await move(cat.id);
    } catch (e: any) {
      showAlert("Couldn't create category", e.message ?? "Unknown error");
      setCreateBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Move "{plan.title}"</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.textMid} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
            {categories.map((c) => {
              const count = (plansByCategory.get(c.id) ?? []).length;
              const isCurrent = plan.parent_category_id === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.moveRow, isCurrent && styles.moveRowCurrent]}
                  disabled={isCurrent || busy}
                  onPress={() => move(c.id)}
                >
                  <View style={[styles.moduleColorDot, { backgroundColor: c.color_theme || colors.primaryGreen }]} />
                  <Text style={{ fontSize: 16 }}>{c.icon ?? ""}</Text>
                  <Text style={[styles.moveRowText, { flex: 1 }]} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.moveRowCount}>{count}</Text>
                  {isCurrent ? <Text style={styles.moveRowCurrentTag}>Current</Text> : <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />}
                </TouchableOpacity>
              );
            })}

            {creating ? (
              <View style={styles.moveRow}>
                <TextInput style={[styles.input, { flex: 1 }]} value={newCatTitle} onChangeText={setNewCatTitle} placeholder="New category title" placeholderTextColor={colors.textMuted} autoFocus />
                <TouchableOpacity onPress={createAndMove} disabled={createBusy || !newCatTitle.trim()}>
                  {createBusy ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.addInTreeBtn} onPress={() => setCreating(true)}>
                <Ionicons name="add" size={14} color={colors.accentGreen} />
                <Text style={styles.addInTreeText}>Create New Category</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          {busy && <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 10 }} />}
        </View>
      </View>
    </Modal>
  );
}

// ── Position (reorder) modal ─────────────────────────────────────────────────

function PositionModal({
  plan, maxPosition, onClose, onMoved,
}: { plan: Curriculum; maxPosition: number; onClose: () => void; onMoved: () => void }) {
  const [value, setValue] = useState(String(plan.topic_number ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) { setError("Enter a valid position number."); return; }
    setBusy(true); setError(null);
    try {
      await reorderPlan(plan.id, n);
      onMoved();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to reorder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.box, { maxWidth: 380 }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Change Position</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.textMid} /></TouchableOpacity>
          </View>
          <Text style={styles.hintText}>"{plan.title}" is currently topic {plan.topic_number ?? "?"} of {maxPosition}. The unlock chain will be recalculated after moving it.</Text>
          <Field label="Move to position">
            <TextInput style={styles.input} value={value} onChangeText={setValue} keyboardType="number-pad" placeholder={`1 - ${maxPosition}`} placeholderTextColor={colors.textMuted} />
          </Field>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.7 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Move</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Lock toggle confirm ──────────────────────────────────────────────────────

function LockConfirmModal({
  plan, onClose, onToggled,
}: { plan: Curriculum; onClose: () => void; onToggled: () => void }) {
  const isCurrentlyLocked = !!plan.unlock_after_plan_id && !plan.manually_unlocked;
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await togglePlanLock(plan.id, !isCurrentlyLocked);
      onToggled();
      onClose();
    } catch (e: any) {
      showAlert("Error", e.message ?? "Failed to update lock state");
      setBusy(false);
    }
  }

  const title = isCurrentlyLocked ? "Unlock this plan?" : "Re-lock this plan?";
  const message = isCurrentlyLocked
    ? `"${plan.title}" will be unlocked for all users regardless of whether they've completed the previous topic. You can re-lock it any time.`
    : `"${plan.title}" will go back to following the normal sequential unlock chain — users will need to complete the previous topic first.`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.box, { maxWidth: 400 }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.textMid} /></TouchableOpacity>
          </View>
          <Text style={styles.hintText}>{message}</Text>
          <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.7 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>{isCurrentlyLocked ? "Unlock Plan" : "Re-lock Plan"}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Admin notes modal (Idea E) ───────────────────────────────────────────────

function NotesModal({ plan, onClose, onSaved }: { plan: Curriculum; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(plan.admin_notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("p2p_curriculums").update({ admin_notes: notes.trim() || null }).eq("id", plan.id);
    setBusy(false);
    if (error) { showAlert("Error", error.message); return; }
    onSaved();
    onClose();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Admin Notes</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.textMid} /></TouchableOpacity>
          </View>
          <Text style={styles.hintText}>Internal only — never shown to users.</Text>
          <TextInput style={[styles.input, { minHeight: 100 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" placeholder="e.g. Needs a re-record of module 3 audio" placeholderTextColor={colors.textMuted} />
          <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.7 }]} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Save Notes</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

// ── Plan row ──────────────────────────────────────────────────────────────────

function PlanRow({
  plan, categoryTitle, onOpenActions,
}: { plan: Curriculum; categoryTitle?: string; onOpenActions: () => void }) {
  const isLocked = !!plan.unlock_after_plan_id && !plan.manually_unlocked;
  return (
    <View style={styles.planRow}>
      {plan.topic_number != null && <View style={styles.topicBadge}><Text style={styles.topicBadgeText}>{plan.topic_number}</Text></View>}
      <Ionicons name={isLocked ? "lock-closed" : "lock-open-outline"} size={13} color={isLocked ? "#B45309" : colors.accentGreen} />
      <Text style={styles.planRowTitle} numberOfLines={1}>{plan.title}</Text>
      {plan.is_featured_in_category && <Ionicons name="star" size={13} color="#B8860B" />}
      {!!plan.admin_notes && <Ionicons name="document-text" size={13} color="#B8860B" />}
      {plan.is_visible === false && <Ionicons name="eye-off-outline" size={13} color={colors.textMuted} />}
      {categoryTitle && <Text style={styles.planRowCategory} numberOfLines={1}>{categoryTitle}</Text>}
      <StatusPill status={plan.status} />
      <TouchableOpacity onPress={onOpenActions} style={{ padding: 4 }}>
        <Ionicons name="ellipsis-vertical" size={15} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

// ── Category row ──────────────────────────────────────────────────────────────

function CategoryRow({
  category, plans, isFirst, isLast, isExpanded, stats, statsLoading,
  onToggleExpand, onMove, onOpenActions, onOpenPlanActions,
}: {
  category: Curriculum; plans: Curriculum[]; isFirst: boolean; isLast: boolean; isExpanded: boolean;
  stats: CategoryStats | null; statsLoading: boolean;
  onToggleExpand: () => void; onMove: (dir: "up" | "down") => void;
  onOpenActions: () => void; onOpenPlanActions: (plan: Curriculum) => void;
}) {
  return (
    <View style={styles.categoryCard}>
      <TouchableOpacity style={[styles.categoryHeader, { borderLeftColor: category.color_theme || colors.primaryGreen }]} onPress={onToggleExpand}>
        <Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} size={15} color={colors.textMid} />
        <Text style={{ fontSize: 17 }}>{category.icon ?? "📁"}</Text>
        <Text style={styles.categoryTitle} numberOfLines={1}>{category.title}</Text>
        {category.is_visible === false && <Ionicons name="eye-off-outline" size={14} color={colors.textMuted} />}
        <View style={styles.categoryCountBadge}><Text style={styles.categoryCountText}>{plans.length}</Text></View>
        <StatusPill status={category.status} />
        <View style={styles.reorderBtns}>
          <TouchableOpacity disabled={isFirst} onPress={() => onMove("up")}>
            <Ionicons name="arrow-up" size={13} color={isFirst ? colors.borderBeige : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity disabled={isLast} onPress={() => onMove("down")}>
            <Ionicons name="arrow-down" size={13} color={isLast ? colors.borderBeige : colors.textMuted} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={onOpenActions} style={{ padding: 4 }}>
          <Ionicons name="ellipsis-vertical" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.categoryBody}>
          {statsLoading ? (
            <ActivityIndicator size="small" color={colors.accentGreen} style={{ marginVertical: 8 }} />
          ) : stats ? (
            <View style={styles.statsRow}>
              <StatChip label="Enrolled" value={String(stats.usersEnrolled)} />
              <StatChip label="Lessons done" value={String(stats.lessonsCompleted)} />
              <StatChip label="Most reached" value={stats.mostReachedTopic ? `Topic ${stats.mostReachedTopic.topicNumber ?? "?"}` : "—"} />
              <StatChip label="Avg. completion" value={stats.avgCompletionWeeks != null ? `${stats.avgCompletionWeeks}w` : "—"} />
            </View>
          ) : null}

          {plans.length === 0 ? (
            <Text style={styles.emptyText}>No plans in this category yet.</Text>
          ) : (
            plans.map((p) => <PlanRow key={p.id} plan={p} onOpenActions={() => onOpenPlanActions(p)} />)
          )}
        </View>
      )}
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statChipValue}>{value}</Text>
      <Text style={styles.statChipLabel}>{label}</Text>
    </View>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

type Tab = "categories" | "all" | "uncategorized";

export default function PlanCategoryManager({
  curricula, onReload, onEditPlan, onOpenPdfImport, onCreatePlanInCategory,
}: {
  curricula: Curriculum[];
  onReload: () => void | Promise<void>;
  onEditPlan: (id: string) => void;
  onOpenPdfImport: () => void;
  onCreatePlanInCategory: (categoryId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("categories");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statsById, setStatsById] = useState<Record<string, CategoryStats | undefined>>({});
  const [statsLoadingId, setStatsLoadingId] = useState<string | null>(null);

  const [categoryModal, setCategoryModal] = useState<null | "create" | Curriculum>(null);
  const [moveModal, setMoveModal] = useState<Curriculum | null>(null);
  const [positionModal, setPositionModal] = useState<Curriculum | null>(null);
  const [lockModal, setLockModal] = useState<Curriculum | null>(null);
  const [notesModal, setNotesModal] = useState<Curriculum | null>(null);
  const [planSheet, setPlanSheet] = useState<Curriculum | null>(null);
  const [categorySheet, setCategorySheet] = useState<Curriculum | null>(null);

  const [search, setSearch] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);

  const categories = useMemo(
    () => curricula.filter((c) => c.type === "plan_category").sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [curricula]
  );
  const plans = useMemo(() => curricula.filter((c) => c.type === "plan"), [curricula]);
  const plansByCategory = useMemo(() => {
    const m = new Map<string, Curriculum[]>();
    for (const p of plans) {
      if (!p.parent_category_id) continue;
      (m.get(p.parent_category_id) ?? m.set(p.parent_category_id, []).get(p.parent_category_id)!).push(p);
    }
    for (const list of m.values()) list.sort((a, b) => (a.topic_number ?? 0) - (b.topic_number ?? 0));
    return m;
  }, [plans]);
  const uncategorizedPlans = useMemo(() => plans.filter((p) => !p.parent_category_id), [plans]);
  const categoryTitleById = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);

  async function reload() { await onReload(); }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else {
        next.add(id);
        if (statsById[id] === undefined) loadStats(id);
      }
      return next;
    });
  }

  async function loadStats(categoryId: string) {
    setStatsLoadingId(categoryId);
    try {
      const s = await getPlanCategoryStats(categoryId);
      setStatsById((prev) => ({ ...prev, [categoryId]: s }));
    } catch {
      // Leave stats absent — the panel just shows the plan list without them.
    } finally {
      setStatsLoadingId((id) => (id === categoryId ? null : id));
    }
  }

  async function moveCategoryOrder(cat: Curriculum, dir: "up" | "down") {
    const idx = categories.findIndex((c) => c.id === cat.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= categories.length) return;
    const other = categories[swapIdx];
    try {
      await reorderPlanCategories([
        { id: cat.id, display_order: other.display_order ?? swapIdx },
        { id: other.id, display_order: cat.display_order ?? idx },
      ]);
      await reload();
    } catch (e: any) {
      showAlert("Reorder failed", e.message ?? "Unknown error");
    }
  }

  async function toggleFeatured(plan: Curriculum) {
    const { error } = await supabase.from("p2p_curriculums").update({ is_featured_in_category: !plan.is_featured_in_category }).eq("id", plan.id);
    if (error) { showAlert("Error", error.message); return; }
    await reload();
  }
  async function toggleVisible(plan: Curriculum) {
    const { error } = await supabase.from("p2p_curriculums").update({ is_visible: plan.is_visible === false }).eq("id", plan.id);
    if (error) { showAlert("Error", error.message); return; }
    await reload();
  }
  async function handleDuplicate(plan: Curriculum) {
    try {
      const result = await duplicatePlan(plan.id);
      await reload();
      showAlert("Duplicated", `"${result.title}" was created as a draft.`);
    } catch (e: any) {
      showAlert("Duplicate failed", e.message ?? "Unknown error");
    }
  }
  function handleDeletePlan(plan: Curriculum) {
    showConfirm("Delete plan?", `"${plan.title}" and all its modules/lessons will be permanently deleted.`, async () => {
      const { error } = await supabase.from("p2p_curriculums").delete().eq("id", plan.id);
      if (error) {
        showAlert("Could not delete plan", error.code === "23503" ? "This plan still has content inside it. Delete its modules first." : error.message);
        return;
      }
      await reload();
    });
  }

  function planActionItems(plan: Curriculum): ActionItem[] {
    const catPlans = plan.parent_category_id ? (plansByCategory.get(plan.parent_category_id) ?? []) : [];
    return [
      { label: "Edit", icon: "create-outline", onPress: () => onEditPlan(plan.id) },
      { label: "Duplicate Plan", icon: "copy-outline", onPress: () => handleDuplicate(plan) },
      { label: "Move to Category", icon: "swap-horizontal-outline", onPress: () => setMoveModal(plan) },
      { label: "Change Position", icon: "reorder-three-outline", onPress: () => setPositionModal(plan), disabled: !plan.parent_category_id || catPlans.length < 2 },
      { label: (!!plan.unlock_after_plan_id && !plan.manually_unlocked) ? "Unlock Plan" : "Re-lock Plan", icon: "lock-open-outline", onPress: () => setLockModal(plan), disabled: !plan.unlock_after_plan_id && !plan.manually_unlocked },
      { label: plan.is_featured_in_category ? "Unfeature in Category" : "Feature in Category", icon: "star-outline", onPress: () => toggleFeatured(plan) },
      { label: plan.is_visible === false ? "Make Visible" : "Hide from Users", icon: plan.is_visible === false ? "eye-outline" : "eye-off-outline", onPress: () => toggleVisible(plan) },
      { label: "Admin Notes", icon: "document-text-outline", onPress: () => setNotesModal(plan) },
      { label: "Delete", icon: "trash-outline", danger: true, onPress: () => handleDeletePlan(plan) },
    ];
  }

  function categoryActionItems(cat: Curriculum): ActionItem[] {
    return [
      { label: "Edit", icon: "create-outline", onPress: () => setCategoryModal(cat) },
      { label: "Add Plan", icon: "add-circle-outline", onPress: () => onCreatePlanInCategory(cat.id) },
      { label: "View Plans", icon: "eye-outline", onPress: () => { if (!expanded.has(cat.id)) toggleExpand(cat.id); } },
      { label: "Delete", icon: "trash-outline", danger: true, onPress: () => showConfirm("Delete category?", `Delete "${cat.title}"? This only works if it has no plans inside it.`, async () => {
        try { await deletePlanCategory(cat.id); await reload(); } catch (e: any) { showAlert("Can't delete category", e.message ?? "Unknown error"); }
      }) },
    ];
  }

  const filteredAllPlans = useMemo(() => {
    let list = plans;
    if (filterCategoryId === "uncategorized") list = list.filter((p) => !p.parent_category_id);
    else if (filterCategoryId) list = list.filter((p) => p.parent_category_id === filterCategoryId);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [plans, filterCategoryId, search]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.topBar}>
        <View style={styles.tabRow}>
          {(["categories", "all", "uncategorized"] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
                {t === "categories" ? "Categories" : t === "all" ? "All Plans" : "Uncategorized"}
                {t === "uncategorized" && uncategorizedPlans.length > 0 ? ` (${uncategorizedPlans.length})` : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={styles.addBtnSmall} onPress={onOpenPdfImport}>
            <Ionicons name="document-attach-outline" size={15} color={colors.accentGreen} />
            <Text style={styles.addBtnSmallText}>Import from PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBtnSmall} onPress={() => setCategoryModal("create")}>
            <Ionicons name="add" size={16} color={colors.accentGreen} />
            <Text style={styles.addBtnSmallText}>New Category</Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === "categories" && (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
          {categories.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>No categories yet. Create one to organize your plans.</Text>
            </View>
          ) : (
            categories.map((cat, i) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                plans={plansByCategory.get(cat.id) ?? []}
                isFirst={i === 0}
                isLast={i === categories.length - 1}
                isExpanded={expanded.has(cat.id)}
                stats={statsById[cat.id] ?? null}
                statsLoading={statsLoadingId === cat.id}
                onToggleExpand={() => toggleExpand(cat.id)}
                onMove={(dir) => moveCategoryOrder(cat, dir)}
                onOpenActions={() => setCategorySheet(cat)}
                onOpenPlanActions={(p) => setPlanSheet(p)}
              />
            ))
          )}
        </ScrollView>
      )}

      {tab === "all" && (
        <View style={{ flex: 1 }}>
          <View style={styles.filterBar}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={14} color={colors.textMuted} />
              <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search plans A-Z…" placeholderTextColor={colors.textMuted} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
              <TouchableOpacity style={[styles.filterChip, !filterCategoryId && styles.filterChipActive]} onPress={() => setFilterCategoryId(null)}>
                <Text style={[styles.filterChipText, !filterCategoryId && styles.filterChipTextActive]}>All</Text>
              </TouchableOpacity>
              {categories.map((c) => (
                <TouchableOpacity key={c.id} style={[styles.filterChip, filterCategoryId === c.id && styles.filterChipActive]} onPress={() => setFilterCategoryId(c.id)}>
                  <Text style={[styles.filterChipText, filterCategoryId === c.id && styles.filterChipTextActive]}>{c.icon} {c.title}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.filterChip, filterCategoryId === "uncategorized" && styles.filterChipActive]} onPress={() => setFilterCategoryId("uncategorized")}>
                <Text style={[styles.filterChipText, filterCategoryId === "uncategorized" && styles.filterChipTextActive]}>Uncategorized</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 6 }}>
            {filteredAllPlans.length === 0 ? (
              <View style={styles.emptyState}><Text style={styles.emptyText}>No plans match.</Text></View>
            ) : (
              filteredAllPlans.map((p) => (
                <PlanRow
                  key={p.id}
                  plan={p}
                  categoryTitle={p.parent_category_id ? categoryTitleById.get(p.parent_category_id) : "Uncategorized"}
                  onOpenActions={() => setPlanSheet(p)}
                />
              ))
            )}
          </ScrollView>
        </View>
      )}

      {tab === "uncategorized" && (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 6 }}>
          {uncategorizedPlans.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-circle-outline" size={32} color={colors.accentGreen} />
              <Text style={styles.emptyText}>All plans are assigned to categories ✓</Text>
            </View>
          ) : (
            uncategorizedPlans.map((p) => (
              <View key={p.id} style={styles.planRow}>
                <Text style={styles.planRowTitle} numberOfLines={1}>{p.title}</Text>
                <StatusPill status={p.status} />
                <TouchableOpacity style={styles.assignBtn} onPress={() => setMoveModal(p)}>
                  <Text style={styles.assignBtnText}>Assign Category</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPlanSheet(p)} style={{ padding: 4 }}>
                  <Ionicons name="ellipsis-vertical" size={15} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {categoryModal && (
        <CategoryFormModal
          category={categoryModal === "create" ? null : categoryModal}
          onClose={() => setCategoryModal(null)}
          onSaved={reload}
        />
      )}
      {moveModal && (
        <MovePlanModal plan={moveModal} categories={categories} plansByCategory={plansByCategory} onClose={() => setMoveModal(null)} onMoved={reload} />
      )}
      {positionModal && (
        <PositionModal plan={positionModal} maxPosition={(plansByCategory.get(positionModal.parent_category_id ?? "") ?? []).length} onClose={() => setPositionModal(null)} onMoved={reload} />
      )}
      {lockModal && <LockConfirmModal plan={lockModal} onClose={() => setLockModal(null)} onToggled={reload} />}
      {notesModal && <NotesModal plan={notesModal} onClose={() => setNotesModal(null)} onSaved={reload} />}
      {planSheet && <ActionSheet title={planSheet.title} items={planActionItems(planSheet)} onClose={() => setPlanSheet(null)} />}
      {categorySheet && <ActionSheet title={categorySheet.title} items={categoryActionItems(categorySheet)} onClose={() => setCategorySheet(null)} />}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, backgroundColor: "#fff", flexWrap: "wrap", gap: 10 },
  tabRow: { flexDirection: "row", gap: 6, backgroundColor: colors.cardBeige, borderRadius: 10, padding: 4 },
  tabBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8 },
  tabBtnActive: { backgroundColor: colors.primaryGreen },
  tabBtnText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  tabBtnTextActive: { color: "#fff" },

  addBtnSmall: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnSmallText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  emptyState: { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },

  categoryCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, overflow: "hidden" },
  categoryHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderLeftWidth: 4 },
  categoryTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: colors.textDark },
  categoryCountBadge: { backgroundColor: colors.cardBeige, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  categoryCountText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  categoryBody: { padding: 12, paddingTop: 8, gap: 6, borderTopWidth: 1, borderTopColor: colors.borderBeige, backgroundColor: colors.lightCream },

  reorderBtns: { flexDirection: "column", gap: 1 },
  moduleColorDot: { width: 8, height: 8, borderRadius: 4 },

  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  statChip: { backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 10, paddingVertical: 6, minWidth: 84 },
  statChipValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.textDark },
  statChipLabel: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  planRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.borderBeige },
  topicBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center" },
  topicBadgeText: { fontSize: 10, color: colors.textMid, fontFamily: "Inter_700Bold" },
  planRowTitle: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  planRowCategory: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", maxWidth: 140 },

  assignBtn: { backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  assignBtnText: { fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  filterBar: { padding: 14, paddingBottom: 4, gap: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  filterChip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  filterChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  filterChipTextActive: { color: "#fff" },

  addInTreeBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 6 },
  addInTreeText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  // Modals
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { width: "100%", maxWidth: 520, maxHeight: "88%", backgroundColor: "#fff", borderRadius: 18, padding: 20, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", flex: 1, marginRight: 10 },

  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  hintText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
  input: { backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 10, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_400Regular", textAlign: "center" },

  previewCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.lightCream, borderRadius: 12, padding: 12, borderLeftWidth: 4 },
  previewIcon: { fontSize: 24 },
  previewTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.textDark },
  previewDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted },

  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchSelected: { borderColor: colors.textDark },
  iconOpt: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.borderBeige },
  iconOptSelected: { borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.1)" },

  statusRow: { flexDirection: "row", gap: 8 },
  statusOpt: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.borderBeige },
  statusOptText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleTrack: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.borderBeige, padding: 2, justifyContent: "center" },
  toggleTrackOn: { backgroundColor: colors.accentGreen },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  toggleThumbOn: { transform: [{ translateX: 18 }] },

  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.accentGreen, borderRadius: 12, height: 46, paddingHorizontal: 20 },
  primaryBtnText: { fontSize: 14, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },

  dangerZone: { gap: 8, marginTop: 4, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.borderBeige },
  dangerZoneTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#B91C1C", textTransform: "uppercase", letterSpacing: 0.5 },
  dangerBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "#F1B4B4" },
  dangerBtnText: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_600SemiBold" },

  moveRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige },
  moveRowCurrent: { backgroundColor: "rgba(29,158,117,0.08)", borderColor: colors.accentGreen },
  moveRowText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  moveRowCount: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  moveRowCurrentTag: { fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  sheetBox: { width: "100%", maxWidth: 340, backgroundColor: "#fff", borderRadius: 16, padding: 8, gap: 2 },
  sheetTitle: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_600SemiBold", padding: 10, paddingBottom: 4 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8 },
  sheetItemText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_500Medium" },
});