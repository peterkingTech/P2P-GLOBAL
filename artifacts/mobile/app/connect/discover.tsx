import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, DiscoverablePeer } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function Discover() {
  const insets = useSafeAreaInsets();
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const { getDiscoverablePeers } = useData();
  const [peers, setPeers] = useState<DiscoverablePeer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setPeers(await getDiscoverablePeers(q));
    setLoading(false);
  }, [getDiscoverablePeers]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Stack.Screen options={{ title: "Discovery Search" }} />
      <View style={styles.container}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => load(search)}
            returnKeyType="search"
          />
        </View>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primaryGreen} />
        ) : (
          <FlatList
            data={peers}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 60 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>No study partners found.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.row, item.id === highlight && styles.rowHighlight]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.fullName.charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.fullName}</Text>
                  <Text style={styles.meta}>{item.country || "Unknown location"} · {item.role}</Text>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, margin: 20, marginBottom: 0,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  rowHighlight: { borderColor: colors.primaryGreen, borderWidth: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
