import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

interface AdminChurch {
  id: string; name: string; city: string | null; country: string; status: string;
  isVerified: boolean; verifiedAt: string | null; contactEmail: string | null;
  contactName: string | null; website: string | null; createdAt: string; memberCount: number;
}
interface ChurchStats {
  totalChurches: number; verifiedChurches: number; totalChurchMembers: number; nationsWithChurches: number;
}

export default function AdminChurchesScreen() {
  const [tab, setTab] = useState<"all" | "pending" | "stats">("all");
  const [churches, setChurches] = useState<AdminChurch[]>([]);
  const [stats, setStats] = useState<ChurchStats | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [churchesRes, statsRes] = await Promise.all([
        authedFetch("/admin/churches"),
        authedFetch("/admin/churches/stats"),
      ]);
      if (churchesRes.ok) setChurches(await churchesRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleVerify(id: string, verified: boolean) {
    await authedFetch(`/admin/churches/${id}/verify`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified }),
    });
    load();
  }

  const filtered = churches.filter((c) => {
    if (search.trim() && !`${c.name} ${c.country} ${c.city ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (tab === "pending") return !c.isVerified;
    return true;
  });

  return (
    <View style={styles.container}>
      <View style={styles.tabsRow}>
        {(["all", "pending", "stats"] as const).map((tb) => (
          <TouchableOpacity key={tb} style={[styles.tabChip, tab === tb && styles.tabChipActive]} onPress={() => setTab(tb)}>
            <Text style={[styles.tabChipText, tab === tb && styles.tabChipTextActive]}>
              {tb === "all" ? "All Churches" : tb === "pending" ? "Verification Queue" : "Stats"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab !== "stats" && (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search by name, country, or city" placeholderTextColor={colors.textMuted} />
        </View>
      )}

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : tab === "stats" ? (
        <ScrollView contentContainerStyle={styles.content}>
          <StatRow label="Total churches registered" value={stats?.totalChurches ?? 0} />
          <StatRow label="Verified churches" value={stats?.verifiedChurches ?? 0} />
          <StatRow label="Total church members" value={stats?.totalChurchMembers ?? 0} />
          <StatRow label="Nations with churches" value={stats?.nationsWithChurches ?? 0} />
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No churches found.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.churchName}>⛪ {item.name}</Text>
                <Text style={[styles.badge, item.isVerified ? styles.badgeVerified : styles.badgePending]}>
                  {item.isVerified ? "✓ Verified" : "Pending"}
                </Text>
              </View>
              <Text style={styles.cardMeta}>
                {[item.city, item.country].filter(Boolean).join(", ")} · {item.memberCount} members · {item.status}
              </Text>
              {item.contactName && <Text style={styles.cardMeta}>Contact: {item.contactName} {item.contactEmail ? `· ${item.contactEmail}` : ""}</Text>}
              {item.website && <Text style={styles.cardMeta}>Website: {item.website}</Text>}
              <Text style={styles.cardMeta}>Registered: {new Date(item.createdAt).toLocaleDateString()}</Text>

              {!item.isVerified ? (
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.verifyBtn} onPress={() => handleVerify(item.id, true)}>
                    <Text style={styles.verifyBtnText}>Verify ✓</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.unverifyLink} onPress={() => handleVerify(item.id, false)}>
                  <Text style={styles.unverifyLinkText}>Remove verification</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 16, gap: 10 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabsRow: { flexDirection: "row", padding: 16, gap: 8 },
  tabChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  tabChipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  tabChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  tabChipTextActive: { color: "#fff", fontWeight: "700" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  churchName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  badge: { fontSize: 11, fontWeight: "700", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden", fontFamily: "Inter_700Bold" },
  badgeVerified: { backgroundColor: "rgba(29,158,117,0.15)", color: colors.accentGreen },
  badgePending: { backgroundColor: "rgba(217,119,6,0.15)", color: "#D97706" },
  cardMeta: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  verifyBtn: { backgroundColor: colors.accentGreen, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  verifyBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  unverifyLink: { marginTop: 8 },
  unverifyLinkText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium" },
  statRow: {
    flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14,
  },
  statLabel: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 15, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
});