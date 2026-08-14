import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

function currentWeekRange(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1); // Monday
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { start, end, label: `Week of ${fmt(start)} – ${fmt(end)} ${end.getFullYear()}` };
}

export default function SubmitReportScreen() {
  const router = useRouter();
  const { adminStats, loadAdminStats, submitAdminReport } = useData();
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { start, end, label } = currentWeekRange();

  useEffect(() => { loadAdminStats(); }, [loadAdminStats]);

  async function handleSubmit() {
    setSubmitting(true);
    const err = await submitAdminReport({
      reportPeriod: "weekly",
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      adminNotes: notes,
    });
    setSubmitting(false);
    if (err) {
      Alert.alert("Couldn't submit report", err);
      return;
    }
    Alert.alert("Report submitted", "Your report has been sent to your supervisor and the Administrative Supervisor.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Submit Weekly Report</Text>
      <Text style={styles.subtitle}>{label}</Text>

      <Text style={styles.sectionLabel}>Auto-generated stats (from your activity this week)</Text>
      <View style={styles.divider} />
      {adminStats ? (
        <>
          <StatLine label="Cases handled" value={String(adminStats.casesHandled)} />
          <StatLine label="Avg response time" value={adminStats.avgResponseMinutes != null ? `${adminStats.avgResponseMinutes} min` : "Not tracked"} />
          <StatLine label="Avg feedback rating" value={adminStats.avgFeedbackRating != null ? `${adminStats.avgFeedbackRating} / 5.0` : "No feedback yet"} />
          <StatLine label="Open cases" value={String(adminStats.openCases)} />
        </>
      ) : (
        <ActivityIndicator color={colors.accentGreen} />
      )}
      <View style={styles.divider} />

      <Text style={styles.sectionLabel}>Your notes</Text>
      <Text style={styles.helperText}>Add your observations, challenges, or anything the team should know:</Text>
      <TextInput
        style={styles.textArea}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes for your supervisor..."
        placeholderTextColor={colors.textMuted}
        multiline
        numberOfLines={6}
      />

      <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Report</Text>}
      </TouchableOpacity>

      <Text style={styles.footerNote}>Report will be sent to your supervisor and the Administrative Supervisor.</Text>
    </ScrollView>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statLine}>
      <Text style={styles.statLineLabel}>{label}:</Text>
      <Text style={styles.statLineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 16, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  divider: { height: 1, backgroundColor: colors.borderBeige, marginVertical: 8 },
  statLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  statLineLabel: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  statLineValue: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  helperText: { fontSize: 12, color: colors.textMuted, marginTop: 12, marginBottom: 8, fontFamily: "Inter_400Regular" },
  textArea: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", minHeight: 120, textAlignVertical: "top",
  },
  submitBtn: { backgroundColor: colors.accentGreen, borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center", marginTop: 20 },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
  footerNote: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: 12, fontFamily: "Inter_400Regular" },
});