import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Modal, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";

// Admin PDF Plan Importer — upload one or more P2P Plan PDFs, preview the
// auto-extracted modules/lessons for a single file (or run a sequential
// bulk import for multiple), then confirm to insert as a draft plan.
//
// STEP 1 also requires picking which of the 10 plan-category collections
// (migration 054_plan_categories.sql) the plan(s) belong to before
// uploading — parentCategoryId is attached to every import from here.

type ParsedLesson = {
  title: string; orderIndex: number; memoryVerse: string; content: string;
  discussionQuestions: string; lifeAssignment: string; checkpoint: string;
};
type ParsedModule = { title: string; orderIndex: number; lessons: ParsedLesson[] };
type ParsedPlan = {
  title: string; description: string; subtitle: string; category: string;
  lectureIntro: string; modules: ParsedModule[];
  parentCategoryId?: string | null; topicNumber?: number | null;
};
type PlanCategory = { id: string; title: string; colorTheme: string; planCount: number };
type BulkResult = { filename: string; ok: boolean; title?: string; error?: string };

type Step = "upload" | "preview" | "importing" | "success" | "error";

async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

function pdfFormData(asset: DocumentPicker.DocumentPickerAsset): FormData {
  const form = new FormData();
  if (Platform.OS === "web" && asset.file) {
    form.append("pdf", asset.file, asset.name);
  } else {
    form.append("pdf", { uri: asset.uri, name: asset.name, type: asset.mimeType ?? "application/pdf" } as any);
  }
  return form;
}

async function uploadPdf(asset: DocumentPicker.DocumentPickerAsset): Promise<ParsedPlan> {
  const token = await getAuthToken();
  const res = await fetch(`${getApiUrl()}/admin/plans/upload-pdf`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: pdfFormData(asset),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to parse PDF");
  return data as ParsedPlan;
}

async function confirmImport(plan: ParsedPlan): Promise<{ id: string }> {
  const token = await getAuthToken();
  const res = await fetch(`${getApiUrl()}/admin/plans/confirm-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to import plan");
  return data as { id: string };
}

export default function PdfImportModal({ visible, onClose, onImported }: {
  visible: boolean; onClose: () => void; onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set([0]));
  const [errorMsg, setErrorMsg] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [importedTitle, setImportedTitle] = useState("");
  const [categories, setCategories] = useState<PlanCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCategoriesLoading(true);
    (async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch(`${getApiUrl()}/plans/categories`, { headers: { Authorization: `Bearer ${token}` } });
        const data = (await res.json()) as PlanCategory[];
        setCategories(Array.isArray(data) ? data : []);
      } catch {
        setCategories([]);
      } finally {
        setCategoriesLoading(false);
      }
    })();
  }, [visible]);

  function reset() {
    setStep("upload"); setPlan(null); setErrorMsg(""); setBulkProgress(null);
    setBulkResults(null); setImportedTitle(""); setExpandedModules(new Set([0]));
  }
  function close() { reset(); onClose(); }

  async function pickFiles() {
    if (!selectedCategoryId) return;
    const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf", multiple: true, copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets.length) return;

    const assets = result.assets.slice(0, 20);

    if (assets.length === 1) {
      setBusy(true);
      try {
        const parsed = await uploadPdf(assets[0]);
        parsed.parentCategoryId = selectedCategoryId;
        parsed.topicNumber = (selectedCategory?.planCount ?? 0) + 1;
        setPlan(parsed);
        setExpandedModules(new Set([0]));
        setStep("preview");
      } catch (e: any) {
        setErrorMsg(e.message ?? "Failed to parse PDF");
        setStep("error");
      } finally {
        setBusy(false);
      }
      return;
    }

    // Bulk mode: sequential parse + import, no per-file preview. Topic
    // numbers increment locally across the batch, continuing on from the
    // category's current plan count.
    setStep("importing");
    const results: BulkResult[] = [];
    let nextTopicNumber = (selectedCategory?.planCount ?? 0) + 1;
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      setBulkProgress({ current: i + 1, total: assets.length, filename: asset.name });
      try {
        const parsed = await uploadPdf(asset);
        parsed.parentCategoryId = selectedCategoryId;
        parsed.topicNumber = nextTopicNumber++;
        await confirmImport(parsed);
        results.push({ filename: asset.name, ok: true, title: parsed.title });
      } catch (e: any) {
        results.push({ filename: asset.name, ok: false, error: e.message ?? "Failed" });
      }
    }
    setBulkResults(results);
    setStep("success");
    if (results.some((r) => r.ok)) onImported();
  }

  async function handleConfirmImport() {
    if (!plan) return;
    setBusy(true);
    setErrorMsg("");
    try {
      await confirmImport(plan);
      setImportedTitle(plan.title);
      setStep("success");
      onImported();
    } catch (e: any) {
      setErrorMsg(e.message ?? "Failed to import plan");
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  function toggleModule(idx: number) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function updatePlanField<K extends keyof ParsedPlan>(field: K, value: ParsedPlan[K]) {
    setPlan((p) => (p ? { ...p, [field]: value } : p));
  }

  const lessonCount = plan ? plan.modules.reduce((n, m) => n + m.lessons.length, 0) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Import from PDF</Text>
            <TouchableOpacity onPress={close}><Ionicons name="close" size={22} color={colors.textMid} /></TouchableOpacity>
          </View>

          {step === "upload" && (
            <View style={styles.uploadBody}>
              <Ionicons name="document-attach-outline" size={40} color={colors.accentGreen} />
              <Text style={styles.uploadHint}>
                Choose one PDF to preview before importing, or select up to 20 to bulk-import them sequentially.
              </Text>

              <View style={{ width: "100%", gap: 8 }}>
                <Text style={styles.fieldLabel}>Category *</Text>
                {categoriesLoading ? (
                  <ActivityIndicator color={colors.accentGreen} size="small" />
                ) : (
                  <View style={styles.categoryChipRow}>
                    {categories.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[
                          styles.categoryChip,
                          { borderColor: c.colorTheme },
                          selectedCategoryId === c.id && { backgroundColor: c.colorTheme },
                        ]}
                        onPress={() => setSelectedCategoryId(c.id)}
                      >
                        <Text style={[styles.categoryChipText, { color: selectedCategoryId === c.id ? "#fff" : c.colorTheme }]}>
                          {c.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity style={[styles.primaryBtn, !selectedCategoryId && { opacity: 0.5 }]} onPress={pickFiles} disabled={busy || !selectedCategoryId}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                  <><Ionicons name="folder-open-outline" size={16} color="#fff" /><Text style={styles.primaryBtnText}>Choose PDF(s)</Text></>
                )}
              </TouchableOpacity>
            </View>
          )}

          {step === "importing" && (
            <View style={styles.uploadBody}>
              <ActivityIndicator color={colors.accentGreen} size="large" />
              {bulkProgress && (
                <Text style={styles.uploadHint}>
                  Importing {bulkProgress.current} of {bulkProgress.total}: {bulkProgress.filename}
                </Text>
              )}
            </View>
          )}

          {step === "preview" && plan && (
            <ScrollView style={styles.previewScroll} contentContainerStyle={{ gap: 14 }}>
              <PreviewField label="Title">
                <TextInput style={styles.input} value={plan.title} onChangeText={(v) => updatePlanField("title", v)} />
              </PreviewField>
              <PreviewField label="Subtitle">
                <TextInput style={styles.input} value={plan.subtitle} onChangeText={(v) => updatePlanField("subtitle", v)} />
              </PreviewField>
              <PreviewField label="Description">
                <TextInput style={[styles.input, { minHeight: 70 }]} value={plan.description} onChangeText={(v) => updatePlanField("description", v)} multiline textAlignVertical="top" />
              </PreviewField>
              <PreviewField label="Category">
                <TextInput style={styles.input} value={plan.category} onChangeText={(v) => updatePlanField("category", v)} autoCapitalize="none" />
              </PreviewField>

              <Text style={styles.structureSummary}>
                {plan.modules.length} module{plan.modules.length === 1 ? "" : "s"} · {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
              </Text>

              {plan.modules.map((mod, mi) => (
                <View key={mi} style={styles.moduleBlock}>
                  <TouchableOpacity style={styles.moduleHeaderRow} onPress={() => toggleModule(mi)}>
                    <Ionicons name={expandedModules.has(mi) ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMid} />
                    <Text style={styles.moduleHeaderText}>Module {mi + 1}: {mod.title}</Text>
                    <Text style={styles.moduleHeaderCount}>{mod.lessons.length}</Text>
                  </TouchableOpacity>
                  {expandedModules.has(mi) && (
                    <View style={styles.lessonList}>
                      {mod.lessons.map((lesson, li) => (
                        <Text key={li} style={styles.lessonRow} numberOfLines={1}>
                          {mi + 1}.{li + 1} {lesson.title}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              ))}

              <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.7 }]} onPress={handleConfirmImport} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                  <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.primaryBtnText}>Import as Draft</Text></>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === "success" && (
            <View style={styles.uploadBody}>
              <Ionicons name="checkmark-circle" size={40} color={colors.accentGreen} />
              {bulkResults ? (
                <ScrollView style={{ maxHeight: 260, width: "100%" }} contentContainerStyle={{ gap: 6 }}>
                  <Text style={styles.uploadHint}>
                    {bulkResults.filter((r) => r.ok).length} of {bulkResults.length} imported successfully.
                  </Text>
                  {bulkResults.map((r, i) => (
                    <View key={i} style={styles.bulkResultRow}>
                      <Ionicons name={r.ok ? "checkmark-circle-outline" : "close-circle-outline"} size={14} color={r.ok ? colors.accentGreen : "#B91C1C"} />
                      <Text style={styles.bulkResultText} numberOfLines={1}>
                        {r.ok ? (r.title ?? r.filename) : `${r.filename} — ${r.error}`}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.uploadHint}>"{importedTitle}" was imported as a draft plan.</Text>
              )}
              <View style={styles.successBtnRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={reset}>
                  <Text style={styles.secondaryBtnText}>Import another</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={close}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === "error" && (
            <View style={styles.uploadBody}>
              <Ionicons name="warning-outline" size={40} color="#B91C1C" />
              <Text style={styles.errorText}>{errorMsg}</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep("upload")}>
                <Text style={styles.primaryBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PreviewField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { width: "100%", maxWidth: 520, maxHeight: "85%", backgroundColor: "#fff", borderRadius: 18, padding: 20, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  uploadBody: { alignItems: "center", gap: 14, paddingVertical: 20 },
  uploadHint: { fontSize: 13, color: colors.textMid, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 19 },

  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.accentGreen, borderRadius: 12, height: 46, paddingHorizontal: 20 },
  primaryBtnText: { fontSize: 14, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, height: 46, paddingHorizontal: 20, borderWidth: 1, borderColor: colors.borderBeige },
  secondaryBtnText: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  successBtnRow: { flexDirection: "row", gap: 10 },

  previewScroll: { maxHeight: 500 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  input: { backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 10, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },

  structureSummary: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  moduleBlock: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, overflow: "hidden" },
  moduleHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: colors.cardBeige },
  moduleHeaderText: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  moduleHeaderCount: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  lessonList: { padding: 10, gap: 6 },
  lessonRow: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },

  bulkResultRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  bulkResultText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", flex: 1 },

  errorText: { fontSize: 13, color: "#B91C1C", textAlign: "center", fontFamily: "Inter_400Regular" },

  categoryChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  categoryChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
