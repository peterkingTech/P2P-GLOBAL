import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, JournalReflection, JournalTimelineEntry } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// My Discipleship Journal — "What is this learning doing in my life?"
// Aggregates three already-existing private screens (notes.tsx,
// highlights.tsx, prayer/journal.tsx — all real, all RLS-private, all
// pre-dating this slice) plus the one genuinely new piece, longitudinal
// reflections (p2p_journal_reflections, migrations/082), into a single
// chronological timeline via useData().getJournalTimeline(). This screen
// never writes note/highlight/prayer data itself — it reads the merged
// feed and hands off to the existing screens (with ?compose=true to
// auto-open their creation modal) for anything but reflections, which are
// native to this Journal.

const REVISIT_DAYS = 30;

const TYPE_ICON: Record<JournalTimelineEntry["type"], string> = {
  reflection: "💭", prayer: "🙏", highlight: "⭐", note: "📝",
};
const TYPE_LABEL: Record<JournalTimelineEntry["type"], string> = {
  reflection: "Reflection", prayer: "Prayer Request", highlight: "Highlight", note: "Personal Note",
};

type Filter = "all" | "reflection" | "prayer" | "highlight" | "note";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "reflection", label: "Reflections" },
  { key: "prayer", label: "Prayers" }, { key: "highlight", label: "Highlights" }, { key: "note", label: "Notes" },
];

function formatEntryDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export default function MyDiscipleshipJournalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getJournalTimeline, getMyReflections } = useData();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [loading, setLoading] = useState(true);
  const [timeline, setTimeline] = useState<JournalTimelineEntry[]>([]);
  const [reflections, setReflections] = useState<JournalReflection[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [revisitDismissed, setRevisitDismissed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tl, refs] = await Promise.all([getJournalTimeline(), getMyReflections()]);
    setTimeline(tl);
    setReflections(refs);
    setLoading(false);
  }, [getJournalTimeline, getMyReflections]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // "Ready to revisit": the latest entry in a reflection chain is at least
  // REVISIT_DAYS old. Deterministic, no AI, no persisted dismissal state —
  // "Not Now" just hides it for this visit (spec: don't spam users, keep
  // this the simplest appropriate implementation).
  const latestByRoot = new Map<string, JournalReflection>();
  for (const r of reflections) {
    const current = latestByRoot.get(r.rootId);
    if (!current || new Date(r.createdAt).getTime() > new Date(current.createdAt).getTime()) {
      latestByRoot.set(r.rootId, r);
    }
  }
  const revisitCandidate = Array.from(latestByRoot.values())
    .filter((r) => Date.now() - new Date(r.createdAt).getTime() >= REVISIT_DAYS * 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

  const filtered = filter === "all" ? timeline : timeline.filter((e) => e.type === filter);

  function openEntry(entry: JournalTimelineEntry) {
    switch (entry.type) {
      case "note": router.push("/notes" as any); break;
      case "highlight": router.push("/highlights" as any); break;
      case "prayer": router.push("/prayer/journal" as any); break;
      case "reflection": router.push(`/my-discipleship/journal/reflection/${entry.id}` as any); break;
    }
  }

  function handleChoose(type: JournalTimelineEntry["type"]) {
    setNewEntryOpen(false);
    switch (type) {
      case "reflection": router.push("/my-discipleship/journal/reflection/new" as any); break;
      case "note": router.push("/notes?compose=true" as any); break;
      case "highlight": router.push("/highlights?compose=true" as any); break;
      case "prayer": router.push("/prayer/journal?compose=true" as any); break;
    }
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Discipleship Journal</Text>
      </View>

      {loading ? (
        <View style={s.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          <Text style={s.heroSub}>Reflect, remember, pray and grow.</Text>

          <TouchableOpacity style={s.newEntryBtn} onPress={() => setNewEntryOpen(true)}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={s.newEntryBtnText}>New Entry</Text>
          </TouchableOpacity>

          {revisitCandidate && !revisitDismissed && (
            <View style={s.revisitCard}>
              <Text style={s.revisitLabel}>🔄 REVISIT YOUR JOURNEY</Text>
              <Text style={s.revisitSub}>
                You wrote this reflection {formatEntryDate(revisitCandidate.createdAt).toLowerCase() === "today" ? "recently" : `on ${formatEntryDate(revisitCandidate.createdAt)}`}.
              </Text>
              {revisitCandidate.prompt && <Text style={s.revisitPrompt}>{revisitCandidate.prompt}</Text>}
              <Text style={s.revisitContent} numberOfLines={3}>"{revisitCandidate.content}"</Text>
              <View style={s.revisitActionsRow}>
                <TouchableOpacity
                  style={s.revisitPrimaryBtn}
                  onPress={() => router.push(`/my-discipleship/journal/reflection/${revisitCandidate.rootId}?revisit=true` as any)}
                >
                  <Text style={s.revisitPrimaryBtnText}>Reflect Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.revisitSecondaryBtn} onPress={() => setRevisitDismissed(true)}>
                  <Text style={s.revisitSecondaryBtnText}>Not Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ gap: 8 }}>
            {FILTERS.map((f) => (
              <TouchableOpacity key={f.key} style={[s.filterChip, filter === f.key && s.filterChipActive]} onPress={() => setFilter(f.key)}>
                <Text style={[s.filterChipText, filter === f.key && s.filterChipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.sectionHeader}>{filter === "all" ? "Recent Entries" : FILTERS.find((f) => f.key === filter)?.label}</Text>
          {filtered.length === 0 ? (
            <View style={s.emptyCard}>
              {timeline.length === 0 ? (
                <>
                  <Text style={s.emptyCardTitle}>Your discipleship journal is empty.</Text>
                  <Text style={s.emptyCardText}>Start capturing what you're learning, praying about and reflecting on.</Text>
                  <TouchableOpacity style={s.emptyCardBtn} onPress={() => setNewEntryOpen(true)}>
                    <Text style={s.emptyCardBtnText}>Create Entry</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={s.emptyCardText}>
                  {filter === "reflection" ? "No reflections yet." : filter === "prayer" ? "No active prayer requests." : filter === "highlight" ? "No highlights yet." : "No notes yet."}
                </Text>
              )}
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {filtered.map((entry) => (
                <TouchableOpacity key={`${entry.type}_${entry.id}`} style={s.entryCard} activeOpacity={0.85} onPress={() => openEntry(entry)}>
                  <Text style={s.entryIcon}>{TYPE_ICON[entry.type]}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={s.entryTopRow}>
                      <Text style={s.entryType}>{TYPE_LABEL[entry.type]}</Text>
                      <Text style={s.entryDate}>{formatEntryDate(entry.at)}</Text>
                    </View>
                    <Text style={s.entryTitle} numberOfLines={1}>{entry.title}</Text>
                    <Text style={s.entryPreview} numberOfLines={2}>{entry.preview}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={newEntryOpen} transparent animationType="slide" onRequestClose={() => setNewEntryOpen(false)}>
        <View style={s.chooserOverlay}>
          <View style={s.chooserSheet}>
            <View style={s.chooserHeader}>
              <Text style={s.chooserTitle}>What would you like to add?</Text>
              <TouchableOpacity onPress={() => setNewEntryOpen(false)}>
                <Ionicons name="close" size={22} color={colors.textDark} />
              </TouchableOpacity>
            </View>
            {(["reflection", "prayer", "highlight", "note"] as const).map((type) => (
              <TouchableOpacity key={type} style={s.chooserOption} onPress={() => handleChoose(type)}>
                <Text style={s.chooserOptionEmoji}>{TYPE_ICON[type]}</Text>
                <Text style={s.chooserOptionText}>{TYPE_LABEL[type]}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },
    heroSub: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 16 },

    newEntryBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 13, marginBottom: 20,
    },
    newEntryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

    revisitCard: {
      backgroundColor: "rgba(224,164,65,0.1)", borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
      borderRadius: 16, padding: 16, marginBottom: 20, gap: 6,
    },
    revisitLabel: { fontSize: 11, fontWeight: "700", color: c.amber, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    revisitSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    revisitPrompt: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 4 },
    revisitContent: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 19, marginTop: 2 },
    revisitActionsRow: { flexDirection: "row", gap: 10, marginTop: 8 },
    revisitPrimaryBtn: { backgroundColor: c.amber, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
    revisitPrimaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    revisitSecondaryBtn: { paddingHorizontal: 12, paddingVertical: 9 },
    revisitSecondaryBtnText: { color: c.textMuted, fontSize: 13, fontFamily: "Inter_500Medium" },

    filterRow: { marginBottom: 16, flexGrow: 0 },
    filterChip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: c.card },
    filterChipActive: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    filterChipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    filterChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },

    sectionHeader: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 },

    emptyCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 20, alignItems: "center", gap: 10 },
    emptyCardTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    emptyCardText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    emptyCardBtn: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
    emptyCardBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

    entryCard: {
      flexDirection: "row", gap: 12, backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14,
    },
    entryIcon: { fontSize: 20 },
    entryTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    entryType: { fontSize: 10, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    entryDate: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    entryTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 3 },
    entryPreview: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },

    chooserOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    chooserSheet: { backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
    chooserHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    chooserTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    chooserOption: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.cardBeige, borderRadius: 14, padding: 14, marginBottom: 8,
    },
    chooserOptionEmoji: { fontSize: 20 },
    chooserOptionText: { flex: 1, fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}