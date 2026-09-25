import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, DiscoverablePeer } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { Avatar } from "@/components/Avatar";
import SkillsMultiSelect from "@/components/SkillsMultiSelect";
import { skillLabel } from "@/constants/skillsTaxonomy";
import colors from "@/constants/colors";

// P2P Connection audit — Discovery used to show a Report/Flag icon and an
// always-available Message icon for every listed peer, regardless of any
// relationship. Per the "Discover -> Connect -> Accept -> Communicate"
// requirement: Report is removed from Discovery entirely (it still exists
// on the profile screen's menu and inside an actual conversation's
// long-press menu — a meaningful-interaction context, not a first-contact
// list), and Message is only offered once the backend's own
// p2p_can_contact_directly boundary (migration 166) actually permits
// direct contact — everyone else sees a P2P Connection action instead.
export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, supabase } = useAuth();
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const { getDiscoverablePeers, getDiscoveryRelationshipStatus } = useData();
  const [peers, setPeers] = useState<DiscoverablePeer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState<string[]>([]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);

  async function handleMessage(peer: DiscoverablePeer) {
    if (!peer.canContact) return;
    setMessaging(peer.id);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: peer.id });
      if (error || !data) {
        if (error?.message?.includes("age verification required")) {
          Alert.alert(
            "Add your date of birth",
            "Please add your date of birth in Settings before messaging other members.",
            [{ text: "Go to Settings", onPress: () => router.push("/settings/index" as any) }, { text: "Cancel", style: "cancel" }]
          );
        } else if (error?.message?.includes("adult and minor accounts")) {
          Alert.alert("Can't message this person", "This conversation isn't available.");
        } else {
          Alert.alert("Can't message yet", "Connect with this person first to start a conversation.");
        }
        return;
      }
      router.push(`/messages/${data}` as any);
    } finally {
      setMessaging(null);
    }
  }

  async function handleConnect(peer: DiscoverablePeer) {
    if (!profile?.id || peer.connectionStatus !== "none") return;
    setConnecting(peer.id);
    try {
      const res = await fetch(`${getApiUrl()}/connections/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: profile.id, toUserId: peer.id, requestType: "connect" }),
      });
      if (res.ok) {
        const row = await res.json();
        setPeers((prev) => prev.map((p) => (p.id === peer.id ? { ...p, connectionStatus: "pending_sent", connectionRequestId: row.id } : p)));
      } else {
        const body = await res.json();
        Alert.alert("Couldn't send request", body.error ?? "Please try again.");
      }
    } catch {
      Alert.alert("Couldn't send request", "Please check your connection and try again.");
    } finally {
      setConnecting(null);
    }
  }

  async function handleRespond(peer: DiscoverablePeer, response: "accepted" | "declined") {
    if (!profile?.id || !peer.connectionRequestId) return;
    setResponding(peer.id);
    try {
      const res = await fetch(`${getApiUrl()}/connections/${peer.connectionRequestId}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responderId: profile.id, response }),
      });
      if (res.ok) {
        setPeers((prev) => prev.map((p) => (p.id === peer.id
          ? { ...p, connectionStatus: response === "accepted" ? "connected" : "none", canContact: response === "accepted" ? true : p.canContact }
          : p)));
      } else {
        const body = await res.json();
        Alert.alert("Couldn't respond", body.error ?? "This request may have already been handled.");
      }
    } catch {
      Alert.alert("Couldn't respond", "Please check your connection and try again.");
    } finally {
      setResponding(null);
    }
  }

  const load = useCallback(async (q?: string, skills?: string[]) => {
    setLoading(true);
    const results = await getDiscoverablePeers(q, skills);
    setPeers(results);
    setLoading(false);
    // Relationship status loads in a second pass rather than blocking the
    // initial list render — the list itself (names/photos) doesn't depend
    // on it, only the action shown per row does.
    if (results.length > 0) {
      const statusById = await getDiscoveryRelationshipStatus(results.map((p) => p.id));
      setPeers((prev) => prev.map((p) => (statusById[p.id] ? { ...p, ...statusById[p.id] } : p)));
    }
  }, [getDiscoverablePeers, getDiscoveryRelationshipStatus]);

  useEffect(() => { load(search, skillFilter); }, [skillFilter, load]);

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
            onSubmitEditing={() => load(search, skillFilter)}
            returnKeyType="search"
          />
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.skillFilterBtn} onPress={() => setSkillPickerOpen(true)}>
            <Ionicons name="options-outline" size={14} color={colors.accentGreen} />
            <Text style={styles.skillFilterBtnText}>
              {skillFilter.length > 0 ? `Skills (${skillFilter.length})` : "Filter by skill"}
            </Text>
          </TouchableOpacity>
          {skillFilter.length > 0 && (
            <TouchableOpacity onPress={() => setSkillFilter([])}>
              <Text style={styles.clearFilterText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        {skillFilter.length > 0 && (
          <View style={styles.chipsWrap}>
            {skillFilter.map((s) => (
              <View key={s} style={styles.skillChip}>
                <Text style={styles.skillChipText}>{skillLabel(s)}</Text>
              </View>
            ))}
          </View>
        )}

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
              <TouchableOpacity
                style={[styles.row, item.id === highlight && styles.rowHighlight]}
                onPress={() => { if (item.username) router.push(`/profile/${item.username}` as any); }}
                disabled={!item.username}
                activeOpacity={0.8}
              >
                <Avatar photoUrl={item.photoUrl} name={item.fullName} size={44} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.fullName}</Text>
                  <Text style={styles.meta}>{item.country || "Unknown location"} · {item.role}</Text>
                  {item.skills.length > 0 && (
                    <Text style={styles.skillsMeta} numberOfLines={1}>
                      {item.skills.slice(0, 3).map(skillLabel).join(", ")}
                    </Text>
                  )}
                </View>
                {item.connectionStatus === "pending_received" ? (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={(e) => { e.stopPropagation(); handleRespond(item, "accepted"); }}
                      disabled={responding === item.id}
                    >
                      {responding === item.id ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineBtn}
                      onPress={(e) => { e.stopPropagation(); handleRespond(item, "declined"); }}
                      disabled={responding === item.id}
                    >
                      <Ionicons name="close" size={16} color={colors.accentGreen} />
                    </TouchableOpacity>
                  </View>
                ) : item.canContact ? (
                  <TouchableOpacity
                    style={styles.msgBtn}
                    onPress={(e) => { e.stopPropagation(); handleMessage(item); }}
                    disabled={messaging === item.id}
                  >
                    {messaging === item.id ? (
                      <ActivityIndicator size="small" color={colors.accentGreen} />
                    ) : (
                      <Ionicons name="chatbubble-outline" size={18} color={colors.accentGreen} />
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.connectBtn, item.connectionStatus === "pending_sent" && styles.connectBtnPending]}
                    onPress={(e) => { e.stopPropagation(); handleConnect(item); }}
                    disabled={connecting === item.id || item.connectionStatus === "pending_sent" || item.canContact === undefined}
                  >
                    {connecting === item.id || item.canContact === undefined ? (
                      <ActivityIndicator size="small" color={item.connectionStatus === "pending_sent" ? colors.accentGreen : "#fff"} />
                    ) : item.connectionStatus === "pending_sent" ? (
                      <Text style={styles.connectBtnPendingText}>Pending</Text>
                    ) : (
                      <><Ionicons name="add" size={14} color="#fff" /><Text style={styles.connectBtnText}>Connect</Text></>
                    )}
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      <SkillsMultiSelect
        visible={skillPickerOpen}
        initialSelected={skillFilter}
        onClose={() => setSkillPickerOpen(false)}
        onSave={(selected) => {
          setSkillFilter(selected);
          setSkillPickerOpen(false);
        }}
      />
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
  filterRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 20, marginTop: 10,
  },
  skillFilterBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  skillFilterBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  clearFilterText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: 20, marginTop: 8 },
  skillChip: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  skillChipText: { fontSize: 11, color: colors.textDark, fontFamily: "Inter_500Medium" },
  skillsMeta: { fontSize: 11, color: colors.accentGreen, marginTop: 2, fontFamily: "Inter_500Medium" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  rowHighlight: { borderColor: colors.primaryGreen, borderWidth: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  msgBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(29,158,117,0.08)" },
  acceptBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryGreen },
  declineBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.borderBeige },
  connectBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16, backgroundColor: colors.primaryGreen,
  },
  connectBtnPending: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderBeige },
  connectBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  connectBtnPendingText: { color: colors.textMuted, fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
