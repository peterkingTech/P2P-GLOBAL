// "Names and titles" in a My Plan / Bible Study search (owner brief 2026-11-18 §11): entries the search names
// (e.g. Abba, Prince of Peace, Yahweh → YHWH / Yahweh / Jehovah), and for God / Jesus / the Holy Spirit / "Names of …"
// the collection to open, with its first entries. Sits under "What it means"; every other result group is unchanged.
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import NameCard from "@/components/study/NameCard";
import type { NamesForSearch } from "@/lib/biblicalNamesApi";

export default function NamesSection({ names }: { names: NamesForSearch }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const s = useMemo(() => makeStyles(c), [c]);
  const col = names.collection;
  const openCol = (section: string) => router.push({ pathname: "/bible-study/names", params: { section } } as any);
  if (!names.matches.length && !col) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.head}>{t("names.searchTitle", { defaultValue: "Names, titles and descriptions" })}</Text>
      {col ? (
        <View style={[s.colCard, names.openCollection && s.colStrong]}>
          <Text style={s.colTitle}>{col.title}</Text>
          <Text style={s.note}>{t("names.colCount", { defaultValue: "{{count}} entries — each with its Scripture, original language and sources. Filter by person, language, Testament and kind.", count: col.total })}</Text>
          <View style={s.actions}>
            <AppButton icon="albums-outline" label={t("names.openCollection", { defaultValue: "Open the complete collection" })} onPress={() => openCol(col.section)} />
            {col.devotional ? <AppButton variant="secondary" icon="musical-notes-outline" label={t("names.devotionalCount", { defaultValue: "Devotional and worship expressions ({{count}})", count: col.devotional })} onPress={() => openCol("devotional")} /> : null}
          </View>
        </View>
      ) : null}
      {names.matches.map((m, i) => <NameCard key={m.id} item={m} initiallyOpen={i === 0 && !col} />)}
      {col?.preview.length ? (
        <>
          <Text style={s.sub}>{t("names.fromCollection", { defaultValue: "From the collection (in Bible order)" })}</Text>
          {col.preview.map((m) => <NameCard key={m.id} item={m} />)}
          <AppButton variant="tertiary" icon="arrow-forward" label={t("names.seeAll", { defaultValue: "See all {{count}}", count: col.total })} onPress={() => openCol(col.section)} />
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  head: { color: c.textDark, fontSize: 18, fontWeight: "800", marginTop: 4 },
  sub: { color: c.textMid, fontSize: 13, fontWeight: "700" },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  colCard: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: c.borderBeige },
  colStrong: { borderColor: c.accentGreen, borderWidth: 2 },
  colTitle: { color: c.textDark, fontSize: 18, fontWeight: "800" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
