import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, TextInput, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import {
  getKingdomWinsAdminQueue, moderateKingdomWin, KINGDOM_CATEGORY_LABELS, IMPACT_THEME_LABELS,
  type KingdomWin,
} from "@/lib/kingdomWinsApi";

type QueueStatus = "submitted" | "published" | "rejected" | "archived";

// Pre-publication review queue for P2P Impact (and any other Kingdom
// Wins entry submitted for review) — additive to the existing REACTIVE
// report/flag queue at app/admin/moderation.tsx, which stays untouched
// and still handles post-publication reports for kingdom_win content.
// This screen is the new, separate PRE-publication approve/reject/archive
// flow required for P2P Impact submissions (routes/kingdomWins.ts
// GET /admin/queue, POST /:id/moderate).
const STATUS_FILTERS: Array<{ value: QueueStatus; label: string }> = [
  { value: "submitted", label: "Pending" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function KingdomWinsReviewScreen() {
  const [statusFilter, setStatusFilter] = useState<QueueStatus>("submitted");
  const [entries, setEntries] = useState<KingdomWin[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await getKingdomWinsAdminQueue(statusFilter)); }
    catch (e: any) { showAlert("Couldn't load queue", e.message ?? "Please try again."); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function act(entry: KingdomWin, action: "approve" | "reject" | "archive") {
    setActing(entry.id);
    try {
      await moderateKingdomWin(entry.id, action, noteDrafts[entry.id]);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (e: any) {
      showAlert("Couldn't complete action", e.message ?? "Please try again.");
    } finally {
      setActing(null);
    }
  }

  function confirmAction(entry: KingdomWin, action: "approve" | "reject" | "archive") {
    const copy: Record<string, { title: string; body: string }> = {
      approve: { title: "Publish this story?", body: "It will become visible to the entire authenticated P2P community." },
      reject: { title: "Reject this submission?", body: "The author will be notified and can revise it." },
      archive: { title: "Archive this story?", body: "It will no longer be publicly visible, but the record is kept." },
    };
    Alert.alert(copy[action].title, copy[action].body, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: action === "reject" ? "destructive" : "default", onPress: () => act(entry, action) },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity key={f.value} style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]} onPress={() => setStatusFilter(f.value)}>
            <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>Nothing here right now.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{item.entryType === "p2p_impact" ? "P2P Impact" : item.entryType === "testimony" ? "Testimony" : "Kingdom Win"}</Text></View>
                <Text style={styles.timeText}>{timeAgo(item.submittedAt ?? item.createdAt)}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>{KINGDOM_CATEGORY_LABELS[item.category]} · {item.isAnonymous ? "Anonymous" : item.authorName ?? "A peer"}</Text>
              {item.impactThemes.length > 0 && (
                <Text style={styles.themesText}>{item.impactThemes.map((t) => IMPACT_THEME_LABELS[t]).join(", ")}</Text>
              )}
              <Text style={styles.body} numberOfLines={6}>{item.body}</Text>
              {!!item.mediaType && (
                <View style={styles.mediaRow}>
                  <Ionicons name={item.mediaType === "video" ? "videocam-outline" : "image-outline"} size={13} color={colors.textMuted} />
                  <Text style={styles.mediaText}>{item.mediaType} attached</Text>
                </View>
              )}
              <Text style={styles.consentText}>
                Consent: {item.consentConfirmedAt ? `confirmed ${new Date(item.consentConfirmedAt).toLocaleDateString()}` : "not confirmed"}
              </Text>
              {!!item.moderationNote && <Text style={styles.noteExisting}>Note: {item.moderationNote}</Text>}

              {item.status === "submitted" ? (
                <>
                  <TextInput
                    style={styles.noteInput} placeholder="Optional note to author" placeholderTextColor={colors.textMuted}
                    value={noteDrafts[item.id] ?? ""} onChangeText={(t) => setNoteDrafts((prev) => ({ ...prev, [item.id]: t }))}
                  />
                  <View style={styles.actionsRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.actionApprove]} onPress={() => confirmAction(item, "approve")} disabled={acting === item.id}>
                      <Text style={styles.actionBtnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.actionReject]} onPress={() => confirmAction(item, "reject")} disabled={acting === item.id}>
                      <Text style={styles.actionBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : item.status === "published" ? (
                <TouchableOpacity style={[styles.actionBtn, styles.actionArchive, { marginTop: 8 }]} onPress={() => confirmAction(item, "archive")} disabled={acting === item.id}>
                  <Text style={styles.actionBtnText}>Archive</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.statusPill, item.status === "rejected" ? styles.statusPillRejected : styles.statusPillArchived]}>
                  <Text style={styles.statusPillText}>{item.status.toUpperCase()}</Text>
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { flexDirection: "row", gap: 8, flexWrap: "wrap", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  filterChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  filterChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  filterChipTextActive: { color: "#fff", fontWeight: "600" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 10, gap: 4 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeBadge: { backgroundColor: "rgba(94,114,228,0.15)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 11, color: "#5e72e4", fontFamily: "Inter_700Bold" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
  cardMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  themesText: { fontSize: 11, color: "#5e72e4", fontFamily: "Inter_500Medium" },
  body: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 4 },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  mediaText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  consentText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
  noteExisting: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium", marginTop: 4, fontStyle: "italic" },
  noteInput: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, color: colors.textDark, marginTop: 8, fontFamily: "Inter_400Regular" },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  actionBtnText: { fontSize: 12, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  actionApprove: { backgroundColor: colors.primaryGreen },
  actionReject: { backgroundColor: "#B91C1C" },
  actionArchive: { backgroundColor: "#D97706" },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginTop: 8 },
  statusPillText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  statusPillRejected: { backgroundColor: "#B91C1C" },
  statusPillArchived: { backgroundColor: "#D97706" },
});
