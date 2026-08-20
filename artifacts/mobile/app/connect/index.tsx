import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
} from "react-native";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData } from "@/contexts/DataContext";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";

interface MyPeerGuide {
  peerGuideId: string; peerGuideName: string; peerGuideUsername: string | null;
  peerGuidePhotoUrl: string | null; peerGuideCountry: string | null;
}
interface MyDisciple {
  discipleId: string; discipleName: string; discipleUsername: string | null;
  disciplePhotoUrl: string | null; discipleCountry: string | null;
}

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
}

// "Active Peer Guide Relationship" — reuses the existing
// GET /discipleship/my-peer-guide/:userId (already built for the crisis-
// alert screen) and GET /discipleship/:userId/disciples endpoints, and the
// same p2p_start_direct_conversation messaging path profile screens already
// use. No "View Journey" action — that concept doesn't exist elsewhere in
// this app yet, so it isn't invented here either.
function MyPeerGuideCard({ guide }: { guide: MyPeerGuide }) {
  const router = useRouter();
  const [messaging, setMessaging] = useState(false);

  async function handleMessage() {
    setMessaging(true);
    try {
      const { data: convId, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: guide.peerGuideId });
      if (error || !convId) { showAlert("Can't message this user", "Please try again."); return; }
      router.push(`/messages/${convId}` as any);
    } finally {
      setMessaging(false);
    }
  }

  return (
    <View style={styles.relationshipCard}>
      <View style={styles.relationshipHeaderRow}>
        {guide.peerGuidePhotoUrl ? (
          <Image source={{ uri: guide.peerGuidePhotoUrl }} style={styles.relationshipAvatar} />
        ) : (
          <View style={[styles.relationshipAvatar, styles.relationshipAvatarFallback]}>
            <Text style={styles.relationshipAvatarInitial}>{guide.peerGuideName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.relationshipLabel}>MY PEER GUIDE</Text>
          <Text style={styles.relationshipName}>{guide.peerGuideName}</Text>
          <Text style={styles.relationshipSub}>Your Peer Guide{guide.peerGuideCountry ? ` · ${guide.peerGuideCountry}` : ""}</Text>
        </View>
      </View>
      <View style={styles.relationshipActionsRow}>
        <TouchableOpacity style={styles.relationshipActionBtn} onPress={handleMessage} disabled={messaging}>
          {messaging ? <ActivityIndicator size="small" color={colors.accentGreen} /> : (
            <><Ionicons name="chatbubble-outline" size={14} color={colors.accentGreen} /><Text style={styles.relationshipActionText}>Message</Text></>
          )}
        </TouchableOpacity>
        {guide.peerGuideUsername && (
          <TouchableOpacity style={styles.relationshipActionBtn} onPress={() => router.push(`/profile/${guide.peerGuideUsername}` as any)}>
            <Ionicons name="person-outline" size={14} color={colors.accentGreen} />
            <Text style={styles.relationshipActionText}>View Profile</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function MyDisciplesSection({ disciples }: { disciples: MyDisciple[] }) {
  const router = useRouter();
  const [messagingId, setMessagingId] = useState<string | null>(null);

  async function handleMessage(discipleId: string) {
    setMessagingId(discipleId);
    try {
      const { data: convId, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: discipleId });
      if (error || !convId) { showAlert("Can't message this user", "Please try again."); return; }
      router.push(`/messages/${convId}` as any);
    } finally {
      setMessagingId(null);
    }
  }

  return (
    <View style={{ gap: 10, marginBottom: 20 }}>
      {disciples.map((d) => (
        <View key={d.discipleId} style={styles.relationshipCard}>
          <View style={styles.relationshipHeaderRow}>
            {d.disciplePhotoUrl ? (
              <Image source={{ uri: d.disciplePhotoUrl }} style={styles.relationshipAvatar} />
            ) : (
              <View style={[styles.relationshipAvatar, styles.relationshipAvatarFallback]}>
                <Text style={styles.relationshipAvatarInitial}>{d.discipleName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.relationshipLabel}>MY DISCIPLE</Text>
              <Text style={styles.relationshipName}>{d.discipleName}</Text>
              <Text style={styles.relationshipSub}>Someone I'm guiding{d.discipleCountry ? ` · ${d.discipleCountry}` : ""}</Text>
            </View>
          </View>
          <View style={styles.relationshipActionsRow}>
            <TouchableOpacity style={styles.relationshipActionBtn} onPress={() => handleMessage(d.discipleId)} disabled={messagingId === d.discipleId}>
              {messagingId === d.discipleId ? <ActivityIndicator size="small" color={colors.accentGreen} /> : (
                <><Ionicons name="chatbubble-outline" size={14} color={colors.accentGreen} /><Text style={styles.relationshipActionText}>Message</Text></>
              )}
            </TouchableOpacity>
            {d.discipleUsername && (
              <TouchableOpacity style={styles.relationshipActionBtn} onPress={() => router.push(`/profile/${d.discipleUsername}` as any)}>
                <Ionicons name="person-outline" size={14} color={colors.accentGreen} />
                <Text style={styles.relationshipActionText}>View Profile</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const MATCH_PATHS = [
  {
    id: "smart",
    icon: "sparkles" as const,
    title: "Find a Peer Guide",
    subtitle: "Let P2P help you find someone who can walk with you",
    color: colors.primaryGreen,
    route: "/connect/smart-match" as const,
  },
  {
    id: "choose-someone-i-know",
    icon: "person-circle" as const,
    title: "Choose Someone I Know",
    subtitle: "Already know someone you trust? Send them a Peer Guide request",
    color: colors.accentGreen,
    route: "/connect/by-username?type=peer_guide" as const,
  },
  {
    id: "invite",
    icon: "mail" as const,
    title: "Invite a Peer",
    subtitle: "Send a study invitation to someone you know",
    color: colors.amber,
    route: "/connect/invite" as const,
  },
  {
    id: "discover",
    icon: "search" as const,
    title: "Discovery Search",
    subtitle: "Browse available study partners globally",
    color: "#6B5C3D",
    route: "/connect/discover" as const,
  },
  {
    id: "group",
    icon: "people" as const,
    title: "Join a Group",
    subtitle: "Find a small group or church-based study group",
    color: colors.accentGreen,
    route: "/connect/groups" as const,
  },
  {
    id: "username",
    icon: "at" as const,
    title: "Find by Username",
    subtitle: "Already know their @username? Connect directly",
    color: colors.primaryGreen,
    route: "/connect/by-username" as const,
  },
];

export default function ConnectHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { pendingConfirmationCount } = useData();
  const { profile } = useAuth();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const [myPeerGuide, setMyPeerGuide] = useState<MyPeerGuide | null>(null);
  const [myDisciples, setMyDisciples] = useState<MyDisciple[]>([]);

  useFocusEffect(useCallback(() => {
    if (!profile?.id) return;
    fetch(`${getApiUrl()}/discipleship/my-peer-guide/${profile.id}`)
      .then((r) => r.json())
      .then((data) => setMyPeerGuide(data?.peerGuideId ? data : null))
      .catch(() => setMyPeerGuide(null));
    fetch(`${getApiUrl()}/discipleship/${profile.id}/disciples`)
      .then((r) => r.json())
      .then((data) => setMyDisciples(Array.isArray(data) ? data : []))
      .catch(() => setMyDisciples([]));
  }, [profile?.id]));

  return (
    <>
      <Stack.Screen options={{ title: "Connect", headerBackTitle: "Back" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 20, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {myPeerGuide && <MyPeerGuideCard guide={myPeerGuide} />}
        {myDisciples.length > 0 && <MyDisciplesSection disciples={myDisciples} />}

        <Text style={styles.sectionTitle}>Find a Study Partner</Text>
        <Text style={styles.sectionSub}>Choose how you want to connect</Text>

        <View style={styles.pathGrid}>
          {MATCH_PATHS.map((path) => (
            <TouchableOpacity
              key={path.id}
              style={styles.pathCard}
              activeOpacity={0.85}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(path.route as any);
              }}
            >
              <View style={[styles.pathIconRing, { backgroundColor: `${path.color}18`, borderColor: `${path.color}33` }]}>
                <Ionicons name={path.icon} size={28} color={path.color} />
              </View>
              <Text style={styles.pathTitle}>{path.title}</Text>
              <Text style={styles.pathSub}>{path.subtitle}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.pathCard}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/confirmations" as any);
            }}
          >
            <View style={[styles.pathIconRing, { backgroundColor: `${colors.primaryGreen}18`, borderColor: `${colors.primaryGreen}33` }]}>
              <Ionicons name="checkmark-done-circle" size={28} color={colors.primaryGreen} />
              {pendingConfirmationCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pendingConfirmationCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.pathTitle}>Pending Confirmations</Text>
            <Text style={styles.pathSub}>Confirm real encouragement, prayer, and peer sessions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pathCard}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/peer-guide-requests" as any);
            }}
          >
            <View style={[styles.pathIconRing, { backgroundColor: `${colors.amber}18`, borderColor: `${colors.amber}33` }]}>
              <Ionicons name="people-circle" size={28} color={colors.amber} />
            </View>
            <Text style={styles.pathTitle}>Peer Guide Requests</Text>
            <Text style={styles.pathSub}>Accept or decline learners asking you to guide them</Text>
          </TouchableOpacity>

          {profile?.isPeerGuideEligible && (
            <TouchableOpacity
              style={styles.pathCard}
              activeOpacity={0.85}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/graduates" as any);
              }}
            >
              <View style={[styles.pathIconRing, { backgroundColor: `${colors.accentGreen}18`, borderColor: `${colors.accentGreen}33` }]}>
                <Ionicons name="mail-open" size={28} color={colors.accentGreen} />
              </View>
              <Text style={styles.pathTitle}>Completion Letters</Text>
              <Text style={styles.pathSub}>Write a letter for disciples who finished the Core Curriculum</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="information-circle" size={18} color={colors.amber} />
          <Text style={styles.tipText}>
            The best study pairs share a language and meet at least once a week. Consistency bears fruit.
          </Text>
        </View>

      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  relationshipCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 12,
  },
  relationshipHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  relationshipAvatar: { width: 44, height: 44, borderRadius: 22 },
  relationshipAvatarFallback: { backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  relationshipAvatarInitial: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  relationshipLabel: { fontSize: 10, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  relationshipName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 2 },
  relationshipSub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  relationshipActionsRow: { flexDirection: "row", gap: 10 },
  relationshipActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingVertical: 10,
  },
  relationshipActionText: { fontSize: 12, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 20 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  sectionSub: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 20, fontFamily: "Inter_400Regular" },
  pathGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  pathCard: {
    width: "47%",
    backgroundColor: colors.card,
    borderRadius: 18, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, gap: 8,
  },
  pathIconRing: {
    width: 52, height: 52, borderRadius: 16,
    borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  badge: {
    position: "absolute", top: -4, right: -4,
    backgroundColor: "#C0392B", borderRadius: 9, minWidth: 18, height: 18,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
  pathTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  pathSub: { fontSize: 11, color: colors.textMuted, lineHeight: 16, fontFamily: "Inter_400Regular" },
  tipCard: {
    backgroundColor: "rgba(186,117,23,0.08)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(186,117,23,0.2)",
    padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 20,
  },
  tipText: { flex: 1, fontSize: 13, color: colors.textMid, lineHeight: 20, fontFamily: "Inter_400Regular" },
});
