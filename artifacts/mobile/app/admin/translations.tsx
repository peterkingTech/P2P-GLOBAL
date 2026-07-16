import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { getApiUrl } from "@/lib/apiUrl";

// ── Types ──────────────────────────────────────────────────────────────────────

type Language = { code: string; name_en: string; flag_emoji: string | null };
type CoverageRow = {
  code: string; name: string;
  modules: { total: number; approved: number; draft: number };
  lessons: { total: number; approved: number; draft: number };
};
type JobCounts = { pending: number; processing: number; failed: number; retrying: number };

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function TranslationsDashboard() {
  const router = useRouter();

  const [languages, setLanguages] = useState<Language[]>([]);
  const [coverage, setCoverage] = useState<Map<string, CoverageRow>>(new Map());
  const [jobCounts, setJobCounts] = useState<JobCounts>({ pending: 0, processing: 0, failed: 0, retrying: 0 });
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [batchModal, setBatchModal] = useState(false);
  const [curricula, setCurricula] = useState<Array<{ id: string; title: string }>>([]);
  const [batchLang, setBatchLang] = useState("");
  const [batchCurriculum, setBatchCurriculum] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: langs }, { data: mods }, { data: lessons }, { data: trans }, { data: jobs }, { data: drafts }] =
        await Promise.all([
          supabase.from("p2p_languages").select("code,name_en,flag_emoji").neq("code", "en").order("name_en"),
          supabase.from("p2p_modules").select("id", { count: "exact", head: true }),
          supabase.from("p2p_lessons").select("id", { count: "exact", head: true }),
          supabase.from("p2p_content_translations").select("language_code,content_type,status"),
          supabase.from("p2p_translation_jobs").select("status"),
          supabase.from("p2p_content_translations").select("id", { count: "exact", head: true }).eq("status", "draft"),
        ]);

      const totalMods = (mods as any)?.count ?? 0;
      const totalLess = (lessons as any)?.count ?? 0;

      // Build coverage map from fetched translations
      const map = new Map<string, CoverageRow>();
      for (const lang of (langs ?? []) as Language[]) {
        map.set(lang.code, {
          code: lang.code, name: lang.name_en,
          modules: { total: totalMods, approved: 0, draft: 0 },
          lessons: { total: totalLess, approved: 0, draft: 0 },
        });
      }
      for (const row of (trans ?? []) as { language_code: string; content_type: string; status: string }[]) {
        const entry = map.get(row.language_code);
        if (!entry) continue;
        if (row.content_type === "module") {
          if (row.status === "approved") entry.modules.approved++;
          else if (row.status === "draft") entry.modules.draft++;
        } else if (row.content_type === "lesson") {
          if (row.status === "approved") entry.lessons.approved++;
          else if (row.status === "draft") entry.lessons.draft++;
        }
      }

      const counts = { pending: 0, processing: 0, failed: 0, retrying: 0 };
      for (const j of (jobs ?? []) as { status: string }[]) {
        if (j.status in counts) counts[j.status as keyof typeof counts]++;
      }

      setLanguages((langs ?? []) as Language[]);
      setCoverage(map);
      setJobCounts(counts);
      setReviewCount((drafts as any)?.count ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load curricula for batch modal
  useEffect(() => {
    if (!batchModal) return;
    supabase.from("p2p_curriculums").select("id,title").then(({ data }) => {
      setCurricula((data ?? []) as { id: string; title: string }[]);
    });
  }, [batchModal]);

  async function runBatchTranslation() {
    if (!batchCurriculum || !batchLang) return Alert.alert("Select both curriculum and language");
    setBatchRunning(true);
    setBatchProgress("Starting…");
    try {
      const token = await getAuthToken();
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/translations/admin/batch-curriculum`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ curriculumId: batchCurriculum, lang: batchLang }),
      });
      const text = await res.text();
      // Parse SSE response
      const lastDataLine = text.split("\n").filter(l => l.startsWith("data:")).pop();
      const lastData = lastDataLine ? JSON.parse(lastDataLine.slice(5).trim()) : {};
      if (lastData.error) throw new Error(lastData.error);
      const s = lastData.stats ?? lastData;
      setBatchProgress(`Done: ${s.done} translated, ${s.skipped} skipped, ${s.failed} failed`);
      await load();
    } catch (e: any) {
      setBatchProgress(`Error: ${e.message}`);
    } finally {
      setBatchRunning(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primaryGreen} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Header row ── */}
      <View style={styles.headerRow}>
        <Text style={styles.pageTitle}>Translation Dashboard</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={load}>
          <Ionicons name="refresh" size={16} color={colors.primaryGreen} />
        </TouchableOpacity>
      </View>

      {/* ── Status cards ── */}
      <View style={styles.cardsRow}>
        <StatCard label="Pending" value={jobCounts.pending} color="#F59E0B" icon="time" />
        <StatCard label="Processing" value={jobCounts.processing} color="#3B82F6" icon="sync" />
        <StatCard label="Failed" value={jobCounts.failed} color="#EF4444" icon="alert-circle" />
        <StatCard label="Review Queue" value={reviewCount} color={colors.primaryGreen} icon="checkmark-circle" />
      </View>

      {/* ── Quick actions ── */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.push("/admin/translation-review" as any)}
        >
          <Ionicons name="eye-outline" size={15} color={colors.cream} />
          <Text style={styles.actionBtnText}>Review Queue ({reviewCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => router.push("/admin/translation-jobs" as any)}
        >
          <Ionicons name="list" size={15} color={colors.primaryGreen} />
          <Text style={[styles.actionBtnText, { color: colors.primaryGreen }]}>Job Log</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => setBatchModal(true)}
        >
          <Ionicons name="flash" size={15} color={colors.primaryGreen} />
          <Text style={[styles.actionBtnText, { color: colors.primaryGreen }]}>Translate Curriculum</Text>
        </TouchableOpacity>
      </View>

      {/* ── Language coverage grid ── */}
      <Text style={styles.sectionTitle}>Language Coverage</Text>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.tableCell, styles.tableCellLang, styles.tableHeaderText]}>Language</Text>
          <Text style={[styles.tableCell, styles.tableCellNum, styles.tableHeaderText]}>Modules</Text>
          <Text style={[styles.tableCell, styles.tableCellNum, styles.tableHeaderText]}>Lessons</Text>
          <Text style={[styles.tableCell, styles.tableCellAction]} />
        </View>
        {languages.map((lang) => {
          const cov = coverage.get(lang.code);
          const modPct = pct(cov?.modules.approved ?? 0, cov?.modules.total ?? 1);
          const lesPct = pct(cov?.lessons.approved ?? 0, cov?.lessons.total ?? 1);
          const modDraft = cov?.modules.draft ?? 0;
          const lesDraft = cov?.lessons.draft ?? 0;
          return (
            <View key={lang.code} style={styles.tableRow}>
              <View style={[styles.tableCell, styles.tableCellLang, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                {lang.flag_emoji ? <Text style={{ fontSize: 16 }}>{lang.flag_emoji}</Text> : null}
                <Text style={styles.langName}>{lang.name_en}</Text>
                <Text style={styles.langCode}>({lang.code})</Text>
              </View>
              <View style={[styles.tableCell, styles.tableCellNum]}>
                <CoverageBar pct={modPct} draft={modDraft} total={cov?.modules.total ?? 0} />
              </View>
              <View style={[styles.tableCell, styles.tableCellNum]}>
                <CoverageBar pct={lesPct} draft={lesDraft} total={cov?.lessons.total ?? 0} />
              </View>
              <TouchableOpacity
                style={[styles.tableCell, styles.tableCellAction, styles.translateBtn]}
                onPress={() => {
                  setBatchLang(lang.code);
                  setBatchModal(true);
                }}
              >
                <Ionicons name="flash" size={12} color={colors.primaryGreen} />
              </TouchableOpacity>
            </View>
          );
        })}
        {languages.length === 0 && (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No languages configured. Run migration 002 in Supabase.</Text>
          </View>
        )}
      </View>

      {/* ── Batch translate modal ── */}
      <Modal visible={batchModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Translate Curriculum</Text>

            <Text style={styles.modalLabel}>Curriculum</Text>
            <ScrollView style={styles.pickerScroll} nestedScrollEnabled>
              {curricula.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pickerItem, batchCurriculum === c.id && styles.pickerItemActive]}
                  onPress={() => setBatchCurriculum(c.id)}
                >
                  <Text style={[styles.pickerItemText, batchCurriculum === c.id && styles.pickerItemTextActive]}>
                    {c.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.modalLabel}>Target Language</Text>
            <ScrollView style={styles.pickerScroll} nestedScrollEnabled>
              {languages.map((l) => (
                <TouchableOpacity
                  key={l.code}
                  style={[styles.pickerItem, batchLang === l.code && styles.pickerItemActive]}
                  onPress={() => setBatchLang(l.code)}
                >
                  <Text style={[styles.pickerItemText, batchLang === l.code && styles.pickerItemTextActive]}>
                    {l.flag_emoji} {l.name_en}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {batchProgress ? (
              <View style={styles.progressBox}>
                <Text style={styles.progressText}>{batchProgress}</Text>
              </View>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => { setBatchModal(false); setBatchProgress(null); setBatchCurriculum(""); }}
                disabled={batchRunning}
              >
                <Text style={[styles.modalBtnText, { color: "#666" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary, batchRunning && styles.modalBtnDisabled]}
                onPress={runBatchTranslation}
                disabled={batchRunning}
              >
                {batchRunning
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalBtnText}>Translate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: {
  label: string; value: number; color: string; icon: any;
}) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CoverageBar({ pct: p, draft, total }: { pct: number; draft: number; total: number }) {
  return (
    <View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${p}%` as any }]} />
      </View>
      <Text style={styles.barLabel}>{p}% approved{draft > 0 ? ` · ${draft} draft` : ""}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 16, gap: 0 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  pageTitle: { fontSize: 20, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  refreshBtn: { padding: 6 },

  cardsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  statCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 10,
    borderLeftWidth: 3, alignItems: "center", gap: 2,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  statValue: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, color: "#666", textAlign: "center", fontFamily: "Inter_500Medium" },

  actionsRow: { flexDirection: "row", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.primaryGreen, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  actionBtnSecondary: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: colors.primaryGreen,
  },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#333", marginBottom: 8, fontFamily: "Inter_700Bold" },

  table: { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", marginBottom: 24 },
  tableRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  tableHeader: { backgroundColor: "#F9FAFB" },
  tableHeaderText: { fontFamily: "Inter_600SemiBold", color: "#555", fontSize: 11 },
  tableCell: { padding: 10 },
  tableCellLang: { flex: 2 },
  tableCellNum: { flex: 2 },
  tableCellAction: { width: 36, alignItems: "center", justifyContent: "center" },
  translateBtn: { padding: 6 },
  langName: { fontSize: 13, color: "#222", fontFamily: "Inter_500Medium" },
  langCode: { fontSize: 11, color: "#999", fontFamily: "Inter_400Regular" },
  emptyRow: { padding: 16 },
  emptyText: { color: "#999", fontSize: 13, textAlign: "center" },

  barTrack: { height: 6, backgroundColor: "#E5E7EB", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: colors.primaryGreen, borderRadius: 3 },
  barLabel: { fontSize: 10, color: "#666", marginTop: 2, fontFamily: "Inter_400Regular" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  modalBox: { backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#222", fontFamily: "Inter_700Bold", marginBottom: 4 },
  modalLabel: { fontSize: 13, color: "#555", fontFamily: "Inter_600SemiBold" },
  pickerScroll: { maxHeight: 140, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8 },
  pickerItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  pickerItemActive: { backgroundColor: colors.primaryGreen + "22" },
  pickerItemText: { fontSize: 13, color: "#333", fontFamily: "Inter_400Regular" },
  pickerItemTextActive: { color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  progressBox: { backgroundColor: "#F3F4F6", borderRadius: 8, padding: 10 },
  progressText: { fontSize: 12, color: "#555", fontFamily: "Inter_400Regular" },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: { flex: 1, borderRadius: 8, padding: 12, alignItems: "center" },
  modalBtnPrimary: { backgroundColor: colors.primaryGreen },
  modalBtnSecondary: { borderWidth: 1, borderColor: "#E5E7EB" },
  modalBtnDisabled: { opacity: 0.5 },
  modalBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
