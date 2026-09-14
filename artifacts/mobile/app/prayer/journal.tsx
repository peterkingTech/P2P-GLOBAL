import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, Linking, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getMyJournal, updateJournalEntry, type JournalEntry2, type JournalStatus } from "@/lib/prayerJournal2Api";
import { getScriptureReference } from "@/lib/prayerTopicsApi";

type Filter = "all" | "answered" | "unanswered";
const PAGE_SIZE = 20;

const STATUS_LABELS: Record<JournalStatus, string> = {
  still_praying: "Still Praying", trusting_god: "Trusting God", god_is_answering: "God Is Answering",
  answered: "Answered", no_longer_needed: "No Longer Needed",
};
const STATUS_OPTIONS: JournalStatus[] = ["still_praying", "trusting_god", "god_is_answering", "answered", "no_longer_needed"];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// "Pray the Word" Stage 4 — Prayer Journal 2.0. Reads/writes now go
// through the paginated routes/prayerJournal.ts API (never loading the
// user's whole history at once); the existing simple "Write a Prayer"
// modal and "Mark as Answered" flow are preserved exactly as before.
export default function PrayerJournalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [entries, setEntries] = useState<JournalEntry2[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answerNotesDraft, setAnswerNotesDraft] = useState<Record<string, string>>({});
  const [scriptureCache, setScriptureCache] = useState<Record<string, string>>({});

  const [writeOpen, setWriteOpen] = useState(compose === "true");
  const [newCategory, setNewCategory] = useState("");
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);

  const loadPage = useCallback(async (pageNum: number, currentFilter: Filter) => {
    const result = await getMyJournal(pageNum, PAGE_SIZE, currentFilter === "all" ? undefined : currentFilter);
    setTotal(result.total);
    return result.entries;
  }, []);

  const reload = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const first = await loadPage(0, filter);
      setEntries(first);
      setPage(0);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, filter, loadPage]);

  useEffect(() => { reload(); }, [reload]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const more = await loadPage(nextPage, filter);
      setEntries((prev) => [...prev, ...more]);
      setPage(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }

  async function submitNewPrayer() {
    if (!newText.trim() || !profile?.id) return;
    setSaving(true);
    await supabase.from("p2p_prayer_journal").insert({ user_id: profile.id, prayer_text: newText.trim(), category: newCategory.trim() || null });
    setSaving(false);
    setNewText("");
    setNewCategory("");
    setWriteOpen(false);
    reload();
  }

  async function markAnswered(id: string) {
    try {
      await updateJournalEntry(id, { isAnswered: true, answerNotes: answerNotesDraft[id]?.trim() || null, status: "answered" });
      reload();
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Please try again.");
    }
  }

  async function handleSetStatus(id: string, status: JournalStatus) {
    try {
      await updateJournalEntry(id, { status });
      reload();
    } catch (e: any) {
      showAlert("Couldn't update status", e.message ?? "Please try again.");
    }
  }

  async function handleReadScripture(entry: JournalEntry2) {
    if (!entry.scriptureReferenceId) return;
    let display = scriptureCache[entry.scriptureReferenceId];
    if (!display) {
      try {
        const ref = await getScriptureReference(entry.scriptureReferenceId);
        display = ref.referenceDisplay;
        setScriptureCache((prev) => ({ ...prev, [entry.scriptureReferenceId as string]: display }));
      } catch {
        showAlert("Couldn't load Scripture", "Please try again.");
        return;
      }
    }
    Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(display)}`);
  }

  function handleContinuePath(entry: JournalEntry2) {
    if (!entry.category?.startsWith("path:")) return;
    router.push(`/prayer/paths/${entry.category.slice(5)}` as any);
  }

  function handlePrayAgain(entry: JournalEntry2) {
    setNewCategory(entry.category ?? "");
    setNewText("");
    setWriteOpen(true);
  }

  const searchLower = search.trim().toLowerCase();
  const filtered = entries.filter((e) => !searchLower || e.prayerText.toLowerCase().includes(searchLower));
  const answeredArchive = entries.filter((e) => e.isAnswered).sort((a, b) => new Date(b.answeredAt ?? 0).getTime() - new Date(a.answeredAt ?? 0).getTime());
  const hasMore = entries.length < total;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Prayer Journal</Text>
        <TouchableOpacity onPress={() => { setNewCategory(""); setWriteOpen(true); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="add" size={24} color={colors.upperRoomAmber} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.upperRoomMuted} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search your prayers..." placeholderTextColor={colors.upperRoomMuted} />
      </View>
      <View style={styles.filterRow}>
        {(["all", "unanswered", "answered"] as Filter[]).map((f) => (
          <TouchableOpacity key={f} style={[styles.filterChip, filter === f && styles.filterChipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.upperRoomAmber} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <Text style={styles.emptyText}>No prayers match here yet.</Text>
        ) : (
          filtered.map((e) => {
            const expanded = expandedId === e.id;
            const isPathEntry = e.category?.startsWith("path:");
            return (
              <TouchableOpacity key={e.id} style={styles.entryCard} activeOpacity={0.9} onPress={() => setExpandedId(expanded ? null : e.id)}>
                <View style={styles.entryTopRow}>
                  <Text style={styles.entryDate}>{new Date(e.createdAt).toLocaleDateString()}</Text>
                  {e.category ? <View style={styles.categoryTag}><Text style={styles.categoryTagText}>{isPathEntry ? "Prayer Path" : e.category}</Text></View> : null}
                  {e.status && <View style={styles.statusTag}><Text style={styles.statusTagText}>{STATUS_LABELS[e.status]}</Text></View>}
                  {e.isAnswered && <Ionicons name="checkmark-circle" size={16} color={colors.upperRoomAmber} />}
                </View>
                <Text style={styles.entryText} numberOfLines={expanded ? undefined : 2}>{e.prayerText}</Text>
                {expanded && (
                  <View style={styles.expandedBox}>
                    {e.isAnswered ? (
                      e.answerNotes ? <Text style={styles.answerNotesText}>{e.answerNotes}</Text> : null
                    ) : (
                      <>
                        <TextInput
                          style={styles.answerNotesInput}
                          placeholder="How did God answer this? (optional)"
                          placeholderTextColor={colors.upperRoomMuted}
                          value={answerNotesDraft[e.id] ?? ""}
                          onChangeText={(v) => setAnswerNotesDraft((prev) => ({ ...prev, [e.id]: v }))}
                          multiline
                        />
                        <TouchableOpacity style={styles.markAnsweredBtn} onPress={() => markAnswered(e.id)}>
                          <Ionicons name="checkmark" size={14} color="#100B06" />
                          <Text style={styles.markAnsweredBtnText}>Mark as Answered</Text>
                        </TouchableOpacity>

                        <Text style={styles.statusLabel}>How is this prayer going?</Text>
                        <View style={styles.statusChipRow}>
                          {STATUS_OPTIONS.filter((s) => s !== "answered").map((s) => (
                            <TouchableOpacity key={s} style={[styles.statusChip, e.status === s && styles.statusChipActive]} onPress={() => handleSetStatus(e.id, s)}>
                              <Text style={[styles.statusChipText, e.status === s && styles.statusChipTextActive]}>{STATUS_LABELS[s]}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}

                    <View style={styles.quickActionsRow}>
                      {!!e.scriptureReferenceId && (
                        <TouchableOpacity style={styles.quickActionBtn} onPress={() => handleReadScripture(e)}>
                          <Ionicons name="book-outline" size={13} color={colors.upperRoomAmber} />
                          <Text style={styles.quickActionText}>Read Scripture</Text>
                        </TouchableOpacity>
                      )}
                      {isPathEntry && (
                        <TouchableOpacity style={styles.quickActionBtn} onPress={() => handleContinuePath(e)}>
                          <Ionicons name="trail-sign-outline" size={13} color={colors.upperRoomAmber} />
                          <Text style={styles.quickActionText}>Continue Path</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push("/prayer/pray-with-me" as any)}>
                        <Ionicons name="people-outline" size={13} color={colors.upperRoomAmber} />
                        <Text style={styles.quickActionText}>Pray With Me</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.quickActionBtn} onPress={() => handlePrayAgain(e)}>
                        <Ionicons name="refresh-outline" size={13} color={colors.upperRoomAmber} />
                        <Text style={styles.quickActionText}>Pray Again</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        {!loading && hasMore && (
          <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? <ActivityIndicator size="small" color={colors.upperRoomAmber} /> : <Text style={styles.loadMoreText}>Load More</Text>}
          </TouchableOpacity>
        )}

        {answeredArchive.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Answered Prayers — Your Testimony</Text>
            {answeredArchive.map((e) => (
              <View key={e.id} style={[styles.entryCard, styles.answeredArchiveCard]}>
                <View style={styles.entryTopRow}>
                  <Text style={styles.entryDate}>{e.answeredAt ? new Date(e.answeredAt).toLocaleDateString() : ""}</Text>
                  <Ionicons name="checkmark-circle" size={16} color={colors.upperRoomAmber} />
                </View>
                <Text style={styles.entryText}>{e.prayerText}</Text>
                {e.answerNotes ? <Text style={styles.answerNotesText}>{e.answerNotes}</Text> : null}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={writeOpen} animationType="slide" transparent onRequestClose={() => setWriteOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Write a Prayer</Text>
            <TextInput style={styles.modalInput} value={newCategory} onChangeText={setNewCategory} placeholder="Category (optional)" placeholderTextColor={colors.upperRoomMuted} />
            <TextInput style={[styles.modalInput, styles.modalTextarea]} value={newText} onChangeText={setNewText} placeholder="Write your prayer..." placeholderTextColor={colors.upperRoomMuted} multiline />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setWriteOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={submitNewPrayer} disabled={saving}>
                {saving ? <ActivityIndicator color="#100B06" size="small" /> : <Text style={styles.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.upperRoomBg },
    headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
    headerBarTitle: { fontSize: 16, fontWeight: "700", color: c.upperRoomCream, fontFamily: "Inter_700Bold" },
    searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 12, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10 },
    searchInput: { flex: 1, fontSize: 14, color: c.upperRoomCream, fontFamily: "Inter_400Regular" },
    filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 10 },
    filterChip: { borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
    filterChipActive: { backgroundColor: c.upperRoomAmber, borderColor: c.upperRoomAmber },
    filterChipText: { fontSize: 12, color: c.upperRoomMuted, fontFamily: "Inter_500Medium" },
    filterChipTextActive: { color: "#100B06", fontWeight: "700" },
    scroll: { padding: 16 },
    emptyText: { fontSize: 13, color: c.upperRoomMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
    entryCard: { backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    answeredArchiveCard: { borderColor: "rgba(224,164,65,0.35)" },
    entryTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
    entryDate: { fontSize: 11, color: c.upperRoomMuted, fontFamily: "Inter_400Regular" },
    categoryTag: { backgroundColor: "rgba(224,164,65,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    categoryTagText: { fontSize: 10, color: c.upperRoomAmber, fontFamily: "Inter_600SemiBold" },
    statusTag: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    statusTagText: { fontSize: 10, color: c.upperRoomMuted, fontFamily: "Inter_600SemiBold" },
    entryText: { fontSize: 14, color: c.upperRoomCream, fontFamily: "Inter_400Regular", lineHeight: 20 },
    expandedBox: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.upperRoomBorder, paddingTop: 12 },
    answerNotesText: { fontSize: 13, color: c.upperRoomAmber, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 19, marginTop: 6 },
    answerNotesInput: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 10, padding: 10, color: c.upperRoomCream, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 50 },
    markAnsweredBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.upperRoomAmber, borderRadius: 10, paddingVertical: 10, marginTop: 10 },
    markAnsweredBtnText: { fontSize: 13, fontWeight: "700", color: "#100B06", fontFamily: "Inter_700Bold" },
    statusLabel: { fontSize: 11, color: c.upperRoomMuted, fontFamily: "Inter_500Medium", marginTop: 12, marginBottom: 6 },
    statusChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    statusChip: { borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
    statusChipActive: { backgroundColor: c.upperRoomAmber, borderColor: c.upperRoomAmber },
    statusChipText: { fontSize: 11, color: c.upperRoomMuted, fontFamily: "Inter_500Medium" },
    statusChipTextActive: { color: "#100B06", fontFamily: "Inter_700Bold" },
    quickActionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
    quickActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    quickActionText: { fontSize: 11, color: c.upperRoomAmber, fontFamily: "Inter_500Medium" },
    loadMoreBtn: { alignItems: "center", paddingVertical: 14 },
    loadMoreText: { fontSize: 13, color: c.upperRoomAmber, fontFamily: "Inter_600SemiBold" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.upperRoomMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    modalBox: { backgroundColor: c.upperRoomBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, borderWidth: 1, borderColor: c.upperRoomBorder },
    modalTitle: { fontSize: 17, fontWeight: "700", color: c.upperRoomCream, fontFamily: "Inter_700Bold", marginBottom: 14 },
    modalInput: { backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 10, padding: 12, color: c.upperRoomCream, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 10 },
    modalTextarea: { minHeight: 100, textAlignVertical: "top" },
    modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 8 },
    modalCancelBtn: { flex: 1, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    modalCancelText: { fontSize: 14, color: c.upperRoomMuted, fontFamily: "Inter_600SemiBold" },
    modalSaveBtn: { flex: 1, backgroundColor: c.upperRoomAmber, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    modalSaveText: { fontSize: 14, color: "#100B06", fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
