import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import { getCoreFoundations, type CoreFoundations, type CoreStatus } from "@/lib/growthApi";

// KINGDOM SCHOOL FOUNDATIONS (the Core Foundations Curriculum) — every lesson of
// every published Kingdom School curriculum (Peer-to-Peer Orientation, The
// Gospel & Salvation, The Christian Foundation, and any added later), grouped
// by curriculum and module, with its status, visible from Seed onwards
// (GET /growth/me/core-foundations). A lesson counts only once its
// assessment is passed through an independent evaluation; opening, reading,
// listening or attending never does. All of them are needed for Forest Builder
// (an additional gate, separate from general learning units); they can be
// taken at any stage and are never a condition for the earlier stages.

const ICONS: Record<CoreStatus, keyof typeof Ionicons.glyphMap> = {
  passed: "checkmark-circle", awaiting_evaluation: "hourglass-outline", returned: "arrow-undo-outline", answer_again: "refresh-outline", not_yet_passed: "alert-circle-outline",
  submitted: "paper-plane-outline", in_progress: "ellipse-outline", not_started: "ellipse-outline",
};

export default function CoreFoundationsScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<CoreFoundations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    getCoreFoundations().then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  }, []));
  const tone = (st: CoreStatus) => (st === "passed" ? c.accentGreen : st === "returned" || st === "not_yet_passed" || st === "answer_again" ? c.amber : st === "not_started" ? c.textMuted : c.primaryGreen);
  const sections = data ? (data.curricula?.length ? data.curricula : [{ id: "all", title: data.name, passed: data.passed, total: data.total, percent: data.percent, modules: data.modules }]) : [];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Foundations" }} />
      {!data && !error ? <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /> : null}
      {error ? <Text style={s.body}>{error}</Text> : null}
      {data ? (
        <>
          <Text style={s.h1} accessibilityRole="header">{data.name}</Text>
          <View style={s.panel} accessible accessibilityLabel={`${data.passed} of ${data.total} lessons passed, ${data.percent} percent. ${data.outstanding} outstanding.`}>
            <Text style={s.big}>{data.passed} / {data.total} lessons — {data.percent}%</Text>
            <View style={s.track}><View style={[s.fill, { width: `${data.percent}%` as any }]} /></View>
            <Text style={s.meta}>{data.outstanding} outstanding{data.counts.awaiting_evaluation ? ` · ${data.counts.awaiting_evaluation} awaiting evaluation` : ""}{data.counts.returned ? ` · ${data.counts.returned} returned for correction` : ""}</Text>
            <Text style={s.meta}>{data.note}</Text>
            {data.next ? (
              <>
                <AppButton label="Continue the curriculum" icon="play" accessibilityLabel={`Continue the curriculum: ${data.next.title}`}
                  onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: data.next!.id } } as any)} />
                <Text style={s.meta}>Next: {data.next.title}</Text>
              </>
            ) : null}
          </View>
          {data.counts.answer_again ? <Text style={s.meta}>{data.counts.answer_again} lesson{data.counts.answer_again === 1 ? "" : "s"} to answer again: the earlier evaluation was closed when P2P Global made a fresh start.</Text> : null}
          {sections.map((cu, ci) => (
            <View key={cu.id} style={{ gap: 10 }}>
              <View style={s.curHead} accessible accessibilityRole="header" accessibilityLabel={`${cu.title}: ${cu.passed} of ${cu.total} passed`}>
                <Text style={[s.section, { flex: 1 }]}>{cu.title}</Text>
                <Text style={s.meta}>{cu.passed} / {cu.total} — {cu.percent}%</Text>
              </View>
              {cu.modules.map((m, mi) => {
                const done = m.lessons.filter((l) => l.status === "passed").length;
                const isOpen = open === m.id || (open === null && ci === 0 && mi === 0);
                return (
                  <View key={m.id} style={s.panel}>
                    <TouchableOpacity style={s.row} onPress={() => setOpen(isOpen ? "" : m.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                      accessibilityLabel={`${m.title}: ${done} of ${m.lessons.length} passed`}>
                      <Text style={[s.title, { flex: 1 }]}>{m.title}</Text>
                      <Text style={s.meta}>{done} / {m.lessons.length}</Text>
                      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={c.textMuted} />
                    </TouchableOpacity>
                    {isOpen ? m.lessons.map((l) => (
                      <TouchableOpacity key={l.id} style={s.lesson} onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: l.id } } as any)}
                        accessibilityRole="button" accessibilityLabel={`${l.title}: ${l.statusLabel}`}>
                        <Ionicons name={ICONS[l.status]} size={18} color={tone(l.status)} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.body}>{l.title}</Text>
                          <Text style={[s.meta, { color: tone(l.status) }]}>{l.statusLabel}{l.passedAt ? ` · ${new Date(l.passedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                      </TouchableOpacity>
                    )) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    h1: { fontSize: 22, color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    big: { fontSize: 18, color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, lineHeight: 20, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    panel: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    track: { height: 8, borderRadius: 4, backgroundColor: c.borderBeige, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
    row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    curHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
    lesson: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
  });
}
