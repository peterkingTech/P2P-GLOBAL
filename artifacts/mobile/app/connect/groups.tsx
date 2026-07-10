import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PeerGroup } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function Groups() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getGroups, joinGroup, leaveGroup, createGroup } = useData();
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setGroups(await getGroups());
    setLoading(false);
  }, [getGroups]);

  useEffect(() => { load(); }, [load]);

  async function toggleMembership(g: PeerGroup) {
    setBusyId(g.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const err = g.isMember ? await leaveGroup(g.id) : await joinGroup(g.id);
    if (!err) await load();
    setBusyId(null);
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    const err = await createGroup(newName, newDesc || null);
    setCreating(false);
    if (err) {
      setCreateError(err);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCreateOpen(false);
    setNewName("");
    setNewDesc("");
    await load();
  }

  return (
    <>
      <Stack.Screen options={{ title: "Groups" }} />
      <View style={{ flex: 1, backgroundColor: colors.lightCream }}>
        <TouchableOpacity
          style={styles.createBar}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCreateOpen(true); }}
        >
          <Ionicons name="add-circle" size={20} color={colors.primaryGreen} />
          <Text style={styles.createBarText}>Start a new group</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.primaryGreen} />
        ) : (
          <FlatList
            style={styles.container}
            data={groups}
            keyExtractor={(g) => g.id}
            contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: insets.bottom + 60 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-circle-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>No groups have been created yet. Be the first to start one!</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={item.isMember || item.isCreator ? 0.7 : 1}
                onPress={() => {
                  if (item.isMember || item.isCreator) router.push({ pathname: "/connect/group/[id]", params: { id: item.id } });
                }}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name="people" size={20} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  {!!item.description && <Text style={styles.desc}>{item.description}</Text>}
                  <Text style={styles.meta}>
                    {item.memberCount} member{item.memberCount === 1 ? "" : "s"}
                    {item.isCreator ? " · You created this" : ""}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.joinBtn, item.isMember && styles.leaveBtn]}
                  onPress={() => toggleMembership(item)}
                  disabled={busyId === item.id}
                >
                  <Text style={[styles.joinBtnText, item.isMember && styles.leaveBtnText]}>
                    {busyId === item.id ? "..." : item.isMember ? "Leave" : "Join"}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Group</Text>
              <TouchableOpacity onPress={() => setCreateOpen(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Group name"
              placeholderTextColor={colors.textMuted}
              value={newName}
              onChangeText={setNewName}
              maxLength={60}
            />
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="What's this group about? (optional)"
              placeholderTextColor={colors.textMuted}
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
              maxLength={200}
            />
            {!!createError && <Text style={styles.errorText}>{createError}</Text>}
            <TouchableOpacity
              style={[styles.submitBtn, (!newName.trim() || creating) && styles.submitBtnDisabled]}
              onPress={handleCreate}
              disabled={!newName.trim() || creating}
            >
              <Text style={styles.submitBtnText}>{creating ? "Creating..." : "Create Group"}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  createBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 20, marginTop: 16, marginBottom: 4,
    backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(29,158,117,0.2)",
    paddingVertical: 12, paddingHorizontal: 14,
  },
  createBarText: { color: colors.primaryGreen, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  cardIcon: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: "Inter_400Regular" },
  joinBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  leaveBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.textMuted },
  joinBtnText: { color: "#fff", fontWeight: "700", fontSize: 12, fontFamily: "Inter_700Bold" },
  leaveBtnText: { color: colors.textMuted },
  empty: { alignItems: "center", gap: 12, marginTop: 60, paddingHorizontal: 30 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  input: {
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12,
    fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", marginBottom: 12,
  },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  errorText: { color: "#D64545", fontSize: 12, marginBottom: 10, fontFamily: "Inter_400Regular" },
  submitBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
});
