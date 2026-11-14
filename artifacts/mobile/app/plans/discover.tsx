import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import SubjectPicker, { type ChosenSubject } from "@/components/plans/SubjectPicker";
import Recommendations from "@/components/plans/Recommendations";
import { discover, SUBJECT_TYPES, type Discovery, type SubjectType } from "@/lib/planDiscoveryApi";

// P2P PLANS — EXPLORE A SUBJECT (brief §5–7). Choose a Bible book, a topic, a Biblical person or event, Core
// Foundations or a course, and see what P2P has for it — grouped, classified and explained. Nothing is created:
// the person can leave at any time, or ask P2P to organise it into a plan, or choose their own resources.
function DiscoverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const params = useLocalSearchParams<{ type?: string; key?: string; label?: string; group?: string; start?: string }>();
  const initial = params.type && params.key && (SUBJECT_TYPES as string[]).includes(params.type) ? { type: params.type as SubjectType, key: String(params.key), label: String(params.label ?? "") } : null;
  const [subject, setSubject] = useState<ChosenSubject | null>(initial);
  const [data, setData] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setError(null);
    if (!subject) return;
    discover(subject.type, subject.key).then((d) => { setData(d); if (!subject.label) setSubject({ ...subject, label: d.subject.label }); },
      (e) => setError(e?.status === 404 ? t("p2pPlans.discover.unavailable") : e?.message ?? t("p2pPlans.discover.loadError")));
  }, [subject?.type, subject?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const build = (approach: "p2p" | "own") => subject && router.push({ pathname: "/plans/builder", params: { type: subject.type, key: subject.key, label: data?.subject.label ?? subject.label, approach, ...(params.group ? { group: String(params.group) } : {}) } } as any);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("p2pPlans.discover.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>{t("p2pPlans.builder.whatToStudy")}</Text>
        <Text style={s.body}>{t("p2pPlans.discover.intro")}</Text>
        <SubjectPicker value={subject} onChange={setSubject} initialType={params.start && (SUBJECT_TYPES as string[]).includes(params.start) ? (params.start as SubjectType) : undefined} />
        {subject ? (
          <>
            {data?.subject.summary ? <Text style={s.body}>{data.subject.summary}</Text> : null}
            <View style={s.ctaCard}>
              <Text style={s.ctaTitle}>{t("p2pPlans.discover.readyTitle")}</Text>
              <Text style={s.small}>{t("p2pPlans.discover.readyHint")}</Text>
              <View style={s.buttons}>
                <AppButton icon="sparkles-outline" label={t("p2pPlans.builder.approachP2P")} onPress={() => build("p2p")} disabled={!data} />
                <AppButton variant="secondary" icon="list-outline" label={t("p2pPlans.builder.approachOwn")} onPress={() => build("own")} disabled={!data} />
              </View>
            </View>
            {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : !data ? <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /> : <Recommendations data={data} />}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(DiscoverScreen, "Explore a subject");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 14, width: "100%", maxWidth: 820, alignSelf: "center" },
    h1: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
    ctaCard: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.cardBeige },
    ctaTitle: { fontSize: 15.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  });
}
