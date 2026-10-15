import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, TextInput, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import {
  getKingdomWinsAdminQueue, moderateKingdomWin, getWinsRestrictions, restrictWinsPosting, liftWinsRestriction,
  KINGDOM_CATEGORY_LABELS, IMPACT_THEME_LABELS, type KingdomWin, type WinsRestriction,
} from "@/lib/kingdomWinsApi";
import { RESTRICTION_DURATIONS, formatUntil, isWinsModerator, restrictionExpiry, type RestrictionDuration } from "@/lib/winsModerationModel";

type QueueStatus = "submitted" | "published" | "rejected" | "archived" | "removed";

// Kingdom Wins review queue — additive to the REACTIVE report/flag queue at
// app/admin/moderation.tsx (post-publication reports for kingdom_win content
// are resolved there). This screen handles:
//   • P2P Impact submissions awaiting approval (Wins moderators and the
//     admin_content P2P Impact reviewer);
//   • ordinary posts held by automated screening (Wins moderators only);
//   • posting restrictions for repeat offenders (Wins moderators only).
// The server decides what each role may see and do (routes/kingdomWins.ts,
// migration 189); this screen only hides controls a role can't use.
const STATUS_FILTERS: Array<{ value: QueueStatus; label: string; moderatorOnly?: boolean }> = [
  { value: "submitted", label: "Pending" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
  { value: "removed", label: "Removed", moderatorOnly: true },
];
const CATEGORY_LABELS: Record<string, string> = {
  link: "Link", contact: "Contact details", fundraising: "Fundraising", promotion: "Promotion",
  advertising: "Advertising", payment: "Payment details", money_scheme: "Money scheme", scam: "Scam pattern",
  translation: "Not yet translated — please read the original",
};

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
function confirmThen(title: string, message: string, destructive: boolean, onConfirm: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onConfirm(); return; }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
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
  const { profile } = useAuth();
  const canModerate = isWinsModerator(profile?.role);
  const [statusFilter, setStatusFilter] = useState<QueueStatus>("submitted");
  const [entries, setEntries] = useState<KingdomWin[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [restrictionFor, setRestrictionFor] = useState<string | null>(null);

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
      approve: entry.heldForReview
        ? { title: "Release and publish?", body: "Automated screening held this post. Publishing makes it visible to the entire authenticated P2P community." }
        : { title: "Publish this story?", body: "It will become visible to the entire authenticated P2P community." },
      reject: { title: "Reject this submission?", body: "The author will be notified and can revise it." },
      archive: { title: "Archive this story?", body: "It will no longer be publicly visible, but the record is kept." },
    };
    confirmThen(copy[action].title, copy[action].body, action === "reject", () => act(entry, action));
  }

  const filters = STATUS_FILTERS.filter((f) => canModerate || !f.moderatorOnly);

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.value} style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]} onPress={() => setStatusFilter(f.value)}
            accessibilityRole="tab" accessibilityLabel={f.label} accessibilityState={{ selected: statusFilter === f.value }} aria-selected={statusFilter === f.value}
          >
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
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{item.entryType === "p2p_impact" ? "P2P Impact" : item.entryType === "testimony" ? "Testimony" : "Kingdom Win"}</Text></View>
                  {item.heldForReview ? (
                    <View style={styles.heldBadge} accessibilityLabel="Held by automated screening">
                      <Ionicons name="shield-half-outline" size={11} color="#8A5410" />
                      <Text style={styles.heldBadgeText}>Held by screening</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.timeText}>{timeAgo(item.submittedAt ?? item.createdAt)}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>{KINGDOM_CATEGORY_LABELS[item.category]} · {item.isAnonymous ? "Anonymous" : item.authorName ?? "A peer"}</Text>
              {item.heldForReview && item.screeningCategories?.length ? (
                <Text style={styles.heldReason}>Matched: {item.screeningCategories.map((c) => CATEGORY_LABELS[c] ?? c).join(", ")}</Text>
              ) : null}
              {item.impactThemes.length > 0 && (
                <Text style={styles.themesText}>{item.impactThemes.map((t) => IMPACT_THEME_LABELS[t]).join(", ")}</Text>
              )}
              <Text style={styles.body} numberOfLines={6}>{item.body}</Text>
              {item.screeningTranslation ? (
                <View style={styles.translationBox} accessibilityLabel="English translation">
                  <Text style={styles.translationLabel}>English translation (automatic)</Text>
                  <Text style={styles.body} numberOfLines={8}>{item.screeningTranslation}</Text>
                </View>
              ) : null}
              {!!item.mediaType && (
                <View style={styles.mediaRow}>
                  <Ionicons name={item.mediaType === "video" ? "videocam-outline" : "image-outline"} size={13} color={colors.textMuted} />
                  <Text style={styles.mediaText}>{item.mediaType} attached — not automatically scanned; please check it</Text>
                </View>
              )}
              {item.entryType === "p2p_impact" ? (
                <Text style={styles.consentText}>
                  Consent: {item.consentConfirmedAt ? `confirmed ${new Date(item.consentConfirmedAt).toLocaleDateString()}` : "not confirmed"}
                </Text>
              ) : null}
              {!!item.moderationNote && <Text style={styles.noteExisting}>Note: {item.moderationNote}</Text>}

              {item.status === "submitted" ? (
                <>
                  <TextInput
                    style={styles.noteInput} placeholder="Optional note to author" placeholderTextColor={colors.textMuted} accessibilityLabel="Note to author"
                    value={noteDrafts[item.id] ?? ""} onChangeText={(t) => setNoteDrafts((prev) => ({ ...prev, [item.id]: t }))}
                  />
                  <View style={styles.actionsRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.actionApprove]} onPress={() => confirmAction(item, "approve")} disabled={acting === item.id} accessibilityRole="button" accessibilityLabel={item.heldForReview ? "Release and publish" : "Approve"}>
                      <Text style={styles.actionBtnText}>{item.heldForReview ? "Release & publish" : "Approve"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.actionReject]} onPress={() => confirmAction(item, "reject")} disabled={acting === item.id} accessibilityRole="button" accessibilityLabel="Reject">
                      <Text style={styles.actionBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : item.status === "published" && canModerate ? (
                <TouchableOpacity style={[styles.actionBtn, styles.actionArchive, { marginTop: 8 }]} onPress={() => confirmAction(item, "archive")} disabled={acting === item.id} accessibilityRole="button" accessibilityLabel="Archive">
                  <Text style={styles.actionBtnText}>Archive</Text>
                </TouchableOpacity>
              ) : item.status !== "published" ? (
                <View style={[styles.statusPill, item.status === "archived" ? styles.statusPillArchived : styles.statusPillRejected]}>
                  <Text style={styles.statusPillText}>{item.status.toUpperCase()}</Text>
                </View>
              ) : null}

              {canModerate && item.authorId ? (
                restrictionFor === item.authorId ? (
                  <RestrictionPanel userId={item.authorId} onClose={() => setRestrictionFor(null)} />
                ) : (
                  <TouchableOpacity style={styles.linkBtn} onPress={() => setRestrictionFor(item.authorId)} accessibilityRole="button" accessibilityLabel="Posting restriction for this author">
                    <Ionicons name="lock-closed-outline" size={13} color={colors.textMid} />
                    <Text style={styles.linkBtnText}>Posting restriction…</Text>
                  </TouchableOpacity>
                )
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

// View, impose and lift a Kingdom Wins posting restriction for one author.
// Restricting stops new posts only: existing posts, drafts, reading and
// reactions are untouched, and open reports are not resolved.
function RestrictionPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [items, setItems] = useState<WinsRestriction[] | null>(null);
  const [duration, setDuration] = useState<RestrictionDuration>("7d");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await getWinsRestrictions(userId)); }
    catch (e: any) { showAlert("Couldn't load restrictions", e.message ?? "Please try again."); setItems([]); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const active = (items ?? []).filter((r) => r.active);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); setReason(""); await load(); }
    catch (e: any) { showAlert("Couldn't complete action", e.message ?? "Please try again."); }
    finally { setBusy(false); }
  }
  function restrict() {
    if (reason.trim().length < 3) { showAlert("Reason needed", "Please give a reason (at least 3 characters)."); return; }
    const label = RESTRICTION_DURATIONS.find((d) => d.value === duration)?.label ?? "";
    confirmThen("Restrict posting?", `This member won't be able to share new Kingdom Wins (${label.toLowerCase()}). Their existing posts stay up.`, true,
      () => run(() => restrictWinsPosting(userId, reason.trim(), restrictionExpiry(duration))));
  }
  function liftAll() {
    if (reason.trim().length < 3) { showAlert("Reason needed", "Please give a reason for lifting (at least 3 characters)."); return; }
    confirmThen("Lift restriction?", "This member will be able to share Kingdom Wins again.", false,
      () => run(async () => { for (const r of active) await liftWinsRestriction(r.id, reason.trim()); }));
  }

  return (
    <View style={styles.panel} accessibilityLabel="Posting restriction">
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Posting restriction</Text>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close posting restriction" style={styles.closeBtn}>
          <Ionicons name="close" size={18} color={colors.textMid} />
        </TouchableOpacity>
      </View>
      {items === null ? <ActivityIndicator color={colors.primaryGreen} /> : active.length ? (
        <>
          {active.map((r) => (
            <Text key={r.id} style={styles.panelText}>Restricted {r.expiresAt ? `until ${formatUntil(r.expiresAt)}` : "until lifted"} — {r.reason}</Text>
          ))}
          <TextInput style={styles.noteInput} placeholder="Reason for lifting" placeholderTextColor={colors.textMuted} accessibilityLabel="Reason for lifting" value={reason} onChangeText={setReason} />
          <TouchableOpacity style={[styles.actionBtn, styles.actionApprove, { marginTop: 8 }]} onPress={liftAll} disabled={busy} accessibilityRole="button" accessibilityLabel="Lift restriction">
            <Text style={styles.actionBtnText}>Lift restriction</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.panelText}>Not restricted.{(items ?? []).length ? ` ${(items ?? []).length} earlier restriction(s) on record.` : ""}</Text>
          <View style={styles.durationRow}>
            {RESTRICTION_DURATIONS.map((d) => (
              <TouchableOpacity
                key={d.value} style={[styles.filterChip, duration === d.value && styles.filterChipActive]} onPress={() => setDuration(d.value)}
                accessibilityRole="radio" accessibilityLabel={d.label} accessibilityState={{ checked: duration === d.value }} aria-checked={duration === d.value}
              >
                <Text style={[styles.filterChipText, duration === d.value && styles.filterChipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.noteInput} placeholder="Reason (kept for moderators; not shown to the member)" placeholderTextColor={colors.textMuted} accessibilityLabel="Reason for restriction" value={reason} onChangeText={setReason} />
          <TouchableOpacity style={[styles.actionBtn, styles.actionReject, { marginTop: 8 }]} onPress={restrict} disabled={busy} accessibilityRole="button" accessibilityLabel="Restrict posting">
            <Text style={styles.actionBtnText}>Restrict posting</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { flexDirection: "row", gap: 8, flexWrap: "wrap", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterChip: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center", borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
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
  heldBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FFF4E0", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  heldBadgeText: { fontSize: 11, color: "#8A5410", fontFamily: "Inter_700Bold" },
  heldReason: { fontSize: 11, color: "#8A5410", fontFamily: "Inter_500Medium" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
  cardMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  themesText: { fontSize: 11, color: "#5e72e4", fontFamily: "Inter_500Medium" },
  body: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 4 },
  translationBox: { marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige },
  translationLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  mediaText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  consentText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
  noteExisting: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium", marginTop: 4, fontStyle: "italic" },
  noteInput: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, fontSize: 12, color: colors.textDark, marginTop: 8, fontFamily: "Inter_400Regular" },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, minHeight: 44, justifyContent: "center", borderRadius: 8, alignItems: "center" },
  actionBtnText: { fontSize: 12, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  actionApprove: { backgroundColor: colors.primaryGreen },
  actionReject: { backgroundColor: "#B91C1C" },
  actionArchive: { backgroundColor: "#D97706" },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginTop: 8 },
  statusPillText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  statusPillRejected: { backgroundColor: "#B91C1C" },
  statusPillArchived: { backgroundColor: "#D97706" },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, marginTop: 4, alignSelf: "flex-start" },
  linkBtnText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  panel: { marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: colors.lightCream, gap: 4 },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panelTitle: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_700Bold" },
  panelText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 17 },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  durationRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
});
