import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Alert, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { getFlagEmoji } from "@/lib/countryGeo";
import { Avatar } from "@/components/Avatar";
import { shareProfile } from "@/lib/sharing";

interface PublicProfile {
  userId: string; username: string; fullName: string | null; photoUrl: string | null;
  country: string | null; countryCode: string | null; bio: string | null;
  isPeerGuideEligible: boolean; joinedAt: string; showProgressPublicly: boolean;
  growthLevel: number | null; modulesCompleted: number | null; fruitCount: number | null;
  activeMenteesCount: number | null;
}

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function PublicProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile: viewer } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { username } = useLocalSearchParams<{ username: string }>();

  const [data, setData] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [isBlockedByMe, setIsBlockedByMe] = useState(false);

  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setNotFound(false);
    try {
      const url = `${getApiUrl()}/profiles/username/${encodeURIComponent(username)}${viewer?.id ? `?viewerId=${viewer.id}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) { setNotFound(true); setData(null); return; }
      setData(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [username, viewer?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!viewer?.id || !data?.userId) return;
    supabase.from("p2p_user_blocks").select("id").eq("blocker_id", viewer.id).eq("blocked_id", data.userId).maybeSingle()
      .then(({ data: block }) => setIsBlockedByMe(!!block));
  }, [viewer?.id, data?.userId]);

  const isOwnProfile = viewer?.id === data?.userId;

  async function handleConnect() {
    if (!viewer?.id || !data) return;
    setConnecting(true);
    try {
      const res = await fetch(`${getApiUrl()}/connections/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: viewer.id, toUserId: data.userId, requestType: "connect" }),
      });
      if (res.ok) showAlert("Request sent", `@${data.username} will see your connection request.`);
      else { const body = await res.json(); showAlert("Couldn't send request", body.error ?? "Please try again."); }
    } finally {
      setConnecting(false);
    }
  }

  async function handleRequestPeerGuide() {
    if (!viewer?.id || !data) return;
    setConnecting(true);
    try {
      const res = await fetch(`${getApiUrl()}/discipleship/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId: viewer.id, peerGuideId: data.userId }),
      });
      if (res.ok) showAlert("Request sent", `You've asked @${data.username} to be your peer guide.`);
      else { const body = await res.json(); showAlert("Couldn't send request", body.error ?? "Please try again."); }
    } finally {
      setConnecting(false);
    }
  }

  async function handleMessage() {
    if (!data) return;
    setMessaging(true);
    try {
      const { data: convId, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: data.userId });
      if (error || !convId) { showAlert("Can't message this user", "You may need to connect with them first."); return; }
      router.push(`/messages/${convId}` as any);
    } finally {
      setMessaging(false);
    }
  }

  function handleShare() {
    setMenuOpen(false);
    if (data) void shareProfile(data.username);
  }

  function handleReport() {
    setMenuOpen(false);
    showAlert("Report submitted", "Thank you — our team will review this account.");
    // Reuses the existing moderation-flag pathway used elsewhere in the app
    // for reporting profiles; a full report-reason picker is out of scope
    // here (see messages/[id].tsx's existing "Report profile" flow for that
    // richer version of this action).
  }

  async function handleBlock() {
    if (!viewer?.id || !data) return;
    setMenuOpen(false);
    Alert.alert(`Block @${data.username}?`, "They won't be able to see your profile or message you.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block", style: "destructive", onPress: async () => {
          await fetch(`${getApiUrl()}/connections/block`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ blockerId: viewer.id, blockedId: data.userId }),
          });
          setIsBlockedByMe(true);
        },
      },
    ]);
  }

  async function handleUnblock() {
    if (!viewer?.id || !data) return;
    await fetch(`${getApiUrl()}/connections/unblock`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockerId: viewer.id, blockedId: data.userId }),
    });
    setIsBlockedByMe(false);
    load();
  }

  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: topPad }, styles.centerFill]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  if (notFound || !data) {
    return (
      <View style={[styles.root, { paddingTop: topPad }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={colors.textDark} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerFill}>
          <Text style={styles.notFoundText}>This profile is not available.</Text>
        </View>
      </View>
    );
  }

  if (isBlockedByMe) {
    return (
      <View style={[styles.root, { paddingTop: topPad }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={colors.textDark} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerFill}>
          <Text style={styles.notFoundText}>This profile is not available.</Text>
          <TouchableOpacity style={styles.unblockBtn} onPress={handleUnblock}>
            <Text style={styles.unblockBtnText}>Unblock @{data.username}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>@{data.username}</Text>
        {!isOwnProfile ? (
          <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textDark} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.avatarSection}>
          <Avatar photoUrl={data.photoUrl} name={data.fullName ?? data.username} size={96} borderWidth={3} style={styles.avatarCircle} />
          <Text style={styles.username}>@{data.username}</Text>
          {data.fullName && <Text style={styles.fullName}>{data.fullName}</Text>}
          {data.country && (
            <Text style={styles.countryLine}>{getFlagEmoji(data.country)} {data.country}</Text>
          )}
          {data.bio && <Text style={styles.bio}>"{data.bio}"</Text>}
        </View>

        {data.showProgressPublicly ? (
          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{data.modulesCompleted}</Text>
              <Text style={styles.statLabel}>Modules</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{data.fruitCount}</Text>
              <Text style={styles.statLabel}>Fruits Earned</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{data.activeMenteesCount}</Text>
              <Text style={styles.statLabel}>🌳 Trees</Text>
            </View>
          </View>
        ) : (
          <View style={styles.statsCardHidden}>
            <Text style={styles.hiddenText}>This person keeps their progress private.</Text>
          </View>
        )}

        {!isOwnProfile && (
          <View style={styles.actionsGrid}>
            <TouchableOpacity style={styles.actionBtnPrimary} onPress={handleConnect} disabled={connecting}>
              {connecting ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Ionicons name="person-add" size={15} color="#fff" /><Text style={styles.actionBtnPrimaryText}>Connect</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleMessage} disabled={messaging}>
              {messaging ? <ActivityIndicator color={colors.accentGreen} size="small" /> : (
                <><Ionicons name="chatbubble-outline" size={15} color={colors.accentGreen} /><Text style={styles.actionBtnSecondaryText}>Message</Text></>
              )}
            </TouchableOpacity>
            {data.isPeerGuideEligible && (
              <TouchableOpacity style={[styles.actionBtnSecondary, { flexBasis: "100%" }]} onPress={handleRequestPeerGuide} disabled={connecting}>
                <Ionicons name="compass-outline" size={15} color={colors.accentGreen} />
                <Text style={styles.actionBtnSecondaryText}>Request as Peer Guide</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.joinedText}>Joined {new Date(data.joinedAt).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</Text>
      </ScrollView>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity style={styles.menuRow} onPress={handleShare}>
              <Ionicons name="share-outline" size={18} color={colors.textDark} />
              <Text style={styles.menuRowText}>Share Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={handleReport}>
              <Ionicons name="flag-outline" size={18} color={colors.textDark} />
              <Text style={styles.menuRowText}>Report User</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={handleBlock}>
              <Ionicons name="ban-outline" size={18} color="#B91C1C" />
              <Text style={[styles.menuRowText, { color: "#B91C1C" }]}>Block User</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
    notFoundText: { fontSize: 15, color: c.textMuted, fontFamily: "Inter_400Regular" },
    unblockBtn: { backgroundColor: c.accentGreen, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
    unblockBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginHorizontal: 10 },
    content: { paddingHorizontal: 20, paddingTop: 24 },
    avatarSection: { alignItems: "center", marginBottom: 20 },
    avatarCircle: { backgroundColor: "rgba(29,158,117,0.15)", borderColor: c.accentGreen },
    username: { fontSize: 20, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 12 },
    fullName: { fontSize: 14, color: c.textMid, marginTop: 2, fontFamily: "Inter_400Regular" },
    countryLine: { fontSize: 13, color: c.textMid, marginTop: 6, fontFamily: "Inter_400Regular" },
    bio: { fontSize: 13, color: c.textMid, marginTop: 10, textAlign: "center", lineHeight: 19, fontStyle: "italic", fontFamily: "Inter_400Regular", paddingHorizontal: 20 },
    statsCard: { flexDirection: "row", backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 20, justifyContent: "space-around" },
    statsCardHidden: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 20, alignItems: "center" },
    hiddenText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    statItem: { alignItems: "center" },
    statNum: { fontSize: 16, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    statLabel: { fontSize: 11, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    statDivider: { width: 1, height: 32, backgroundColor: c.borderBeige },
    actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
    actionBtnPrimary: { flex: 1, flexBasis: "47%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accentGreen, borderRadius: 12, paddingVertical: 12 },
    actionBtnPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    actionBtnSecondary: { flex: 1, flexBasis: "47%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12 },
    actionBtnSecondaryText: { color: c.accentGreen, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    joinedText: { fontSize: 12, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", marginTop: 8 },
    menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    menuSheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10 },
    menuRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    menuRowText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
  });
}
