// Admin Dashboard — the consolidated notification overview (owner brief 2026-11-18 §11): unread, action required,
// critical, assigned to me, overdue, and recent administrative activity, each linking straight to its place.
// Same live summary as the header bell and sidebar badges (one fetch); only modules this admin may open.
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { timeAgo } from "@/lib/timeFormat";
import { useAdminNotificationSummary } from "@/lib/adminNotificationsApi";

export default function NotificationSummary() {
  const router = useRouter();
  const sum = useAdminNotificationSummary();
  if (!sum) return null;
  const tiles: { label: string; value: number; filter: string; tone?: string }[] = [
    { label: "Unread", value: sum.unread, filter: "unread" },
    { label: "Action required", value: sum.actionRequired, filter: "action" },
    { label: "Critical", value: sum.critical, filter: "important", tone: sum.critical ? "#B42318" : undefined },
    { label: "Assigned to me", value: sum.assignedToMe, filter: "assigned" },
    { label: "Overdue", value: sum.overdue, filter: "action", tone: sum.overdue ? "#B54708" : undefined },
  ];
  return (
    <View style={s.card} accessibilityLabel="Notifications summary">
      <View style={s.head}>
        <Ionicons name="notifications-outline" size={18} color={colors.primaryGreen} />
        <Text style={s.h}>Needs your attention</Text>
        <TouchableOpacity onPress={() => router.push("/admin/notifications" as any)} accessibilityRole="link"><Text style={s.link}>All notifications</Text></TouchableOpacity>
      </View>
      <View style={s.tiles}>
        {tiles.map((t) => (
          <TouchableOpacity key={t.label} style={s.tile} onPress={() => router.push({ pathname: "/admin/notifications", params: { filter: t.filter } } as any)} accessibilityRole="link" accessibilityLabel={`${t.label}: ${t.value}`}>
            <Text style={[s.value, t.tone ? { color: t.tone } : null]}>{t.value}</Text>
            <Text style={s.label}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {sum.recent.length ? (
        <View style={{ gap: 4 }}>
          <Text style={s.sub}>Recent activity</Text>
          {sum.recent.slice(0, 5).map((r) => (
            <TouchableOpacity key={r.id} onPress={() => router.push({ pathname: r.route, params: r.params } as any)} style={s.row} accessibilityRole="link">
              <Text style={s.rowText} numberOfLines={1}>{r.status === "resolved" ? "✓ " : ""}{r.title}</Text>
              <Text style={s.rowMeta}>{r.module} · {timeAgo(r.at)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : <Text style={s.sub}>Nothing waiting on you right now.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.borderBeige, marginHorizontal: 16, marginTop: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  h: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold", color: colors.textDark },
  link: { fontSize: 13, color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, minWidth: 96, padding: 10, borderRadius: 10, backgroundColor: colors.lightCream, minHeight: 44 },
  value: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  label: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  sub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", gap: 8, alignItems: "center", minHeight: 32 },
  rowText: { flex: 1, fontSize: 13, color: colors.textDark },
  rowMeta: { fontSize: 12, color: colors.textMuted },
});
