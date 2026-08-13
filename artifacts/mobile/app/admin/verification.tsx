import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Image, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Video, ResizeMode } from "expo-av";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

type Tab = "queue" | "history" | "stats";

interface QueueRow {
  applicationId: string; userId: string; username: string | null; displayName: string | null;
  photoUrl: string | null; country: string | null; method: string; submittedAt: string;
  attemptNumber: number; accountAgeDays: number | null;
}

interface ApplicationDetail {
  applicationId: string; userId: string; username: string | null; displayName: string | null;
  profilePhotoUrl: string | null; country: string | null; accountAgeDays: number | null;
  method: string; submissionUrl: string | null; status: string; submittedAt: string; attemptNumber: number;
}

interface HistoryRow {
  id: string; userId: string; username: string | null; displayName: string | null;
  action: string; actionByUsername: string | null; reason: string | null; createdAt: string;
}

interface Stats {
  totalVerified: number; pendingApplications: number; approvedThisWeek: number; declinedThisWeek: number;
  avgReviewHours: number; totalApplicationsAllTime: number; totalApprovalsAllTime: number;
  totalDeclinesAllTime: number; totalRevocationsAllTime: number; verificationRate: number;
}

const DECLINE_REASONS: Array<{ value: string; label: string }> = [
  { value: "face_mismatch", label: "Face does not clearly match profile photo" },
  { value: "image_unclear", label: "Image or video too dark or blurry" },
  { value: "no_note_visible", label: "Note not visible or incorrect username/date" },
  { value: "suspected_fake", label: "Suspected AI-generated or fake photo" },
  { value: "other", label: "Other" },
];

const ACTION_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  approved: { label: "Approved", icon: "checkmark-circle", color: colors.accentGreen },
  declined: { label: "Declined", icon: "close-circle", color: "#F87171" },
  revoked: { label: "Revoked", icon: "warning", color: "#F59E0B" },
  granted: { label: "Granted", icon: "gift", color: colors.accentGreen },
  submitted: { label: "Submitted", icon: "arrow-up-circle", color: colors.textMuted },
  withdrawn: { label: "Withdrawn", icon: "arrow-undo-circle", color: colors.textMuted },
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminVerificationScreen() {
  const [tab, setTab] = useState<Tab>("queue");

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [reviewApplicationId, setReviewApplicationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: "approved" | "declined"; username: string | null } | null>(null);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const res = await authedFetch("/admin/verification/queue");
      setQueue(res.ok ? await res.json() : []);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (q: string) => {
    setHistoryLoading(true);
    try {
      const res = await authedFetch(`/admin/verification/history${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      setHistoryRows(res.ok ? await res.json() : []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await authedFetch("/admin/verification/stats");
      setStats(res.ok ? await res.json() : null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "queue") loadQueue();
    if (tab === "history") loadHistory(historyQuery);
    if (tab === "stats") loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "history") return;
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(() => loadHistory(historyQuery), 300);
    return () => { if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current); };
  }, [historyQuery, tab, loadHistory]);

  async function openReview(applicationId: string) {
    setReviewApplicationId(applicationId);
    setDetail(null);
    setNotes("");
    setDecliningOpen(false);
    setOutcome(null);
    setDetailLoading(true);
    try {
      const res = await authedFetch(`/admin/verification/queue/${applicationId}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }

  function closeReview() {
    setReviewApplicationId(null);
    setDetail(null);
    setOutcome(null);
  }

  async function handleApprove() {
    if (!detail) return;
    setActing(true);
    try {
      const res = await authedFetch(`/admin/verification/approve/${detail.applicationId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      if (!res.ok) { const body = await res.json(); Alert.alert("Couldn't approve", body.error ?? "Something went wrong"); return; }
      setOutcome({ kind: "approved", username: detail.username });
      setQueue((prev) => prev.filter((q) => q.applicationId !== detail.applicationId));
    } finally {
      setActing(false);
    }
  }

  async function handleDecline(reason: string) {
    if (!detail) return;
    setActing(true);
    try {
      const res = await authedFetch(`/admin/verification/decline/${detail.applicationId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const body = await res.json(); Alert.alert("Couldn't decline", body.error ?? "Something went wrong"); return; }
      setOutcome({ kind: "declined", username: detail.username });
      setQueue((prev) => prev.filter((q) => q.applicationId !== detail.applicationId));
    } finally {
      setActing(false);
      setDecliningOpen(false);
    }
  }

  function reviewNext() {
    closeReview();
    if (queue.length > 0) openReview(queue[0].applicationId);
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {(["queue", "history", "stats"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.filterChip, tab === t && styles.filterChipActive]} onPress={() => setTab(t)}>
            <Text style={[styles.filterChipText, tab === t && styles.filterChipTextActive]}>
              {t === "queue" ? `Queue${queue.length ? ` (${queue.length})` : ""}` : t === "history" ? "History" : "Stats"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "queue" && (
        queueLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <FlatList
            data={queue}
            keyExtractor={(q) => q.applicationId}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-done-circle-outline" size={28} color={colors.accentGreen} />
                <Text style={styles.emptyText}>Queue is clear — no pending verification applications.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardUsername}>{item.username ? `@${item.username}` : "(no username)"}</Text>
                  <Text style={styles.cardSub}>{item.displayName ?? "Unnamed"}{item.country ? ` · ${item.country}` : ""}</Text>
                  <Text style={styles.cardSub}>{item.method === "video_selfie" ? "Video selfie" : "Selfie with note"} · Submitted {timeAgo(item.submittedAt)}</Text>
                  <Text style={styles.cardSub}>Account age: {item.accountAgeDays ?? "?"} days · Attempt {item.attemptNumber}</Text>
                </View>
                <TouchableOpacity style={styles.actionBtnOutline} onPress={() => openReview(item.applicationId)}>
                  <Text style={styles.actionBtnOutlineText}>Review →</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )
      )}

      {tab === "history" && (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={historyQuery}
              onChangeText={setHistoryQuery}
              placeholder="Search by username or name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
          </View>
          {historyLoading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
          ) : (
            <FlatList
              data={historyRows}
              keyExtractor={(h) => h.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.emptyText}>No verification history yet.</Text>}
              renderItem={({ item }) => {
                const meta = ACTION_LABELS[item.action] ?? { label: item.action, icon: "ellipse", color: colors.textMuted };
                return (
                  <View style={styles.historyRow}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardUsername}>{item.username ? `@${item.username}` : item.displayName ?? "Unknown"}</Text>
                      <Text style={styles.cardSub}>
                        {meta.label} · {new Date(item.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                        {item.actionByUsername ? ` · by @${item.actionByUsername}` : ""}
                      </Text>
                      {item.reason && <Text style={styles.reasonLine}>Reason: {item.reason}</Text>}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}

      {tab === "stats" && (
        statsLoading || !stats ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.statsSectionLabel}>CURRENT STATUS</Text>
            <StatRow label="Total verified users" value={stats.totalVerified} />
            <StatRow label="Pending applications" value={stats.pendingApplications} />
            <StatRow label="Verification rate" value={`${stats.verificationRate}%`} />
            <Text style={styles.statsSectionLabel}>THIS WEEK</Text>
            <StatRow label="Approved" value={stats.approvedThisWeek} />
            <StatRow label="Declined" value={stats.declinedThisWeek} />
            <Text style={styles.statsSectionLabel}>PROCESSING</Text>
            <StatRow label="Average review time" value={`${stats.avgReviewHours}h`} />
            <Text style={styles.statsSectionLabel}>ALL TIME</Text>
            <StatRow label="Total applications" value={stats.totalApplicationsAllTime} />
            <StatRow label="Total approvals" value={stats.totalApprovalsAllTime} />
            <StatRow label="Total declines" value={stats.totalDeclinesAllTime} />
            <StatRow label="Total revocations" value={stats.totalRevocationsAllTime} />
          </ScrollView>
        )
      )}

      <Modal visible={!!reviewApplicationId} animationType="slide" onRequestClose={closeReview}>
        <View style={styles.reviewContainer}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewTitle}>Verification Review</Text>
            <TouchableOpacity onPress={closeReview}><Ionicons name="close" size={22} color={colors.textDark} /></TouchableOpacity>
          </View>

          {detailLoading || !detail ? (
            <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
          ) : outcome ? (
            <View style={styles.outcomeWrap}>
              <Ionicons
                name={outcome.kind === "approved" ? "checkmark-circle" : "close-circle"}
                size={40}
                color={outcome.kind === "approved" ? colors.accentGreen : "#F87171"}
              />
              <Text style={styles.outcomeTitle}>{outcome.kind === "approved" ? "Verified ✓" : "Application declined."}</Text>
              <Text style={styles.outcomeBody}>
                {outcome.username ? `@${outcome.username} ` : "The applicant "}
                {outcome.kind === "approved"
                  ? "is now verified. They have been notified. The submission will be deleted in 48 hours."
                  : "has been notified with the reason. The submission has been deleted immediately. They can reapply after 7 days."}
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={reviewNext}>
                <Text style={styles.primaryBtnText}>Review Next Application →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.backLink} onPress={closeReview}><Text style={styles.backLinkText}>Close</Text></TouchableOpacity>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.reviewSubtitle}>
                {detail.username ? `@${detail.username}` : "(no username)"} · {detail.displayName ?? "Unnamed"} · {detail.country ?? "Unknown location"}
              </Text>
              <Text style={styles.cardSub}>Account age: {detail.accountAgeDays ?? "?"} days · Attempt {detail.attemptNumber}</Text>

              <View style={styles.mediaRow}>
                <View style={styles.mediaCol}>
                  <Text style={styles.mediaLabel}>PROFILE PHOTO</Text>
                  {detail.profilePhotoUrl ? (
                    <Image source={{ uri: detail.profilePhotoUrl }} style={styles.mediaImage} />
                  ) : (
                    <View style={styles.mediaPlaceholder}><Ionicons name="person" size={28} color={colors.textMuted} /></View>
                  )}
                </View>
                <View style={styles.mediaCol}>
                  <Text style={styles.mediaLabel}>SUBMISSION</Text>
                  {!detail.submissionUrl ? (
                    <View style={styles.mediaPlaceholder}><Ionicons name="alert-circle" size={28} color={colors.textMuted} /></View>
                  ) : detail.method === "video_selfie" ? (
                    <Video source={{ uri: detail.submissionUrl }} style={styles.mediaImage} useNativeControls resizeMode={ResizeMode.COVER} isLooping />
                  ) : (
                    <Image source={{ uri: detail.submissionUrl }} style={styles.mediaImage} />
                  )}
                </View>
              </View>

              <Text style={styles.cardSub}>Method: {detail.method === "video_selfie" ? "Video selfie" : "Selfie with note"}</Text>
              <Text style={styles.cardSub}>Submitted: {new Date(detail.submittedAt).toLocaleString()}</Text>

              <Text style={styles.mediaLabel}>REVIEWER NOTES (private — not shown to user)</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional notes for the audit record"
                placeholderTextColor={colors.textMuted}
                multiline
              />

              {!decliningOpen ? (
                <>
                  <TouchableOpacity style={styles.approveBtn} onPress={handleApprove} disabled={acting}>
                    {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>✓ Approve Verification</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.declineBtn} onPress={() => setDecliningOpen(true)} disabled={acting}>
                    <Text style={styles.declineBtnText}>✗ Decline</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.mediaLabel}>SELECT REASON</Text>
                  {DECLINE_REASONS.map((r) => (
                    <TouchableOpacity key={r.value} style={styles.reasonOption} onPress={() => handleDecline(r.value)} disabled={acting}>
                      <Ionicons name="radio-button-off" size={16} color={colors.textMuted} />
                      <Text style={styles.reasonOptionText}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.backLink} onPress={() => setDecliningOpen(false)}><Text style={styles.backLinkText}>Cancel</Text></TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { flexDirection: "row", gap: 8, flexWrap: "wrap", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  filterChipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  filterChipText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  filterChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyWrap: { alignItems: "center", gap: 8, marginTop: 40, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14,
  },
  cardUsername: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  actionBtnOutline: { borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  actionBtnOutlineText: { fontSize: 12, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, marginHorizontal: 14, marginTop: 12, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  historyRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14,
  },
  reasonLine: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: "italic", fontFamily: "Inter_400Regular" },
  statsSectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginTop: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter_700Bold" },
  statRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, marginBottom: 8,
  },
  statLabel: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  statValue: { fontSize: 15, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  reviewContainer: { flex: 1, backgroundColor: colors.lightCream },
  reviewHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  reviewTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  reviewSubtitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, marginBottom: 4, fontFamily: "Inter_600SemiBold" },
  mediaRow: { flexDirection: "row", gap: 12, marginTop: 14, marginBottom: 14 },
  mediaCol: { flex: 1 },
  mediaLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter_700Bold" },
  mediaImage: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: colors.card },
  mediaPlaceholder: {
    width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, alignItems: "center", justifyContent: "center",
  },
  notesInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    padding: 12, minHeight: 70, textAlignVertical: "top", color: colors.textDark, fontSize: 13,
    fontFamily: "Inter_400Regular", marginTop: 6, marginBottom: 16,
  },
  approveBtn: { backgroundColor: colors.accentGreen, borderRadius: 12, height: 50, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  declineBtn: { borderWidth: 1.5, borderColor: "#B91C1C", borderRadius: 12, height: 44, alignItems: "center", justifyContent: "center" },
  declineBtnText: { color: "#B91C1C", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  reasonOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  reasonOptionText: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  outcomeWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 10 },
  outcomeTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  outcomeBody: { fontSize: 13, color: colors.textMid, textAlign: "center", lineHeight: 19, marginBottom: 10, fontFamily: "Inter_400Regular" },
  primaryBtn: { backgroundColor: colors.accentGreen, borderRadius: 12, height: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  backLink: { alignItems: "center", marginTop: 14, paddingVertical: 6 },
  backLinkText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});