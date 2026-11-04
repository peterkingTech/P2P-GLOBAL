import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { apiRequest } from "@/lib/apiClient";

// ADMIN CENTRE — OVERVIEW. What is happening across P2P Global, what needs
// attention, how the community and discipleship are growing, and whether the
// platform is healthy. Every number comes from GET /admin-centre/overview —
// real records, totals only (no names, no private content). Nothing is shown
// to someone without the dashboard.view permission (checked on the server).

interface Overview {
  community: { peers: number; active7: number; active30: number; newRegistrations7: number; newRegistrations30: number; families: number; familyMembers: number; churches: number; churchMembers: number };
  discipleship: { activeRelationships: number; beingGuided: number; guiding: number; generations: number; relationshipsBegun30: number; stages: { stage: number; name: string; people: number }[]; legacyStages: number; milestones: string; promotionsEnabled: boolean };
  learning: { lessonsCompleted30: number; activeLearners30: number; evaluationsWaiting: number; evaluationsInProgress: number; evaluationsCompleted30: number };
  content: { storiesPublished: number; storiesInReview: number; storiesDraft: number; curriculaPublished: number; curriculaDraft: number };
  health: { api: string; growthQueue: number; growthQueueFailing: number; evaluationSweepLastRun: string | null; notificationsAwaitingPush: number };
  recentAdminActivity: { at: string; admin_role: string | null; action: string; target_type: string | null }[];
  generatedAt: string;
}

const minutesSince = (iso: string | null) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60_000) : null);

export default function PlatformOverview({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "hidden" | "error">("loading");
  const load = useCallback(async () => {
    setState("loading");
    try { setData(await apiRequest<Overview>("/admin-centre/overview")); setState("ok"); }
    catch (e) { setState((e as { status?: number }).status === 403 ? "hidden" : "error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state === "hidden") return null;
  if (state === "loading") return <ActivityIndicator color={colors.accentGreen} style={{ margin: 16 }} accessibilityLabel="Loading the overview" />;
  if (state === "error" || !data) {
    return (
      <Pressable onPress={load} style={s.notice} accessibilityRole="button" accessibilityLabel="Couldn't load the overview. Try again">
        <Ionicons name="refresh" size={16} color={colors.textMid} /><Text style={s.noticeText}>Couldn't load the overview — tap to try again.</Text>
      </Pressable>
    );
  }

  const d = data;
  const sweepAge = minutesSince(d.health.evaluationSweepLastRun);
  // What needs an administrator: only real, current conditions.
  const attention = [
    d.learning.evaluationsWaiting > 0 && { icon: "hourglass-outline", text: `${d.learning.evaluationsWaiting} evaluations waiting for an evaluator`, path: "/evaluation/admin" },
    d.content.storiesInReview > 0 && { icon: "book-outline", text: `${d.content.storiesInReview} Kingdom Stor${d.content.storiesInReview === 1 ? "y" : "ies"} awaiting review`, path: "/admin/kingdom-stories" },
    d.health.growthQueueFailing > 0 && { icon: "warning-outline", text: `${d.health.growthQueueFailing} growth recalculations failing (retrying)`, path: "/admin/discipleship" },
    d.health.notificationsAwaitingPush > 0 && { icon: "notifications-off-outline", text: `${d.health.notificationsAwaitingPush} notifications not yet delivered after 15 minutes`, path: null },
    sweepAge !== null && sweepAge > 15 && { icon: "time-outline", text: `Evaluation check last ran ${sweepAge} minutes ago (expected every 5)`, path: null },
    d.discipleship.milestones === "draft" && { icon: "leaf-outline", text: "Growth milestones are still a draft — promotions are off", path: "/admin/discipleship" },
  ].filter(Boolean) as { icon: keyof typeof Ionicons.glyphMap; text: string; path: string | null }[];

  const Body = (
    <View style={s.wrap}>
      <Text style={s.h1} accessibilityRole="header">P2P Global at a glance</Text>
      <Text style={s.meta}>Updated {new Date(d.generatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · from live records</Text>

      <Section title="Needs attention">
        {!attention.length ? <Text style={s.meta}>Nothing needs attention right now.</Text> : attention.map((a) => (
          <Pressable key={a.text} style={s.attention} disabled={!a.path} onPress={() => a.path && router.push(a.path as any)} accessibilityRole={a.path ? "button" : undefined} accessibilityLabel={a.text}>
            <Ionicons name={a.icon} size={18} color={colors.amber} /><Text style={s.attentionText}>{a.text}</Text>
            {a.path ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
          </Pressable>
        ))}
      </Section>

      <Section title="Community">
        <Grid items={[["Peers", d.community.peers], ["Active this week", d.community.active7], ["Active this month", d.community.active30], ["New this week", d.community.newRegistrations7],
          ["Families", d.community.families], ["Family members", d.community.familyMembers], ["Churches", d.community.churches], ["Church members", d.community.churchMembers]]} />
      </Section>

      <Section title="Discipleship">
        <Grid items={[["Active relationships", d.discipleship.activeRelationships], ["Being guided", d.discipleship.beingGuided], ["Guiding others", d.discipleship.guiding], ["Generations", d.discipleship.generations], ["Begun this month", d.discipleship.relationshipsBegun30]]} />
        <Text style={s.sub}>Personal growth stages</Text>
        {d.discipleship.stages.map((st) => {
          const total = d.discipleship.stages.reduce((n, x) => n + x.people, 0) || 1;
          return (
            <View key={st.stage} style={s.barRow} accessible accessibilityLabel={`${st.name}: ${st.people} people`}>
              <Text style={s.barLabel}>{st.name}</Text>
              <View style={s.barTrack}><View style={[s.barFill, { flex: st.people / total }]} /><View style={{ flex: 1 - st.people / total }} /></View>
              <Text style={s.barN}>{st.people}</Text>
            </View>
          );
        })}
        <Text style={s.meta}>{d.discipleship.legacyStages} recognised from before the growth engine · milestones {d.discipleship.milestones} · promotions {d.discipleship.promotionsEnabled ? "on" : "off"}</Text>
      </Section>

      <Section title="Learning">
        <Grid items={[["Lessons completed (30 days)", d.learning.lessonsCompleted30], ["Active learners (30 days)", d.learning.activeLearners30], ["Evaluations waiting", d.learning.evaluationsWaiting], ["In progress", d.learning.evaluationsInProgress], ["Completed (30 days)", d.learning.evaluationsCompleted30]]} />
      </Section>

      <Section title="Content">
        <Grid items={[["Stories published", d.content.storiesPublished], ["Stories in review", d.content.storiesInReview], ["Story drafts", d.content.storiesDraft], ["Curricula published", d.content.curriculaPublished], ["Curriculum drafts", d.content.curriculaDraft]]} />
      </Section>

      <Section title="Platform health">
        <Grid items={[["API", d.health.api === "ok" ? "Responding" : d.health.api], ["Growth queue", d.health.growthQueue], ["Failing (retrying)", d.health.growthQueueFailing], ["Undelivered notices", d.health.notificationsAwaitingPush],
          ["Evaluation check", sweepAge === null ? "Not run yet" : `${sweepAge} min ago`]]} />
      </Section>

      {d.recentAdminActivity.length ? (
        <Section title="Recent administrative activity">
          {d.recentAdminActivity.map((a, i) => (
            <Text key={i} style={s.activity}>{new Date(a.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {a.admin_role ?? "system"} · {a.action.replace(/[._]/g, " ")}</Text>
          ))}
        </Section>
      ) : null}
    </View>
  );
  return compact ? Body : <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>{Body}</ScrollView>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.section}><Text style={s.sectionTitle} accessibilityRole="header">{title}</Text>{children}</View>;
}
function Grid({ items }: { items: [string, number | string][] }) {
  return (
    <View style={s.grid}>
      {items.map(([label, value]) => (
        <View key={label} style={s.cell} accessible accessibilityLabel={`${label}: ${value}`}>
          <Text style={s.value}>{value}</Text><Text style={s.label}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  h1: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  meta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  sub: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.textMid, marginTop: 6 },
  section: { gap: 8, padding: 14, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: colors.textMid, textTransform: "uppercase", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { flexGrow: 1, flexBasis: 140, padding: 10, borderRadius: 10, backgroundColor: colors.lightCream },
  value: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  label: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMid },
  attention: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  attentionText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: colors.textDark },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 110, fontSize: 12, fontFamily: "Inter_500Medium", color: colors.textMid },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.lightCream, flexDirection: "row", overflow: "hidden" },
  barFill: { backgroundColor: colors.accentGreen, borderRadius: 5 },
  barN: { width: 32, textAlign: "right", fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  activity: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMid },
  notice: { flexDirection: "row", gap: 8, alignItems: "center", margin: 16, padding: 12, borderRadius: 12, backgroundColor: colors.card },
  noticeText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
});
