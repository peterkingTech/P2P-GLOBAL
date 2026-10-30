import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getCurriculumOutline, getLearningHome, startJourney, setCurrentLesson, markCovered, unmarkCovered,
  type CurriculumOutline, type GroupScope, type LearningHome,
} from "@/lib/groupLearningApi";
import { AppButton } from "@/components/ui";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// One central series (Core Foundation curriculum or P2P Plan): its modules
// and lessons in order. Every lesson opens the existing lesson screen. When
// opened for a group (s/g params) a leader can choose it as what the group
// studies together, set where the group is (revisit), and mark lessons
// covered together — group progress only, never anyone's personal progress.
export default function CurriculumOutlineScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { curriculumId, s, g } = useLocalSearchParams<{ curriculumId: string; s?: string; g?: string }>();
  const scope: GroupScope | null = s === "family" || s === "church" ? s : null;
  const groupId = scope && g ? g : null;
  const [outline, setOutline] = useState<CurriculumOutline | null>(null);
  const [home, setHome] = useState<LearningHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!curriculumId) return;
    try {
      const [o, h] = await Promise.all([
        getCurriculumOutline(curriculumId),
        scope && groupId ? getLearningHome(scope, groupId).catch(() => null) : Promise.resolve(null),
      ]);
      setOutline(o); setHome(h); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load this series."); }
    finally { setLoading(false); }
  }, [curriculumId, scope, groupId]);
  useEffect(() => { load(); }, [load]);

  const journey = home?.activeJourney && home.activeJourney.curriculum.id === curriculumId ? home.activeJourney : null;
  const canManage = !!home?.canManage && !!scope && !!groupId;
  const covered = new Set(journey?.group.coveredLessonIds ?? []);

  async function run(key: string, fn: () => Promise<unknown>, failTitle: string) {
    if (busy) return;
    setBusy(key);
    try { await fn(); await load(); } catch (e: any) { showAlert(failTitle, e?.message ?? "Please try again."); } finally { setBusy(null); }
  }

  if (loading) return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Series" }} /><ActivityIndicator color={c.primaryGreen} /></View>;
  if (error || !outline) {
    return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Series" }} /><Text style={styles.muted}>{error ?? "This series isn't available."}</Text></View>;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: outline.curriculum.type === "plan" ? "P2P Plan" : "Core Foundation" }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{outline.curriculum.title}</Text>
        {outline.curriculum.subtitle ? <Text style={styles.sub}>{outline.curriculum.subtitle}</Text> : null}
        <Text style={styles.badge}>Official P2P {outline.curriculum.type === "plan" ? "Plan" : "curriculum"}</Text>

        {canManage && !journey && (
          <AppButton label="Study this together" onPress={() => run("start", () => startJourney(scope!, groupId!, outline.curriculum.id), "Couldn't choose this series")} loading={busy === "start"} accessibilityLabel={`Study ${outline.curriculum.title} together`} />
        )}
        {journey && <Text style={styles.current}>Your {scope === "family" ? "family" : "church"} is studying this · {journey.group.covered} of {journey.group.total} covered together</Text>}

        {outline.modules.map((m) => (
          <View key={m.id} style={styles.card}>
            <Text style={styles.moduleTitle}>{m.title}</Text>
            {m.lessons.map((l) => {
              const isCurrent = journey?.currentLesson?.id === l.id;
              const isCovered = covered.has(l.id);
              return (
                <View key={l.id} style={styles.lessonRow}>
                  <Ionicons name={isCovered ? "checkmark-circle" : isCurrent ? "arrow-forward-circle" : "ellipse-outline"} size={18}
                    color={isCovered ? c.primaryGreen : isCurrent ? c.accentGreen : c.textMuted} />
                  <TouchableOpacity style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: l.id } } as any)}
                    accessibilityRole="button" accessibilityLabel={`${l.title}${isCovered ? ", covered together" : ""}${isCurrent ? ", current lesson" : ""}`}>
                    <Text style={[styles.lessonTitle, isCurrent && { fontFamily: "Inter_700Bold" }]} numberOfLines={2}>{l.title}</Text>
                  </TouchableOpacity>
                  {journey && canManage && journey.status === "active" && (
                    isCovered ? (
                      <AppButton label="Undo" onPress={() => run(l.id, () => unmarkCovered(scope!, groupId!, journey.id, l.id), "Couldn't update")} variant="tertiary" loading={busy === l.id} accessibilityLabel={`Undo covered for ${l.title}`} style={{ minWidth: 64 }} />
                    ) : isCurrent ? (
                      <AppButton label="Covered" onPress={() => run(l.id, () => markCovered(scope!, groupId!, journey.id, l.id, true), "Couldn't update")} variant="tertiary" loading={busy === l.id} accessibilityLabel={`Mark ${l.title} covered together`} style={{ minWidth: 64 }} />
                    ) : (
                      <AppButton label="Go here" onPress={() => run(l.id, () => setCurrentLesson(scope!, groupId!, journey.id, l.id), "Couldn't update")} variant="tertiary" loading={busy === l.id} accessibilityLabel={`Make ${l.title} the group's current lesson`} style={{ minWidth: 64 }} />
                    )
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    scroll: { padding: 16, paddingBottom: 40, gap: 12 },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular" },
    badge: { alignSelf: "flex-start", fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", borderWidth: 1, borderColor: c.accentGreen, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
    primary: { backgroundColor: c.primaryGreen, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center" },
    primaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    current: { fontSize: 13, color: c.primaryGreen, fontFamily: "Inter_600SemiBold" },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 2 },
    moduleTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
    lessonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    lessonTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    smallText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    muted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
