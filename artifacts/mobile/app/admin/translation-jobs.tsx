import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";
import { apiFetch } from "@/lib/apiClient";
import { supabase } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/timeFormat";

// ── Types ──────────────────────────────────────────────────────────────────────

type JobRow = {
  id: string; content_type: string; content_id: string; language: string;
  status: string; attempts: number; max_attempts: number; last_error: string | null;
  triggered_by: string; ai_provider: string | null; ai_cost_usd: number | null;
  created_at: string; started_at: string | null; completed_at: string | null;
};

type StatusFilter = "all" | "pending" | "processing" | "completed" | "failed" | "retrying";

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B", processing: "#3B82F6", completed: "#10B981",
  failed: "#EF4444", retrying: "#8B5CF6",
};

const STATUS_ICONS: Record<string, any> = {
  pending: "time-outline", processing: "sync", completed: "checkmark-circle",
  failed: "alert-circle", retrying: "refresh-circle",
};

const LANG_NAMES: Record<string, string> = {
  de: "German", es: "Spanish", fr: "French", pt: "Portuguese",
  zh: "Chinese", ar: "Arabic", he: "Hebrew", ru: "Russian",
};


// ── Component ──────────────────────────────────────────────────────────────────

export default function TranslationJobsScreen() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);

  const PAGE_SIZE = 40;

  const loadJobs = useCallback(async (pg = 0, f = filter) => {
    setLoading(true);
    try {
      const from = pg * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from("p2p_translation_jobs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (f !== "all") q = q.eq("status", f);
      const { data, count, error } = await q;
      if (error) throw error;
      if (pg === 0) setJobs((data ?? []) as JobRow[]);
      else setJobs((prev) => [...prev, ...(data ?? []) as JobRow[]]);
      setTotal(count ?? 0);
      setPage(pg);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadJobs(0, filter); }, [filter]);

  async function retryJobAction(jobId: string) {
    setRetrying(jobId);
    try {
      const res = await apiFetch(`/translations/admin/retry/${jobId}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadJobs(0, filter);
    } catch (e: any) {
      showAlert("Retry failed", e.message);
    } finally {
      setRetrying(null);
    }
  }

  const statusTabs: StatusFilter[] = ["all", "pending", "processing", "failed", "retrying", "completed"];

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Translation Jobs</Text>
        <Text style={styles.pageSubtitle}>{total} total jobs</Text>
      </View>

      {/* ── Status filter tabs ── */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={styles.tabBar} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}
      >
        {statusTabs.map((s) => (
          <TouchableOpacity accessibilityRole="button"
            key={s}
            style={[styles.tab, filter === s && { backgroundColor: STATUS_COLORS[s] ?? colors.primaryGreen }]}
            onPress={() => setFilter(s)}
          >
            {s !== "all" && (
              <Ionicons
                name={STATUS_ICONS[s]}
                size={12}
                color={filter === s ? "#fff" : (STATUS_COLORS[s] ?? "#555")}
              />
            )}
            <Text style={[styles.tabText, filter === s && styles.tabTextActive]}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Job list ── */}
      {loading && jobs.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : jobs.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="document-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No jobs found</Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          onEndReached={() => {
            if (jobs.length < total && !loading) loadJobs(page + 1);
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loading && jobs.length > 0 ? <ActivityIndicator color={colors.primaryGreen} style={{ marginVertical: 12 }} /> : null
          }
          renderItem={({ item }) => (
            <View style={styles.jobCard}>
              {/* Top row: status + type + language */}
              <View style={styles.jobTopRow}>
                <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] ?? "#999") + "22" }]}>
                  <Ionicons name={STATUS_ICONS[item.status]} size={12} color={STATUS_COLORS[item.status] ?? "#999"} />
                  <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] ?? "#999" }]}>
                    {item.status}
                  </Text>
                </View>
                <Text style={styles.jobType}>{item.content_type}</Text>
                <Text style={styles.jobLang}>
                  {LANG_NAMES[item.language] ?? item.language.toUpperCase()}
                </Text>
                <Text style={styles.jobAttempts}>
                  {item.attempts}/{item.max_attempts} attempts
                </Text>
              </View>

              {/* Content ID */}
              <Text style={styles.jobId} numberOfLines={1}>{item.content_id}</Text>

              {/* Cost + time */}
              <View style={styles.jobMetaRow}>
                {item.ai_cost_usd !== null ? (
                  <Text style={styles.jobMeta}>${item.ai_cost_usd.toFixed(4)}</Text>
                ) : null}
                <Text style={styles.jobMeta}>{formatDate(item.created_at, "dateTime", { empty: "—" })}</Text>
                {item.triggered_by !== "admin" ? (
                  <Text style={styles.jobMeta}>by {item.triggered_by}</Text>
                ) : null}
              </View>

              {/* Error (if failed) */}
              {item.last_error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText} numberOfLines={2}>{item.last_error}</Text>
                </View>
              ) : null}

              {/* Retry button (if failed or retrying) */}
              {(item.status === "failed") && item.attempts < item.max_attempts ? (
                <AppButton label="Retry" onPress={() => retryJobAction(item.id)} variant="outline" size="sm" icon="refresh" disabled={!!retrying} loading={retrying === item.id} style={{ alignSelf: "flex-start", marginTop: 2 }} palette="fixedLight" />
              ) : item.status === "failed" ? (
                <Text style={styles.maxAttemptsText}>Max attempts reached</Text>
              ) : null}
            </View>
          )}
        />
      )}
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

  tabBar: { flexGrow: 0, paddingVertical: 8 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB",
  },
  tabText: { fontSize: 12, color: "#555", fontFamily: "Inter_500Medium" },
  tabTextActive: { color: "#fff" },

  emptyText: { fontSize: 14, color: "#999", fontFamily: "Inter_400Regular" },

  jobCard: {
    backgroundColor: "#fff", borderRadius: 12, padding: 12, gap: 6,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  jobTopRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  jobType: { fontSize: 12, color: "#555", fontFamily: "Inter_500Medium", backgroundColor: "#F3F4F6", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  jobLang: { fontSize: 12, color: "#555", fontFamily: "Inter_500Medium" },
  jobAttempts: { fontSize: 11, color: "#999", fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  jobId: { fontSize: 11, color: "#aaa", fontFamily: "Inter_400Regular", fontVariant: ["tabular-nums"] },
  jobMetaRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  jobMeta: { fontSize: 11, color: "#888", fontFamily: "Inter_400Regular" },

  errorBox: { backgroundColor: "#FEF2F2", borderRadius: 6, padding: 8 },
  errorText: { fontSize: 11, color: "#DC2626", fontFamily: "Inter_400Regular", lineHeight: 16 },
  maxAttemptsText: { fontSize: 11, color: "#999", fontFamily: "Inter_400Regular", fontStyle: "italic" },
});
