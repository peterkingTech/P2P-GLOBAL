import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { getPlan, setSessionDone, updateRun, type PlanDetail, type Resource } from "@/lib/studyPlansApi";
import { passageRoute, passageText, resourceRoute } from "@/lib/studyPlansUi";

// P2P PLANS — ONE SESSION (owner brief §13, §6). Only the sections this session has: Scripture (opens the
// EXISTING Bible reader — translation, audio, highlighting and full screen are the reader's own), the
// introduction, study questions (shown by default; Show / Hide never changes progress or the plan),
// supporting resources (each opens its own screen), optional reflection and prayer guidance, and the
// completion action. A lesson session opens the real lesson and completes only through it. Opening a
// session completes nothing; nothing here is submitted or examined.
function PlanSessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { id, session } = useLocalSearchParams<{ id: string; session: string }>();
  const [d, setD] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Questions are shown by default. A tap changes the view at once; the person's saved preference follows.
  const [override, setOverride] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { getPlan(String(id)).then(setD, (e) => setError(e?.message ?? t("p2pPlans.notAvailable"))); }, [id, t]);
  useFocusEffect(load);
  if (error) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><Text style={s.body}>{error}</Text><AppButton size="sm" variant="secondary" label={t("p2pPlans.tryAgain")} onPress={load} /></View>;
  if (!d) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /></View>;
  const i = d.sessions.findIndex((x) => x.id === session);
  const x = d.sessions[i];
  if (!x) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><Text style={s.body}>{t("p2pPlans.notAvailable")}</Text></View>;
  const run = d.me?.run ?? null;
  const done = !!d.me?.schedule.find((y) => y.id === x.id)?.done;
  // The person's saved preference when they follow the plan; otherwise just for this screen. Default: shown.
  // Hiding is a display setting only — it never calls completion and never changes the plan.
  const show = override ?? (run ? run.showQuestions : true);
  const toggle = () => { setOverride(!show); if (run) updateRun(run.id, { showQuestions: !show }).catch(() => setOverride(null)); };
  const go = (r: { pathname: string; params: Record<string, string> } | null) => r && router.push(r as any);
  const label = (r: Resource) => r.label ?? r.display ?? r.title ?? (r.strongs ? r.strongs : r.slug ? r.slug : null);
  const mark = async (v: boolean) => { if (!run) return; setBusy(true); try { await setSessionDone(run.id, x.id, v); load(); } finally { setBusy(false); } };
  const nav = (j: number) => router.replace({ pathname: "/study-plan/session", params: { id: String(id), session: d.sessions[j].id } } as any);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.headerTitle} numberOfLines={1}>{d.plan.title}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={s.kicker}>{t("p2pPlans.session.label", { n: x.position })}</Text>
        <Text style={s.h1} accessibilityRole="header">{x.title}</Text>

        {x.passages.length ? (
          <View style={s.card}>
            <Text style={s.label}>{t("p2pPlans.session.scripture")}</Text>
            {x.passages.map((p) => (
              <View key={p.display} style={s.rowBetween}>
                <Text style={s.ref}>{p.display ?? passageText(p)}</Text>
                <AppButton size="sm" icon="book-outline" label={t("p2pPlans.session.openInBible")} accessibilityLabel={`${t("p2pPlans.session.openInBible")}: ${p.display}`} onPress={() => go(passageRoute(p))} />
              </View>
            ))}
            <Text style={s.small}>{t("p2pPlans.session.listen")}</Text>
          </View>
        ) : null}

        {x.derived && x.primaryResource ? (
          <View style={s.card}>
            <Text style={s.label}>{t("p2pPlans.session.lesson")}</Text>
            <Text style={s.cardTitle}>{x.title}</Text>
            {x.group ? <Text style={s.small}>{x.group}</Text> : null}
            <Text style={[s.meta, x.lessonState !== "open" && s.ok]}>{t(`p2pPlans.session.lessonState.${x.lessonState ?? "open"}`)}</Text>
            <AppButton icon="school-outline" label={t("p2pPlans.session.openLesson")} onPress={() => go(resourceRoute(x.primaryResource!))} style={{ alignSelf: "flex-start" }} />
            <Text style={s.small}>{t("p2pPlans.session.lessonNote")}</Text>
          </View>
        ) : !x.derived && x.primaryResource ? (
          <TouchableOpacity style={s.card} onPress={() => go(resourceRoute(x.primaryResource!))} accessibilityRole="link">
            <Text style={s.label}>{t(`p2pPlans.kind.${x.primaryResource.kind}`)}</Text>
            <Text style={s.cardTitle}>{label(x.primaryResource) ?? t("p2pPlans.session.unavailable")}</Text>
          </TouchableOpacity>
        ) : null}

        {x.intro ? <View style={s.card}><Text style={s.label}>{t("p2pPlans.session.intro")}</Text><Text style={s.body}>{x.intro}</Text></View> : null}

        {x.questions.length ? (
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.label}>{t("p2pPlans.session.questions")}</Text>
              <AppButton size="sm" variant="tertiary" icon={show ? "eye-off-outline" : "eye-outline"} label={show ? t("p2pPlans.session.hide") : t("p2pPlans.session.show")} onPress={toggle} />
            </View>
            {show ? (
              <>
                {x.questions.map((q, n) => (
                  <View key={n} style={s.question}>
                    <Text style={s.qkind}>{t(`p2pPlans.session.qkind.${q.kind}`)}</Text>
                    <Text style={s.qtext}>{q.text}</Text>
                  </View>
                ))}
                <Text style={s.small}>{t("p2pPlans.session.questionsNote")}</Text>
              </>
            ) : <Text style={s.small}>{t("p2pPlans.session.hiddenNote")}</Text>}
          </View>
        ) : null}

        {x.supporting.length ? (
          <View style={s.card}>
            <Text style={s.label}>{t("p2pPlans.session.supporting")}</Text>
            {x.supporting.map((r, n) => {
              const route = resourceRoute(r), name = label(r);
              const available = !!route && !(["lesson", "kingdom_story", "scripture_topic", "curriculum"].includes(r.kind) && !r.label);
              return (
                <TouchableOpacity key={n} style={s.resource} disabled={!available} onPress={() => go(route)} accessibilityRole="link" accessibilityState={{ disabled: !available }}
                  accessibilityLabel={`${t(`p2pPlans.kind.${r.kind}`)}: ${available ? name ?? "" : t("p2pPlans.session.unavailable")}`}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={s.qkind}>{t(`p2pPlans.kind.${r.kind}`)}</Text>
                    <Text style={s.resourceTitle}>{available ? name ?? "" : t("p2pPlans.session.unavailable")}</Text>
                    {r.note ? <Text style={s.small}>{r.note}</Text> : null}
                  </View>
                  {available ? <Ionicons name="chevron-forward" size={16} color={c.textMid} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {x.reflection ? <View style={s.card}><Text style={s.label}>{t("p2pPlans.session.reflection")}</Text><Text style={s.body}>{x.reflection}</Text></View> : null}
        {x.prayer ? <View style={s.card}><Text style={s.label}>{t("p2pPlans.session.prayer")}</Text><Text style={s.body}>{x.prayer}</Text></View> : null}

        {!x.derived ? (
          !run ? <Text style={s.small}>{t("p2pPlans.session.notStarted")}</Text>
          : run.status === "paused" ? <Text style={s.small}>{t("p2pPlans.session.pausedHint")}</Text>
          : done ? (
            <View style={s.rowBetween}>
              <Text style={[s.cardTitle, s.ok]}>✓ {t("p2pPlans.session.done")}</Text>
              <AppButton size="sm" variant="tertiary" label={t("p2pPlans.session.undo")} disabled={busy} onPress={() => mark(false)} />
            </View>
          ) : run.status !== "left" ? <AppButton icon="checkmark" label={t("p2pPlans.session.markDone")} disabled={busy} onPress={() => mark(true)} /> : null
        ) : null}

        <View style={s.rowBetween}>
          {i > 0 ? <AppButton size="sm" variant="secondary" icon="arrow-back" label={t("p2pPlans.session.previous")} onPress={() => nav(i - 1)} /> : <View />}
          {i < d.sessions.length - 1 ? <AppButton size="sm" variant="secondary" icon="arrow-forward" label={t("p2pPlans.session.nextSession")} onPress={() => nav(i + 1)} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
export default withScreenBoundary(PlanSessionScreen, "Plan session");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    headerTitle: { flex: 1, fontSize: 15, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" },
    h1: { fontSize: 24, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 15, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 22 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    ok: { color: c.primaryGreen },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    card: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
    ref: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", flexShrink: 1 },
    question: { gap: 2, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    qkind: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.3 },
    qtext: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium", lineHeight: 22 },
    resource: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    resourceTitle: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
