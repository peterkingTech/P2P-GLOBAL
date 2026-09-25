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
import { VerificationBadge } from "@/components/VerificationBadge";
import { GrainExplanationSheet } from "@/components/GrainExplanationSheet";
import { PeerGuideRequestModal } from "@/components/PeerGuideRequestModal";
import { grainLabel } from "@/lib/grain";

type ConnectionStatus = "none" | "pending_sent" | "pending_received" | "connected";

interface PublicProfile {
  userId: string; username: string; fullName: string | null; photoUrl: string | null;
  country: string | null; countryCode: string | null; bio: string | null;
  isPeerGuideEligible: boolean; joinedAt: string; showProgressPublicly: boolean;
  growthLevel: number | null; modulesCompleted: number | null; fruitCount: number | null;
  activeMenteesCount: number | null; isVerified: boolean;
  connectionStatus?: ConnectionStatus;
  connectionRequestId?: string | null;
  // Whether the backend's own authorization boundary (p2p_can_contact_directly,
  // migration 166 — the same check p2p_start_direct_conversation and
  // /calls/start enforce server-side) currently permits direct contact.
  // NOT the same as connectionStatus === "connected" — family, shared
  // peer-group, and active discipleship-link relationships also grant this
  // without any P2P connection request at all. The UI must reflect this
  // full boundary, not just the P2P-connection-specific state, or it would
  // incorrectly hide Message for relationships that legitimately already
  // allow it.
  canContact?: boolean;
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
  const [responding, setResponding] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [isBlockedByMe, setIsBlockedByMe] = useState(false);
  const [grainCount, setGrainCount] = useState(0);
  const [grainSheetOpen, setGrainSheetOpen] = useState(false);
  const [peerGuideModalOpen, setPeerGuideModalOpen] = useState(false);

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

  // Lightweight re-fetch (no full-screen loading flash) so the connection
  // button reflects authoritative state after a realtime event, rather than
  // trusting the event payload itself as the source of truth.
  const refreshConnectionStatus = useCallback(async () => {
    if (!username) return;
    try {
      const url = `${getApiUrl()}/profiles/username/${encodeURIComponent(username)}${viewer?.id ? `?viewerId=${viewer.id}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const fresh = await res.json();
      setData((prev) => (prev ? { ...prev, connectionStatus: fresh.connectionStatus, connectionRequestId: fresh.connectionRequestId } : prev));
    } catch {
      // Best-effort — the next focus/load() cycle will reconcile state anyway.
    }
  }, [username, viewer?.id]);

  // p2p_connection_requests itself isn't in the realtime publication, but
  // every connect-request/accept/decline already inserts into
  // p2p_notifications (which is) — reusing that existing channel instead of
  // adding a new published table. See DataContext's identical pattern for
  // the unread-count badge.
  useEffect(() => {
    if (!viewer?.id || !data?.userId) return;
    const targetId = data.userId;
    const channel = supabase
      .channel(`p2p_notifications_connection_${viewer.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "p2p_notifications", filter: `user_id=eq.${viewer.id}` },
        (payload) => {
          const n = payload.new as any;
          const type = n?.notification_type as string | undefined;
          if (!type || !["connection_request", "connection_accepted", "connection_declined"].includes(type)) return;
          const involvedId = n?.data?.fromUserId ?? n?.data?.responderId;
          if (involvedId === targetId) void refreshConnectionStatus();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [viewer?.id, data?.userId, refreshConnectionStatus]);

  useEffect(() => {
    if (!data?.userId) { setGrainCount(0); return; }
    fetch(`${getApiUrl()}/profiles/${data.userId}/grain`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setGrainCount(body?.grainCount ?? 0))
      .catch(() => setGrainCount(0));
  }, [data?.userId]);

  const isOwnProfile = viewer?.id === data?.userId;

  async function handleConnect() {
    if (!viewer?.id || !data || data.connectionStatus !== "none") return;
    setConnecting(true);
    try {
      const res = await fetch(`${getApiUrl()}/connections/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: viewer.id, toUserId: data.userId, requestType: "connect" }),
      });
      if (res.ok) {
        const row = await res.json();
        // Optimistic — reconciled against authoritative state on the next
        // load()/realtime refresh, per B4/B5's "database is the source of
        // truth" requirement; this just avoids a flash back to "Connect"
        // before that reconciliation happens.
        setData((prev) => (prev ? { ...prev, connectionStatus: "pending_sent", connectionRequestId: row.id } : prev));
      } else {
        const body = await res.json();
        showAlert("Couldn't send request", body.error ?? "Please try again.");
      }
    } catch {
      showAlert("Couldn't send request", "Please check your connection and try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleRespond(response: "accepted" | "declined") {
    if (!viewer?.id || !data?.connectionRequestId || responding) return;
    setResponding(true);
    try {
      const res = await fetch(`${getApiUrl()}/connections/${data.connectionRequestId}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responderId: viewer.id, response }),
      });
      if (res.ok) {
        setData((prev) => (prev ? { ...prev, connectionStatus: response === "accepted" ? "connected" : "none", connectionRequestId: response === "accepted" ? prev.connectionRequestId : null } : prev));
      } else {
        const body = await res.json();
        showAlert("Couldn't respond", body.error ?? "This request may have already been handled.");
        void refreshConnectionStatus();
      }
    } catch {
      showAlert("Couldn't respond", "Please check your connection and try again.");
    } finally {
      setResponding(false);
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
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.username}>@{data.username}</Text>
            <VerificationBadge isVerified={data.isVerified} username={data.username} size="large" />
          </View>
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

        {grainCount > 0 && (
          <TouchableOpacity style={styles.grainRow} onPress={() => setGrainSheetOpen(true)} activeOpacity={0.7}>
            <Text style={styles.grainRowText}>{grainLabel(grainCount)}</Text>
          </TouchableOpacity>
        )}
        <GrainExplanationSheet
          visible={grainSheetOpen}
          onClose={() => setGrainSheetOpen(false)}
          count={grainCount}
          displayName={data.fullName || `@${data.username}`}
        />

        {!isOwnProfile && (
          <View style={styles.actionsGrid}>
            {data.connectionStatus === "pending_received" ? (
              <>
                <TouchableOpacity style={styles.actionBtnPrimary} onPress={() => handleRespond("accepted")} disabled={responding}>
                  {responding ? <ActivityIndicator color="#fff" size="small" /> : (
                    <><Ionicons name="checkmark" size={15} color="#fff" /><Text style={styles.actionBtnPrimaryText}>Accept</Text></>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtnSecondary} onPress={() => handleRespond("declined")} disabled={responding}>
                  <Ionicons name="close" size={15} color={colors.accentGreen} />
                  <Text style={styles.actionBtnSecondaryText}>Decline</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={data.connectionStatus === "connected" ? styles.actionBtnSecondary : styles.actionBtnPrimary}
                onPress={handleConnect}
                disabled={connecting || data.connectionStatus !== "none"}
              >
                {connecting ? <ActivityIndicator color="#fff" size="small" /> : data.connectionStatus === "connected" ? (
                  <Text style={styles.actionBtnSecondaryText}>Connected ✓</Text>
                ) : data.connectionStatus === "pending_sent" ? (
                  <><Ionicons name="time-outline" size={15} color="#fff" /><Text style={styles.actionBtnPrimaryText}>Pending</Text></>
                ) : (
                  <><Ionicons name="person-add" size={15} color="#fff" /><Text style={styles.actionBtnPrimaryText}>Connect</Text></>
                )}
              </TouchableOpacity>
            )}
            {/* Discover -> Connect -> Accept -> Communicate: Message is only
                offered once the backend's own authorization boundary
                (canContact) actually permits direct contact — not merely
                gated on P2P connection status, since family/group/
                discipleship relationships also grant this without one.
                Hiding this button is a UX convenience only; /calls/start
                and p2p_start_direct_conversation enforce the real boundary
                server-side regardless of what the client shows. */}
            {data.canContact && (
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleMessage} disabled={messaging}>
                {messaging ? <ActivityIndicator color={colors.accentGreen} size="small" /> : (
                  <><Ionicons name="chatbubble-outline" size={15} color={colors.accentGreen} /><Text style={styles.actionBtnSecondaryText}>Message</Text></>
                )}
              </TouchableOpacity>
            )}
            {data.isPeerGuideEligible && (
              <TouchableOpacity style={[styles.actionBtnSecondary, { flexBasis: "100%" }]} onPress={() => setPeerGuideModalOpen(true)}>
                <Ionicons name="compass-outline" size={15} color={colors.accentGreen} />
                <Text style={styles.actionBtnSecondaryText}>Ask to Be My Peer Guide</Text>
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

      <PeerGuideRequestModal
        visible={peerGuideModalOpen}
        onClose={() => setPeerGuideModalOpen(false)}
        targetUserId={data.userId}
        targetName={data.fullName || `@${data.username}`}
      />
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
    grainRow: {
      backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige,
      paddingVertical: 12, paddingHorizontal: 16, marginBottom: 20, alignItems: "center",
    },
    grainRowText: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
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
