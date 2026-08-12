import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Modal, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";
import { listPlanCategories, createPlanCategory, type AdminPlanCategory } from "@/lib/adminPlanCategories";

// Admin PDF Plan Importer — upload one or more P2P Plan PDFs, then assign
// each to a plan category (auto-detected from the PDF's text where
// possible), preview the extracted modules/lessons for a single file (or
// run a per-file reviewed bulk import for multiple), then confirm to
// insert as a draft plan.
//
// Flow: upload (pick files, no gate) -> parsing -> category step (single
// file) / bulk-category review (2+ files) -> preview (single) / importing
// -> success.

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
type BulkResult = { filename: string; ok: boolean; title?: string; error?: string };
type BulkRow = {
  asset: DocumentPicker.DocumentPickerAsset;
  parsed: ParsedPlan | null;
  parseError: string | null;
  categoryId: string | null;
  detected: boolean;
};

type Step = "upload" | "parsing" | "category" | "preview" | "bulk-category" | "importing" | "success" | "error";

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
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [bulkImportProgress, setBulkImportProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [importedTitle, setImportedTitle] = useState("");
  const [categories, setCategories] = useState<AdminPlanCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);

  async function loadCategories(): Promise<AdminPlanCategory[]> {
    setCategoriesLoading(true);
    try {
      const data = await listPlanCategories();
      setCategories(data);
      return data;
    } catch {
      setCategories([]);
      return [];
    } finally {
      setCategoriesLoading(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    loadCategories();
  }, [visible]);

  function reset() {
    setStep("upload"); setPlan(null); setErrorMsg(""); setParseProgress(null); setBulkImportProgress(null);
    setBulkResults(null); setImportedTitle(""); setExpandedModules(new Set([0]));
    setSelectedCategoryId(null); setCreatingCategory(false); setNewCategoryTitle(""); setBulkRows([]);
  }
  function close() { reset(); onClose(); }

  function detectCategoryId(cats: AdminPlanCategory[], slug: string): string | null {
    if (!slug) return null;
    return cats.find((c) => c.category === slug)?.id ?? null;
  }

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf", multiple: true, copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets.length) return;
    const assets = result.assets.slice(0, 20);
    const cats = categories.length ? categories : await loadCategories();

    if (assets.length === 1) {
      setStep("parsing");
      try {
        const parsed = await uploadPdf(assets[0]);
        setPlan(parsed);
        setSelectedCategoryId(detectCategoryId(cats, parsed.category));
        setExpandedModules(new Set([0]));
        setStep("category");
      } catch (e: any) {
        setErrorMsg(e.message ?? "Failed to parse PDF");
        setStep("error");
      }
      return;
    }

    // Bulk mode: parse every file first, then show one review screen where
    // each row gets its own (auto-detected, admin-adjustable) category.
    setStep("parsing");
    const rows: BulkRow[] = [];
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      setParseProgress({ current: i + 1, total: assets.length, filename: asset.name });
      try {
        const parsed = await uploadPdf(asset);
        const detectedId = detectCategoryId(cats, parsed.category);
        rows.push({ asset, parsed, parseError: null, categoryId: detectedId, detected: !!detectedId });
      } catch (e: any) {
        rows.push({ asset, parsed: null, parseError: e.message ?? "Failed to parse", categoryId: null, detected: false });
      }
    }
    setBulkRows(rows);
    setParseProgress(null);
    setStep("bulk-category");
  }

  async function handleCreateCategory(applyTo: "single" | number) {
    if (!newCategoryTitle.trim()) return;
    setCategoryBusy(true);
    try {
      const cat = await createPlanCategory({ title: newCategoryTitle.trim() });
      setCategories((prev) => [...prev, cat]);
      if (applyTo === "single") setSelectedCategoryId(cat.id);
      else setBulkRows((prev) => prev.map((r, i) => (i === applyTo ? { ...r, categoryId: cat.id, detected: false } : r)));
      setCreatingCategory(false);
      setNewCategoryTitle("");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Failed to create category");
    } finally {
      setCategoryBusy(false);
    }
  }

  function proceedToPreview() {
    if (!plan || !selectedCategoryId) return;
    const cat = categories.find((c) => c.id === selectedCategoryId);
    setPlan({ ...plan, parentCategoryId: selectedCategoryId, category: cat?.category ?? plan.category, topicNumber: (cat?.planCount ?? 0) + 1 });
    setStep("preview");
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

  async function handleBulkImportAll() {
    setStep("importing");
    const results: BulkResult[] = [];
    // Topic numbers increment per-category as multiple rows in this batch
    // can target the same category.
    const nextTopicByCategory = new Map<string, number>();
    for (const cat of categories) nextTopicByCategory.set(cat.id, cat.planCount + 1);

    for (let i = 0; i < bulkRows.length; i++) {
      const row = bulkRows[i];
      setBulkImportProgress({ current: i + 1, total: bulkRows.length, filename: row.asset.name });
      if (!row.parsed || !row.categoryId) {
        results.push({ filename: row.asset.name, ok: false, error: row.parseError ?? "No category assigned" });
        continue;
      }
      const cat = categories.find((c) => c.id === row.categoryId);
      const topicNumber = nextTopicByCategory.get(row.categoryId) ?? 1;
      nextTopicByCategory.set(row.categoryId, topicNumber + 1);
      try {
        const toImport: ParsedPlan = { ...row.parsed, parentCategoryId: row.categoryId, category: cat?.category ?? row.parsed.category, topicNumber };
        await confirmImport(toImport);
        results.push({ filename: row.asset.name, ok: true, title: row.parsed.title });
      } catch (e: any) {
        results.push({ filename: row.asset.name, ok: false, error: e.message ?? "Failed" });
      }
    }
    setBulkResults(results);
    setStep("success");
    if (results.some((r) => r.ok)) onImported();
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
  const bulkAssignedCount = bulkRows.filter((r) => r.parsed && r.categoryId).length;
  const bulkNeedsCategoryCount = bulkRows.filter((r) => r.parsed && !r.categoryId).length;

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
                Choose one PDF to preview before importing, or select up to 20 to bulk-import them. You'll assign a category to each on the next step.
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={pickFiles} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                  <><Ionicons name="folder-open-outline" size={16} color="#fff" /><Text style={styles.primaryBtnText}>Choose PDF(s)</Text></>
                )}
              </TouchableOpacity>
            </View>
          )}

          {step === "parsing" && (
            <View style={styles.uploadBody}>
              <ActivityIndicator color={colors.accentGreen} size="large" />
              {parseProgress ? (
                <Text style={styles.uploadHint}>
                  Parsing {parseProgress.current} of {parseProgress.total}: {parseProgress.filename}
                </Text>
              ) : (
                <Text style={styles.uploadHint}>Parsing PDF…</Text>
              )}
            </View>
          )}

          {step === "category" && plan && (
            <ScrollView contentContainerStyle={{ gap: 14 }}>
              <Text style={styles.uploadHint}>
                {selectedCategoryId
                  ? "We detected a likely category for this plan. Change it if needed."
                  : "We couldn't detect a category automatically — choose one below."}
              </Text>
              {categoriesLoading ? (
                <ActivityIndicator color={colors.accentGreen} />
              ) : (
                <View style={styles.categoryChipRow}>
                  {categories.map((c) => {
                    const selected = selectedCategoryId === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.categoryChip, { borderColor: c.colorTheme }, selected && { backgroundColor: c.colorTheme }]}
                        onPress={() => setSelectedCategoryId(c.id)}
                      >
                        {selected && <Ionicons name="checkmark-circle" size={13} color="#fff" style={{ marginRight: 4 }} />}
                        <Text style={[styles.categoryChipText, { color: selected ? "#fff" : c.colorTheme }]}>{c.icon ? `${c.icon} ` : ""}{c.title}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {creatingCategory ? (
                <View style={styles.inlineCreateRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={newCategoryTitle} onChangeText={setNewCategoryTitle} placeholder="New category title" placeholderTextColor={colors.textMuted} autoFocus />
                  <TouchableOpacity onPress={() => handleCreateCategory("single")} disabled={categoryBusy || !newCategoryTitle.trim()}>
                    {categoryBusy ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name="checkmark-circle" size={24} color={colors.accentGreen} />}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addInlineBtn} onPress={() => setCreatingCategory(true)}>
                  <Ionicons name="add" size={14} color={colors.accentGreen} />
                  <Text style={styles.addInlineText}>Create a New Category</Text>
                </TouchableOpacity>
              )}

              {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

              <TouchableOpacity style={[styles.primaryBtn, !selectedCategoryId && { opacity: 0.5 }]} onPress={proceedToPreview} disabled={!selectedCategoryId}>
                <Text style={styles.primaryBtnText}>Continue to Preview</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === "bulk-category" && (
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.uploadHint}>Assign a category to each file. Rows with a dashed border couldn't be auto-detected.</Text>
              {bulkRows.map((row, idx) => (
                <View key={idx} style={[styles.bulkRow, !row.categoryId && !row.parseError && styles.bulkRowWarn]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name={row.parseError ? "close-circle-outline" : row.categoryId ? "checkmark-circle-outline" : "warning-outline"} size={15} color={row.parseError ? "#B91C1C" : row.categoryId ? colors.accentGreen : "#B45309"} />
                    <Text style={styles.bulkRowTitle} numberOfLines={1}>{row.parsed?.title ?? row.asset.name}</Text>
                  </View>
                  {row.parseError ? (
                    <Text style={styles.bulkRowError}>{row.parseError}</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                      {categories.map((c) => {
                        const selected = row.categoryId === c.id;
                        return (
                          <TouchableOpacity
                            key={c.id}
                            style={[styles.categoryChipSm, { borderColor: c.colorTheme }, selected && { backgroundColor: c.colorTheme }]}
                            onPress={() => setBulkRows((prev) => prev.map((r, i) => (i === idx ? { ...r, categoryId: c.id, detected: false } : r)))}
                          >
                            <Text style={[styles.categoryChipTextSm, { color: selected ? "#fff" : c.colorTheme }]}>{c.icon ? `${c.icon} ` : ""}{c.title}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              ))}

              {creatingCategory ? (
                <View style={styles.inlineCreateRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={newCategoryTitle} onChangeText={setNewCategoryTitle} placeholder="New category title" placeholderTextColor={colors.textMuted} autoFocus />
                  <TouchableOpacity onPress={() => handleCreateCategory("single")} disabled={categoryBusy || !newCategoryTitle.trim()}>
                    {categoryBusy ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name="checkmark-circle" size={24} color={colors.accentGreen} />}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addInlineBtn} onPress={() => setCreatingCategory(true)}>
                  <Ionicons name="add" size={14} color={colors.accentGreen} />
                  <Text style={styles.addInlineText}>Create a New Category</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, bulkNeedsCategoryCount > 0 && { opacity: 0.5 }]}
                onPress={handleBulkImportAll}
                disabled={bulkNeedsCategoryCount > 0}
              >
                <Text style={styles.primaryBtnText}>
                  Import All ({bulkAssignedCount} assigned{bulkNeedsCategoryCount > 0 ? `, ${bulkNeedsCategoryCount} need${bulkNeedsCategoryCount === 1 ? "s" : ""} category` : ""})
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === "importing" && (
            <View style={styles.uploadBody}>
              <ActivityIndicator color={colors.accentGreen} size="large" />
              {bulkImportProgress && (
                <Text style={styles.uploadHint}>
                  Importing {bulkImportProgress.current} of {bulkImportProgress.total}: {bulkImportProgress.filename}
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
                <TouchableOpacity style={styles.changeCategoryRow} onPress={() => setStep("category")}>
                  <Text style={styles.changeCategoryText}>
                    {categories.find((c) => c.id === plan.parentCategoryId)?.title ?? "None selected"}
                  </Text>
                  <Text style={styles.changeCategoryLink}>Change</Text>
                </TouchableOpacity>
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

  changeCategoryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 10 },
  changeCategoryText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_500Medium" },
  changeCategoryLink: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

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
  categoryChip: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  categoryChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  categoryChipSm: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  categoryChipTextSm: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  inlineCreateRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  addInlineBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  addInlineText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  bulkRow: { gap: 8, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 10 },
  bulkRowWarn: { borderColor: "#B45309", borderStyle: "dashed" },
  bulkRowTitle: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  bulkRowError: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_400Regular" },
});