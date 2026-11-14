import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { getSubjectTypes, searchSubjects, SUBJECT_TYPES, type SubjectItem, type SubjectType } from "@/lib/planDiscoveryApi";

// P2P PLANS — "What would you like to study?" A searchable selector built from the REAL records (every Bible
// book, every published Scripture topic, published people / events / places / themes, Core Foundations,
// Kingdom School courses). Types with no records are hidden; results are fetched as the person types.
export interface ChosenSubject { type: SubjectType; key: string; label: string }

export default function SubjectPicker({ value, onChange, types, initialType }: { value: ChosenSubject | null; onChange: (s: ChosenSubject | null) => void; types?: SubjectType[]; initialType?: SubjectType }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [available, setAvailable] = useState<SubjectType[] | null>(null);
  const [type, setType] = useState<SubjectType>(value?.type ?? initialType ?? "bible_topic");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SubjectItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    getSubjectTypes().then((r) => {
      const has = r.types.filter((x) => x.count > 0).map((x) => x.type).filter((x) => !types || types.includes(x));
      setAvailable(has);
      if (!has.includes(type) && has.length) setType(has.includes("bible_topic") ? "bible_topic" : has[0]);
    }, () => setAvailable(SUBJECT_TYPES.filter((x) => x === "bible_book" || x === "bible_topic")));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (ty: SubjectType, query: string, offset = 0) => {
    const my = ++seq.current;
    setError(null);
    if (!offset) setItems(null);
    searchSubjects(ty, query, offset).then((r) => {
      if (my !== seq.current) return; // a newer search replaced this one
      setItems((prev) => (offset && prev ? [...prev, ...r.items] : r.items)); setTotal(r.total);
    }, (e) => { if (my === seq.current) setError(e?.message ?? t("p2pPlans.discover.loadError")); });
  };
  useEffect(() => {
    if (!available?.includes(type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(type, q), q ? 250 : 0);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [type, q, available]); // eslint-disable-line react-hooks/exhaustive-deps

  if (value) {
    return (
      <View style={s.chosen} accessibilityLabel={t("p2pPlans.discover.chosen", { label: value.label })}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>{t(`p2pPlans.subjectType.${value.type}`)}</Text>
          <Text style={s.chosenLabel}>{value.label}</Text>
        </View>
        <AppButton size="sm" variant="secondary" label={t("p2pPlans.discover.change")} onPress={() => onChange(null)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {!available ? <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /> : (
        <ChipRow accessibilityLabel={t("p2pPlans.discover.typeLabel")} single>
          {available.map((x) => <FilterChip key={x} label={t(`p2pPlans.subjectType.${x}`)} selected={type === x} selection="single" onPress={() => { setType(x); setQ(""); }} />)}
        </ChipRow>
      )}
      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={c.textMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t(`p2pPlans.discover.searchPlaceholder.${type}`)} placeholderTextColor={c.textMuted} style={s.search}
          accessibilityLabel={t("p2pPlans.discover.search", { type: t(`p2pPlans.subjectType.${type}`) })} autoCorrect={false} />
      </View>
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      {items === null && !error ? <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /> : null}
      {items && !items.length ? <Text style={s.meta}>{t("p2pPlans.discover.noSubjects")}</Text> : null}
      <View style={s.list}>
        {(items ?? []).map((it) => (
          <TouchableOpacity key={`${it.type}:${it.key}`} style={s.item} onPress={() => onChange({ type: it.type, key: it.key, label: it.label })} accessibilityRole="button"
            accessibilityLabel={`${it.label}. ${t(`p2pPlans.subjectType.${it.type}`)}`}>
            <Text style={s.itemLabel}>{it.label}</Text>
            {it.hint && it.type === "bible_topic" ? <Text style={s.small}>{t("p2pPlans.discover.passages", { count: Number(it.hint) })}</Text> : it.hint && it.type !== "bible_book" ? <Text style={s.small} numberOfLines={1}>{it.hint}</Text> : null}
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
      {items && items.length < total ? <AppButton size="sm" variant="tertiary" label={t("p2pPlans.discover.more", { count: total - items.length })} onPress={() => run(type, q, items.length)} /> : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    chosen: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.accentGreen },
    chosenLabel: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12 },
    search: { flex: 1, minHeight: 44, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 15 },
    list: { borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    item: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    itemLabel: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", maxWidth: 180 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
  });
}
