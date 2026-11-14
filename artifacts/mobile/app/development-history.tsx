import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getDevelopmentHistory, type DevelopmentHistory, type HistoryCheckpoint, type HistoryPerson } from "@/lib/growthApi";

// DEVELOPMENT HISTORY (GET /genealogy/history/:personId). The designated Peer
// Guides — current and previous — with BOTH people's verified stage at the start
// and at every checkpoint, exactly as recorded at the time ("Not recorded" when
// a relationship began before stages were recorded — never guessed); the
// verified contributions inside each relationship (never transferred between
// Guides); everyone else who verifiably helped (Pastors, Shepherds and others —
// only through real evidence, never a title); and the people helped, and
// whether they now help others. Counts, stages and dates only. A person's
// history can be opened only within one's own relationships and lineage.

const KIND: Record<string, string> = { start: "Began", stage_change: "Checkpoint", end: "Ended", baseline: "Recorded", correction: "Correction" };
const EVIDENCE: Record<string, string> = {
  "service.learning_feedback": "learning feedback", "service.study_session_facilitated": "led a study session", "service.family_learning_facilitated": "hosted Family learning",
  "service.shared_study_facilitated": "hosted Study Together", "service.peer_confirmed_support": "support confirmed by the person helped",
};
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function DevelopmentHistoryScreen() {
  const router = useRouter();
  const { personId } = useLocalSearchParams<{ personId?: string }>();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [h, setH] = useState<DevelopmentHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    getDevelopmentHistory(personId || "me").then((d) => { setH(d); setError(null); }).catch((e: Error) => setError(e.message));
  }, [personId]));
  const openPerson = (p: HistoryPerson) => { if (p.id) router.push({ pathname: "/development-history", params: { personId: p.id } } as any); };
  const Person = ({ p, sub }: { p: HistoryPerson; sub?: string }) => (
    <TouchableOpacity disabled={!p.id} onPress={() => openPerson(p)} accessibilityRole={p.id ? "button" : "text"} accessibilityLabel={`${p.name}${p.stage ? `, ${p.stage.name}` : ""}${sub ? `. ${sub}` : ""}`} style={s.person}>
      <Ionicons name="person-circle-outline" size={22} color={c.primaryGreen} />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{p.name}{p.stage ? `  · ${p.stage.name}` : ""}</Text>
        {sub ? <Text style={s.meta}>{sub}</Text> : null}
      </View>
      {p.id ? <Ionicons name="chevron-forward" size={15} color={c.textMuted} /> : null}
    </TouchableOpacity>
  );
  const Checkpoints = ({ items }: { items: HistoryCheckpoint[] }) => (
    <View style={s.table} accessibilityLabel="Stages at each step">
      <View style={s.tr}><Text style={[s.th, { flex: 1.3 }]}>When</Text><Text style={s.th}>Participant</Text><Text style={s.th}>Guide</Text></View>
      {items.map((cp, i) => (
        <View key={i} style={s.tr} accessible accessibilityLabel={`${KIND[cp.kind] ?? cp.kind} ${date(cp.at)}: participant ${cp.participantStage ?? "not recorded"}, guide ${cp.guideStage ?? "not recorded"}`}>
          <Text style={[s.td, { flex: 1.3 }]}>{KIND[cp.kind] ?? cp.kind} · {date(cp.at)}</Text>
          <Text style={[s.td, !cp.recorded && s.unknown]}>{cp.recorded ? cp.participantStage : "Not recorded"}</Text>
          <Text style={[s.td, !cp.recorded && s.unknown]}>{cp.recorded ? cp.guideStage : "Not recorded"}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Development history" }} />
      {!h && !error ? <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /> : null}
      {error ? <Text style={s.body}>{error}</Text> : null}
      {h ? (
        <>
          <Text style={s.h1} accessibilityRole="header">{h.person.name}</Text>
          {h.currentStage ? <Text style={s.meta}>Now: {h.currentStage.name} · since {date(h.currentStage.since)}</Text> : null}
          <Text style={s.meta}>{h.note}</Text>

          <Text style={s.section} accessibilityRole="header">Peer Guides</Text>
          {!h.guides.length ? <Text style={s.meta}>No designated Peer Guide yet.</Text> : h.guides.map((g) => (
            <View key={g.linkId} style={s.panel}>
              <Person p={g.guide} sub={`${g.status === "ended" ? "Previous" : g.isPrimary ? "Current designated Guide" : "Guide"} · ${date(g.startedAt)}${g.endedAt ? ` – ${date(g.endedAt)}` : " – now"} · ${g.verifiedContributions} verified contribution${g.verifiedContributions === 1 ? "" : "s"} in this relationship`} />
              <Checkpoints items={g.checkpoints} />
            </View>
          ))}

          {h.guiding.length ? <Text style={s.section} accessibilityRole="header">Guiding</Text> : null}
          {h.guiding.map((g) => (
            <View key={g.linkId} style={s.panel}>
              <Person p={g.participant} sub={`${g.status === "ended" ? "Previously guided" : "Guiding"} · ${date(g.startedAt)}${g.endedAt ? ` – ${date(g.endedAt)}` : " – now"} · ${g.verifiedContributions} verified contribution${g.verifiedContributions === 1 ? "" : "s"}`} />
              <Checkpoints items={g.checkpoints} />
            </View>
          ))}

          <Text style={s.section} accessibilityRole="header">Everyone who helped</Text>
          <Text style={s.meta}>Verified contributions only — a title or a role alone never appears here.</Text>
          {!h.contributors.length ? <Text style={s.meta}>None recorded yet.</Text> : h.contributors.map((x, i) => (
            <View key={i} style={s.panel}>
              <Person p={x.person} sub={`${x.verifiedContributions} verified contribution${x.verifiedContributions === 1 ? "" : "s"}${x.designatedGuide ? " · a designated Guide" : ""} · ${x.kinds.map((k) => EVIDENCE[k] ?? k).join(", ")} · ${date(x.firstAt)}${x.lastAt !== x.firstAt ? ` – ${date(x.lastAt)}` : ""}`} />
            </View>
          ))}

          <Text style={s.section} accessibilityRole="header">People helped</Text>
          {!h.helped.length ? <Text style={s.meta}>None recorded yet.</Text> : h.helped.map((x, i) => (
            <View key={i} style={s.panel}>
              <Person p={x.person} sub={`${x.verifiedContributions} verified contribution${x.verifiedContributions === 1 ? "" : "s"}${x.nowHelpingOthers ? " · now helping others (next generation)" : ""}`} />
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
    content: { padding: 16, gap: 10, paddingBottom: 120 },
    h1: { fontSize: 22, color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 10 },
    title: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, lineHeight: 20, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    panel: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    person: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
    table: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    tr: { flexDirection: "row", gap: 6, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    th: { flex: 1, fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    td: { flex: 1, fontSize: 12.5, color: c.textDark, fontFamily: "Inter_400Regular" },
    unknown: { color: c.textMuted, fontStyle: "italic" },
  });
}
