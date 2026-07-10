import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, DiscoverablePeer } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function SmartMatch() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getSmartMatch } = useData();
  const [match, setMatch] = useState<DiscoverablePeer | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMatch(await getSmartMatch());
    setLoading(false);
  }, [getSmartMatch]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Stack.Screen options={{ title: "Smart Match" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={styles.title}>Your Suggested Partner</Text>
        <Text style={styles.sub}>Based on shared spiritual gifts and country</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primaryGreen} />
        ) : match ? (
          <View style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{match.fullName.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.name}>{match.fullName}</Text>
            <Text style={styles.meta}>{match.country || "Country not set"} · {match.role}</Text>
            {match.gifts.length > 0 && (
              <View style={styles.giftsRow}>
                {match.gifts.map((g) => (
                  <View key={g} style={styles.giftPill}><Text style={styles.giftPillText}>{g}</Text></View>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.btn} onPress={() => router.push(`/connect/discover?highlight=${match.id}`)}>
              <Text style={styles.btnText}>View in Discovery</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="sparkles-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No matches available yet. Check back once more members join.</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 20, fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 24, alignItems: "center", gap: 6,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryGreen,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  avatarText: { color: "#fff", fontSize: 28, fontWeight: "700", fontFamily: "Inter_700Bold" },
  name: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  giftsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 10 },
  giftPill: { backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  giftPillText: { fontSize: 11, color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  btn: { backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16 },
  btnText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  empty: { alignItems: "center", gap: 12, marginTop: 60, paddingHorizontal: 20 },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
});
