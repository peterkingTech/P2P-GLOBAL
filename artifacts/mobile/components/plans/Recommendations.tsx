import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { discover, type Discovery, type Recommendation, type Relevance } from "@/lib/planDiscoveryApi";
import { reasonText, targetRoute } from "@/lib/studyPlansUi";

// P2P PLANS — what P2P found for a subject, grouped by resource type, each with its relevance (Directly
// relevant / Supporting / Further exploration), whether it is essential or optional in a suggested journey,
// WHY it was recommended, and a link to open the real resource. Beginners see direct and supporting items;
// further exploration is one tap away. With `onAdd`, each item can be added to (or removed from) a plan.
export default function Recommendations({ data, onAdd, added }: { data: Discovery; onAdd?: (r: Recommendation) => void; added?: Set<string> }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [level, setLevel] = useState<Relevance | "all">("all");
  const [showFurther, setShowFurther] = useState(false);
  const [extra, setExtra] = useState<Record<string, Recommendation[]>>({});
  const sections = data.sections.map((sec) => ({ ...sec, items: [...sec.items, ...(extra[sec.section] ?? [])] }));
  const visible = (r: Recommendation) => (level === "all" ? r.relevance !== "further" || showFurther : r.relevance === level);
  const more = (section: Discovery["sections"][number]["section"], offset: number) =>
    discover(data.subject.type, data.subject.key, { section, offset }).then((d) => setExtra((x) => ({ ...x, [section]: [...(x[section] ?? []), ...(d.sections[0]?.items ?? [])] })), () => {});

  if (!sections.some((sec) => sec.items.length)) return <Text style={s.meta}>{t("p2pPlans.discover.nothing")}</Text>;
  return (
    <View style={{ gap: 14 }}>
      <Text style={s.meta}>{t("p2pPlans.discover.counts", { direct: data.counts.direct, supporting: data.counts.supporting, further: data.counts.further })}</Text>
      <ChipRow accessibilityLabel={t("p2pPlans.discover.filter")} single>
        {(["all", "direct", "supporting", "further"] as const).map((k) => <FilterChip key={k} label={t(`p2pPlans.relevance.${k}`)} selected={level === k} selection="single" onPress={() => setLevel(k)} />)}
      </ChipRow>
      {sections.map((sec) => {
        const list = sec.items.filter(visible);
        if (!list.length) return null;
        return (
          <View key={sec.section} style={{ gap: 8 }}>
            <Text style={s.sectionTitle} accessibilityRole="header">{t(`p2pPlans.section.${sec.section}`)}</Text>
            {list.map((r) => {
              const route = targetRoute(r.resource, r.reason);
              const isAdded = added?.has(r.key);
              return (
                <View key={r.key} style={[s.card, isAdded && s.cardAdded]}>
                  <View style={s.rowBetween}>
                    <Text style={[s.pill, s[`pill_${r.relevance}` as const]]}>{t(`p2pPlans.relevance.${r.relevance}`)}</Text>
                    <Text style={s.small}>{r.essential ? t("p2pPlans.discover.essential") : t("p2pPlans.discover.optional")}</Text>
                  </View>
                  <Text style={s.cardTitle}>{r.title}</Text>
                  {r.subtitle ? <Text style={s.small}>{r.subtitle}</Text> : null}
                  <View style={s.reasonRow}>
                    <Ionicons name="information-circle-outline" size={15} color={c.textMid} />
                    <Text style={s.reason}>{reasonText(t, r.reason)}</Text>
                  </View>
                  {r.chapters && r.chapters.length > 1 ? <Text style={s.small}>{t("p2pPlans.discover.chapters", { list: r.chapters.map((ch) => ch.number).join(", ") })}</Text> : null}
                  <View style={s.buttons}>
                    {route ? <AppButton size="sm" variant="secondary" icon="open-outline" label={t("p2pPlans.discover.open")} accessibilityLabel={`${t("p2pPlans.discover.open")} ${r.title}`} onPress={() => router.push(route as any)} /> : null}
                    {onAdd && r.resource.kind !== "subject" ? (
                      <AppButton size="sm" variant={isAdded ? "tertiary" : "primary"} icon={isAdded ? "remove" : "add"} label={isAdded ? t("p2pPlans.builder.remove") : t("p2pPlans.discover.add")}
                        accessibilityLabel={`${isAdded ? t("p2pPlans.builder.remove") : t("p2pPlans.discover.add")} ${r.title}`} onPress={() => onAdd(r)} />
                    ) : null}
                  </View>
                </View>
              );
            })}
            {sec.total > sec.items.length && level !== "further" ? <AppButton size="sm" variant="tertiary" label={t("p2pPlans.discover.more", { count: sec.total - sec.items.length })} onPress={() => more(sec.section, sec.items.length)} /> : null}
          </View>
        );
      })}
      {level === "all" && data.counts.further > 0 ? (
        <TouchableOpacity onPress={() => setShowFurther(!showFurther)} accessibilityRole="button" style={s.toggle}>
          <Text style={s.toggleText}>{showFurther ? t("p2pPlans.discover.hideFurther") : t("p2pPlans.discover.showFurther", { count: data.counts.further })}</Text>
          <Ionicons name={showFurther ? "chevron-up" : "chevron-down"} size={16} color={c.accentGreen} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    sectionTitle: { fontSize: 13, letterSpacing: 0.5, fontFamily: "Inter_700Bold", color: c.textMuted, textTransform: "uppercase", marginTop: 4 },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardAdded: { borderColor: c.accentGreen, borderWidth: 1.5 },
    cardTitle: { fontSize: 15.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    pill: { fontSize: 11.5, fontFamily: "Inter_700Bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden", color: c.textDark, backgroundColor: c.cardBeige },
    pill_direct: { backgroundColor: "rgba(29,158,117,0.16)", color: c.primaryGreen },
    pill_supporting: { backgroundColor: "rgba(201,149,42,0.18)", color: c.textDark },
    pill_further: { backgroundColor: c.cardBeige, color: c.textMid },
    reasonRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
    reason: { flex: 1, fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
    toggle: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, justifyContent: "center" },
    toggleText: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
