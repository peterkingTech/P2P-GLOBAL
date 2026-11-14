import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { STAGES } from "@/constants/stages";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import LivingTreeView from "@/components/growth/LivingTreeView";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { useGrowthStage } from "@/hooks/useGrowthStage";
import { useGrowthTree } from "@/hooks/useGrowthTree";
import { getCoreFoundations, getLearningRoots, type CoreFoundations, type GrowthDimension, type LearningRoots } from "@/lib/growthApi";
import { isMyGrowthSection, MY_GROWTH_SECTIONS, recordFromSelection, treeSummary, type MyGrowthSection } from "@/lib/myGrowth";

// MY GROWTH (owner brief 2026-11-14) — one place to explore what P2P Global has VERIFIED, around the
// person's real 3D tree. It explains three separate systems without merging them:
//   • the Growth Matrix decides the official stage (GET /growth/me — requirements per dimension, counts only);
//   • Botanical Development draws selected verified evidence on the tree (GET /growth/me/tree — the SAME
//     shared data Home and My Tree use, hooks/useGrowthTree; no second tree source);
//   • the learning records behind the roots (GET /growth/me/learning-roots, /growth/me/core-foundations).
// Nothing here calculates a stage, a unit or a credit, and nothing shows content (answers, reflections,
// messages). Missing values say "Not available" — never a made-up number. No percentages, no averages.
const LESSONS_SHOWN = 12;

function MyGrowthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<MyGrowthSection>(isMyGrowthSection(params.section) ? params.section : "tree");
  const { stageIndex, journey } = useGrowthStage();
  const { tree, loaded, reload } = useGrowthTree();
  const [selected, setSelected] = useState<string | null>(null);
  const picked = recordFromSelection(selected);

  // Learning Roots + Core Foundations load only when that section is opened.
  const [roots, setRoots] = useState<LearningRoots | null>(null);
  const [core, setCore] = useState<CoreFoundations | null>(null);
  const [rootsError, setRootsError] = useState<string | null>(null);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const loadRoots = useCallback(() => {
    setRootsError(null);
    Promise.all([getLearningRoots(), getCoreFoundations().catch(() => null)])
      .then(([r, cf]) => { setRoots(r); setCore(cf); }, (e) => setRootsError(e?.message ?? t("myGrowth.notAvailable")));
  }, [t]);
  useEffect(() => { if (section === "roots" && !roots && !rootsError) loadRoots(); }, [section, roots, rootsError, loadRoots]);
  // Tapping a fruit or bud on the tree opens its record.
  useEffect(() => { if (picked) setSection("contributions"); }, [picked?.evidenceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stage = STAGES[stageIndex];
  const fmt = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : t("myGrowth.notAvailable"));
  const na = (v: string | number | null | undefined) => (v === null || v === undefined ? t("myGrowth.notAvailable") : String(v));
  const heroHeight = wide ? 520 : Math.min(width * 1.0, 420);

  // ── The official stage card (Growth Matrix) ──
  const verificationLabel = tree?.stage.verification === "legacy_unverified" ? t("myGrowth.stage.legacy") : tree?.stage.verification === "exception" ? t("myGrowth.stage.exception") : t("myGrowth.stage.verified");
  const reqs = journey?.next ? journey.next.dimensions.filter((d) => d.required).flatMap((d) => d.items) : [];
  const dimensionsFor = (filter?: GrowthDimension["dimension"]) => (journey?.next?.dimensions ?? []).filter((d) => !filter || d.dimension === filter);
  const DimensionBlock = ({ d }: { d: GrowthDimension }) => (
    <View style={s.dim} accessible accessibilityLabel={`${d.label}: ${d.required ? (d.met ? t("myGrowth.stage.dimensionMet") : t("myGrowth.stage.dimensionNotMet")) : t("myGrowth.stage.dimensionNotRequired")}`}>
      <View style={s.rowBetween}>
        <Text style={s.dimTitle}>{d.label}</Text>
        <Text style={[s.badge, d.required ? (d.met ? s.badgeMet : s.badgeOpen) : s.badgeNa]}>
          {d.required ? (d.met ? `✓ ${t("myGrowth.stage.dimensionMet")}` : t("myGrowth.stage.dimensionNotMet")) : t("myGrowth.stage.dimensionNotRequired")}
        </Text>
      </View>
      <Text style={s.small}>{t(`myGrowth.stage.dimensionPurpose.${d.dimension}`)}</Text>
      {d.items.map((i) => (
        <View key={i.key ?? i.label} style={s.req}>
          <Text style={s.reqLabel}>{i.met ? "✓ " : "○ "}{i.label}</Text>
          <Text style={s.reqValue}>{t("myGrowth.stage.haveNeed", { have: Math.min(i.have, i.need), need: i.need })}</Text>
          {!i.met && i.missing ? <Text style={s.small}>{i.missing}</Text> : null}
        </View>
      ))}
    </View>
  );

  const stageCard = (
    <View style={s.card}>
      <Text style={s.kicker}>{t("myGrowth.stage.kicker")}</Text>
      <Text style={s.stageName} accessibilityRole="header">{tree?.stage.name ?? stage.name}</Text>
      <Text style={s.body}>{tree?.stage.description ?? stage.description}</Text>
      {tree ? <Text style={s.meta}>{t("myGrowth.stage.since", { date: fmt(tree.stage.since) })} · {verificationLabel}</Text> : null}
      {journey?.next ? (
        <>
          <Text style={s.subhead}>{t("myGrowth.stage.toward", { name: journey.next.name })}</Text>
          <Text style={s.meta}>{t("myGrowth.stage.requirementsMet", { met: reqs.filter((i) => i.met).length, total: reqs.length })}</Text>
          {journey.milestones !== "approved" || !journey.promotionsEnabled ? <Text style={s.note}>{t("myGrowth.stage.draftNote")}</Text> : null}
          {dimensionsFor().map((d) => <DimensionBlock key={d.dimension} d={d} />)}
        </>
      ) : journey ? <Text style={s.note}>{t("myGrowth.stage.top")}</Text> : null}
      <Text style={s.subhead}>{t("myGrowth.stage.history")}</Text>
      {tree?.history.length ? tree.history.map((h) => (
        <Text key={h.stage} style={s.meta}>{fmt(h.achievedAt)} · {t("myGrowth.stage.became", { name: h.name })}{h.kind === "legacy_import" ? ` (${t("myGrowth.stage.legacy")})` : ""}</Text>
      )) : <Text style={s.meta}>{t("myGrowth.stage.historyEmpty")}</Text>}
      <Text style={s.small}>{t("myGrowth.stage.looksNote")}</Text>
    </View>
  );

  const summary = treeSummary(tree);
  const summaryCard = (
    <View style={s.card} accessibilityLabel={t("myGrowth.summary.title")}>
      <Text style={s.cardTitle} accessibilityRole="header">{t("myGrowth.summary.title")}</Text>
      {summary.map((r) => (
        <View key={r.key} style={s.sumRow} accessible accessibilityLabel={`${t(`myGrowth.summary.${r.key}`)}: ${r.key === "foundations" && r.value !== null ? t("myGrowth.summary.foundationsValue", { passed: r.passed, total: r.total }) : na(r.value)}`}>
          <Text style={s.sumLabel}>{t(`myGrowth.summary.${r.key}`)}</Text>
          <Text style={s.sumValue}>{r.key === "foundations" && r.value !== null ? t("myGrowth.summary.foundationsValue", { passed: r.passed, total: r.total }) : na(r.value)}</Text>
        </View>
      ))}
      <Text style={s.small}>{t("myGrowth.summary.fromMatrix")}</Text>
    </View>
  );

  // ── Sections ──
  const rootsSection = (
    <View style={{ gap: 12 }}>
      <Text style={s.body}>{t("myGrowth.roots.intro")}</Text>
      <Text style={s.small}>{t("myGrowth.roots.highlightNote")}</Text>
      <View style={s.card}>
        <Text style={s.cardTitle} accessibilityRole="header">{t("myGrowth.roots.foundationsTitle")}</Text>
        {tree ? <Text style={s.big}>{t("myGrowth.summary.foundationsValue", { passed: tree.roots.coreLessons.passed, total: tree.roots.coreLessons.total })}</Text> : null}
        {core ? (
          <Text style={s.meta}>{t("myGrowth.roots.foundationsCounts", {
            passed: core.counts.passed ?? 0, progress: (core.counts.in_progress ?? 0) + (core.counts.submitted ?? 0),
            awaiting: (core.counts.awaiting_evaluation ?? 0) + (core.counts.returned ?? 0) + (core.counts.answer_again ?? 0) + (core.counts.not_yet_passed ?? 0),
            notStarted: core.counts.not_started ?? 0,
          })}</Text>
        ) : null}
        <View style={s.buttons}>
          {core?.next ? <AppButton label={t("myGrowth.roots.continue")} icon="play-outline" size="sm" onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: core.next!.id } } as any)} /> : null}
          <AppButton label={t("myGrowth.roots.curriculum")} icon="list-outline" size="sm" variant="secondary" onPress={() => router.push("/core-foundations" as any)} />
        </View>
      </View>
      <Text style={s.subhead}>{t("myGrowth.roots.groups")}</Text>
      {!roots ? (rootsError ? (
        <View style={s.center}><Text style={s.meta}>{rootsError}</Text><AppButton label={t("myGrowth.tryAgain")} size="sm" variant="secondary" onPress={loadRoots} /></View>
      ) : <ActivityIndicator color={c.accentGreen} accessibilityLabel={t("myGrowth.loading")} />) : !roots.roots.length ? (
        <Text style={s.meta}>{t("myGrowth.roots.empty")}</Text>
      ) : roots.roots.map((r) => {
        const open = openRoot === r.key;
        const lessons = open ? (showAll ? r.lessons : r.lessons.slice(0, LESSONS_SHOWN)) : [];
        return (
          <View key={r.key} style={[s.root, open && s.rootOpen]}>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setOpenRoot(open ? null : r.key); setShowAll(false); }}
              accessibilityLabel={`${r.title}. ${t("myGrowth.roots.rootCounts", { passed: r.passed, awaiting: r.submitted + r.returned, progress: r.inProgress })}`}>
              <Text style={s.kicker}>{t(`myGrowth.roots.source.${r.source}`)}</Text>
              <Text style={s.rootTitle}>{r.title}</Text>
              <Text style={s.meta}>{t("myGrowth.roots.rootCounts", { passed: r.passed, awaiting: r.submitted + r.returned, progress: r.inProgress })}</Text>
              {r.practicalVerified ? <Text style={s.meta}>{t("myGrowth.roots.practicalVerified", { count: r.practicalVerified })}</Text> : null}
            </TouchableOpacity>
            {lessons.map((l) => (
              <TouchableOpacity key={l.id} style={s.lesson} accessibilityRole="link" accessibilityLabel={`${t("myGrowth.roots.open", { title: l.title })}. ${t(`myGrowth.roots.status.${l.status}`)}`}
                onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: l.id } } as any)}>
                <Text style={s.lessonTitle}>{l.title}</Text>
                <Text style={[s.status, l.status === "passed" ? s.statusPassed : s.statusOpen]}>
                  {t(`myGrowth.roots.status.${l.status}`)}{l.passedOn ? ` · ${fmt(l.passedOn)}` : ""}{l.practicalVerified ? ` · ${t("myGrowth.roots.practicalVerified", { count: l.practicalVerified })}` : ""}
                </Text>
                <Text style={s.small}>{l.group}</Text>
              </TouchableOpacity>
            ))}
            {open && r.lessons.length > LESSONS_SHOWN ? (
              <AppButton label={showAll ? t("myGrowth.roots.showLess") : t("myGrowth.roots.showAll", { count: r.lessons.length })} size="sm" variant="tertiary" onPress={() => setShowAll((v) => !v)} />
            ) : null}
          </View>
        );
      })}
      <Text style={s.small}>{t("myGrowth.roots.themesNote")}</Text>
    </View>
  );

  const apps = tree?.application ?? null;
  const applicationSection = (
    <View style={{ gap: 12 }}>
      <Text style={s.body}>{t("myGrowth.application.intro")}</Text>
      {tree ? <Text style={s.big}>{t("myGrowth.application.verifiedCount", { count: tree.stems.practicalActions })}</Text> : null}
      {dimensionsFor("application").map((d) => <DimensionBlock key={d.dimension} d={d} />)}
      <Text style={s.small}>{t("myGrowth.application.counts")}</Text>
      <Text style={s.small}>{t("myGrowth.application.notCounted")}</Text>
      <Text style={s.subhead}>{t("myGrowth.application.records")}</Text>
      {apps === null ? <Text style={s.meta}>{t("myGrowth.notAvailable")}</Text> : !apps.length ? <Text style={s.meta}>{t("myGrowth.application.empty")}</Text> : apps.slice().reverse().map((a) => (
        <View key={a.id} style={s.record} accessible accessibilityLabel={`${a.label}, ${fmt(a.date)}, ${t(`myGrowth.contributions.status.${a.status}`)}`}>
          <Text style={s.lessonTitle}>{a.label}</Text>
          <Text style={s.meta}>{fmt(a.date)} · {a.areaLabel}</Text>
          <Text style={[s.status, a.countsTowardMilestone ? s.statusPassed : s.statusOpen]}>{a.countsTowardMilestone ? t("myGrowth.stage.verified") : t(`myGrowth.contributions.status.${a.status}`).split(" · ")[0]}</Text>
        </View>
      ))}
    </View>
  );

  const fruits = tree?.fruits ?? [];
  const contributionsSection = (
    <View style={{ gap: 12 }}>
      <Text style={s.body}>{t("myGrowth.contributions.intro")}</Text>
      {tree ? (
        <View style={s.buttons}>
          <Text style={[s.pill, s.pillFruit]}>🍎 {t("myGrowth.contributions.fruit", { count: tree.fruitTotals.verified })}</Text>
          <Text style={[s.pill, s.pillBud]}>{t("myGrowth.contributions.buds", { count: tree.fruitTotals.pendingReview })}</Text>
          {tree.fruitTotals.withdrawn + tree.fruitTotals.rejected ? <Text style={s.pill}>{t("myGrowth.contributions.noFruit", { count: tree.fruitTotals.withdrawn + tree.fruitTotals.rejected })}</Text> : null}
        </View>
      ) : null}
      {dimensionsFor("service").map((d) => <DimensionBlock key={d.dimension} d={d} />)}
      <Text style={s.small}>{t("myGrowth.contributions.notCounted")}</Text>
      {tree && tree.seeds.filter((x) => x.nowHelpingOthers).length ? <Text style={s.meta}>{t("myGrowth.contributions.seeds", { count: tree.seeds.filter((x) => x.nowHelpingOthers).length })}</Text> : null}
      {!fruits.length ? <Text style={s.meta}>{t("myGrowth.contributions.empty")}</Text> : fruits.slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map((f) => {
        const isPicked = picked?.evidenceId === f.id;
        return (
          <View key={f.id} style={[s.record, isPicked && s.recordPicked]} accessible accessibilityLabel={`${f.label}, ${fmt(f.date)}, ${t(`myGrowth.contributions.status.${f.status}`)}`}>
            {isPicked ? <Text style={s.kicker}>{t("myGrowth.contributions.selected")}</Text> : null}
            <Text style={s.lessonTitle}>{f.label}</Text>
            <Text style={s.meta}>{fmt(f.date)} · {f.areaLabel} · {f.kind === "group" ? t("myGrowth.contributions.group", { count: f.peopleHelped ?? 0 }) : t("myGrowth.contributions.individual")}</Text>
            <Text style={[s.status, f.countsTowardMilestone ? s.statusPassed : s.statusOpen]}>{t(`myGrowth.contributions.status.${f.status}`)}</Text>
          </View>
        );
      })}
    </View>
  );

  const cs = tree?.consistency;
  const consistencyRows: [string, string][] = cs ? [
    [t("myGrowth.consistency.activeWeeks"), na(cs.activeWeeks)],
    [t("myGrowth.consistency.activeMonths"), na(cs.activeMonths)],
    [t("myGrowth.consistency.window16"), na(cs.activeWeeksLast16)],
    [t("myGrowth.consistency.window26"), na(cs.activeWeeksLast26)],
    [t("myGrowth.consistency.daysInStage"), na(cs.daysInStage)],
    [t("myGrowth.consistency.journeyDays"), na(cs.journeyDays)],
    [t("myGrowth.consistency.recent", { days: cs.recentDays }), String(cs.recentQualifying)],
    [t("myGrowth.consistency.lastOn"), cs.lastQualifyingOn ? fmt(cs.lastQualifyingOn) : t("myGrowth.notYetRecorded")],
  ] : [];
  const consistencySection = (
    <View style={{ gap: 12 }}>
      <Text style={s.body}>{t("myGrowth.consistency.intro")}</Text>
      {cs?.pausedNow ? <Text style={s.note}>{t("myGrowth.consistency.paused")}</Text> : null}
      <View style={s.card}>
        {cs ? consistencyRows.map(([k, v]) => (
          <View key={k} style={s.sumRow} accessible accessibilityLabel={`${k}: ${v}`}><Text style={s.sumLabel}>{k}</Text><Text style={s.sumValue}>{v}</Text></View>
        )) : <Text style={s.meta}>{t("myGrowth.notAvailable")}</Text>}
        {cs ? <Text style={s.small}>{t("myGrowth.consistency.calculated", { date: fmt(cs.calculatedFor) })}</Text> : null}
      </View>
      {dimensionsFor("consistency").map((d) => <DimensionBlock key={d.dimension} d={d} />)}
      <Text style={s.note}>{t("myGrowth.consistency.noDowngrade")}</Text>
    </View>
  );

  const journeySection = (
    <View style={{ gap: 12 }}>
      <Text style={s.body}>{t("myGrowth.journey.intro")}</Text>
      <AppButton label={t("myGrowth.journey.story")} icon="time-outline" onPress={() => router.push("/growth-timeline" as any)} />
      <View style={s.card}>
        <Text style={s.cardTitle}>{t("myGrowth.journey.history")}</Text>
        <Text style={s.meta}>{t("myGrowth.journey.historyText")}</Text>
        <View style={s.buttons}>
          <AppButton label={t("myGrowth.journey.history")} icon="people-outline" size="sm" variant="secondary" onPress={() => router.push({ pathname: "/development-history", params: { personId: "me" } } as any)} />
          <AppButton label={t("myGrowth.journey.lineage")} icon="git-network-outline" size="sm" variant="secondary" onPress={() => router.push("/lineage" as any)} />
        </View>
      </View>
    </View>
  );

  const content = section === "tree" ? <View style={{ gap: 12 }}>{stageCard}</View>
    : section === "roots" ? rootsSection : section === "application" ? applicationSection
    : section === "contributions" ? contributionsSection : section === "consistency" ? consistencySection : journeySection;

  const treeView = (
    <View style={[s.hero, { height: heroHeight }]}>
      {/* The person's real Meshy tree from the shared tree data — the same one Home and My Tree show. */}
      <LivingTreeView stageIndex={stageIndex} mode="tree" showViewControls style={{ flex: 1 }} background={c.lightCream}
        requestedView={section === "roots" ? "roots" : section === "contributions" ? "canopy" : "full"} onSelect={setSelected}
        extraControls={<IconButton variant="tinted" palette="fixedLight" icon="expand-outline" accessibilityLabel="Open full screen"
          onPress={() => router.push({ pathname: "/tree-3d", params: { stage: String(stageIndex), mine: "1" } } as any)} />} />
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("myGrowth.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("myGrowth.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={s.vision}>{t("myGrowth.vision")}</Text>
        <Text style={s.body}>{t("myGrowth.intro")}</Text>
        {!tree && loaded ? (
          <View style={s.center}><Text style={s.meta}>{t("myGrowth.notAvailable")}</Text><AppButton label={t("myGrowth.tryAgain")} size="sm" variant="secondary" onPress={reload} /></View>
        ) : null}
        {/* Phone: tree, summary, sections one under another. Wide screens: the tree on the left, and the
            summary with the sections beside it, so the tree stays in view while exploring. */}
        <View style={wide ? s.wideRow : { gap: 14 }}>
          <View style={wide ? { flex: 1.1 } : undefined}>{treeView}</View>
          <View style={wide ? { flex: 1, gap: 14 } : { gap: 14 }}>
            {summaryCard}
            <ChipRow accessibilityLabel={t("myGrowth.sections.label")} single>
              {MY_GROWTH_SECTIONS.map((k) => <FilterChip key={k} label={t(`myGrowth.sections.${k}`)} selected={section === k} selection="single" onPress={() => setSection(k)} />)}
            </ChipRow>
            {content}
          </View>
        </View>
        <Text style={s.motto}>{t("myGrowth.motto")}</Text>
        {tree ? <Text style={s.small}>{tree.disclaimer}</Text> : null}
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(MyGrowthScreen, "my-growth");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 14, width: "100%", maxWidth: 1180, alignSelf: "center" },
    vision: { fontSize: 15, color: c.primaryGreen, fontFamily: "Inter_600SemiBold", fontStyle: "italic" },
    motto: { fontSize: 14, color: c.primaryGreen, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 8 },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    note: { fontSize: 12.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 18, padding: 10, borderRadius: 10, backgroundColor: c.cardBeige },
    big: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    center: { alignItems: "center", gap: 10, padding: 16 },
    hero: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream },
    wideRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    stageName: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    subhead: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
    dim: { gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    dimTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    badge: { fontSize: 11.5, fontFamily: "Inter_700Bold", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: "hidden" },
    badgeMet: { color: "#fff", backgroundColor: c.primaryGreen },
    badgeOpen: { color: c.textDark, backgroundColor: c.cardBeige },
    badgeNa: { color: c.textMuted, backgroundColor: "transparent" },
    req: { paddingLeft: 6, gap: 1 },
    reqLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular" },
    reqValue: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    sumRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    sumLabel: { flex: 1, fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
    sumValue: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "right", flexShrink: 1 },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    root: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    rootOpen: { borderColor: c.accentGreen },
    rootTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    lesson: { paddingVertical: 8, paddingHorizontal: 6, gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige, minHeight: 44 },
    lessonTitle: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    status: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
    statusPassed: { color: c.primaryGreen },
    statusOpen: { color: c.textMid },
    record: { padding: 12, gap: 3, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    recordPicked: { borderColor: "#B8322A", borderWidth: 2 },
    pill: { fontSize: 12.5, color: c.textDark, fontFamily: "Inter_600SemiBold", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: c.cardBeige, overflow: "hidden" },
    pillFruit: { backgroundColor: "#F6D9D5" },
    pillBud: { backgroundColor: "#E4EFD9" },
  });
}
