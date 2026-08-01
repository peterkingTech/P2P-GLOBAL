import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

interface DiscoverCircle {
  id: string;
  name: string;
  description: string | null;
  circleType: string;
  status: string;
  languageCode: string;
  timezone: string | null;
  memberCount: number;
  maxMembers: number;
  leaderName: string;
}

export default function DiscoverCirclesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [circles, setCircles] = useState<DiscoverCircle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [formingOnly, setFormingOnly] = useState(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/circles?status=forming,active`);
      const data = (await res.json()) as DiscoverCircle[];
      setCircles(Array.isArray(data) ? data : []);
    } catch {
      setCircles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function requestToJoin(circleId: string) {
    if (!profile?.id) return;
    setRequestingId(circleId);
    try {
      await fetch(`${getApiUrl()}/circles/${circleId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id }),
      });
      Alert.alert("Request sent", "The circle leader will review your request.");
    } catch {
      Alert.alert("Couldn't send request", "Please try again.");
    } finally {
      setRequestingId(null);
    }
  }

  const searchLower = search.trim().toLowerCase();
  const filtered = circles.filter((c) => {
    if (openOnly && c.circleType !== "open") return false;
    if (formingOnly && c.status !== "forming") return false;
    if (searchLower && !c.name.toLowerCase().includes(searchLower) && !(c.description ?? "").toLowerCase().includes(searchLower)) return false;
    return true;
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Find a Circle</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search circles..." placeholderTextColor={colors.textMuted} />
      </View>

      <View style={styles.filterRow}>
        <TouchableOpacity style={[styles.filterChip, openOnly && styles.filterChipActive]} onPress={() => setOpenOnly((v) => !v)}>
          <Text style={[styles.filterChipText, openOnly && styles.filterChipTextActive]}>Open circles only</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterChip, formingOnly && styles.filterChipActive]} onPress={() => setFormingOnly((v) => !v)}>
          <Text style={[styles.filterChipText, formingOnly && styles.filterChipTextActive]}>Forming (not started)</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyStateText}>No circles match right now. Try starting your own.</Text>
          </View>
        ) : (
          filtered.map((c) => (
            <View key={c.id} style={styles.circleCard}>
              <View style={styles.circleTopRow}>
                <Text style={styles.circleName} numberOfLines={1}>{c.name}</Text>
                <View style={[styles.statusPill, c.status === "forming" && styles.statusPillForming]}>
                  <Text style={styles.statusPillText}>{c.status === "forming" ? "Forming" : "Active"}</Text>
                </View>
              </View>
              {c.description ? <Text style={styles.circleDesc} numberOfLines={2}>{c.description}</Text> : null}
              <Text style={styles.circleMeta}>
                Led by {c.leaderName} · {c.memberCount}/{c.maxMembers} members
                {c.timezone ? ` · ${c.timezone}` : ""} · {c.languageCode.toUpperCase()}
              </Text>
              <TouchableOpacity
                style={styles.joinBtn}
                onPress={() => requestToJoin(c.id)}
                disabled={requestingId === c.id}
              >
                {requestingId === c.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.joinBtnText}>Request to Join</Text>}
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, marginHorizontal: 20, marginTop: 16, paddingHorizontal: 12, paddingVertical: 10 },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 12 },
    filterChip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
    filterChipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    filterChipText: { fontSize: 11, color: c.textMid, fontFamily: "Inter_500Medium" },
    filterChipTextActive: { color: "#fff", fontWeight: "700" },
    scroll: { padding: 20 },
    emptyState: { alignItems: "center", paddingVertical: 40, gap: 12 },
    emptyStateText: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", paddingHorizontal: 20, lineHeight: 19 },
    circleCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 12 },
    circleTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    circleName: { flex: 1, fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    statusPill: { backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
    statusPillForming: { backgroundColor: "rgba(224,164,65,0.18)" },
    statusPillText: { fontSize: 10, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    circleDesc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6, lineHeight: 17 },
    circleMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
    joinBtn: { backgroundColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 12 },
    joinBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
