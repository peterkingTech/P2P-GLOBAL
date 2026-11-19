// The PROPOSED learning journey, for review (owner brief 2026-11-19 §3–§4). Every row is an actual P2P resource
// with why it was included and where it comes from. The participant can preview, reorder, remove or replace any
// of them, add more from further discoveries, or search for something else to add. Nothing here is saved — the
// builder saves the plan only when they confirm.
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { resourceRoute } from "@/lib/studyPlansUi";
import { organise, sessionFromItem, type JourneyItem, type Organised, type ProposedSession, type StageKey } from "@/lib/planOrganiserApi";

export const CATEGORY_LABEL: Record<string, string> = {
  bible: "Bible", core_foundations: "Core Foundations", kingdom_school: "Kingdom School", kingdom_stories: "Kingdom Stories",
  reference: "Reference", deep_study: "Deep Study", library: "P2P Library",
};
const STAGE_ICON: Record<StageKey, keyof typeof Ionicons.glyphMap> = {
  foundations: "library-outline", scripture: "book-outline", learning: "school-outline", connections: "git-network-outline", deeper: "layers-outline", application: "leaf-outline",
};

export default function JourneyReview({ data, proposal, onChange }: { data: Organised; proposal: ProposedSession[]; onChange: (next: ProposedSession[]) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [showMore, setShowMore] = useState(false);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [extraQ, setExtraQ] = useState("");
  const [extra, setExtra] = useState<JourneyItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const stageTitle = (k: StageKey) => data.journey.stages.find((x) => x.key === k)?.title ?? k;
  const used = new Set(proposal.map((p) => p.itemKey));
  const pool = [...data.journey.more, ...extra].filter((i, n, a) => !used.has(i.key) && a.findIndex((x) => x.key === i.key) === n);

  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= proposal.length) return; const next = [...proposal]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  const remove = (i: number) => onChange(proposal.filter((_, k) => k !== i));
  const take = (it: JourneyItem) => {
    const ses = sessionFromItem(it, stageTitle(it.stage));
    if (replacing !== null) { onChange(proposal.map((p, k) => (k === replacing ? { ...ses, stage: p.stage } : p))); setReplacing(null); setShowMore(false); return; }
    // Added after the last item of its stage (or at the end).
    const at = proposal.map((p) => p.stage).lastIndexOf(it.stage);
    onChange(at >= 0 ? [...proposal.slice(0, at + 1), ses, ...proposal.slice(at + 1)] : [...proposal, ses]);
  };
  const searchMore = async () => {
    const q = extraQ.trim();
    if (q.length < 2) return;
    setSearching(true); setSearchError(null);
    try {
      const r = await organise({ q });
      setExtra((x) => [...r.journey.stages.flatMap((st) => st.items).filter((i) => i.origin !== "activity"), ...r.journey.more, ...x]);
      setShowMore(true);
    } catch (e: any) { setSearchError(e?.message ?? null); } finally { setSearching(false); }
  };

  let lastStage: StageKey | null = null;
  return (
    <View style={{ gap: 10 }}>
      {data.journey.note === "small" ? <Text style={s.small}>{t("plansOrganiser.small", { defaultValue: "P2P found a little on this so far. You can add more below." })}</Text> : null}
      {proposal.map((p, i) => {
        const header = p.stage !== lastStage ? (lastStage = p.stage, (
          <View style={s.stageHead} key={`h${i}`}>
            <Ionicons name={STAGE_ICON[p.stage]} size={16} color={c.accentGreen} />
            <Text style={s.stageTitle} accessibilityRole="header">{stageTitle(p.stage)}</Text>
          </View>
        )) : null;
        const route = p.passages.length ? resourceRoute({ kind: "bible_passage", ...p.passages[0] }) : p.primaryResource ? resourceRoute(p.primaryResource) : null;
        return (
          <React.Fragment key={`${p.itemKey}-${i}`}>
            {header}
            <View style={[s.item, replacing === i && s.itemOn]}>
              <View style={s.itemTop}>
                <Text style={s.n}>{i + 1}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.title}>{p.title}</Text>
                  <Text style={s.meta}>{CATEGORY_LABEL[p.category] ?? p.category}{p.origin === "activity" ? ` · ${t("plansOrganiser.activity", { defaultValue: "Study questions" })}` : ""}</Text>
                </View>
              </View>
              <Text style={s.why}>{p.why}</Text>
              <Text style={s.source}>{t("plansOrganiser.source", { defaultValue: "Source" })}: {p.source}</Text>
              <View style={s.actions}>
                {route ? <AppButton size="sm" variant="tertiary" icon="eye-outline" label={t("plansOrganiser.preview", { defaultValue: "Preview" })} onPress={() => router.push(route as never)} /> : null}
                <IconButton icon="arrow-up" accessibilityLabel={t("plansOrganiser.moveUp", { defaultValue: "Move up: {{title}}", title: p.title })} onPress={() => move(i, -1)} disabled={i === 0} color={c.textMid} />
                <IconButton icon="arrow-down" accessibilityLabel={t("plansOrganiser.moveDown", { defaultValue: "Move down: {{title}}", title: p.title })} onPress={() => move(i, 1)} disabled={i === proposal.length - 1} color={c.textMid} />
                <IconButton icon="swap-horizontal" accessibilityLabel={t("plansOrganiser.replace", { defaultValue: "Replace: {{title}}", title: p.title })} onPress={() => { setReplacing(replacing === i ? null : i); setShowMore(true); }} selected={replacing === i} color={c.textMid} />
                <IconButton icon="trash-outline" accessibilityLabel={t("plansOrganiser.remove", { defaultValue: "Remove: {{title}}", title: p.title })} onPress={() => remove(i)} color={c.textMid} />
              </View>
            </View>
          </React.Fragment>
        );
      })}

      {data.journey.gaps.length ? (
        <View style={s.gaps}>
          <Text style={s.label}>{t("plansOrganiser.gaps", { defaultValue: "Not found yet" })}</Text>
          {data.journey.gaps.map((g, i) => <Text key={i} style={s.small}>• {g.message}</Text>)}
        </View>
      ) : null}

      <View style={s.moreBox}>
        <AppButton variant="secondary" icon={showMore ? "chevron-up" : "add-circle-outline"} label={replacing !== null ? t("plansOrganiser.chooseReplacement", { defaultValue: "Choose a replacement below" }) : showMore ? t("plansOrganiser.hideMore", { defaultValue: "Hide further discoveries" }) : t("plansOrganiser.discoverMore", { defaultValue: "Discover more ({{count}})", count: pool.length })}
          onPress={() => { if (replacing !== null) return; setShowMore((x) => !x); }} />
        {showMore ? (
          <>
            {pool.length ? pool.slice(0, 30).map((it) => (
              <View key={it.key} style={s.moreRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.moreTitle}>{it.title}</Text>
                  <Text style={s.meta}>{CATEGORY_LABEL[it.category] ?? it.category} · {it.why}</Text>
                </View>
                <AppButton size="sm" variant={replacing !== null ? "primary" : "secondary"} icon={replacing !== null ? "swap-horizontal" : "add"} label={replacing !== null ? t("plansOrganiser.useThis", { defaultValue: "Use this" }) : t("plansOrganiser.add", { defaultValue: "Add" })} onPress={() => take(it)} />
              </View>
            )) : <Text style={s.small}>{t("plansOrganiser.noMore", { defaultValue: "Nothing more was found for this search." })}</Text>}
            <Text style={s.label}>{t("plansOrganiser.searchMore", { defaultValue: "Find something else to add" })}</Text>
            <View style={s.searchRow}>
              <TextInput value={extraQ} onChangeText={setExtraQ} onSubmitEditing={searchMore} placeholder={t("plansOrganiser.searchMorePlaceholder", { defaultValue: "A word, a passage or a question" })} placeholderTextColor={c.textMuted} style={s.input} returnKeyType="search" accessibilityLabel={t("plansOrganiser.searchMore", { defaultValue: "Find something else to add" })} />
              {searching ? <ActivityIndicator color={c.primaryGreen} /> : <AppButton size="sm" icon="search" label={t("plansOrganiser.find", { defaultValue: "Find" })} onPress={searchMore} disabled={extraQ.trim().length < 2} />}
            </View>
            {searchError ? <Text style={s.error}>{searchError}</Text> : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    stageHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
    stageTitle: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    item: { padding: 12, gap: 4, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    itemOn: { borderColor: c.primaryGreen, borderWidth: 1.5 },
    itemTop: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    n: { width: 22, textAlign: "center", fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold", marginTop: 2 },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    why: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    source: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, marginTop: 2 },
    gaps: { padding: 12, gap: 4, borderRadius: 12, backgroundColor: c.cardBeige },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
    moreBox: { gap: 8 },
    moreRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    moreTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
  });
}
