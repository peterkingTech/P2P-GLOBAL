import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Card, Chip, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { getOverview } from "@/lib/studioApi";
import { auditActionLabel, deviceTimeZone, formatInZone } from "@/lib/studioModel";

// Publishing Overview. Every number is computed by the API from the
// canonical records at request time — nothing cached, estimated or invented.

export default function StudioOverview() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tz = deviceTimeZone();
  const { data, loading, error, reload } = useStudioQuery(() => getOverview(tz), [tz]);
  const cols = width >= 1000 ? 4 : width >= 600 ? 3 : 2;

  if (loading && !data) return <StateView loading />;
  if (error) return <StateView error={error} onRetry={reload} />;
  if (!data) return null;

  const tiles: { label: string; value: number; hint: string; to: string; tone?: "amber" | "red" }[] = [
    { label: "Drafts", value: data.stories.draft, hint: "Kingdom Stories in draft", to: "/admin/studio/library" },
    { label: "In review", value: data.review.in_review, hint: "Awaiting a reviewer's decision", to: "/admin/studio/review" },
    { label: "Changes requested", value: data.review.changes_requested, hint: "Back with their editors", to: "/admin/studio/review", tone: data.review.changes_requested ? "amber" : undefined },
    { label: "Approved", value: data.review.approved, hint: "Ready to publish or schedule", to: "/admin/studio/review" },
    { label: "Scheduled", value: data.schedules.scheduled, hint: "Pending or running jobs", to: "/admin/studio/calendar" },
    { label: "Due today", value: data.schedules.dueToday, hint: `Today in ${tz}`, to: "/admin/studio/calendar" },
    { label: "Failed / overdue", value: data.schedules.failed + data.schedules.overdue, hint: "Jobs needing attention", to: "/admin/studio/calendar", tone: data.schedules.failed + data.schedules.overdue ? "red" : undefined },
    { label: "Published", value: data.stories.published, hint: "Kingdom Stories live now", to: "/admin/studio/library" },
  ];

  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.content}>
      <Text style={ss.meta}>Live counts from the canonical records as of {formatInZone(data.generatedAt, tz)}.</Text>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.label}
            style={[styles.tile, { width: `${100 / cols - 2}%` as any }, t.tone === "red" && styles.tileRed, t.tone === "amber" && styles.tileAmber]}
            onPress={() => router.push(t.to as any)}
            accessibilityRole="button"
            accessibilityLabel={`${t.label}: ${t.value}. ${t.hint}`}
          >
            <Text style={styles.tileValue}>{t.value}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
            <Text style={styles.tileHint}>{t.hint}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Card>
        <Text style={ss.h2} accessibilityRole="header">Published in the last 7 days</Text>
        {data.recentlyPublished.length === 0 ? <Text style={ss.meta}>No Kingdom Stories were published in the last 7 days.</Text> : data.recentlyPublished.map((s) => (
          <View key={s.sourceId} style={styles.line}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.accentGreen} />
            <View style={{ flex: 1 }}>
              <Text style={ss.title} numberOfLines={1}>{s.title}</Text>
              <Text style={ss.meta}>{formatInZone(s.publishedAt, tz)}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={ss.h2} accessibilityRole="header">Recent activity</Text>
        {data.activity === null ? <Text style={ss.meta}>Activity history is visible to editors, supervisors and super admins.</Text>
          : data.activity.length === 0 ? <Text style={ss.meta}>No Studio activity recorded yet.</Text>
          : data.activity.map((a) => (
            <View key={a.id} style={styles.line}>
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={ss.body}>{auditActionLabel(a.action)}{typeof a.details?.title === "string" ? ` · ${a.details.title}` : ""}</Text>
                <Text style={ss.meta}>{formatInZone(a.at, tz)} · {a.actor_role === "scheduler" ? "Scheduler" : a.actor_role ?? "unknown role"}</Text>
              </View>
            </View>
          ))}
        {data.activity !== null ? (
          <TouchableOpacity onPress={() => router.push("/admin/studio/audit" as any)} accessibilityRole="link" style={styles.link}>
            <Text style={styles.linkText}>Open the full audit history</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
          </TouchableOpacity>
        ) : null}
      </Card>

      <Card>
        <View style={ss.row}>
          <Text style={[ss.h2, { flex: 1 }]} accessibilityRole="header">Kingdom Wins</Text>
          <Chip label="Read-only in Studio" tone="blue" />
        </View>
        <Text style={ss.body}>{data.wins.awaitingModeration} awaiting moderation · {data.wins.published} published</Text>
        <Text style={ss.meta}>Testimonies are reviewed in the existing moderation queue, not in the Studio.</Text>
        <TouchableOpacity onPress={() => router.push("/admin/kingdom-wins-review" as any)} accessibilityRole="link" style={styles.link}>
          <Text style={styles.linkText}>Open the Kingdom Wins moderation queue</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
        </TouchableOpacity>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  tile: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 2, minWidth: 140, minHeight: 44 },
  tileRed: { borderColor: "#E8B4AC", backgroundColor: "#FDF1EF" },
  tileAmber: { borderColor: "#EBCB95", backgroundColor: "#FDF6EA" },
  tileValue: { fontSize: 26, color: colors.textDark, fontFamily: "Inter_700Bold" },
  tileLabel: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  tileHint: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  line: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, minHeight: 44 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  linkText: { color: colors.primaryGreen, fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
