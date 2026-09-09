import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import {
  getFamilyDetail, startFamilyWorship, getFamilyPrayerRequests, removeFamilyMember,
  type FamilyDetailResponse, type FamilyPrayerRequest,
} from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// One specific family's home screen — reached from MY FAMILIES
// (app/family/index.tsx). Everything here is scoped to this familyId only;
// a user who belongs to several families sees each one's own independent
// roster, prayer list, and Family Media sessions when they open it.
export default function FamilyDetailScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<FamilyDetailResponse | null>(null);
  const [openPrayerCount, setOpenPrayerCount] = useState(0);
  const [startingWorship, setStartingWorship] = useState(false);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      const res = await getFamilyDetail(familyId);
      setData(res);
      const prayers = await getFamilyPrayerRequests(familyId);
      setOpenPrayerCount(prayers.filter((p: FamilyPrayerRequest) => p.status === "open").length);
    } catch (e: any) {
      showAlert("Couldn't load this family", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  async function handleStartWorship() {
    if (!data?.family) return;
    setStartingWorship(true);
    try {
      const session = await startFamilyWorship(data.family.id);
      router.push({ pathname: "/family/worship/[sessionId]", params: { sessionId: session.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't start", e.message ?? "Please try again.");
    } finally {
      setStartingWorship(false);
    }
  }

  function handleLeaveFamily() {
    if (!data?.family || !profile?.id) return;
    const familyName = data.family.name;
    Alert.alert(`Leave ${familyName}?`, "You can be invited back later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave", style: "destructive", onPress: async () => {
          try {
            await removeFamilyMember(data.family.id, profile.id);
            router.replace("/family" as any);
          } catch (e: any) {
            showAlert("Couldn't leave family", e.message ?? "Please try again.");
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Family" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  if (!data?.family) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Stack.Screen options={{ title: "Family" }} />
        <Text style={{ color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" }}>
          You're not a member of this family.
        </Text>
      </View>
    );
  }

  const isShepherd = data.myRole === "shepherd";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: data.family.name }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <View style={styles.headerCard}>
          <Text style={styles.familyName}>{data.family.name}</Text>
          <Text style={styles.familySub}>{data.members.length} member{data.members.length === 1 ? "" : "s"}</Text>
          <TouchableOpacity style={styles.worshipBtn} onPress={handleStartWorship} disabled={startingWorship}>
            {startingWorship ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Text style={styles.worshipBtnIcon}>📺</Text>
                <Text style={styles.worshipBtnText}>Start Family Media</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.navRow}
          onPress={() => router.push({ pathname: "/family/members", params: { familyId } } as any)}
          accessibilityRole="button"
        >
          <View style={styles.navRowIcon}><Ionicons name="people" size={20} color={c.primaryGreen} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navRowTitle}>Family Members</Text>
            <Text style={styles.navRowSub}>{data.members.length} member{data.members.length === 1 ? "" : "s"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navRow}
          onPress={() => router.push({ pathname: "/family/prayer", params: { familyId } } as any)}
          accessibilityRole="button"
        >
          <View style={styles.navRowIcon}><Text style={{ fontSize: 18 }}>🙏</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navRowTitle}>Family Prayer</Text>
            <Text style={styles.navRowSub}>{openPrayerCount > 0 ? `${openPrayerCount} open request${openPrayerCount === 1 ? "" : "s"}` : "No open requests"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
        </TouchableOpacity>

        {!isShepherd && (
          <TouchableOpacity style={styles.leaveRow} onPress={handleLeaveFamily} accessibilityRole="button">
            <Ionicons name="exit-outline" size={18} color={c.textMuted} />
            <Text style={styles.leaveText}>Leave this family</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 14 },

    headerCard: {
      backgroundColor: c.primaryGreen, borderRadius: 18, padding: 20, gap: 4,
    },
    familyName: { fontSize: 20, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    familySub: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
    worshipBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 12, paddingVertical: 13, marginTop: 14,
    },
    worshipBtnIcon: { fontSize: 16 },
    worshipBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

    navRow: {
      flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.borderBeige, padding: 16,
    },
    navRowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    navRowTitle: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    navRowSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

    leaveRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10 },
    leaveText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium" },
  });
}
