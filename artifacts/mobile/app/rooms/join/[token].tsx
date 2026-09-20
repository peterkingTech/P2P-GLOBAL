import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { resolveRoomInvitation, type RoomInvitationPreview, type RoomType } from "@/lib/roomInvitationsApi";
import { joinChurchCall } from "@/lib/churchCallApi";

// P2P Rooms — Shareable Room Links (Stage C).
//
// This screen NEVER joins a room itself. It resolves a link to safe
// preview info, then hands off to whichever EXISTING room screen/join
// flow already exists for that room type — see the three branches in
// handleJoin() below, each matching the exact pattern already used
// elsewhere in this app (app/call/room.tsx self-joins on mount;
// app/family/worship/[sessionId].tsx self-joins on mount; church calls
// join via the existing joinChurchCall() client call before navigating,
// exactly matching app/church/calls.tsx's own handleJoin()). No new
// Agora/join/token logic is introduced anywhere in this file.
type ResolveState =
  | { kind: "loading" }
  | { kind: "auth_required" }
  | { kind: "not_found" }
  | { kind: "revoked" }
  | { kind: "expired" }
  | { kind: "not_authorized" }
  | { kind: "network_error" }
  | { kind: "ready"; preview: RoomInvitationPreview };

const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  break_room: "Break Room", church_call: "Church Call", family_worship: "Family Worship",
};
const ROOM_TYPE_ICON: Record<RoomType, keyof typeof Ionicons.glyphMap> = {
  break_room: "people-circle-outline", church_call: "business-outline", family_worship: "home-outline",
};

export default function RoomInvitationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { token } = useLocalSearchParams<{ token: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [state, setState] = useState<ResolveState>({ kind: "loading" });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!token) return;
    if (authLoading) return;
    if (!isAuthenticated) { setState({ kind: "auth_required" }); return; }
    setState({ kind: "loading" });
    try {
      const preview = await resolveRoomInvitation(token);
      setState({ kind: "ready", preview });
    } catch (e: any) {
      const msg = (e?.message ?? "").toLowerCase();
      if (msg.includes("unauthorized")) setState({ kind: "auth_required" });
      else if (msg.includes("revoked")) setState({ kind: "revoked" });
      else if (msg.includes("expired")) setState({ kind: "expired" });
      else if (msg.includes("access to this invitation")) setState({ kind: "not_authorized" });
      else if (msg.includes("not found") || msg.includes("no longer exists")) setState({ kind: "not_found" });
      else setState({ kind: "network_error" });
    }
  }, [token, isAuthenticated, authLoading]);

  useEffect(() => { resolve(); }, [resolve]);

  async function handleJoin() {
    if (state.kind !== "ready" || joining) return;
    const { roomType, roomId } = state.preview;
    setJoining(true);
    try {
      if (roomType === "break_room") {
        router.replace({ pathname: "/call/room", params: { roomId } } as any);
      } else if (roomType === "family_worship") {
        router.replace({ pathname: "/family/worship/[sessionId]", params: { sessionId: roomId } } as any);
      } else {
        const call = await joinChurchCall(roomId);
        router.replace({ pathname: "/call/church", params: { callId: call.id, channelName: call.channelName ?? "", title: call.title } } as any);
      }
    } catch (e: any) {
      setJoining(false);
      setState({ kind: "ready", preview: state.preview });
      // Join failed — the existing join endpoint's own error already
      // reflects real authorization/lifecycle state; surface it plainly.
      setJoinError(e?.message ?? "Couldn't join right now. Please try again.");
    }
  }

  function StateCard({ icon, title, body, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; children?: React.ReactNode }) {
    return (
      <View style={styles.card}>
        <Ionicons name={icon} size={32} color={c.textMuted} />
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{body}</Text>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Room Invitation</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.body}>
        {(state.kind === "loading") && (
          <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /><Text style={styles.loadingText}>Loading invitation…</Text></View>
        )}

        {state.kind === "auth_required" && (
          <StateCard icon="lock-closed-outline" title="Sign in required" body="You need to sign in to your P2P account to view this invitation.">
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/(auth)/login" as any)}>
              <Text style={styles.primaryBtnText}>Sign In</Text>
            </TouchableOpacity>
          </StateCard>
        )}

        {state.kind === "not_found" && (
          <StateCard icon="help-circle-outline" title="Invitation not found" body="This invitation link doesn't exist or the room it pointed to is no longer available." />
        )}
        {state.kind === "revoked" && (
          <StateCard icon="close-circle-outline" title="Invitation revoked" body="The host has revoked this invitation. Ask them for a new link." />
        )}
        {state.kind === "expired" && (
          <StateCard icon="time-outline" title="Invitation expired" body="This invitation is no longer valid. Ask the host for a new link." />
        )}
        {state.kind === "not_authorized" && (
          <StateCard icon="shield-outline" title="You don't have access" body="This invitation is for a gathering you're not currently able to see. If you believe this is a mistake, contact the host." />
        )}
        {state.kind === "network_error" && (
          <StateCard icon="cloud-offline-outline" title="Couldn't load invitation" body="Check your connection and try again.">
            <TouchableOpacity style={styles.secondaryBtn} onPress={resolve}><Text style={styles.secondaryBtnText}>Try Again</Text></TouchableOpacity>
          </StateCard>
        )}

        {state.kind === "ready" && (
          <View style={styles.card}>
            <View style={styles.typeBadge}>
              <Ionicons name={ROOM_TYPE_ICON[state.preview.roomType]} size={14} color={c.accentGreen} />
              <Text style={styles.typeBadgeText}>{ROOM_TYPE_LABEL[state.preview.roomType]}</Text>
            </View>
            <Text style={styles.roomTitle}>{state.preview.title}</Text>
            {!!state.preview.subtitle && <Text style={styles.roomSubtitle}>{state.preview.subtitle}</Text>}
            {!!state.preview.hostName && <Text style={styles.hostText}>Hosted by {state.preview.hostName}</Text>}

            <View style={styles.stateRow}>
              <View style={[styles.stateDot, state.preview.roomState === "live" && styles.stateDotLive]} />
              <Text style={styles.stateText}>
                {state.preview.roomState === "live" && "Live now — joining is available"}
                {state.preview.roomState === "scheduled" && "Scheduled — joining isn't available yet"}
                {state.preview.roomState === "completed" && "This room has ended"}
                {state.preview.roomState === "unavailable" && "This room isn't currently joinable"}
              </Text>
            </View>

            {!!joinError && <Text style={styles.errorText}>{joinError}</Text>}

            <TouchableOpacity
              style={[styles.primaryBtn, !state.preview.canAttemptJoin && styles.primaryBtnDisabled]}
              onPress={handleJoin}
              disabled={!state.preview.canAttemptJoin || joining}
            >
              {joining ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{state.preview.roomType === "family_worship" ? "Open Gathering" : "Join Room"}</Text>}
            </TouchableOpacity>
            <Text style={styles.authNote}>Joining still requires your P2P account and applicable authorization — this link only points you to the room.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 16 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { flex: 1, paddingHorizontal: 20 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    loadingText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, padding: 22, alignItems: "center", gap: 8, marginTop: 24 },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    cardBody: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    typeBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
    typeBadgeText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    roomTitle: { fontSize: 19, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 6 },
    roomSubtitle: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
    hostText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    stateRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10, marginBottom: 4 },
    stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.textMuted },
    stateDotLive: { backgroundColor: "#DC2626" },
    stateText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
    errorText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium", textAlign: "center" },
    primaryBtn: { backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 10, alignItems: "center", minWidth: 180 },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    secondaryBtn: { borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, marginTop: 6 },
    secondaryBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    authNote: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, lineHeight: 16 },
  });
}
