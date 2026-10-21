import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import type { LessonState, LockExplanation } from "@/lib/lessonLocks";

// Explains a locked lesson/module in plain language: why, what's done, what's
// left (each item labelled in words and an icon, never colour alone), and
// the one next step. It never unlocks anything.
interface Props {
  visible: boolean;
  explanation: LockExplanation | null;
  progress?: { label: string; completed: number; total: number; awaiting?: number } | null;
  primary?: { label: string; onPress: () => void } | null;
  onClose: () => void;
}

const STATE: Record<LessonState, { icon: keyof typeof Ionicons.glyphMap; text: string }> = {
  completed: { icon: "checkmark-circle", text: "Complete" },
  awaiting_review: { icon: "time-outline", text: "Submitted — waiting for review" },
  needs_revision: { icon: "alert-circle-outline", text: "Returned — please revise" },
  open: { icon: "ellipse-outline", text: "Not finished yet" },
  locked: { icon: "lock-closed-outline", text: "Locked" },
};

export default function LockExplanationSheet({ visible, explanation, progress, primary, onClose }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  if (!explanation) return null;
  const pct = progress && progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.head}>
            <Ionicons name="lock-closed" size={18} color={c.amber} />
            <Text style={styles.title} accessibilityRole="header">{explanation.headline}</Text>
            <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }}>
            {explanation.reasons.map((r, i) => <Text key={i} style={styles.reason}>{r}</Text>)}
            {progress ? (
              <View style={styles.progressBox} accessibilityLabel={`${progress.label}: ${progress.completed} of ${progress.total} lessons complete${progress.awaiting ? `, ${progress.awaiting} waiting for review` : ""}`}>
                <Text style={styles.progressLabel}>{progress.label} · {progress.completed} of {progress.total} complete{progress.awaiting ? ` · ${progress.awaiting} in review` : ""}</Text>
                <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
              </View>
            ) : null}
            {explanation.remaining.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={styles.section}>Still to do</Text>
                {explanation.remaining.map(({ lesson, state }) => (
                  <View key={lesson.id} style={styles.item} accessibilityLabel={`${lesson.title}: ${STATE[state].text}`}>
                    <Ionicons name={STATE[state].icon} size={16} color={state === "needs_revision" ? "#C0392B" : state === "awaiting_review" ? c.amber : c.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle} numberOfLines={2}>{lesson.title}</Text>
                      <Text style={styles.itemState}>{STATE[state].text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.encourage}>Every step counts — keep going at your own pace.</Text>
          </ScrollView>
          {primary ? (
            <TouchableOpacity style={styles.primary} onPress={primary.onPress} accessibilityRole="button" accessibilityLabel={primary.label}>
              <Text style={styles.primaryText} numberOfLines={1}>{primary.label}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          ) : explanation.next.kind === "wait_for_review" ? (
            <Text style={styles.waiting}>Your submitted lessons are with a peer reviewer — you'll be notified when they're approved.</Text>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30, gap: 12 },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
    reason: { fontSize: 15, lineHeight: 22, color: c.textDark, fontFamily: "Inter_400Regular" },
    progressBox: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    progressLabel: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    track: { height: 8, borderRadius: 4, backgroundColor: c.progressTrack, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
    section: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    item: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
    itemTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    itemState: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    encourage: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 25, backgroundColor: c.accentGreen, paddingHorizontal: 18 },
    primaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
    waiting: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "center" },
  });
}
