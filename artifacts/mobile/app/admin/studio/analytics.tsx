import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Card, Chip, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { getAnalytics } from "@/lib/studioApi";
import { deviceTimeZone, formatInZone } from "@/lib/studioModel";

// Analytics & Reports: only what the canonical records can tell — stories
// published per month and category, review activity and scheduled-job
// outcomes. Reading/viewing is not instrumented in the app, so it is listed
// as "not measured" rather than estimated.

export default function StudioAnalytics() {
  const tz = deviceTimeZone();
  const { data, loading, error, reload } = useStudioQuery(() => getAnalytics(), []);
  if (loading && !data) return <StateView loading />;
  if (error) return <StateView error={error} onRetry={reload} />;
  if (!data) return null;
  const maxMonth = Math.max(1, ...data.publishedByMonth.map((m) => m.count));

  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.content}>
      <Text style={ss.meta}>From the canonical records as of {formatInZone(data.generatedAt, tz)}.</Text>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Kingdom Stories published, last 12 months</Text>
        {data.publishedByMonth.length === 0 ? <Text style={ss.meta}>No stories were published in the last 12 months.</Text> : data.publishedByMonth.map((m) => (
          <View key={m.month} style={styles.barRow} accessible accessibilityLabel={`${m.month}: ${m.count} published`}>
            <Text style={styles.barLabel}>{m.month}</Text>
            <View style={styles.barTrack}><View style={[styles.bar, { width: `${(m.count / maxMonth) * 100}%` as any }]} /></View>
            <Text style={styles.barValue}>{m.count}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Published by category, last 12 months</Text>
        {data.publishedByCategory.length === 0 ? <Text style={ss.meta}>Nothing published yet.</Text>
          : <View style={ss.row}>{data.publishedByCategory.map((c) => <Chip key={c.category} label={`${c.category}: ${c.count}`} />)}</View>}
      </Card>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Review activity, last 30 days</Text>
        <View style={ss.row}>
          <Chip label={`Submitted: ${data.reviewActivityLast30Days.submitted}`} tone="amber" />
          <Chip label={`Approved: ${data.reviewActivityLast30Days.approved}`} tone="green" />
          <Chip label={`Changes requested: ${data.reviewActivityLast30Days.changesRequested}`} tone="red" />
        </View>
      </Card>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Scheduled jobs finished, last 30 days</Text>
        <View style={ss.row}>
          <Chip label={`Succeeded: ${data.scheduledJobsLast30Days.succeeded}`} tone="green" />
          <Chip label={`Failed: ${data.scheduledJobsLast30Days.failed}`} tone="red" />
          <Chip label={`Cancelled: ${data.scheduledJobsLast30Days.cancelled}`} />
        </View>
      </Card>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Not measured</Text>
        <Text style={ss.body}>The app does not record these, so they are not shown or estimated:</Text>
        {data.notMeasured.map((n) => <Text key={n} style={ss.body}>• {n}</Text>)}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  barLabel: { width: 64, fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  barTrack: { flex: 1, height: 12, backgroundColor: colors.cardBeige, borderRadius: 6, overflow: "hidden" },
  bar: { height: 12, backgroundColor: colors.accentGreen, borderRadius: 6 },
  barValue: { width: 28, textAlign: "right", fontSize: 12, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
});
