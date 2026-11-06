import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { GET_STARTED_STEPS, type GetStartedStepId } from "@/lib/getStarted";
import { useGetStartedProgress } from "@/hooks/useGetStartedProgress";
import { AppButton } from "@/components/ui";
import { getEvaluationStatus, type EvaluationStatus } from "@/lib/peerEvaluationApi";

// "How to use P2P". Reachable any time from Home and Profile — not a
// first-launch-only tutorial.
//
// A step with an `acknowledgement` (peer evaluation) is finished only when the participant ticks it:
// opening the feature doesn't finish it, and nothing about it is inferred. Whether the service behind
// it is running is shown separately (from /evaluation/status) and never assumed.
export default function GetStartedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { completed, completedCount, total, complete } = useGetStartedProgress();
  // Open the first unfinished step by default.
  const [openStep, setOpenStep] = useState<GetStartedStepId | null>(
    () => GET_STARTED_STEPS.find((s) => !completed.has(s.id))?.id ?? null,
  );

  const [acknowledged, setAcknowledged] = useState<Set<GetStartedStepId>>(new Set());
  // null = checking; "error" = we couldn't reach the service (shown as unavailable, never as ready).
  const [service, setService] = useState<EvaluationStatus | "error" | null>(null);
  const statusStepOpen = !!GET_STARTED_STEPS.find((s) => s.id === openStep)?.showsServiceStatus;

  useEffect(() => {
    if (!statusStepOpen) return;
    let cancelled = false;
    setService(null);
    getEvaluationStatus().then((r) => { if (!cancelled) setService(r); }, () => { if (!cancelled) setService("error"); });
    return () => { cancelled = true; };
  }, [statusStepOpen]);

  async function handleOpen(stepId: GetStartedStepId, route: string, acknowledgement?: string) {
    if (!acknowledgement) await complete(stepId);
    router.push(route as any);
  }

  function finish(step: (typeof GET_STARTED_STEPS)[number]) {
    void complete(step.id);
    const next = GET_STARTED_STEPS.find((s) => s.number > step.number && !completed.has(s.id));
    setOpenStep(next?.id ?? null);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>How to use P2P</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Everyone is learning from someone and helping someone grow. Here is how P2P helps you do both.</Text>

        <View style={styles.progressWrap} accessibilityLabel={`${completedCount} of ${total} steps done`}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(completedCount / total) * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>{completedCount} of {total} done</Text>
        </View>

        {GET_STARTED_STEPS.map((step) => {
          const done = completed.has(step.id);
          const open = openStep === step.id;
          return (
            <View key={step.id} style={[styles.step, open && styles.stepOpen]}>
              <TouchableOpacity
                style={styles.stepHeader}
                onPress={() => setOpenStep(open ? null : step.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Step ${step.number}, ${step.title}${done ? ", done" : ""}`}
              >
                <View style={[styles.badge, done && styles.badgeDone]}>
                  {done
                    ? <Ionicons name="checkmark" size={16} color="#fff" />
                    : <Text style={styles.badgeText}>{step.number}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepSummary}>{step.summary}</Text>
                </View>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
              </TouchableOpacity>

              {open && (
                <View style={styles.stepBody}>
                  {step.points.map((p) => (
                    <View key={p} style={styles.pointRow}>
                      <Ionicons name={step.icon} size={14} color={colors.accentGreen} style={{ marginTop: 3 }} />
                      <Text style={styles.pointText}>{p}</Text>
                    </View>
                  ))}
                  {step.showsServiceStatus && <ServiceStatusLine service={service} styles={styles} colors={colors} />}
                  {step.acknowledgement && (
                    <TouchableOpacity
                      style={styles.ackRow}
                      disabled={done}
                      onPress={() => setAcknowledged((prev) => {
                        const n = new Set(prev);
                        if (n.has(step.id)) n.delete(step.id); else n.add(step.id);
                        return n;
                      })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: done || acknowledged.has(step.id), disabled: done }}
                      accessibilityLabel={step.acknowledgement}
                    >
                      <View style={[styles.ackBox, (done || acknowledged.has(step.id)) && styles.ackBoxOn]}>
                        {(done || acknowledged.has(step.id)) && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={styles.ackText}>{step.acknowledgement}</Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.stepActions}>
                    {step.route && (
                      <AppButton label={`${step.actionLabel ?? "Open"}`} onPress={() => { void handleOpen(step.id, step.route as string, step.acknowledgement); }} style={{ flex: 1 }} />
                    )}
                    {!done && (
                      <TouchableOpacity accessibilityRole="button"
                        style={[step.route ? styles.secondaryBtn : styles.primaryBtn, !!step.acknowledgement && !acknowledged.has(step.id) && styles.btnDisabled]}
                        disabled={!!step.acknowledgement && !acknowledged.has(step.id)}
                        accessibilityState={{ disabled: !!step.acknowledgement && !acknowledged.has(step.id) }}
                        accessibilityHint={step.acknowledgement ? "Tick the statement above first" : undefined}
                        onPress={() => finish(step)}
                      >
                        <Text style={step.route ? styles.secondaryBtnText : styles.primaryBtnText}>
                          {step.acknowledgement ? "Done" : step.route ? "Mark as done" : "Got it"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Whether peer evaluation is running right now — separate from the participant understanding it.
function ServiceStatusLine({ service, styles, colors }: { service: EvaluationStatus | "error" | null; styles: ReturnType<typeof makeStyles>; colors: AppColors }) {
  const unavailable = service === "error" || service?.state === "unavailable";
  const text = service === null ? "Checking whether peer evaluation is running…"
    : service === "error" ? "We couldn't check whether peer evaluation is running right now. Your work is kept safe either way."
    : service.message;
  return (
    <View style={[styles.statusBox, unavailable && styles.statusBoxWarn]} accessibilityLiveRegion="polite">
      <Ionicons name={service === null ? "time-outline" : unavailable ? "alert-circle-outline" : "checkmark-circle-outline"} size={16}
        color={unavailable ? colors.amber : colors.accentGreen} style={{ marginTop: 1 }} />
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    secondaryBtnText: { color: c.textDark, fontWeight: "600", fontSize: 14, fontFamily: "Inter_600SemiBold" },
    secondaryBtn: { flex: 1, borderRadius: 12, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.borderBeige },
    container: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    content: { paddingHorizontal: 20, paddingTop: 4 },
    intro: { fontSize: 15, color: c.textDark, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: 16 },
    progressWrap: { marginBottom: 18 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.borderBeige, overflow: "hidden" },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: c.accentGreen },
    progressText: { fontSize: 12, color: c.textMuted, marginTop: 6, fontFamily: "Inter_500Medium" },
    step: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 10 },
    stepOpen: { borderColor: c.accentGreen },
    stepHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    badge: {
      width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: c.accentGreen,
      alignItems: "center", justifyContent: "center",
    },
    badgeDone: { backgroundColor: c.accentGreen },
    badgeText: { color: c.accentGreen, fontWeight: "700", fontFamily: "Inter_700Bold" },
    stepTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    stepSummary: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    stepBody: { paddingHorizontal: 14, paddingBottom: 14 },
    pointRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
    pointText: { flex: 1, fontSize: 14, color: c.textDark, lineHeight: 20, fontFamily: "Inter_400Regular" },
    stepActions: { flexDirection: "row", gap: 10, marginTop: 6 },
    primaryBtn: { flex: 1, backgroundColor: c.accentGreen, borderRadius: 12, height: 42, alignItems: "center", justifyContent: "center" },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    btnDisabled: { opacity: 0.45 },
    ackRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, marginTop: 2 },
    ackBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    ackBoxOn: { backgroundColor: c.accentGreen },
    ackText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    statusBox: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, marginTop: 4, marginBottom: 4 },
    statusBoxWarn: { borderColor: c.amber },
    statusText: { flex: 1, fontSize: 13, color: c.textDark, lineHeight: 19, fontFamily: "Inter_400Regular" },
  });
}
