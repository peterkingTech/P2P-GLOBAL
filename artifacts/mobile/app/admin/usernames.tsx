import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { validateUsername, formatUsername } from "@/lib/username";
import colors from "@/constants/colors";

type Tab = "reserved" | "search" | "flagged";

interface ReservedUsername {
  id: string;
  username: string;
  reason: string | null;
  reservedAt: string;
}

interface SearchResult {
  userId: string;
  username: string | null;
  fullName: string | null;
  email: string | null;
  country: string | null;
  role: string;
  isPrivate: boolean;
  createdAt: string;
}

interface FlaggedAccount {
  userId: string;
  username: string | null;
  fullName: string | null;
  email: string | null;
  role: string;
  createdAt: string;
}

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "reserved", label: "Reserved" },
  { value: "search", label: "Search" },
  { value: "flagged", label: "Flagged" },
];

export default function AdminUsernamesScreen() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("reserved");

  const [reserved, setReserved] = useState<ReservedUsername[]>([]);
  const [reservedLoading, setReservedLoading] = useState(true);
  const [reserveModalOpen, setReserveModalOpen] = useState(false);
  const [reserveUsername, setReserveUsername] = useState("");
  const [reserveReason, setReserveReason] = useState("");
  const [reserving, setReserving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [flagged, setFlagged] = useState<FlaggedAccount[]>([]);
  const [flaggedLoading, setFlaggedLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const loadReserved = useCallback(async () => {
    setReservedLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/admin/reserved-usernames`);
      setReserved(await res.json());
    } finally {
      setReservedLoading(false);
    }
  }, []);

  const loadFlagged = useCallback(async () => {
    setFlaggedLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/admin/flagged-usernames`);
      setFlagged(await res.json());
    } finally {
      setFlaggedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "reserved") loadReserved();
    if (tab === "flagged") loadFlagged();
  }, [tab, loadReserved, loadFlagged]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${getApiUrl()}/admin/username-search?q=${encodeURIComponent(searchQuery.trim())}`);
        setSearchResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  async function handleReserve() {
    const clean = formatUsername(reserveUsername);
    const check = validateUsername(clean);
    if (!check.valid) {
      Alert.alert("Invalid username", check.error ?? "Please enter a valid username");
      return;
    }
    setReserving(true);
    try {
      const res = await fetch(`${getApiUrl()}/admin/reserved-usernames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: clean, reason: reserveReason.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        Alert.alert("Couldn't reserve", body.error ?? "Something went wrong");
        return;
      }
      setReserveModalOpen(false);
      setReserveUsername("");
      setReserveReason("");
      loadReserved();
    } finally {
      setReserving(false);
    }
  }

  function confirmUnreserve(username: string) {
    Alert.alert(`Unreserve @${username}?`, "This username will become claimable by anyone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unreserve", style: "destructive", onPress: async () => {
          setActingId(username);
          try {
            await fetch(`${getApiUrl()}/admin/reserved-usernames/${encodeURIComponent(username)}`, { method: "DELETE" });
            setReserved((prev) => prev.filter((r) => r.username !== username));
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  }

  function confirmForceChange(result: SearchResult) {
    if (!result.username) return;
    Alert.alert(`Force @${result.username} to change username?`, "They'll be required to pick a new username the next time they open the app.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Force Change", style: "destructive", onPress: async () => {
          setActingId(result.userId);
          try {
            await fetch(`${getApiUrl()}/admin/force-username-change/${result.userId}`, { method: "POST" });
            Alert.alert("Done", `@${result.username} will be prompted to change their username.`);
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  }

  async function handleDismissFlag(userId: string) {
    setActingId(userId);
    try {
      await fetch(`${getApiUrl()}/admin/dismiss-username-flag/${userId}`, { method: "POST" });
      setFlagged((prev) => prev.filter((f) => f.userId !== userId));
    } finally {
      setActingId(null);
    }
  }

  async function handleForceChangeFromFlagged(userId: string) {
    setActingId(userId);
    try {
      await fetch(`${getApiUrl()}/admin/force-username-change/${userId}`, { method: "POST" });
      Alert.alert("Confirmed", "This account remains flagged for a required username change.");
    } finally {
      setActingId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.value}
            style={[styles.filterChip, tab === t.value && styles.filterChipActive]}
            onPress={() => setTab(t.value)}
          >
            <Text style={[styles.filterChipText, tab === t.value && styles.filterChipTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "reserved" && (
        <>
          <TouchableOpacity style={styles.reserveBtn} onPress={() => setReserveModalOpen(true)}>
            <Ionicons name="add-circle" size={16} color="#fff" />
            <Text style={styles.reserveBtnText}>Reserve a Username</Text>
          </TouchableOpacity>
          {reservedLoading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
          ) : (
            <FlatList
              data={reserved}
              keyExtractor={(r) => r.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.emptyText}>No reserved usernames.</Text>}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardUsername}>@{item.username}</Text>
                    {item.reason && <Text style={styles.cardSub}>{item.reason}</Text>}
                  </View>
                  <TouchableOpacity
                    style={styles.actionBtnOutline}
                    onPress={() => confirmUnreserve(item.username)}
                    disabled={actingId === item.username}
                  >
                    {actingId === item.username ? (
                      <ActivityIndicator size="small" color="#B91C1C" />
                    ) : (
                      <Text style={styles.actionBtnOutlineTextDanger}>Unreserve</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </>
      )}

      {tab === "search" && (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search username, name, or email (includes private profiles)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={colors.textMuted} />}
          </View>
          <FlatList
            data={searchResults}
            keyExtractor={(r) => r.userId}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              searchQuery.trim().length >= 2 && !searching ? (
                <Text style={styles.emptyText}>No matches.</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardUsername}>{item.username ? `@${item.username}` : "(no username)"}</Text>
                  <Text style={styles.cardSub}>{item.fullName ?? "Unnamed"} · {item.email ?? "no email"}</Text>
                  <Text style={styles.cardSub}>{item.role} {item.isPrivate ? "· private profile" : ""}</Text>
                </View>
                {item.username && (
                  <TouchableOpacity
                    style={styles.actionBtnOutline}
                    onPress={() => confirmForceChange(item)}
                    disabled={actingId === item.userId}
                  >
                    {actingId === item.userId ? (
                      <ActivityIndicator size="small" color={colors.accentGreen} />
                    ) : (
                      <Text style={styles.actionBtnOutlineText}>Force Change</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        </>
      )}

      {tab === "flagged" && (
        flaggedLoading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <FlatList
            data={flagged}
            keyExtractor={(f) => f.userId}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>No accounts flagged for a required username change.</Text>}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardUsername}>{item.username ? `@${item.username}` : "(no username)"}</Text>
                  <Text style={styles.cardSub}>{item.fullName ?? "Unnamed"} · {item.email ?? "no email"}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    style={styles.actionBtnOutline}
                    onPress={() => handleForceChangeFromFlagged(item.userId)}
                    disabled={actingId === item.userId}
                  >
                    <Text style={styles.actionBtnOutlineText}>Confirm</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtnOutline}
                    onPress={() => handleDismissFlag(item.userId)}
                    disabled={actingId === item.userId}
                  >
                    {actingId === item.userId ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <Text style={styles.actionBtnOutlineTextMuted}>Dismiss</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      )}

      <Modal visible={reserveModalOpen} transparent animationType="fade" onRequestClose={() => setReserveModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reserve a Username</Text>
            <TextInput
              style={styles.modalInput}
              value={reserveUsername}
              onChangeText={setReserveUsername}
              placeholder="username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.modalInput}
              value={reserveReason}
              onChangeText={setReserveReason}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setReserveModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleReserve} disabled={reserving}>
                {reserving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalConfirmText}>Reserve</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { flexDirection: "row", gap: 8, flexWrap: "wrap", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  filterChipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  filterChipText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  filterChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 30 },
  reserveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.accentGreen, marginHorizontal: 14, marginTop: 12,
    borderRadius: 10, height: 42,
  },
  reserveBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 14,
  },
  cardUsername: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  actionBtnOutline: { borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 70, alignItems: "center" },
  actionBtnOutlineText: { fontSize: 12, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  actionBtnOutlineTextDanger: { fontSize: 12, fontWeight: "700", color: "#B91C1C", fontFamily: "Inter_700Bold" },
  actionBtnOutlineTextMuted: { fontSize: 12, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, marginHorizontal: 14, marginTop: 12, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 400, backgroundColor: colors.card, borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, marginBottom: 14, fontFamily: "Inter_700Bold" },
  modalInput: {
    backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, padding: 12, color: colors.textDark, fontSize: 14,
    fontFamily: "Inter_400Regular", marginBottom: 12,
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalCancelBtn: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 14, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  modalConfirmBtn: { flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center" },
  modalConfirmText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
});
