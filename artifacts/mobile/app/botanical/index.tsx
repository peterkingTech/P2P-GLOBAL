import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import LivingTreeView from "@/components/growth/LivingTreeView";
import BotanicalModelView from "@/components/growth/BotanicalModelView";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { useGrowthStage } from "@/hooks/useGrowthStage";
import { useGrowthTree } from "@/hooks/useGrowthTree";
import { APPLE_LIFECYCLE } from "@/lib/botanicalLifecycle";
import { botanicalAvailability } from "@/lib/growthTreeAssets";
import { storyEvents } from "@/lib/myGrowth";
import { CONTINUE_LINKS, STEP_DIMENSIONS, milestoneBoard, personalFor, stepKey, type BoardItem, type Dimension, type PersonalLine, type PersonalState } from "@/lib/howMyTreeGrows";

// HOW MY TREE GROWS (owner brief 2026-11-14; formerly "How an apple tree grows"). The person's own growth
// journey told through the apple tree's complete natural development:
//   1 My growth journey — the real 3D tree (shared tree data + renderer, the same as Home and My Tree)
//   2 What I have achieved · 3 What is growing now · 4 My next milestones (the Growth Matrix's own checklists)
//   5 The complete growth process — EVERY existing lifecycle step, its botany, its meaning for the person and
//     their real progress; one Meshy model at a time, unavailable models say so (never a substitute)
//   6 My growth story (dated, verified events only) · 7 Continue growing (existing destinations)
// Nothing here calculates a stage, a unit or a credit; values that didn't load say "Not available".
const DIM_ORDER: (Dimension | "stage")[] = ["stage", "consistency", "learning", "application", "service"];
const STORY_SHOWN = 8;

function HowMyTreeGrowsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const { stageIndex, journey, loading } = useGrowthStage();
  const { tree, plan, loaded, reload } = useGrowthTree();
  const data = useMemo(() => ({ journey, tree, plan }), [journey, tree, plan]);
  const board = useMemo(() => milestoneBoard(data), [data]);
  const story = useMemo(() => storyEvents(tree).slice(0, STORY_SHOWN), [tree]);
  const steps = useMemo(() => APPLE_LIFECYCLE.map((sec) => ({ ...sec, items: sec.items.map((i) => {
    const a = botanicalAvailability(i.asset);
    return { ...i, available: a !== "unavailable", local: a === "local_review", personal: personalFor(i.asset, data) };
  }) })), [data]);
  const all = steps.flatMap((x) => x.items);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(() => all.find((i) => i.available)?.asset ?? null);
  const [laterOpen, setLaterOpen] = useState(false);
  const current = all.find((i) => i.asset === shown) ?? null;
  const ready = all.filter((i) => i.available).length;
  const unavailable = !loading && loaded && !journey && !tree;

  const fmt = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const tl = (l: PersonalLine | BoardItem) => {
    const p: Record<string, string | number> = { ...(l.params ?? {}) };
    if (typeof p.date === "string") p.date = fmt(p.date);
    return t(l.key, p);
  };
  const stateStyle = (st: PersonalState) => (st === "achieved" ? s.badgeMet : st === "in_progress" || st === "now" ? s.badgeOpen : s.badgeNa);
  const stepName = (asset: string) => t(`treeGrows.steps.${stepKey(asset)}.name`);

  // ── 1. My growth journey ──
  const stageNo = journey?.stage.stage ?? stageIndex + 1;
  const journeyCard = (
    <View style={s.card}>
      <Text style={s.kicker}>{t("treeGrows.sections.journey")}</Text>
      {journey ? (
        <>
          <Text style={s.stageName}>{t("treeGrows.journey.stage", { stage: journey.stage.name })}</Text>
          <Text style={s.small}>{t("treeGrows.journey.since", { date: fmt(journey.stage.since) })} · {journey.stage.verification === "legacy_unverified" ? t("treeGrows.journey.legacy") : t("treeGrows.journey.verified")}</Text>
          <Text style={s.body}>{t(`treeGrows.journey.meaning.${Math.min(5, Math.max(1, stageNo))}`)}</Text>
          <Text style={s.subhead}>{journey.next ? t("treeGrows.journey.nextStage", { stage: journey.next.name }) : t("treeGrows.journey.highest")}</Text>
        </>
      ) : <Text style={s.meta}>{loading ? t("treeGrows.loading") : t("treeGrows.notAvailable")}</Text>}
      <View style={s.buttons}>
        <AppButton label={t("treeGrows.journey.myGrowth")} icon="leaf-outline" size="sm" variant="secondary" onPress={() => router.push("/my-growth" as any)} />
      </View>
    </View>
  );
  const treeView = (
    <View style={[s.hero, { height: wide ? 480 : Math.min(width, 400) }]}>
      <LivingTreeView stageIndex={stageIndex} mode="tree" showViewControls style={{ flex: 1 }} background={c.lightCream}
        extraControls={<IconButton variant="tinted" palette="fixedLight" icon="expand-outline" accessibilityLabel={t("treeGrows.journey.openTree")}
          onPress={() => router.push({ pathname: "/tree-3d", params: { stage: String(stageIndex), mine: "1" } } as any)} />} />
    </View>
  );

  // ── 2–3. Achieved / growing now, grouped by dimension ──
  const grouped = (items: BoardItem[], empty: string) => {
    if (!items.length) return <Text style={s.meta}>{empty}</Text>;
    return DIM_ORDER.filter((d) => items.some((i) => i.dimension === d)).map((d) => (
      <View key={d} style={s.dim}>
        <Text style={s.dimTitle}>{t(`treeGrows.dimension.${d}`)}{d !== "stage" ? ` · ${t(`treeGrows.tree.${d}`)}` : ""}</Text>
        {items.filter((i) => i.dimension === d).map((i, n) => (
          <Text key={n} style={s.reqLabel}>{"• "}{tl(i)}{i.date ? ` · ${fmt(i.date)}` : ""}</Text>
        ))}
      </View>
    ));
  };
  const achievedCard = (
    <View style={s.card}>
      <Text style={s.cardTitle} accessibilityRole="header">✓ {t("treeGrows.sections.achieved")}</Text>
      {unavailable ? <Text style={s.meta}>{t("treeGrows.notAvailable")}</Text> : grouped(board.achieved, t("treeGrows.board.achievedEmpty"))}
    </View>
  );
  const growingCard = (
    <View style={s.card}>
      <Text style={s.cardTitle} accessibilityRole="header">◐ {t("treeGrows.sections.growing")}</Text>
      {unavailable ? <Text style={s.meta}>{t("treeGrows.notAvailable")}</Text> : grouped(board.growing, t("treeGrows.board.growingEmpty"))}
    </View>
  );

  // ── 4. Next milestones (the engine's checklists, every requirement) ──
  const dimBlock = (d: { dimension: Dimension; label: string; met: boolean; required: boolean; items: { label: string; have: number; need: number; met: boolean; missing?: string | null }[] }, key: string) => (
    <View key={key} style={s.dim}>
      <View style={s.rowBetween}>
        <Text style={s.dimTitle}>{t(`treeGrows.dimension.${d.dimension}`)} · {t(`treeGrows.tree.${d.dimension}`)}</Text>
        <Text style={[s.badge, d.required ? (d.met ? s.badgeMet : s.badgeOpen) : s.badgeNa]}>{d.required ? (d.met ? `✓ ${t("treeGrows.board.met")}` : t("treeGrows.board.notMet")) : t("treeGrows.board.notRequired")}</Text>
      </View>
      {d.items.map((i) => (
        <View key={i.label} style={s.req}>
          <Text style={s.reqLabel}>{i.met ? "✓ " : "○ "}{i.label}</Text>
          <Text style={s.reqValue}>{t("treeGrows.board.have", { have: Math.min(i.have, i.need), need: i.need })}</Text>
          {!i.met && i.missing ? <Text style={s.small}>{i.missing}</Text> : null}
        </View>
      ))}
    </View>
  );
  const nextCard = (
    <View style={s.card}>
      <Text style={s.cardTitle} accessibilityRole="header">→ {t("treeGrows.sections.next")}</Text>
      {!journey ? <Text style={s.meta}>{t("treeGrows.notAvailable")}</Text> : !journey.next ? <Text style={s.meta}>{t("treeGrows.board.nextNone")}</Text> : (
        <>
          <Text style={s.stageName}>{journey.next.name}</Text>
          <Text style={s.meta}>{t("treeGrows.board.nextIntro", { stage: journey.next.name })}</Text>
          {board.next.map((d) => dimBlock(d, d.dimension))}
          <Text style={s.small}>{t("treeGrows.board.promotionsOff")}</Text>
        </>
      )}
      {journey?.later?.length ? (
        <>
          <TouchableOpacity onPress={() => setLaterOpen((v) => !v)} style={s.disclose} accessibilityRole="button" accessibilityState={{ expanded: laterOpen }}>
            <Text style={s.subhead}>{t("treeGrows.board.later")}</Text>
            <Ionicons name={laterOpen ? "chevron-up" : "chevron-down"} size={16} color={c.textMid} />
          </TouchableOpacity>
          {laterOpen ? (
            <View style={{ gap: 6 }}>
              <Text style={s.small}>{t("treeGrows.board.laterHint")}</Text>
              {journey.later.map((st) => (
                <View key={st.stage} style={s.laterStage}>
                  <Text style={s.dimTitle}>{st.name}</Text>
                  {st.dimensions.some((d) => d.required) ? st.dimensions.filter((d) => d.required).map((d) => dimBlock({ ...d, items: d.items.map((i) => ({ ...i, missing: null })) }, `${st.stage}-${d.dimension}`))
                    : <Text style={s.small}>{t("treeGrows.board.laterNone")}</Text>}
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );

  // ── 5. The complete growth process ──
  const processCard = (
    <View style={{ gap: 10 }}>
      <Text style={s.sectionTitle} accessibilityRole="header">{t("treeGrows.sections.process")}</Text>
      <Text style={s.meta}>{t("treeGrows.process.intro")}</Text>
      <Text style={s.small}>{t("treeGrows.process.models", { ready, total: all.length })}</Text>
      {current ? (
        <View style={s.hero}>
          <BotanicalModelView assetId={current.asset} label={`${stepName(current.asset)}. ${t(`treeGrows.steps.${stepKey(current.asset)}.botany`)}`} style={{ height: 280 }} />
          <View style={{ padding: 12, gap: 2 }}>
            <Text style={s.cardTitle}>{stepName(current.asset)}</Text>
            {current.local ? <Text style={s.local}>{t("treeGrows.localCopy")}</Text> : null}
          </View>
        </View>
      ) : null}
      {steps.map((sec) => (
        <View key={sec.id} style={{ gap: 8 }}>
          <Text style={s.group} accessibilityRole="header">{t(`treeGrows.lifecycle.${sec.id}.title`)}</Text>
          <Text style={s.small}>{t(`treeGrows.lifecycle.${sec.id}.intro`)}</Text>
          {sec.items.map((i) => {
            const k = stepKey(i.asset), isOpen = open === i.asset, st = i.personal.state;
            return (
              <View key={i.asset} style={[s.step, isOpen && s.stepOpen]}>
                <TouchableOpacity onPress={() => setOpen(isOpen ? null : i.asset)} style={s.stepHead} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${t(`treeGrows.steps.${k}.name`)}. ${t(`treeGrows.state.${st}`)}`}>
                  <Ionicons name={st === "achieved" ? "checkmark-circle" : st === "in_progress" || st === "now" ? "ellipse-outline" : st === "season" ? "leaf-outline" : "radio-button-off"} size={20} color={st === "achieved" ? c.primaryGreen : c.textMuted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.stepTitle}>{t(`treeGrows.steps.${k}.name`)}</Text>
                    <Text style={s.small}>{(STEP_DIMENSIONS[i.asset] ?? []).map((d) => t(`treeGrows.dimension.${d}`)).join(" · ")}</Text>
                  </View>
                  <Text style={[s.badge, stateStyle(st)]}>{t(`treeGrows.state.${st}`)}</Text>
                  <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={c.textMid} />
                </TouchableOpacity>
                {isOpen ? (
                  <View style={s.stepBody}>
                    <Text style={s.label}>{t("treeGrows.process.botany")}</Text>
                    <Text style={s.body}>{t(`treeGrows.steps.${k}.botany`)}</Text>
                    <Text style={s.label}>{t("treeGrows.process.meaning")}</Text>
                    <Text style={s.body}>{t(`treeGrows.steps.${k}.meaning`)}</Text>
                    <Text style={s.label}>{t("treeGrows.process.yours")}</Text>
                    {i.personal.lines.map((l, n) => <Text key={n} style={s.yours}>{tl(l)}</Text>)}
                    {i.available ? (
                      <AppButton label={shown === i.asset ? t("treeGrows.process.showing3d") : t("treeGrows.process.show3d")} icon="cube-outline" size="sm" variant="secondary" style={{ alignSelf: "flex-start", marginTop: 4 }}
                        disabled={shown === i.asset} onPress={() => setShown(i.asset)} />
                    ) : <Text style={s.small}>{t("treeGrows.modelNotAvailable")}</Text>}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  // ── 6. My growth story (verified, dated events only) ──
  const storyCard = (
    <View style={s.card}>
      <Text style={s.cardTitle} accessibilityRole="header">{t("treeGrows.sections.story")}</Text>
      <Text style={s.small}>{t("treeGrows.story.intro")}</Text>
      {!tree ? <Text style={s.meta}>{t("treeGrows.notAvailable")}</Text> : !story.length ? <Text style={s.meta}>{t("treeGrows.story.empty")}</Text> : story.map((e) => (
        <View key={e.ref} style={s.dim}>
          <Text style={s.small}>{fmt(e.date)} · {t(`treeGrows.story.kind.${e.kind}`)}</Text>
          <Text style={s.reqLabel}>{e.kind === "learning" ? t("treeGrows.story.unitsEvent", { count: e.units }) : e.kind === "botany" ? t("treeGrows.story.kind.botany") : e.title}{e.detail ? ` · ${e.detail}` : ""}</Text>
        </View>
      ))}
      <AppButton label={t("treeGrows.story.open")} icon="time-outline" size="sm" variant="secondary" style={{ alignSelf: "flex-start" }} onPress={() => router.push("/growth-timeline" as any)} />
    </View>
  );

  // ── 7. Continue growing ──
  const continueCard = (
    <View style={s.card}>
      <Text style={s.cardTitle} accessibilityRole="header">{t("treeGrows.sections.continue")}</Text>
      <Text style={s.small}>{t("treeGrows.continue.intro")}</Text>
      {(["learning", "application", "service", "consistency"] as Dimension[]).map((d) => (
        <View key={d} style={s.dim}>
          <Text style={s.dimTitle}>{t(`treeGrows.dimension.${d}`)}</Text>
          <View style={s.buttons}>
            {CONTINUE_LINKS.filter((l) => l.dimension === d).map((l) => (
              <AppButton key={l.key} label={t(`treeGrows.continue.${l.key}`)} icon={l.icon as any} size="sm" variant="secondary" onPress={() => router.push(l.route as any)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("treeGrows.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("treeGrows.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={s.vision}>{t("treeGrows.vision")}</Text>
        <Text style={s.body}>{t("treeGrows.intro")}</Text>
        {unavailable ? (
          <View style={[s.card, s.center]}>
            <Text style={s.cardTitle}>{t("treeGrows.notAvailable")}</Text>
            <Text style={s.meta}>{t("treeGrows.unavailableBody")}</Text>
            <AppButton label={t("treeGrows.tryAgain")} size="sm" variant="secondary" onPress={reload} />
          </View>
        ) : null}
        <View style={wide ? s.wideRow : { gap: 14 }}>
          <View style={wide ? { flex: 1.1, gap: 14 } : { gap: 14 }}>{treeView}{wide ? journeyCard : null}</View>
          <View style={wide ? { flex: 1, gap: 14 } : { gap: 14 }}>
            {wide ? null : journeyCard}
            {achievedCard}
            {growingCard}
          </View>
        </View>
        {nextCard}
        {processCard}
        {storyCard}
        {continueCard}
        <Text style={s.note}>{t("treeGrows.honest")}</Text>
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(HowMyTreeGrowsScreen, "How My Tree Grows");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 14, width: "100%", maxWidth: 1180, alignSelf: "center" },
    vision: { fontSize: 15, color: c.primaryGreen, fontFamily: "Inter_600SemiBold", fontStyle: "italic" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    note: { fontSize: 12.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 18, padding: 10, borderRadius: 10, backgroundColor: c.cardBeige },
    center: { alignItems: "center" },
    hero: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream },
    wideRow: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionTitle: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 6 },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    stageName: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    subhead: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 6 },
    group: { fontSize: 13, letterSpacing: 0.6, fontFamily: "Inter_700Bold", color: c.textMuted, textTransform: "uppercase", marginTop: 8 },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
    dim: { gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    dimTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    badge: { fontSize: 11.5, fontFamily: "Inter_700Bold", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: "hidden" },
    badgeMet: { color: "#fff", backgroundColor: c.primaryGreen },
    badgeOpen: { color: c.textDark, backgroundColor: c.cardBeige },
    badgeNa: { color: c.textMuted, backgroundColor: "transparent" },
    req: { paddingStart: 6, gap: 1 },
    reqLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 18 },
    reqValue: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    disclose: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
    laterStage: { padding: 10, borderRadius: 12, backgroundColor: c.lightCream, gap: 2 },
    local: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.amber },
    step: { borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    stepOpen: { borderColor: c.accentGreen },
    stepHead: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, padding: 12 },
    stepTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    stepBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 4 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 },
    yours: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_500Medium", lineHeight: 19 },
  });
}
