import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator, TextInput, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getInviteablePeople, sendCallInvitation, InviteablePerson } from "@/lib/callInvitations";

// Study Together C2 — "Add People" during an active call. Only resolves
// WHO to invite and sends the invitation; delivery/accept/decline all ride
// the existing incoming-call mechanism (call/incoming.tsx), not a second
// notification UI.

const RELATIONSHIP_LABEL: Record<InviteablePerson["relationship"], string> = {
  peer_guide: "Peer Guide", disciple: "Disciple", connection: "Connection",
};

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export function AddPeopleSheet({
  visible, onClose, callId,
}: { visible: boolean; onClose: () => void; callId: string }) {
  const [people, setPeople] = useState<InviteablePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [justInvited, setJustInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    getInviteablePeople(callId)
      .then((list) => { if (!cancelled) setPeople(list); })
      .catch(() => { if (!cancelled) setPeople([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, callId]);

  async function handleInvite(person: InviteablePerson) {
    setInvitingId(person.userId);
    try {
      await sendCallInvitation(callId, person.userId);
      setJustInvited((prev) => new Set(prev).add(person.userId));
    } catch (e: any) {
      showAlert("Couldn't invite this person", e?.message ?? "Please try again.");
    } finally {
      setInvitingId(null);
    }
  }

  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower ? people.filter((p) => p.displayName.toLowerCase().includes(searchLower)) : people;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Add People</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
          </View>
          <Text style={styles.sub}>Who would you like to add?</Text>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color="rgba(255,255,255,0.5)" />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search..."
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
          </View>

          {loading ? (
            <View style={styles.centerFill}><ActivityIndicator color="#1D9E75" /></View>
          ) : filtered.length === 0 ? (
            <Text style={styles.emptyText}>
              {people.length === 0 ? "You don't have anyone available to add right now." : "No matches."}
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 380 }}>
              {filtered.map((p) => {
                const pending = p.invitationPending || justInvited.has(p.userId);
                return (
                  <View key={p.userId} style={styles.personRow}>
                    <View style={styles.avatar}><Text style={styles.avatarInitial}>{p.displayName.charAt(0).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName}>{p.displayName}</Text>
                      <Text style={styles.personRelationship}>{RELATIONSHIP_LABEL[p.relationship]}</Text>
                    </View>
                    {pending ? (
                      <View style={styles.pendingChip}><Text style={styles.pendingChipText}>Invitation pending</Text></View>
                    ) : (
                      <TouchableOpacity style={styles.inviteBtn} onPress={() => handleInvite(p)} disabled={invitingId === p.userId}>
                        {invitingId === p.userId ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.inviteBtnText}>Invite</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, minHeight: 260 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1A241E",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 4,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  centerFill: { paddingVertical: 30, alignItems: "center" },
  emptyText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 20, textAlign: "center" },
  personRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1A241E", borderRadius: 14, padding: 12, marginBottom: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  personName: { color: "#fff", fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  personRelationship: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  inviteBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minWidth: 64, alignItems: "center" },
  inviteBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  pendingChip: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  pendingChipText: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_500Medium" },
});