import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";
import { getFlagEmoji } from "@/lib/countryGeo";
import colors from "@/constants/colors";

interface FoundProfile {
  userId: string; username: string; fullName: string | null; photoUrl: string | null;
  country: string | null; modulesCompleted: number | null; activeMenteesCount: number | null;
}
interface CircleOption { id: string; name: string }

type RequestType = "connect" | "peer_guide" | "circle_invite";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function ConnectByUsernameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ type?: string }>();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<FoundProfile | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [requestType, setRequestType] = useState<RequestType>(params.type === "peer_guide" ? "peer_guide" : "connect");
  const [myCircles, setMyCircles] = useState<CircleOption[]>([]);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    fetch(`${getApiUrl()}/circles?leaderId=${profile.id}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setMyCircles(data.map((c: any) => ({ id: c.id, name: c.name }))); })
      .catch(() => {});
  }, [profile?.id]);

  async function handleSearch() {
    const clean = query.trim().replace(/^@/, "");
    if (!clean) return;
    setSearching(true);
    setSearchError(null);
    setFound(null);
    try {
      const res = await fetch(`${getApiUrl()}/profiles/username/${encodeURIComponent(clean)}${profile?.id ? `?viewerId=${profile.id}` : ""}`);
      if (!res.ok) { setSearchError(`No one found for @${clean}`); return; }
      const data = await res.json();
      setFound(data);
    } catch {
      setSearchError("Couldn't search right now. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleSend() {
    if (!profile?.id || !found) return;
    if (requestType === "circle_invite" && !selectedCircleId) {
      showAlert("Choose a circle", "Select which circle you'd like to invite them to.");
      return;
    }
    setSending(true);
    try {
      if (requestType === "peer_guide") {
        const res = await authedFetch("/discipleship/request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ learnerId: profile.id, peerGuideId: found.userId, message: message.trim() || undefined, source: "direct" }),
        });
        if (!res.ok) { const body = await res.json(); showAlert("Couldn't send request", body.error ?? "Please try again."); return; }
      } else {
        const res = await fetch(`${getApiUrl()}/connections/request`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromUserId: profile.id, toUserId: found.userId, requestType,
            circleId: requestType === "circle_invite" ? selectedCircleId : undefined,
            message: message.trim() || undefined,
          }),
        });
        if (!res.ok) { const body = await res.json(); showAlert("Couldn't send request", body.error ?? "Please try again."); return; }
      }
      showAlert("Request sent", `@${found.username} will be notified.`);
      router.back();
    } finally {
      setSending(false);
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{params.type === "peer_guide" ? "Choose Someone I Know" : "Find Someone by Username"}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.searchRow}>
          <Text style={styles.atPrefix}>@</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={searching}>
            {searching ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
        {searchError && <Text style={styles.searchErrorText}>{searchError}</Text>}

        {found && (
          <>
            <View style={styles.previewCard}>
              <View style={styles.previewAvatar}>
                <Text style={styles.previewAvatarText}>{(found.fullName ?? found.username).charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewUsername}>@{found.username}</Text>
                <Text style={styles.previewMeta}>
                  {found.fullName ?? "Someone"}{found.country ? ` · ${getFlagEmoji(found.country)} ${found.country}` : ""}
                  {found.modulesCompleted != null ? ` · Module ${found.modulesCompleted}` : ""}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Connection type</Text>
            <View style={styles.typeOptions}>
              <TouchableOpacity style={styles.typeRow} onPress={() => setRequestType("connect")}>
                <Ionicons name={requestType === "connect" ? "radio-button-on" : "radio-button-off"} size={18} color={colors.accentGreen} />
                <Text style={styles.typeRowText}>Connect (follow each other)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.typeRow} onPress={() => setRequestType("peer_guide")}>
                <Ionicons name={requestType === "peer_guide" ? "radio-button-on" : "radio-button-off"} size={18} color={colors.accentGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeRowText}>Request as Peer Guide</Text>
                  <Text style={styles.typeRowSub}>Ask {found.fullName ?? `@${found.username}`} to guide you through the curriculum</Text>
                </View>
              </TouchableOpacity>
              {myCircles.length > 0 && (
                <TouchableOpacity style={styles.typeRow} onPress={() => setRequestType("circle_invite")}>
                  <Ionicons name={requestType === "circle_invite" ? "radio-button-on" : "radio-button-off"} size={18} color={colors.accentGreen} />
                  <Text style={styles.typeRowText}>Invite to a Circle</Text>
                </TouchableOpacity>
              )}
            </View>

            {requestType === "circle_invite" && myCircles.length > 0 && (
              <View style={styles.circlePicker}>
                {myCircles.map((c) => (
                  <TouchableOpacity key={c.id} style={[styles.circleChip, selectedCircleId === c.id && styles.circleChipActive]} onPress={() => setSelectedCircleId(c.id)}>
                    <Text style={[styles.circleChipText, selectedCircleId === c.id && styles.circleChipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {requestType !== "circle_invite" && (
              <>
                <Text style={styles.sectionLabel}>Optional message</Text>
                <TextInput
                  style={styles.messageInput}
                  value={message}
                  onChangeText={(v) => setMessage(v.slice(0, 200))}
                  placeholder={requestType === "peer_guide" ? "Tell them why you would like them to be your Peer Guide…" : "We met at the conference in Seoul..."}
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
                <Text style={styles.charCount}>{message.length}/200</Text>
              </>
            )}

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setFound(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={sending}>
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendBtnText}>Send Request</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, gap: 12 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  content: { padding: 20 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12 },
  atPrefix: { color: colors.textMid, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.textDark, fontFamily: "Inter_400Regular" },
  searchBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center" },
  searchErrorText: { color: "#B91C1C", fontSize: 13, marginTop: 10, fontFamily: "Inter_400Regular" },
  previewCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginTop: 20 },
  previewAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
  previewAvatarText: { fontSize: 17, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  previewUsername: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  previewMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, marginTop: 20, marginBottom: 10, fontFamily: "Inter_600SemiBold" },
  typeOptions: { gap: 12 },
  typeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  typeRowText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_500Medium" },
  typeRowSub: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  circlePicker: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  circleChip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  circleChipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  circleChipText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  circleChipTextActive: { color: "#fff", fontWeight: "700" },
  messageInput: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12, minHeight: 70, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
  charCount: { fontSize: 11, color: colors.textMuted, textAlign: "right", marginTop: 4, fontFamily: "Inter_400Regular" },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 24 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  cancelBtnText: { color: colors.textMid, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sendBtn: { flex: 1, backgroundColor: colors.accentGreen, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
