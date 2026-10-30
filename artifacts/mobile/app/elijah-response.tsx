import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";
import ReadableText from "@/components/ReadableText";
import { AppButton } from "@/components/ui";

// The Elijah Protocol response screen — reached from the Home screen's
// "we noticed you've been quiet" card (see index.tsx), since this app has no
// push-notification tap-routing infrastructure to reach it directly from a
// native notification tap.

type Decision = "taking_break" | "needs_support" | "restarting";

export default function ElijahResponseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { modules, lessons } = useData();

  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [done, setDone] = useState<Decision | null>(null);

  async function respond(decision: Decision) {
    if (!profile?.id) return;
    setSubmitting(decision);
    try {
      await fetch(`${getApiUrl()}/pastoral-care/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id, decision }),
      });
    } catch {
      // Best-effort — still let the user proceed to whatever comes next.
    } finally {
      setSubmitting(null);
    }

    if (decision === "restarting") {
      const currentModule = modules.find((m) => !m.isLocked && m.completedLessons < m.lessonCount) ?? modules[0] ?? null;
      const currentLesson = currentModule
        ? [...lessons].filter((l) => l.moduleId === currentModule.id && !l.isCompleted).sort((a, b) => a.order - b.order)[0] ?? null
        : null;
      if (currentLesson) {
        router.replace(`/lesson/${currentLesson.id}` as any);
      } else {
        router.replace("/(tabs)/learn" as any);
      }
    } else {
      setDone(decision);
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);

  if (done) {
    return (
      <View style={[styles.root, { paddingTop: topPad }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.confirmWrap}>
          <View style={styles.iconRing}>
            <Ionicons name="heart" size={28} color={colors.accentGreen} />
          </View>
          <Text style={styles.title}>Thank you for sharing that</Text>
          <Text style={styles.confirmText}>
            {done === "taking_break"
              ? "That's okay. We won't send you any more check-ins for 30 days. Come back whenever you're ready."
              : "Your peer guide has been asked to reach out to you personally. You are not alone in this."}
          </Text>
          <AppButton label="Return Home" onPress={() => router.replace("/(tabs)")} size="lg" palette="fixedLight" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <ReadableText style={styles.reference}>1 Kings 19:4-8</ReadableText>
        <Text style={styles.paragraph}>
          Elijah was exhausted and felt like giving up. God did not rebuke him. He gave him food, rest, and a gentle
          word. Whatever you are carrying right now, you are not alone.
        </Text>

        <View style={{ gap: 12, marginTop: 32 }}>
          <AppButton label="I need a break — I am okay" onPress={() => respond("taking_break")} variant="secondary" size="lg" disabled={!!submitting} loading={submitting === "taking_break"} palette="fixedLight" />

          <AppButton label="I need someone to talk to" onPress={() => respond("needs_support")} size="lg" disabled={!!submitting} loading={submitting === "needs_support"} palette="fixedLight" />

          <AppButton label="I am ready to restart" onPress={() => respond("restarting")} size="lg" disabled={!!submitting} loading={submitting === "restarting"} palette="fixedLight" />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 28, paddingTop: 60 },
  reference: {
    fontSize: 13, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold",
    textAlign: "center", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 20,
  },
  paragraph: { fontSize: 16, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 26, textAlign: "center" },

  confirmWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  iconRing: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(29,158,117,0.1)",
    borderWidth: 1.5, borderColor: "rgba(29,158,117,0.25)", alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 12 },
  confirmText: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 28 },
});