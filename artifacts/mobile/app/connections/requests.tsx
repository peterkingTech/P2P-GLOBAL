import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import SettingsSubHeader from "@/components/SettingsSubHeader";

interface PendingRequest {
  id: string;
  fromUserId: string;
  fromUserName: string;
  fromUsername: string | null;
  fromCountry: string | null;
  requestType: "connect" | "circle_invite";
  message: string | null;
  createdAt: string;
}

export default function MessageRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { respondToConnectionRequest } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/connections/pending/${profile.id}`);
      const body = await res.json();
      setRequests(Array.isArray(body) ? body : []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRespond(id: string, response: "accepted" | "declined") {
    setResponding(id);
    const err = await respondToConnectionRequest(id, response);
    setResponding(null);
    if (err) return;
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Message Requests" />
      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : requests.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="checkmark-circle-outline" size={44} color={colors.borderBeige} />
          <Text style={styles.emptyText}>No pending requests</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.avatarCircle}>
                  <Ionicons name="person" size={20} color={colors.primaryGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.fromUserName}</Text>
                  {item.fromUsername && <Text style={styles.username}>@{item.fromUsername}</Text>}
                </View>
                {item.fromUsername && (
                  <TouchableOpacity onPress={() => router.push(`/profile/${item.fromUsername}` as any)}>
                    <Text style={styles.viewProfile}>View Profile</Text>
                  </TouchableOpacity>
                )}
              </View>
              {item.message && <Text style={styles.message}>{item.message}</Text>}
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={styles.declineBtn}
                  disabled={responding === item.id}
                  onPress={() => handleRespond(item.id, "declined")}
                >
                  <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.acceptBtn}
                  disabled={responding === item.id}
                  onPress={() => handleRespond(item.id, "accepted")}
                >
                  {responding === item.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.acceptBtnText}>Accept</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    emptyText: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14 },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatarCircle: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(29,158,117,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    name: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    username: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    viewProfile: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    message: { fontSize: 13, color: c.textMid, marginTop: 10, fontFamily: "Inter_400Regular" },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    declineBtn: {
      flex: 1, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      height: 42, alignItems: "center", justifyContent: "center",
    },
    declineBtnText: { color: c.textMid, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    acceptBtn: {
      flex: 1, backgroundColor: c.accentGreen, borderRadius: 10,
      height: 42, alignItems: "center", justifyContent: "center",
    },
    acceptBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}