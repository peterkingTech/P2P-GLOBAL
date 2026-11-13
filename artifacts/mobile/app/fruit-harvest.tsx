import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { getGrowthTree, type GrowthTree, type TreeFruit } from "@/lib/growthApi";

// FRUIT HARVEST — my verified meaningful contributions. Each fruit is ONE record in the Growth Milestone
// Matrix's evidence ledger (GET /growth/me/tree): one action, one fruit; a group session I led is one
// fruit, however many attended. Withdrawn, rejected or still-in-review records are listed honestly and
// never shown as verified fruit. No sample fruit, no content, no other people's names — only what the
// ledger verified. Seeds (people I helped who now help others) link to the genealogy.
type KindFilter = "all" | "individual" | "group";
type StatusFilter = "verified" | "all";
const STATUS_LABEL: Record<TreeFruit["status"], string> = { verified: "Verified", pending_review: "Awaiting review", rejected: "Not accepted", withdrawn: "Withdrawn" };

export default function FruitHarvestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<GrowthTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("verified");
  const [type, setType] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); getGrowthTree().then(setD, (e) => setError(e?.message ?? "Couldn't load your harvest.")); }, []);
  useEffect(load, [load]);

  const types = useMemo(() => [...new Map((d?.fruits ?? []).map((f) => [f.type, f.label])).entries()], [d]);
  const shown = (d?.fruits ?? [])
    .filter((f) => (status === "verified" ? f.countsTowardMilestone : true) && (kind === "all" || f.kind === kind) && (type === "all" || f.type === type))
    .sort((a, b) => b.date.localeCompare(a.date));
  const seeds = d?.seeds.filter((x) => x.nowHelpingOthers) ?? [];

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">Fruit Harvest</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }}>
        {!d ? (error ? (
          <View style={s.center}><Text style={s.muted}>{error}</Text><AppButton label="Try again" variant="secondary" size="sm" onPress={load} /></View>
        ) : <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /></View>) : (
          <>
            <Text style={s.lead}>Each fruit is one meaningful contribution that has been verified — a group session you led counts once, however many came.</Text>
            <View style={s.totals}>
              <Total s={s} n={d.fruitTotals.verified} label="Verified" />
              <Total s={s} n={d.fruitTotals.pendingReview} label="In review" />
              <Total s={s} n={seeds.length} label="Seeds" />
            </View>
            {!d.fruits.length ? (
              <View style={s.empty}>
                <Ionicons name="leaf-outline" size={36} color={c.borderBeige} />
                <Text style={s.emptyTitle}>No contributions verified yet</Text>
                <Text style={s.muted}>When you help someone grow — useful feedback on their learning, a study you lead, support they confirm — it is verified and appears here as fruit.</Text>
              </View>
            ) : (
              <>
                <ChipRow accessibilityLabel="Show" single>
                  <FilterChip label="Verified" selected={status === "verified"} selection="single" onPress={() => setStatus("verified")} />
                  <FilterChip label="Full history" selected={status === "all"} selection="single" onPress={() => setStatus("all")} />
                </ChipRow>
                <ChipRow accessibilityLabel="Kind" single>
                  {(["all", "individual", "group"] as KindFilter[]).map((k) => <FilterChip key={k} label={k === "all" ? "All" : k === "group" ? "Group" : "Individual"} selected={kind === k} selection="single" onPress={() => setKind(k)} />)}
                </ChipRow>
                {types.length > 1 ? (
                  <ChipRow accessibilityLabel="Type" single>
                    <FilterChip label="Every type" selected={type === "all"} selection="single" onPress={() => setType("all")} />
                    {types.map(([k, l]) => <FilterChip key={k} label={l} selected={type === k} selection="single" onPress={() => setType(k)} />)}
                  </ChipRow>
                ) : null}
                {!shown.length ? <Text style={s.muted}>Nothing matches these filters.</Text> : null}
                {shown.map((f) => {
                  const isOpen = open === f.id;
                  return (
                    <TouchableOpacity key={f.id} style={[s.card, !f.countsTowardMilestone && { opacity: 0.7 }]} onPress={() => setOpen(isOpen ? null : f.id)}
                      accessibilityRole="button" accessibilityState={{ expanded: isOpen }} accessibilityLabel={`${f.label}, ${f.date}, ${STATUS_LABEL[f.status]}`}>
                      <View style={s.row}>
                        <View style={[s.dot, { backgroundColor: f.countsTowardMilestone ? "#B8322A" : c.borderBeige }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.name}>{f.label}</Text>
                          <Text style={s.meta}>{new Date(f.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {f.areaLabel}</Text>
                        </View>
                        <Text style={[s.badge, f.countsTowardMilestone && s.badgeOk]}>{STATUS_LABEL[f.status]}</Text>
                      </View>
                      {isOpen ? (
                        <View style={s.detail}>
                          <Detail s={s} k="Contribution" v={f.label} />
                          <Detail s={s} k="Date recorded" v={f.date} />
                          <Detail s={s} k="Where" v={f.areaLabel} />
                          <Detail s={s} k="Individual or group" v={f.kind === "group" ? `Group — one fruit for leading it${f.peopleHelped ? ` (${f.peopleHelped} took part)` : ""}` : `Individual${f.peopleHelped ? ` (${f.peopleHelped === 1 ? "one person" : `${f.peopleHelped} people`})` : ""}`} />
                          <Detail s={s} k="Verification" v={STATUS_LABEL[f.status]} />
                          <Detail s={s} k="Counts toward your milestones" v={f.countsTowardMilestone ? "Yes" : "No"} />
                          <Detail s={s} k="Evidence reference" v={f.id.slice(0, 8)} />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
            <View style={s.card}>
              <Text style={s.name}>Seeds — multiplication</Text>
              <Text style={s.meta}>
                {d.seeds.length
                  ? `You've helped ${d.seeds.length} ${d.seeds.length === 1 ? "person" : "people"}${seeds.length ? `; ${seeds.length} now ${seeds.length === 1 ? "helps" : "help"} others too` : ""}.`
                  : "When someone you have helped goes on to help others, it shows here."}
              </Text>
              {seeds.map((x) => <Text key={x.ref} style={s.meta}>• First verified help to someone else: {x.firstHelpedOthersOn ?? "date not recorded"}</Text>)}
              <AppButton label="My genealogy" icon="git-network-outline" variant="secondary" size="sm" onPress={() => router.push("/lineage" as any)} />
            </View>
            <Text style={s.small}>{d.note} {d.disclaimer}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Total({ s, n, label }: { s: ReturnType<typeof makeStyles>; n: number; label: string }) {
  return <View style={s.total} accessible accessibilityLabel={`${n} ${label}`}><Text style={s.totalN}>{n}</Text><Text style={s.meta}>{label}</Text></View>;
}
function Detail({ s, k, v }: { s: ReturnType<typeof makeStyles>; k: string; v: string }) {
  return <Text style={s.detailRow}><Text style={s.detailKey}>{k}: </Text>{v}</Text>;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    lead: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    center: { alignItems: "center", gap: 10, padding: 24 },
    muted: { fontSize: 13.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center" },
    small: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16 },
    totals: { flexDirection: "row", gap: 10 },
    total: { flex: 1, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    totalN: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    empty: { alignItems: "center", gap: 8, padding: 20, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    emptyTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    dot: { width: 14, height: 14, borderRadius: 7 },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    badge: { fontSize: 11.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    badgeOk: { color: c.accentGreen },
    detail: { gap: 3, marginTop: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    detailRow: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    detailKey: { fontFamily: "Inter_600SemiBold" },
  });
}
