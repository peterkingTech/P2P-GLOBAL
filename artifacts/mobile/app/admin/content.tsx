import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// ── Types ──────────────────────────────────────────────────────────────────────

type ContentTab = "curriculum" | "prayer";

type PrayerPostRow = {
  id: string; user_id: string; post_type: string; body: string; status: string;
  is_anonymous: boolean; created_at: string; user_name?: string;
};

// ── Main component ─────────────────────────────────────────────────────────────
//
// Plans management used to have its own tab here, querying the p2p_plans
// table family directly. That system was fully unified into p2p_curriculums
// (migration 041) — Plans are now created/edited through the "Plans" toggle
// inside the Curriculum Manager itself (see admin/curriculum.tsx), so this
// screen only links out to it rather than duplicating that UI.

export default function ContentManager() {
  const router = useRouter();
  const [tab, setTab] = useState<ContentTab>("curriculum");

  return (
    <View style={s.root}>
      {/* Sub-tab bar */}
      <View style={s.subTabBar}>
        {(["curriculum", "prayer"] as ContentTab[]).map((t) => (
          <TouchableOpacity key={t} style={[s.subTab, tab === t && s.subTabActive]} onPress={() => setTab(t)}>
            <Text style={[s.subTabText, tab === t && s.subTabTextActive]}>
              {t === "curriculum" ? "Curriculum & Plans" : "Prayer & Testimonies"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "curriculum" && <CurriculumSection router={router} />}
      {tab === "prayer" && <PrayerSection />}
    </View>
  );
}

// ── CurriculumSection ──────────────────────────────────────────────────────────

function CurriculumSection({ router }: { router: any }) {
  return (
    <View style={s.centeredSection}>
      <Ionicons name="book-outline" size={48} color={colors.accentGreen} />
      <Text style={s.centeredTitle}>Curriculum Manager</Text>
      <Text style={s.centeredSub}>Create and edit the core curriculum and Plans — modules, lessons, and translations. Use the Curriculum/Plans toggle inside.</Text>
      <TouchableOpacity style={s.bigBtn} onPress={() => router.push("/admin/curriculum")}>
        <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
        <Text style={s.bigBtnText}>Open Curriculum Manager</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── PrayerSection ──────────────────────────────────────────────────────────────

function PrayerSection() {
  const [posts, setPosts] = useState<PrayerPostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "request" | "testimony">("all");

  const loadPosts = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from("p2p_prayer_wall_posts")
      .select("id,user_id,post_type,body,status,is_anonymous,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    const { data } = await q;
    setPosts((data ?? []) as PrayerPostRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const removePost = (post: PrayerPostRow) => {
    Alert.alert("Remove Post", "Remove this post from the prayer wall?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        const { error } = await supabase.from("p2p_prayer_wall_posts").delete().eq("id", post.id);
        if (error) Alert.alert("Error", error.message);
        else setPosts(prev => prev.filter(p => p.id !== post.id));
      }},
    ]);
  };

  const filteredPosts = posts.filter(p => filter === "all" || p.post_type === filter);

  return (
    <View style={s.sectionRoot}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Prayer & Testimonies</Text>
        <TouchableOpacity onPress={loadPosts} style={s.iconBtn}>
          <Ionicons name="refresh-outline" size={20} color={colors.accentGreen} />
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {(["all", "request", "testimony"] as const).map(f => (
          <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
            <Text style={[s.filterBtnText, filter === f && s.filterBtnTextActive]}>{f === "all" ? "All" : f === "request" ? "Requests" : "Testimonies"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accentGreen} />
      ) : filteredPosts.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>No posts found.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredPosts}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={s.prayerCard}>
              <View style={s.prayerCardTop}>
                <View style={[s.typePill, { backgroundColor: item.post_type === "testimony" ? colors.accentGreen : colors.amber }]}>
                  <Text style={s.statusPillText}>{item.post_type}</Text>
                </View>
                <Text style={s.prayerDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => removePost(item)} style={s.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                </TouchableOpacity>
              </View>
              <Text style={s.prayerBody} numberOfLines={4}>{item.body}</Text>
              {item.is_anonymous && <Text style={s.anonymousTag}>Anonymous</Text>}
            </View>
          )}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  subTabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, paddingHorizontal: 8 },
  subTab: { paddingHorizontal: 14, paddingVertical: 12, marginRight: 4, borderBottomWidth: 2, borderBottomColor: "transparent" },
  subTabActive: { borderBottomColor: colors.accentGreen },
  subTabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.textMuted },
  subTabTextActive: { color: colors.accentGreen, fontFamily: "Inter_700Bold" },

  centeredSection: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  centeredTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  centeredSub: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 20 },
  bigBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primaryGreen, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14, marginTop: 8 },
  bigBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  sectionRoot: { flex: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },

  planCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  planCardLeft: { flex: 1 },
  planCardTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  planCardTagline: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  planCardRight: { flexDirection: "row", alignItems: "center", gap: 6 },

  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  typePill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },

  iconBtn: { padding: 4 },

  planDetailHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, gap: 8 },
  backBtn: { padding: 4 },
  planDetailTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", flex: 1 },

  innerTabBar: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, maxHeight: 44 },
  innerTabBarContent: { paddingHorizontal: 8, flexDirection: "row" },
  innerTab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  innerTabActive: { borderBottomColor: colors.accentGreen },
  innerTabText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  innerTabTextActive: { color: colors.accentGreen, fontFamily: "Inter_700Bold" },

  saveInfoBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  saveInfoBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  rowCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rowCardTitle: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  rowCardSub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },

  moduleBlock: { backgroundColor: "#f5f5f0", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, marginBottom: 12 },
  moduleHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 6 },
  moduleTitle: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  lessonRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, padding: 10, marginBottom: 6 },
  lessonCode: { fontSize: 10, fontWeight: "700", color: colors.amber, fontFamily: "Inter_700Bold", marginBottom: 1 },
  lessonTitle: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },

  addLessonBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 4, marginTop: 4 },
  addLessonBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  qRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#f9f9f6", borderRadius: 8, padding: 10, marginBottom: 6 },
  qText: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
  addQRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 6 },
  addQInput: { flex: 1, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", minHeight: 44 },
  addQBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff" },
  filterBtnActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  filterBtnText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  filterBtnTextActive: { color: "#fff" },

  prayerCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 10 },
  prayerCardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  prayerDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  prayerBody: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
  anonymousTag: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4, fontStyle: "italic" },
});

const ms = StyleSheet.create({
  modalRoot: { flex: 1, backgroundColor: colors.lightCream },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, backgroundColor: "#fff" },
  modalCloseBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalSaveBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  modalSaveText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  modalBody: { padding: 16, paddingBottom: 60 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  fieldInput: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  fieldMultiline: { minHeight: 96, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingVertical: 4 },
  sectionDivider: { fontSize: 12, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
});
