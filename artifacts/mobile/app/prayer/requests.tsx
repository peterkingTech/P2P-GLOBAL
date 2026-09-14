import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getOpenPrayerRequests, commitToPray, type OpenPrayerRequest } from "@/lib/prayerCoordinationApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const MODE_LABEL: Record<string, string> = { pray_for_me: "Pray for me", pray_with_me: "Pray with me", both: "Pray for me or with me" };

// Prayer 2.0 Stage 4 — completes Stage 2's own "Prayer Requests" area,
// which the dashboard never actually built a browse view for. This is
// deliberately NOT a social feed: no reactions, no counts, no comments —
// just real open requests and a real "I will pray for this" commitment.
export default function PrayerRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<OpenPrayerRequest[]>([]);
  const [committing, setCommitting] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await getOpenPrayerRequests());
    } catch (e: any) {
      showAlert("Couldn't load prayer requests", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleCommit(request: OpenPrayerRequest) {
    setCommitting(request.id);
    try {
      await commitToPray(request.id);
      setCommitted((prev) => new Set(prev).add(request.id));
    } catch (e: any) {
      showAlert("Couldn't record your commitment", e.message ?? "Please try again.");
    } finally {
      setCommitting(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Prayer Requests</Text>
        <TouchableOpacity onPress={() => router.push("/prayer/pray-with-me" as any)} accessibilityLabel="Share a request">
          <Ionicons name="add-circle" size={26} color={c.accentGreen} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
        ) : requests.length === 0 ? (
          <Text style={styles.emptyText}>No open prayer requests from peers right now.</Text>
        ) : (
          requests.map((r) => (
            <View key={r.id} style={styles.card}>
              <Text style={styles.cardOwner}>{r.ownerName ?? "Someone"}</Text>
              <Text style={styles.cardTitle}>{r.title}</Text>
              <Text style={styles.cardPoint}>{r.prayerPoint}</Text>
              <Text style={styles.cardMode}>{MODE_LABEL[r.prayerMode]}</Text>
              <TouchableOpacity
                style={[styles.commitBtn, committed.has(r.id) && styles.commitBtnDone]}
                onPress={() => handleCommit(r)}
                disabled={committing === r.id || committed.has(r.id)}
              >
                {committing === r.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.commitBtnText}>{committed.has(r.id) ? "🙏 Committed" : "I will pray for this"}</Text>
                )}
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
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 10 },
    cardOwner: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    cardPoint: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 19 },
    cardMode: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 8 },
    commitBtn: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 10 },
    commitBtnDone: { backgroundColor: c.accentGreen, opacity: 0.7 },
    commitBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  });
}
