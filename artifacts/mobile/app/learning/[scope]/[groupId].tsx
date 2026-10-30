import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getLearningHome, startJourney, markCovered, customStudyPath, manageCustomPath, LearningApiError,
  type GroupScope, type LearningHome,
} from "@/lib/groupLearningApi";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";


// Learning home for one Family Circle or Church (same screen, scope from the
// route). Four parts: Continue Learning (the group's chosen series from the
// central P2P library), P2P Library, Our Custom Lessons (the group's own,
// never shown as official P2P content), and Progress — "Together" (lessons
// the group covered) kept visibly separate from "You" (your own lesson
// progress). Leaders choose / change the series; the server enforces it.
export default function LearningHomeScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { scope: rawScope, groupId } = useLocalSearchParams<{ scope: string; groupId: string }>();
  const scope: GroupScope | null = rawScope === "family" || rawScope === "church" ? rawScope : null;

  const [data, setData] = useState<LearningHome | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scope || !groupId) return;
    try {
      setData(await getLearningHome(scope, groupId));
      setError(null);
    } catch (e: any) {
      setError({ message: e?.message ?? "Couldn't load Learning.", status: e instanceof LearningApiError ? e.status : 0 });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scope, groupId]);
  useEffect(() => { load(); }, [load]);

  const libraryParams = { s: scope ?? "", g: groupId ?? "" };
  const openLibrary = () => router.push({ pathname: "/learning/library", params: libraryParams } as any);
  const openOutline = (curriculumId: string) => router.push({ pathname: "/learning/curriculum/[curriculumId]", params: { curriculumId, ...libraryParams } } as any);
  const openLesson = (lessonId: string) => router.push({ pathname: "/lesson/[id]", params: { id: lessonId } } as any);

  async function handleCovered() {
    const j = data?.activeJourney;
    if (!scope || !groupId || !j?.currentLesson || busy) return;
    setBusy("covered");
    try {
      const r = await markCovered(scope, groupId, j.id, j.currentLesson.id, true);
      if (r.completed) showAlert("Series complete", `Your group has covered every lesson in ${j.curriculum.title}.`);
      await load();
    } catch (e: any) { showAlert("Couldn't update", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  }

  async function handleResume(curriculumId: string) {
    if (!scope || !groupId || busy) return;
    setBusy(curriculumId);
    try { await startJourney(scope, groupId, curriculumId); await load(); }
    catch (e: any) { showAlert("Couldn't resume", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  }

  if (!scope || !groupId) {
    return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Learning" }} /><Text style={styles.muted}>This page isn't available.</Text></View>;
  }
  if (loading) {
    return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Learning" }} /><ActivityIndicator color={c.primaryGreen} /></View>;
  }
  if (error || !data) {
    const denied = error?.status === 403;
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <Stack.Screen options={{ title: "Learning" }} />
        <Text style={styles.muted}>{denied ? `You're not part of this ${scope === "family" ? "Family Circle" : "church"}.` : error?.message ?? "Couldn't load Learning."}</Text>
        {!denied && (
          <AppButton label="Try again" onPress={() => { setLoading(true); load(); }} variant="outline" />
        )}
      </View>
    );
  }

  const j = data.activeJourney;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Learning" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        {/* 1. Continue Learning */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>CONTINUE LEARNING</Text>
          {j ? (
            <>
              <Text style={styles.heroTitle}>{j.curriculum.title}</Text>
              {j.currentLesson ? (
                <>
                  <Text style={styles.heroSub} numberOfLines={2}>{j.currentLesson.moduleTitle} · {j.currentLesson.title}</Text>
                  <AppButton label="Open lesson" size="lg" onPress={() => openLesson(j.currentLesson!.id)} variant="secondary" accessibilityLabel={`Open lesson ${j.currentLesson.title}`} style={{ marginTop: 10 }} />
                  {data.canManage && (
                    <AppButton label="We covered this — next lesson" onPress={handleCovered} variant="secondary" disabled={busy === "covered"} loading={busy === "covered"} accessibilityLabel="Mark this lesson covered together and move to the next" style={{ marginTop: 8 }} />
                  )}
                </>
              ) : <Text style={styles.heroSub}>Every lesson in this series has been covered together.</Text>}
              <TouchableOpacity onPress={() => openOutline(j.curriculum.id)} accessibilityRole="button" style={styles.heroLink}>
                <Text style={styles.heroLinkText}>{data.canManage ? "All lessons · change or revisit →" : "All lessons →"}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>Nothing chosen yet</Text>
              <Text style={styles.heroSub}>
                {data.canManage ? "Choose a Core Foundation series or a P2P Plan to study together." : "Your leaders haven't chosen a series yet. You can still explore the P2P Library."}
              </Text>
              <AppButton label={data.canManage ? "Choose from the P2P Library" : "Explore the P2P Library"} size="lg" onPress={openLibrary} variant="secondary" style={{ marginTop: 10 }} />
            </>
          )}
        </View>

        {/* Waiting on you — assignments to do (yours) and, for leaders, to review. */}
        {(data.work?.toDo.length || data.work?.toReview.length) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Waiting on you</Text>
            {data.work!.toDo.map((a) => (
              <TouchableOpacity key={`do-${a.assignmentId}`} style={styles.listRow} onPress={() => router.push({ pathname: "/learning/assignment/[assignmentId]", params: { assignmentId: a.assignmentId, s: scope } } as any)}
                accessibilityRole="button" accessibilityLabel={`Comprehensive Check ${a.title}${a.state === "returned" ? ", returned to you" : ""}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.rowSub}>
                    {a.state === "returned" ? "Returned — please revise" : "Not started"}
                    {a.lessonTitle ? ` · ${a.lessonTitle}` : ""}{a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleDateString()}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
              </TouchableOpacity>
            ))}
            {data.work!.toReview.map((a) => (
              <TouchableOpacity key={`rv-${a.assignmentId}`} style={styles.listRow} onPress={() => router.push({ pathname: "/learning/assignment/[assignmentId]", params: { assignmentId: a.assignmentId, s: scope } } as any)}
                accessibilityRole="button" accessibilityLabel={`${a.waiting} submissions to review for ${a.title}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.rowSub}>{a.waiting} {a.waiting === 1 ? "submission" : "submissions"} to review{a.lessonTitle ? ` · ${a.lessonTitle}` : ""}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* 2. P2P Library */}
        <TouchableOpacity style={styles.rowCard} onPress={openLibrary} accessibilityRole="button" accessibilityHint="Core Foundation curriculum and P2P Plans">
          <Ionicons name="library-outline" size={22} color={c.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>P2P Library</Text>
            <Text style={styles.rowSub}>Core Foundation curriculum and P2P Plans</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </TouchableOpacity>

        {/* 3. Our Custom Lessons */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Our Custom Lessons</Text>
            {data.canManage && (
              <AppButton label="Manage" onPress={() => router.push(manageCustomPath(scope, groupId) as any)} variant="tertiary" style={{ minWidth: 44 }} />
            )}
          </View>
          <Text style={styles.cardNote}>Written by your {scope === "family" ? "family" : "church"} — not official P2P curriculum.</Text>
          {data.customLessons.length === 0 ? (
            <Text style={styles.muted}>{data.canManage ? "No custom lessons yet. Use Manage to write one." : "No custom lessons yet."}</Text>
          ) : data.customLessons.map((s) => (
            <TouchableOpacity key={s.id} style={styles.listRow} onPress={() => router.push(customStudyPath(scope, groupId, s.id) as any)} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle} numberOfLines={1}>{s.title}</Text>
                <Text style={styles.rowSub}>{s.lessonCount} {s.lessonCount === 1 ? "lesson" : "lessons"}{s.status === "draft" ? " · Draft (only leaders see this)" : ""}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* 4. Progress */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Progress</Text>
          {j ? (
            <>
              <ProgressBar styles={styles} c={c} label="Together" detail={`${j.group.covered} of ${j.group.total} lessons covered as a group`} percent={pct(j.group.covered, j.group.total)} />
              <ProgressBar styles={styles} c={c} label="You" detail={`${j.personal.completed} of ${j.personal.total} lessons completed${j.personal.submitted ? ` · ${j.personal.submitted} waiting for review` : ""}`} percent={pct(j.personal.completed, j.personal.total)} />
              <Text style={styles.cardNote}>"Together" counts lessons your group covered. "You" is your own lesson progress — nobody else's.</Text>
              {data.memberProgress && data.memberProgress.members.length > 0 && (
                <>
                  <Text style={[styles.cardTitle, { marginTop: 12 }]}>Members (leaders only)</Text>
                  {data.memberProgress.members.map((m) => (
                    <View key={m.userId} style={styles.listRow} accessibilityLabel={`${m.name}: ${m.completed} of ${data.memberProgress!.total} lessons completed`}>
                      <Text style={[styles.listTitle, { flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.rowSub}>{m.completed}/{data.memberProgress!.total}{m.submitted ? ` · ${m.submitted} waiting` : ""}</Text>
                    </View>
                  ))}
                  <Text style={styles.cardNote}>
                    Lessons each member completed in this series — never their answers.{data.memberProgress.hiddenCount ? ` ${data.memberProgress.hiddenCount} member${data.memberProgress.hiddenCount === 1 ? " has" : "s have"} chosen not to share with leadership.` : ""}
                  </Text>
                </>
              )}
            </>
          ) : <Text style={styles.muted}>Progress appears once a series is chosen.</Text>}
          {data.history.length > 0 && (
            <>
              <Text style={[styles.cardTitle, { marginTop: 12 }]}>Earlier series</Text>
              {data.history.map((h) => (
                <View key={h.id} style={styles.listRow}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => openOutline(h.curriculum.id)} accessibilityRole="button">
                    <Text style={styles.listTitle} numberOfLines={1}>{h.curriculum.title}</Text>
                    <Text style={styles.rowSub}>{h.status === "completed" ? "Completed" : "Paused"} · {h.group.covered} of {h.group.total} covered together</Text>
                  </TouchableOpacity>
                  {data.canManage && h.status === "paused" && (
                    <AppButton label="Resume" onPress={() => handleResume(h.curriculum.id)} variant="tertiary" disabled={!!busy} loading={busy === h.curriculum.id} accessibilityLabel={`Resume ${h.curriculum.title}`} style={{ minWidth: 64 }} />
                  )}
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function ProgressBar({ styles, c, label, detail, percent }: { styles: ReturnType<typeof makeStyles>; c: AppColors; label: string; detail: string; percent: number }) {
  return (
    <View style={styles.progressBlock} accessible accessibilityLabel={`${label}: ${detail}`}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.rowSub}>{percent}%</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${percent}%`, backgroundColor: label === "You" ? c.accentGreen : c.primaryGreen }]} /></View>
      <Text style={styles.rowSub}>{detail}</Text>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", gap: 12 },
    scroll: { padding: 16, paddingBottom: 40, gap: 14 },
    muted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "left" },
    heroCard: { backgroundColor: c.primaryGreen, borderRadius: 18, padding: 20, gap: 6 },
    heroLabel: { fontSize: 11, letterSpacing: 1, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_700Bold" },
    heroTitle: { fontSize: 20, color: "#fff", fontFamily: "Inter_700Bold" },
    heroSub: { fontSize: 14, color: "rgba(255,255,255,0.9)", fontFamily: "Inter_500Medium" },
    heroBtn: { backgroundColor: "#fff", borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 10 },
    heroBtnText: { color: c.primaryGreen, fontSize: 15, fontFamily: "Inter_700Bold" },
    heroSecondary: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 12, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
    heroSecondaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
    heroLink: { minHeight: 44, justifyContent: "center", marginTop: 2 },
    heroLinkText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
    rowCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, minHeight: 64 },
    rowTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 6 },
    cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardNote: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    linkBtn: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
    linkText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    listRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.borderBeige },
    listTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    smallBtn: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center" },
    secondaryBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center" },
    secondaryBtnText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    progressBlock: { gap: 4, marginTop: 8 },
    progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    progressLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    track: { height: 8, borderRadius: 4, backgroundColor: c.borderBeige, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4 },
  });
}
