import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, DiscoverablePeer } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { supabase } = useAuth();
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const { getDiscoverablePeers } = useData();
  const [peers, setPeers] = useState<DiscoverablePeer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState<string | null>(null);

  async function handleMessage(peer: DiscoverablePeer) {
    setMessaging(peer.id);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: peer.id });
      if (error || !data) {
        Alert.alert(
          "Can't message yet",
          "You can message peers once you share a study group together, or once they've reached out for help."
        );
        return;
      }
      router.push(`/messages/${data}` as any);
    } finally {
      setMessaging(null);
    }
  }

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
                <TouchableOpacity style={styles.msgBtn} onPress={() => handleMessage(item)} disabled={messaging === item.id}>
                  {messaging === item.id ? (
                    <ActivityIndicator size="small" color={colors.accentGreen} />
                  ) : (
                    <Ionicons name="chatbubble-outline" size={18} color={colors.accentGreen} />
                  )}
                </TouchableOpacity>
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
  msgBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(29,158,117,0.08)" },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
