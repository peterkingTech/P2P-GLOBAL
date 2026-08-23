import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// "Who would you like to study with?" — the Kingdom School lesson entry
// point's person picker (Study Together Phase 1, discoverability slice).
// Only resolves WHO; the caller starts the call itself once a person is
// picked. Backed by GET /discipleship/study-partners/:userId, which unions
// the same relationship types p2p_start_direct_conversation already treats
// as eligible (active discipleship links, shared group membership) — never
// an unrestricted "browse all users" list.

interface StudyPartner {
  id: string; name: string; username: string | null; photoUrl: string | null;
  country: string | null; relationship: "peer_guide" | "disciple" | "connection";
}

const RELATIONSHIP_LABEL: Record<StudyPartner["relationship"], string> = {
  peer_guide: "Peer Guide", disciple: "Your Disciple", connection: "Connection",
};

export function StudyPartnerPicker({
  visible, onClose, onSelectPerson,
}: { visible: boolean; onClose: () => void; onSelectPerson: (person: { id: string; name: string }) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [people, setPeople] = useState<StudyPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible || !user?.id) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`${getApiUrl()}/discipleship/study-partners/${user.id}`)
      .then((res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data) => { if (!cancelled) setPeople(data.people ?? []); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, user?.id]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Who would you like to study with?</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centerFill}><ActivityIndicator color="#1D9E75" /></View>
          ) : error ? (
            <Text style={styles.emptyText}>Couldn't load your connections. Please try again.</Text>
          ) : people.length === 0 ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.emptyText}>You don't have anyone available to study with yet.</Text>
              <TouchableOpacity style={styles.connectBtn} onPress={() => { onClose(); router.push("/connect" as any); }}>
                <Text style={styles.connectBtnText}>Find Someone to Connect With</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              {people.map((p) => (
                <TouchableOpacity key={p.id} style={styles.personRow} onPress={() => onSelectPerson({ id: p.id, name: p.name })}>
                  {p.photoUrl ? (
                    <Image source={{ uri: p.photoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.avatarInitial}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{p.name}</Text>
                    <Text style={styles.personRelationship}>{RELATIONSHIP_LABEL[p.relationship]}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8, minHeight: 200 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 12 },
  title: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1 },
  centerFill: { paddingVertical: 32, alignItems: "center" },
  emptyText: { color: "rgba(255,255,255,0.65)", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, paddingVertical: 8 },
  connectBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  connectBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  personRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1A241E", borderRadius: 14, padding: 12, marginBottom: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  personName: { color: "#fff", fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  personRelationship: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});