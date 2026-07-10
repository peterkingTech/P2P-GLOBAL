import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, GroupMember, DiscoverablePeer, PeerGroup } from "@/contexts/DataContext";
import { Avatar } from "@/components/Avatar";
import colors from "@/constants/colors";

export default function GroupDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getGroups, getGroupMembers, addGroupMember, removeGroupMember, getDiscoverablePeers } = useData();
  const [group, setGroup] = useState<PeerGroup | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [peers, setPeers] = useState<DiscoverablePeer[]>([]);
  const [peersLoading, setPeersLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [groups, mems] = await Promise.all([getGroups(), getGroupMembers(id)]);
    setGroup(groups.find((g) => g.id === id) || null);
    setMembers(mems);
    setLoading(false);
  }, [getGroups, getGroupMembers, id]);

  useEffect(() => { load(); }, [load]);

  const loadPeers = useCallback(async (q?: string) => {
    setPeersLoading(true);
    setPeers(await getDiscoverablePeers(q));
    setPeersLoading(false);
  }, [getDiscoverablePeers]);

  function openAddModal() {
    setAddOpen(true);
    loadPeers();
  }

  async function handleAdd(peerId: string) {
    setBusyId(peerId);
    const err = await addGroupMember(id, peerId);
    setBusyId(null);
    if (!err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    }
  }

  async function handleRemove(userId: string) {
    setBusyId(userId);
    const err = await removeGroupMember(id, userId);
    setBusyId(null);
    if (!err) await load();
  }

  const memberIds = new Set(members.map((m) => m.userId));

  return (
    <>
      <Stack.Screen options={{ title: group?.name || "Group" }} />
      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.primaryGreen} />
        ) : (
          <>
            {!!group?.description && (
              <Text style={styles.desc}>{group.description}</Text>
            )}
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Members ({members.length})</Text>
              {group?.isCreator && (
                <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
                  <Ionicons name="person-add" size={16} color={colors.primaryGreen} />
                  <Text style={styles.addBtnText}>Add peer</Text>
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={members}
              keyExtractor={(m) => m.userId}
              contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: insets.bottom + 60 }}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <Avatar photoUrl={item.photoUrl} name={item.fullName} size={40} style={styles.avatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.fullName}</Text>
                    <Text style={styles.meta}>{item.role}</Text>
                  </View>
                  {group?.isCreator && item.userId !== group.peerGuideId && (
                    <TouchableOpacity onPress={() => handleRemove(item.userId)} disabled={busyId === item.userId}>
                      {busyId === item.userId ? (
                        <ActivityIndicator size="small" color={colors.textMuted} />
                      ) : (
                        <Ionicons name="close-circle-outline" size={22} color={colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
          </>
        )}
      </View>

      <Modal visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={[styles.modalContainer, { paddingTop: insets.top + 12 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add a Peer</Text>
            <TouchableOpacity onPress={() => setAddOpen(false)}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => loadPeers(search)}
              returnKeyType="search"
            />
          </View>
          {peersLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primaryGreen} />
          ) : (
            <FlatList
              data={peers}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No peers found.</Text>
                </View>
              }
              renderItem={({ item }) => {
                const already = memberIds.has(item.id);
                return (
                  <View style={styles.card}>
                    <Avatar photoUrl={item.photoUrl} name={item.fullName} size={40} style={styles.avatar} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.fullName}</Text>
                      <Text style={styles.meta}>{item.country || "Unknown location"} · {item.role}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.smallBtn, already && styles.smallBtnDisabled]}
                      onPress={() => handleAdd(item.id)}
                      disabled={already || busyId === item.id}
                    >
                      <Text style={styles.smallBtnText}>
                        {busyId === item.id ? "..." : already ? "Added" : "Add"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  desc: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 20, paddingTop: 16 },
  sectionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  addBtnText: { color: colors.primaryGreen, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  modalContainer: { flex: 1, backgroundColor: colors.lightCream },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 20, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  smallBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  smallBtnDisabled: { backgroundColor: colors.textMuted },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 12, fontFamily: "Inter_700Bold" },
  empty: { alignItems: "center", marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
