import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

// One shared rectangular circle card, replacing three near-identical local
// implementations (app/circles/index.tsx "My Circles", app/circles/discover.tsx
// "Find a Circle", and the Peer Circles teaser in app/(tabs)/discover.tsx).
// Covers the union of fields those three screens already show — this does
// not add any field/status none of them already displayed.
export interface CircleCardProps {
  name: string;
  leaderName?: string | null;
  memberCount: number;
  maxMembers?: number | null;
  description?: string | null;
  status?: "forming" | "active" | "completed" | null;
  nextSessionAt?: string | null;
  /** Omit when the card itself has no navigation target (e.g. Find a Circle, which only exposes "Request to Join"). */
  onPress?: () => void;
  /** "chevron" for a plain navigate row; an explicit action button otherwise; omit for neither (bare tap-to-open card). */
  action?: "chevron" | { label: string; onPress: () => void; loading?: boolean };
}

export function CircleCard({
  name, leaderName, memberCount, maxMembers, description, status, nextSessionAt, onPress, action,
}: CircleCardProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors as any);
  const Container = onPress ? TouchableOpacity : View;

  const memberLine = leaderName
    ? `${memberCount}${maxMembers ? `/${maxMembers}` : ""} member${memberCount === 1 && !maxMembers ? "" : "s"} · Led by ${leaderName}`
    : `${memberCount}${maxMembers ? `/${maxMembers}` : ""} member${memberCount === 1 && !maxMembers ? "" : "s"}`;

  return (
    <Container style={styles.card} {...(onPress ? { activeOpacity: 0.88, onPress } : {})}>
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="people-circle" size={26} color={colors.accentGreen} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {!!status && (
              <View style={[styles.statusPill, status === "forming" && styles.statusPillForming]}>
                <Text style={styles.statusPillText}>{status === "forming" ? "Forming" : status === "completed" ? "Completed" : "Active"}</Text>
              </View>
            )}
          </View>
          <Text style={styles.meta} numberOfLines={1}>{memberLine}</Text>
          {!!nextSessionAt && (
            <Text style={styles.nextSession}>Next session: {new Date(nextSessionAt).toLocaleDateString()}</Text>
          )}
        </View>
        {action === "chevron" && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
      </View>

      {!!description && <Text style={styles.description} numberOfLines={2}>{description}</Text>}

      {action && action !== "chevron" && (
        <TouchableOpacity style={styles.actionBtn} onPress={action.onPress} disabled={action.loading}>
          {action.loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>{action.label}</Text>}
        </TouchableOpacity>
      )}
    </Container>
  );
}

function makeStyles(c: { card: string; borderBeige: string; textDark: string; textMuted: string; accentGreen: string }) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14,
      padding: 14, marginBottom: 10,
    },
    topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    name: { flex: 1, fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },
    nextSession: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_500Medium", marginTop: 3 },
    statusPill: { backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
    statusPillForming: { backgroundColor: "rgba(224,164,65,0.18)" },
    statusPillText: { fontSize: 10, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    description: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 17 },
    actionBtn: { backgroundColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 12 },
    actionBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
