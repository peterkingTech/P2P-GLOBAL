import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Switch, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData, TeamProfile } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function TeamScreen() {
  const { getAllProfiles, setCrisisResponder } = useData();
  const [profiles, setProfiles] = useState<TeamProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getAllProfiles();
    setProfiles(data);
    setLoading(false);
  }, [getAllProfiles]);

  useEffect(() => { load(); }, [load]);

  async function toggle(p: TeamProfile) {
    const next = !p.isCrisisResponder;
    setSavingId(p.id);
    setProfiles((prev) => prev.map((row) => (row.id === p.id ? { ...row, isCrisisResponder: next } : row)));
    const err = await setCrisisResponder(p.id, next);
    if (err) {
      setProfiles((prev) => prev.map((row) => (row.id === p.id ? { ...row, isCrisisResponder: !next } : row)));
    }
    setSavingId(null);
  }

  const filtered = profiles.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.fullName.toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q);
  });

  const crisisCount = profiles.filter((p) => p.isCrisisResponder).length;

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Ionicons name="alert-circle" size={18} color="#B91C1C" />
        <Text style={styles.bannerText}>
          {crisisCount === 0
            ? "No one is assigned as a Crisis Responder yet. Crisis alerts have nowhere to go until you assign at least one person below."
            : `${crisisCount} ${crisisCount === 1 ? "person" : "people"} currently receive crisis alerts.`}
        </Text>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No users found.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.name}>{item.fullName}</Text>
                <Text style={styles.meta}>{item.email || "no email"} · {item.role}</Text>
              </View>
              <View style={styles.switchWrap}>
                <Text style={styles.switchLabel}>Crisis Responder</Text>
                <Switch
                  value={item.isCrisisResponder}
                  onValueChange={() => toggle(item)}
                  disabled={savingId === item.id}
                  trackColor={{ true: "#B91C1C", false: colors.borderBeige }}
                  thumbColor="#fff"
                />
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  banner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(185,28,28,0.08)", padding: 12, margin: 14, borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(185,28,28,0.25)",
  },
  bannerText: { flex: 1, fontSize: 12, color: "#7A1717", lineHeight: 17, fontFamily: "Inter_500Medium" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 14, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 14, paddingBottom: 20, gap: 8 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 12, marginBottom: 8,
  },
  rowInfo: { flex: 1, marginRight: 10 },
  name: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  switchWrap: { alignItems: "center", gap: 4 },
  switchLabel: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
