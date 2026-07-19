import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, Modal, TextInput, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// ── Types ──────────────────────────────────────────────────────────────────────

type DraftRow = {
  id: string; content_type: string; content_id: string; language_code: string;
  title: string | null; subtitle: string | null; description: string | null;
  body: string | null; metadata: Record<string, unknown>;
  status: string; translated_at: string;
};

type EnglishSource = {
  title?: string | null; subtitle?: string | null;
  description?: string | null; body?: string | null;
  sections?: Array<{ title: string; content: string }>;
  questions?: string[];
};

const TYPE_LABELS: Record<string, string> = {
  curriculum: "Curriculum", module: "Module", lesson: "Lesson",
  section: "Section", question: "Question", scripture: "Scripture",
  plan: "Plan", plan_module: "Plan Module", plan_lesson: "Plan Lesson",
};

const LANG_NAMES: Record<string, string> = {
  de: "German", es: "Spanish", fr: "French", pt: "Portuguese",
  zh: "Chinese", ar: "Arabic", he: "Hebrew", ru: "Russian",
  ja: "Japanese", ko: "Korean", hi: "Hindi", sw: "Swahili",
};

// ── Fetch English source for side-by-side ─────────────────────────────────────

async function fetchEnglishSource(contentType: string, contentId: string): Promise<EnglishSource | null> {
  switch (contentType) {
    case "curriculum": {
      const { data } = await supabase.from("p2p_curriculums").select("title,description").eq("id", contentId).maybeSingle();
      return data ? { title: data.title, description: data.description } : null;
    }
    case "module": {
      const { data } = await supabase.from("p2p_modules").select("title,description").eq("id", contentId).maybeSingle();
      return data ? { title: data.title, description: data.description } : null;
    }
    case "lesson": {
      const [{ data: lesson }, { data: sections }, { data: questions }] = await Promise.all([
        supabase.from("p2p_lessons").select("title,subtitle").eq("id", contentId).maybeSingle(),
        supabase.from("p2p_lesson_sections").select("title,content").eq("lesson_id", contentId).order("sort_order"),
        supabase.from("p2p_reflection_questions").select("question").eq("lesson_id", contentId).order("sort_order"),
      ]);
      if (!lesson) return null;
      return {
        title: lesson.title, subtitle: lesson.subtitle,
        sections: (sections ?? []) as { title: string; content: string }[],
        questions: (questions ?? []).map((q: any) => q.question as string),
      };
    }
    case "plan": {
      const { data } = await supabase.from("p2p_plans").select("title,tagline,overview").eq("id", contentId).maybeSingle();
      return data ? { title: data.title, subtitle: data.tagline, description: data.overview } : null;
    }
    case "plan_module": {
      const { data } = await supabase.from("p2p_plan_modules").select("module_title").eq("id", contentId).maybeSingle();
      return data ? { title: data.module_title } : null;
    }
    case "plan_lesson": {
      const { data } = await supabase.from("p2p_plan_lessons").select("title").eq("id", contentId).maybeSingle();
      return data ? { title: data.title } : null;
    }
    default:
      return null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function TranslationReviewScreen() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLang, setFilterLang] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [langs, setLangs] = useState<string[]>([]);

  const [reviewing, setReviewing] = useState<DraftRow | null>(null);
  const [englishSrc, setEnglishSrc] = useState<EnglishSource | null>(null);
  const [srcLoading, setSrcLoading] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedTagline, setEditedTagline] = useState("");
  const [editedDesc, setEditedDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from("p2p_content_translations").select("*").eq("status", "draft").order("translated_at", { ascending: false });
      const { data } = await q;
      const rows = (data ?? []) as DraftRow[];
      setDrafts(rows);
      setLangs([...new Set(rows.map((r) => r.language_code))].sort());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  async function openReview(row: DraftRow) {
    setReviewing(row);
    setEditedTitle(row.title ?? "");
    if (row.content_type === "plan") {
      setEditedTagline(row.subtitle ?? "");
      setEditedDesc(row.description ?? "");
    } else {
      setEditedTagline("");
      setEditedDesc(row.description ?? row.subtitle ?? "");
    }
    setEnglishSrc(null);
    setSrcLoading(true);
    try {
      const src = await fetchEnglishSource(row.content_type, row.content_id);
      setEnglishSrc(src);
    } finally {
      setSrcLoading(false);
    }
  }

  async function updateStatus(status: "approved" | "rejected") {
    if (!reviewing) return;
    setSaving(true);
    try {
      const update: Record<string, unknown> = { status };
      if (editedTitle !== reviewing.title) update.title = editedTitle;
      if (reviewing.content_type === "plan") {
        if (editedTagline !== (reviewing.subtitle ?? "")) update.subtitle = editedTagline;
        if (editedDesc !== reviewing.description) update.description = editedDesc;
      } else if (reviewing.content_type === "module" || reviewing.content_type === "curriculum") {
        if (editedDesc !== reviewing.description) update.description = editedDesc;
      } else {
        if (editedDesc !== reviewing.subtitle) update.subtitle = editedDesc;
      }
      if (status === "approved") update.approved_at = new Date().toISOString();

      const { error } = await supabase
        .from("p2p_content_translations")
        .update(update)
        .eq("content_type", reviewing.content_type)
        .eq("content_id", reviewing.content_id)
        .eq("language_code", reviewing.language_code);

      if (error) throw error;
      setReviewing(null);
      setDrafts((prev) => prev.filter(
        (d) => !(d.content_type === reviewing.content_type && d.content_id === reviewing.content_id && d.language_code === reviewing.language_code)
      ));
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = drafts.filter((d) =>
    (filterLang === "all" || d.language_code === filterLang) &&
    (filterType === "all" || d.content_type === filterType)
  );

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Review Queue</Text>
        <Text style={styles.pageSubtitle}>{drafts.length} draft{drafts.length !== 1 ? "s" : ""} pending approval</Text>
      </View>

      {/* ── Filters ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
        {["all", ...langs].map((l) => (
          <TouchableOpacity key={l} style={[styles.chip, filterLang === l && styles.chipActive]} onPress={() => setFilterLang(l)}>
            <Text style={[styles.chipText, filterLang === l && styles.chipTextActive]}>
              {l === "all" ? "All Languages" : (LANG_NAMES[l] ?? l.toUpperCase())}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.chipDivider} />
        {["all", "curriculum", "module", "lesson", "plan", "plan_module", "plan_lesson"].map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, filterType === t && styles.chipActive]} onPress={() => setFilterType(t)}>
            <Text style={[styles.chipText, filterType === t && styles.chipTextActive]}>
              {t === "all" ? "All Types" : TYPE_LABELS[t] ?? t}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── List ── */}
      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle-outline" size={48} color={colors.primaryGreen} />
          <Text style={styles.emptyTitle}>Queue is clear</Text>
          <Text style={styles.emptySubtitle}>No draft translations match your filters</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => `${item.content_type}_${item.content_id}_${item.language_code}`}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item }) => (
            <View style={styles.draftCard}>
              <View style={styles.draftCardLeft}>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{TYPE_LABELS[item.content_type] ?? item.content_type}</Text>
                </View>
                <View>
                  <Text style={styles.draftTitle} numberOfLines={1}>
                    {item.title ?? "(no title)"}
                  </Text>
                  <Text style={styles.draftMeta}>
                    {LANG_NAMES[item.language_code] ?? item.language_code} · {new Date(item.translated_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.reviewBtn} onPress={() => openReview(item)}>
                <Text style={styles.reviewBtnText}>Review</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* ── Review modal ── */}
      <Modal visible={!!reviewing} animationType="slide">
        <View style={styles.modalRoot}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setReviewing(null)} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {reviewing ? `${TYPE_LABELS[reviewing.content_type] ?? reviewing.content_type} · ${LANG_NAMES[reviewing.language_code] ?? reviewing.language_code}` : ""}
            </Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={{ padding: 16, gap: 16 }}>
            {/* Side-by-side: English | Translation */}
            <View style={styles.compareRow}>
              {/* English */}
              <View style={styles.compareCol}>
                <Text style={styles.compareLabel}>🇬🇧 English (Source)</Text>
                {srcLoading ? (
                  <ActivityIndicator color={colors.primaryGreen} style={{ marginTop: 12 }} />
                ) : englishSrc ? (
                  <View style={{ gap: 8 }}>
                    {englishSrc.title ? <SourceField label="Title" value={englishSrc.title} /> : null}
                    {englishSrc.subtitle ? <SourceField label="Subtitle" value={englishSrc.subtitle} /> : null}
                    {englishSrc.description ? <SourceField label="Description" value={englishSrc.description} /> : null}
                    {englishSrc.sections?.map((s, i) => (
                      <SourceField key={i} label={s.title || `Section ${i + 1}`} value={s.content} />
                    ))}
                    {englishSrc.questions?.map((q, i) => (
                      <SourceField key={i} label={`Q${i + 1}`} value={q} />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noSrcText}>Source not found</Text>
                )}
              </View>

              {/* Translation (editable) */}
              <View style={styles.compareCol}>
                <Text style={styles.compareLabel}>
                  {reviewing ? (LANG_NAMES[reviewing.language_code] ?? reviewing.language_code) : ""} (AI Draft)
                </Text>
                <View style={{ gap: 8 }}>
                  <Text style={styles.editLabel}>Title</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editedTitle}
                    onChangeText={setEditedTitle}
                    placeholder="Title"
                    multiline
                  />
                  {reviewing?.content_type === "plan" && (
                    <>
                      <Text style={styles.editLabel}>Tagline</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editedTagline}
                        onChangeText={setEditedTagline}
                        placeholder="Tagline"
                        multiline
                      />
                    </>
                  )}
                  <Text style={styles.editLabel}>
                    {reviewing?.content_type === "plan" ? "Overview" : reviewing?.content_type === "lesson" ? "Subtitle" : "Description"}
                  </Text>
                  <TextInput
                    style={[styles.editInput, { minHeight: 80 }]}
                    value={editedDesc}
                    onChangeText={setEditedDesc}
                    placeholder="Description / subtitle"
                    multiline
                  />
                  {/* Show read-only translated metadata fields */}
                  {reviewing?.metadata?.sections
                    ? (reviewing.metadata.sections as any[]).map((s: any, i: number) => (
                        <View key={i}>
                          <Text style={styles.editLabel}>{s.title || `Section ${i + 1}`}</Text>
                          <View style={styles.readonlyField}>
                            <Text style={styles.readonlyText}>{s.content ?? "(empty)"}</Text>
                          </View>
                        </View>
                      ))
                    : null}
                  {reviewing?.metadata?.questions
                    ? (reviewing.metadata.questions as any[]).map((q: any, i: number) => (
                        <View key={i}>
                          <Text style={styles.editLabel}>Q{i + 1}</Text>
                          <View style={styles.readonlyField}>
                            <Text style={styles.readonlyText}>{q.question ?? q ?? "(empty)"}</Text>
                          </View>
                        </View>
                      ))
                    : null}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Action buttons */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectBtn]}
              onPress={() => Alert.alert(
                "Reject Translation",
                "This will mark the translation as rejected. It won't be shown to users.",
                [{ text: "Cancel", style: "cancel" }, { text: "Reject", style: "destructive", onPress: () => updateStatus("rejected") }]
              )}
              disabled={saving}
            >
              <Ionicons name="close-circle" size={18} color="#EF4444" />
              <Text style={[styles.actionButtonText, { color: "#EF4444" }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.approveBtn]}
              onPress={() => updateStatus("approved")}
              disabled={saving}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.actionButtonText}>Approve & Publish</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SourceField({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.editLabel}>{label}</Text>
      <View style={styles.sourceField}>
        <Text style={styles.sourceText}>{value}</Text>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },

  header: { padding: 16, paddingBottom: 8 },
  pageTitle: { fontSize: 20, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  pageSubtitle: { fontSize: 13, color: "#666", fontFamily: "Inter_400Regular", marginTop: 2 },

  filterBar: { flexGrow: 0, paddingVertical: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB" },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 12, color: "#555", fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff" },
  chipDivider: { width: 1, backgroundColor: "#E5E7EB", marginHorizontal: 4 },

  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 13, color: "#999", fontFamily: "Inter_400Regular" },

  draftCard: {
    backgroundColor: "#fff", borderRadius: 12, padding: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  draftCardLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  typeBadge: { backgroundColor: colors.primaryGreen + "22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  typeBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primaryGreen },
  draftTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#222" },
  draftMeta: { fontSize: 11, color: "#999", fontFamily: "Inter_400Regular", marginTop: 1 },
  reviewBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  reviewBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  modalRoot: { flex: 1, backgroundColor: "#F9FAFB" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
  },
  closeBtn: { padding: 4 },
  modalTitle: { fontSize: 15, fontWeight: "600", color: "#222", fontFamily: "Inter_600SemiBold" },
  modalScroll: { flex: 1 },

  compareRow: { flexDirection: "row", gap: 12 },
  compareCol: { flex: 1, gap: 8 },
  compareLabel: { fontSize: 13, fontWeight: "700", color: "#333", fontFamily: "Inter_700Bold", marginBottom: 4 },

  sourceField: { backgroundColor: "#F3F4F6", borderRadius: 8, padding: 10 },
  sourceText: { fontSize: 13, color: "#444", lineHeight: 18, fontFamily: "Inter_400Regular" },
  noSrcText: { fontSize: 13, color: "#999", fontFamily: "Inter_400Regular", fontStyle: "italic" },

  editLabel: { fontSize: 11, color: "#888", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  editInput: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB",
    borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular", color: "#222",
  },
  readonlyField: { backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  readonlyText: { fontSize: 13, color: "#555", lineHeight: 18, fontFamily: "Inter_400Regular" },

  modalActions: {
    flexDirection: "row", gap: 12, padding: 16,
    backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB",
  },
  actionButton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 10, paddingVertical: 14,
  },
  actionButtonText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  rejectBtn: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  approveBtn: { backgroundColor: colors.primaryGreen },
});
