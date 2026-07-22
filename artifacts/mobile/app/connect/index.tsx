import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useRouter, Stack } from "expo-router";
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
    subtitle: "Matched partner based on your gifts & country",
    color: colors.primaryGreen,
    route: "/connect/smart-match" as const,
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
];

export default function ConnectHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { pendingConfirmationCount } = useData();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

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
                router.push(path.route);
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
