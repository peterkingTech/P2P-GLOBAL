// BIBLICAL NAMES, TITLES AND DESCRIPTIONS — the collection browser (owner brief 2026-11-18 §2, §12).
// Sections A–H, filters (person, language, Testament, kind) showing only what has entries, sorting
// (Bible order, original language, category, A–Z), search inside the collection, and expandable entries (NameCard).
// Opened from the Bible Study page, from a search ("Names of God"), or at one entry (?id=).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { ActiveFilters, ChipRow, FilterChip, FilterSheet, type FilterGroup, type FilterValue } from "@/components/ui";
import { StudyState as StateView } from "@/components/study/StudyUI";
import NameCard from "@/components/study/NameCard";
import { getNameEntry, getNamesCollection, KIND_LABEL, LANGUAGE_LABEL, PERSON_LABEL, type NameKind, type NamePerson, type NameSection, type NameSummary, type NamesCollection, type NamesFilter } from "@/lib/biblicalNamesApi";

const SORTS = [["canon", "Bible order"], ["language", "Original language"], ["category", "Category"], ["alpha", "A–Z"]] as const;

export default function BiblicalNames() {
  const p = useLocalSearchParams<{ section?: string; id?: string }>();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [f, setF] = useState<NamesFilter>({ section: (p.section as NameSection) || "father", sort: "canon" });
  const [q, setQ] = useState("");
  const [data, setData] = useState<NamesCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<NameSummary | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    getNamesCollection({ ...f, q: q.trim() || undefined }).then(setData).catch((e) => setError((e as Error)?.message ?? "")).finally(() => setLoading(false));
  }, [f, q]);
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  // Opened at one entry (a "related name"): show it first, expanded.
  useEffect(() => {
    if (!p.id) return;
    getNameEntry(String(p.id)).then((r) => setFocus({ ...r.entry, original: r.entry.original.map((o) => ({ lemma: o.lemma, transliteration: o.transliteration, language: o.language, strongs: o.strongs })), interpretive: !!r.entry.interp } as NameSummary)).catch(() => {});
  }, [p.id]);
  const set = (patch: Partial<NamesFilter>) => setF((cur) => ({ ...cur, ...patch }));

  return (
    <>
      <Stack.Screen options={{ title: t("names.title", { defaultValue: "Names and Titles of God" }) }} />
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60, gap: 12, maxWidth: 900, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>{t("names.intro", { defaultValue: "The names, titles and descriptions Scripture gives God the Father, Jesus Christ and the Holy Spirit — with the original Hebrew, Aramaic and Greek, where each appears, and its sources. Devotional and worship expressions are listed separately and labelled for what they are." })}</Text>

        {focus ? <NameCard key={`focus-${focus.id}`} item={focus} initiallyOpen /> : null}

        <ChipRow accessibilityLabel={t("names.sections", { defaultValue: "Collections" })} single>
          {(data?.sections ?? []).filter((x) => x.count).map((x) => (
            <FilterChip key={x.key} label={`${t(`names.section.${x.key}`, { defaultValue: x.title })} ${x.count}`} selected={f.section === x.key} selection="single" onPress={() => set({ section: x.key })} />
          ))}
        </ChipRow>
        <TextInput value={q} onChangeText={setQ} placeholder={t("names.filterPlaceholder", { defaultValue: "Find a name, title, Hebrew or Greek word" })} placeholderTextColor={c.textMuted}
          style={s.search} accessibilityLabel={t("names.filterPlaceholder", { defaultValue: "Find a name, title, Hebrew or Greek word" })} />

        {data ? (() => {
          // One Filters control (UI refinement 2026-11-19): person, language, Testament, kind and sorting live in a
          // sheet; what's chosen shows as small removable chips. Same filters, same combinations as before.
          const groups: FilterGroup[] = [
            ...(data.facets.person.length > 1 ? [{ key: "person", title: t("names.byPerson", { defaultValue: "Person" }), options: [{ value: "", label: t("names.any", { defaultValue: "Any" }) }, ...data.facets.person.map((x) => ({ value: x.key, label: `${t(`names.person.${x.key}`, { defaultValue: PERSON_LABEL[x.key as NamePerson] })} ${x.count}` }))] }] : []),
            { key: "language", title: t("names.byLanguageOnly", { defaultValue: "Language" }), options: [{ value: "", label: t("names.any", { defaultValue: "Any" }) }, ...data.facets.language.map((x) => ({ value: x.key, label: `${t(`names.lang.${x.key}`, { defaultValue: LANGUAGE_LABEL[x.key] ?? x.key })} ${x.count}` }))] },
            { key: "testament", title: t("names.byTestament", { defaultValue: "Testament" }), options: [{ value: "", label: t("names.any", { defaultValue: "Any" }) }, ...data.facets.testament.map((x) => ({ value: x.key, label: `${x.key === "OT" ? t("study.testament.OT", { defaultValue: "Old Testament" }) : t("study.testament.NT", { defaultValue: "New Testament" })} ${x.count}` }))] },
            { key: "kind", title: t("names.byKind", { defaultValue: "Kind" }), options: [{ value: "", label: t("names.any", { defaultValue: "Any" }) }, ...data.facets.kind.map((x) => ({ value: x.key, label: `${t(`names.kind.${x.key}`, { defaultValue: KIND_LABEL[x.key as NameKind] })} ${x.count}` }))] },
            { key: "sort", title: t("names.sort", { defaultValue: "Sort" }), options: SORTS.map(([k, l]) => ({ value: k, label: t(`names.sortBy.${k}`, { defaultValue: l }) })) },
          ];
          const value: FilterValue = { person: [f.person ?? ""], language: [f.language ?? ""], testament: [f.testament ?? ""], kind: [f.kind ?? ""], sort: [f.sort ?? "canon"] };
          const defaults: FilterValue = { person: [""], language: [""], testament: [""], kind: [""], sort: ["canon"] };
          const apply = (v: FilterValue) => set({ person: (v.person?.[0] || null) as NamesFilter["person"], language: v.language?.[0] || null, testament: (v.testament?.[0] || null) as NamesFilter["testament"], kind: (v.kind?.[0] || null) as NamesFilter["kind"], sort: (v.sort?.[0] || "canon") as NamesFilter["sort"] });
          return (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <FilterSheet groups={groups} value={value} defaults={defaults} onChange={apply} />
                <Text style={[s.note, { flex: 1 }]}>{t("names.showing", { defaultValue: "{{count}} of {{total}} in {{title}}", count: data.total, total: data.sectionTotal, title: data.title })}</Text>
              </View>
              <ActiveFilters groups={groups} value={value} defaults={defaults} onChange={apply} />
            </View>
          );
        })() : null}

        <StateView loading={loading && !data} error={error} onRetry={load} empty={data && !data.entries.length ? t("names.none", { defaultValue: "No entries match these filters." }) : null} />
        {(data?.entries ?? []).filter((e) => e.id !== focus?.id).map((e) => <NameCard key={e.id} item={e} />)}

        {data ? (
          <View style={s.about}>
            <Text style={s.label}>{t("names.aboutTitle", { defaultValue: "Sources and coverage" })}</Text>
            <Text style={s.note}>{data.about.coverage}</Text>
            <Text style={s.note}>{t("names.aboutSources", { defaultValue: "Scripture: {{bibles}}. Original languages: STEPBible lexicons (CC BY 4.0) with BSB interlinear tagging. Dictionary: {{easton}}.",
              bibles: data.about.sources.bible.map((b) => `${b.name} (${b.licence})`).join(", "), easton: `${data.about.sources.easton.name} (${data.about.sources.easton.licence})` })}</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  intro: { color: c.textMid, fontSize: 15, lineHeight: 22 },
  search: { minHeight: 48, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.textDark, backgroundColor: c.card },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  label: { color: c.textMid, fontSize: 13, fontWeight: "800" },
  about: { gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
});
