import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const MATCH_PATHS = [
  {
    id: "smart",
    icon: "sparkles" as const,
    title: "Smart Match",
    subtitle: "AI-matched partner based on your gifts, timezone & language",
    color: colors.primaryGreen,
  },
  {
    id: "invite",
    icon: "mail" as const,
    title: "Invite a Peer",
    subtitle: "Send a study invitation to someone you know",
    color: colors.amber,
  },
  {
    id: "discover",
    icon: "search" as const,
    title: "Discovery Search",
    subtitle: "Browse available study partners globally",
    color: "#6B5C3D",
  },
  {
    id: "group",
    icon: "people" as const,
    title: "Join a Group",
    subtitle: "Find a small group or church-based study group",
    color: colors.accentGreen,
  },
];

export default function ConnectTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sessions } = useData();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const liveSessions = sessions.filter((s) => s.isLive);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 20, paddingBottom: insets.bottom + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
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
            }}
          >
            <View style={[styles.pathIconRing, { backgroundColor: `${path.color}18`, borderColor: `${path.color}33` }]}>
              <Ionicons name={path.icon} size={28} color={path.color} />
            </View>
            <Text style={styles.pathTitle}>{path.title}</Text>
            <Text style={styles.pathSub}>{path.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Live Sessions */}
      {liveSessions.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Live Now</Text>
          {liveSessions.map((session) => (
            <TouchableOpacity
              key={session.id}
              style={styles.liveRow}
              onPress={() => router.push(`/session/${session.id}`)}
              activeOpacity={0.85}
            >
              <View style={styles.livePulse} />
              <View style={{ flex: 1 }}>
                <Text style={styles.liveRowTitle}>{session.title}</Text>
                <Text style={styles.liveRowMeta}>
                  {session.participantCount} participants · {session.durationMinutes} min
                </Text>
              </View>
              <TouchableOpacity style={styles.joinBtn} onPress={() => router.push(`/session/${session.id}`)}>
                <Text style={styles.joinBtnText}>Join</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Peer tips */}
      <View style={styles.tipCard}>
        <Ionicons name="information-circle" size={18} color={colors.amber} />
        <Text style={styles.tipText}>
          The best study pairs share a language and meet at least once a week. Consistency bears fruit.
        </Text>
      </View>

      {/* Sessions */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Upcoming Sessions</Text>
      {sessions.filter((s) => !s.isLive).map((session) => (
        <TouchableOpacity
          key={session.id}
          style={styles.sessionRow}
          onPress={() => router.push(`/session/${session.id}`)}
          activeOpacity={0.85}
        >
          <View style={styles.sessionIcon}>
            <Ionicons name="calendar-outline" size={20} color={colors.accentGreen} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sessionTitle}>{session.title}</Text>
            <Text style={styles.sessionMeta}>{session.hostName} · {session.durationMinutes} min</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  pathTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  pathSub: { fontSize: 11, color: colors.textMuted, lineHeight: 16, fontFamily: "Inter_400Regular" },
  liveRow: {
    backgroundColor: colors.primaryGreen,
    borderRadius: 14, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10,
  },
  livePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF4444" },
  liveRowTitle: { fontSize: 14, fontWeight: "600", color: colors.cream, fontFamily: "Inter_600SemiBold" },
  liveRowMeta: { fontSize: 12, color: colors.lightGreen, opacity: 0.8, fontFamily: "Inter_400Regular" },
  joinBtn: {
    backgroundColor: colors.cream,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6,
  },
  joinBtnText: { color: colors.primaryGreen, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  tipCard: {
    backgroundColor: "rgba(186,117,23,0.08)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(186,117,23,0.2)",
    padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 20,
  },
  tipText: { flex: 1, fontSize: 13, color: colors.textMid, lineHeight: 20, fontFamily: "Inter_400Regular" },
  sessionRow: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10,
  },
  sessionIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  sessionTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  sessionMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
});
