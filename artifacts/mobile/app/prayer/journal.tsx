import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

interface JournalEntry {
  id: string;
  prayer_text: string;
  category: string | null;
  is_answered: boolean;
  answered_at: string | null;
  answer_notes: string | null;
  created_at: string;
}

type Filter = "all" | "answered" | "unanswered";

export default function PrayerJournalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answerNotesDraft, setAnswerNotesDraft] = useState<Record<string, string>>({});

  const [writeOpen, setWriteOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase.from("p2p_prayer_journal").select("*").eq("user_id", profile.id).order("created_at", { ascending: false });
    setEntries((data ?? []) as JournalEntry[]);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  async function submitNewPrayer() {
    if (!newText.trim() || !profile?.id) return;
    setSaving(true);
    await supabase.from("p2p_prayer_journal").insert({ user_id: profile.id, prayer_text: newText.trim(), category: newCategory.trim() || null });
    setSaving(false);
    setNewText("");
    setNewCategory("");
    setWriteOpen(false);
    load();
  }

  async function markAnswered(id: string) {
    if (!profile?.id) return;
    await supabase.from("p2p_prayer_journal").update({
      is_answered: true, answered_at: new Date().toISOString(), answer_notes: answerNotesDraft[id]?.trim() || null,
    }).eq("id", id);
    load();
  }

  const searchLower = search.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (filter === "answered" && !e.is_answered) return false;
    if (filter === "unanswered" && e.is_answered) return false;
    if (searchLower && !e.prayer_text.toLowerCase().includes(searchLower)) return false;
    return true;
  });
  const answeredArchive = entries.filter((e) => e.is_answered).sort((a, b) => new Date(b.answered_at ?? 0).getTime() - new Date(a.answered_at ?? 0).getTime());

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Prayer Journal</Text>
        <TouchableOpacity onPress={() => setWriteOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
            return (
              <TouchableOpacity key={e.id} style={styles.entryCard} activeOpacity={0.9} onPress={() => setExpandedId(expanded ? null : e.id)}>
                <View style={styles.entryTopRow}>
                  <Text style={styles.entryDate}>{new Date(e.created_at).toLocaleDateString()}</Text>
                  {e.category ? <View style={styles.categoryTag}><Text style={styles.categoryTagText}>{e.category}</Text></View> : null}
                  {e.is_answered && <Ionicons name="checkmark-circle" size={16} color={colors.upperRoomAmber} />}
                </View>
                <Text style={styles.entryText} numberOfLines={expanded ? undefined : 2}>{e.prayer_text}</Text>
                {expanded && (
                  <View style={styles.expandedBox}>
                    {e.is_answered ? (
                      e.answer_notes ? <Text style={styles.answerNotesText}>{e.answer_notes}</Text> : null
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
                      </>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        {answeredArchive.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Answered Prayers — Your Testimony</Text>
            {answeredArchive.map((e) => (
              <View key={e.id} style={[styles.entryCard, styles.answeredArchiveCard]}>
                <View style={styles.entryTopRow}>
                  <Text style={styles.entryDate}>{e.answered_at ? new Date(e.answered_at).toLocaleDateString() : ""}</Text>
                  <Ionicons name="checkmark-circle" size={16} color={colors.upperRoomAmber} />
                </View>
                <Text style={styles.entryText}>{e.prayer_text}</Text>
                {e.answer_notes ? <Text style={styles.answerNotesText}>{e.answer_notes}</Text> : null}
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
    entryTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    entryDate: { fontSize: 11, color: c.upperRoomMuted, fontFamily: "Inter_400Regular" },
    categoryTag: { backgroundColor: "rgba(224,164,65,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    categoryTagText: { fontSize: 10, color: c.upperRoomAmber, fontFamily: "Inter_600SemiBold" },
    entryText: { fontSize: 14, color: c.upperRoomCream, fontFamily: "Inter_400Regular", lineHeight: 20 },
    expandedBox: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.upperRoomBorder, paddingTop: 12 },
    answerNotesText: { fontSize: 13, color: c.upperRoomAmber, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 19, marginTop: 6 },
    answerNotesInput: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 10, padding: 10, color: c.upperRoomCream, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 50 },
    markAnsweredBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.upperRoomAmber, borderRadius: 10, paddingVertical: 10, marginTop: 10 },
    markAnsweredBtnText: { fontSize: 13, fontWeight: "700", color: "#100B06", fontFamily: "Inter_700Bold" },
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
