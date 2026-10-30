import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Platform, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { Avatar } from "@/components/Avatar";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { AppButton } from "@/components/ui";

// P2P Connections management hub — the "Discover -> P2P Connect -> Accept ->
// Communicate" lifecycle needs one place to see every stage of it, not just
// the incoming-only inbox connections/requests.tsx already provides (which
// also serves circle_invite requests and stays untouched). This screen is
// P2P connect-type only: Incoming / Sent / My P2P Connections / History.
// Reuses the same p2p_connection_requests table and the same
// respondToConnectionRequest helper the profile screen and requests inbox
// already use — no new backend concept, no new table.

type Tab = "incoming" | "sent" | "connected" | "history";

interface BaseRow {
  id: string;
  status: string;
  createdAt: string;
  respondedAt: string | null;
}
interface IncomingRow extends BaseRow {
  fromUserId: string; fromUserName: string; fromUsername: string | null; fromPhotoUrl: string | null;
}
interface SentRow extends BaseRow {
  toUserId: string; toUserName: string; toUsername: string | null; toPhotoUrl: string | null;
}
interface ConnectedRow extends BaseRow {
  otherUserId: string; otherUserName: string; otherUsername: string | null; otherPhotoUrl: string | null;
}
interface HistoryRow extends BaseRow {
  otherUserId: string; otherUserName: string; otherUsername: string | null; wasSentByMe: boolean;
}

export default function P2PConnectionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, supabase } = useAuth();
  const { respondToConnectionRequest } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [tab, setTab] = useState<Tab>("incoming");
  const [loading, setLoading] = useState(true);
  const [incoming, setIncoming] = useState<IncomingRow[]>([]);
  const [sent, setSent] = useState<SentRow[]>([]);
  const [connected, setConnected] = useState<ConnectedRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [inRes, sentRes, connRes, histRes] = await Promise.all([
        fetch(`${getApiUrl()}/connections/pending/${profile.id}`),
        fetch(`${getApiUrl()}/connections/sent/${profile.id}`),
        fetch(`${getApiUrl()}/connections/accepted/${profile.id}`),
        fetch(`${getApiUrl()}/connections/history/${profile.id}`),
      ]);
      const [inBody, sentBody, connBody, histBody] = await Promise.all([
        inRes.json(), sentRes.json(), connRes.json(), histRes.json(),
      ]);
      // /pending also returns circle_invite requests — this screen is P2P
      // connect-only, circle invites stay on connections/requests.tsx.
      setIncoming((Array.isArray(inBody) ? inBody : []).filter((r: any) => r.requestType === "connect"));
      setSent(Array.isArray(sentBody) ? sentBody : []);
      setConnected(Array.isArray(connBody) ? connBody : []);
      setHistory(Array.isArray(histBody) ? histBody : []);
    } catch {
      setIncoming([]); setSent([]); setConnected([]); setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRespond(id: string, response: "accepted" | "declined") {
    setBusyId(id);
    const err = await respondToConnectionRequest(id, response);
    setBusyId(null);
    if (err) { Alert.alert("Couldn't respond", err); return; }
    load();
  }

  async function handleCancel(id: string) {
    if (!profile?.id) return;
    setBusyId(id);
    try {
      const res = await fetch(`${getApiUrl()}/connections/${id}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id }),
      });
      if (!res.ok) {
        const body = await res.json();
        Alert.alert("Couldn't cancel", body.error ?? "This request may have already been handled.");
      } else {
        load();
      }
    } catch {
      Alert.alert("Couldn't cancel", "Please check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMessage(targetId: string) {
    setBusyId(targetId);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: targetId });
      if (error || !data) {
        Alert.alert("Can't message yet", "This conversation isn't available.");
        return;
      }
      router.push(`/messages/${data}` as any);
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "incoming", label: "Incoming", count: incoming.length },
    { key: "sent", label: "Sent", count: sent.length },
    { key: "connected", label: "Connected", count: connected.length },
    { key: "history", label: "History", count: 0 },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="P2P Connections" />
      <View style={styles.tabRow}>
        {tabs.map((t) => (
          <TouchableOpacity accessibilityRole="button" key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>
              {t.label}{t.count > 0 ? ` (${t.count})` : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : tab === "incoming" ? (
        <FlatList
          data={incoming}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState icon="mail-unread-outline" text="No incoming P2P Connect requests." colors={colors} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Avatar photoUrl={item.fromPhotoUrl} name={item.fromUserName} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.fromUserName}</Text>
                  {item.fromUsername && <Text style={styles.username}>@{item.fromUsername}</Text>}
                  <Text style={styles.dateText}>Received {new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                {item.fromUsername && (
                  <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/profile/${item.fromUsername}` as any)}>
                    <Text style={styles.viewProfile}>View Profile</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.p2pLabel}>P2P Connect Request</Text>
              <View style={styles.btnRow}>
                <AppButton label="Decline" onPress={() => handleRespond(item.id, "declined")} variant="outline" disabled={busyId === item.id} style={{ flex: 1 }} />
                <AppButton label="Accept" onPress={() => handleRespond(item.id, "accepted")} disabled={busyId === item.id} loading={busyId === item.id} style={{ flex: 1 }} />
              </View>
            </View>
          )}
        />
      ) : tab === "sent" ? (
        <FlatList
          data={sent}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState icon="paper-plane-outline" text="No sent P2P Connect requests." colors={colors} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Avatar photoUrl={item.toPhotoUrl} name={item.toUserName} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.toUserName}</Text>
                  {item.toUsername && <Text style={styles.username}>@{item.toUsername}</Text>}
                  <Text style={styles.dateText}>Sent {new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                {item.toUsername && (
                  <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/profile/${item.toUsername}` as any)}>
                    <Text style={styles.viewProfile}>View Profile</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.pendingPill}>
                <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                <Text style={styles.pendingPillText}>P2P Connect Pending</Text>
              </View>
              <AppButton label="Cancel Request" onPress={() => handleCancel(item.id)} variant="outline" disabled={busyId === item.id} loading={busyId === item.id} style={{ marginTop: 10, flex: 1 }} />
            </View>
          )}
        />
      ) : tab === "connected" ? (
        <FlatList
          data={connected}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState icon="people-outline" text="No P2P Connections yet." colors={colors} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Avatar photoUrl={item.otherPhotoUrl} name={item.otherUserName} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.otherUserName}</Text>
                  {item.otherUsername && <Text style={styles.username}>@{item.otherUsername}</Text>}
                </View>
                {item.otherUsername && (
                  <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/profile/${item.otherUsername}` as any)}>
                    <Text style={styles.viewProfile}>View Profile</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.btnRow}>
                <View style={styles.connectedPill}>
                  <Ionicons name="checkmark" size={12} color={colors.primaryGreen} />
                  <Text style={styles.connectedPillText}>P2P Connected</Text>
                </View>
                <AppButton label="Message" onPress={() => handleMessage(item.otherUserId)} variant="secondary" size="sm" icon="chatbubble-outline" disabled={busyId === item.otherUserId} loading={busyId === item.otherUserId} />
              </View>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState icon="time-outline" text="No past request history." colors={colors} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Avatar photoUrl={null} name={item.otherUserName} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.otherUserName}</Text>
                  {item.otherUsername && <Text style={styles.username}>@{item.otherUsername}</Text>}
                  <Text style={styles.dateText}>
                    {item.wasSentByMe ? "You sent" : "They sent"} · {item.status === "declined" ? "Declined" : "Cancelled"}
                    {item.respondedAt ? ` · ${new Date(item.respondedAt).toLocaleDateString()}` : ""}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function EmptyState({ icon, text, colors }: { icon: keyof typeof Ionicons.glyphMap; text: string; colors: AppColors }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 }}>
      <Ionicons name={icon} size={36} color={colors.borderBeige} />
      <Text style={{ fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" }}>{text}</Text>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    tabRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
    tabBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    tabBtnActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tabBtnText: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    tabBtnTextActive: { color: "#fff" },
    listContent: { padding: 16, gap: 10 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14 },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    username: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    dateText: { fontSize: 11, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    viewProfile: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    p2pLabel: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", marginTop: 10, textTransform: "uppercase", letterSpacing: 0.5 },
    btnRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 },
    pendingPill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, marginTop: 10 },
    pendingPillText: { fontSize: 11, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold" },
    connectedPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
    connectedPillText: { fontSize: 11, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
  });
}
