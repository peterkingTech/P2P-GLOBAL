import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { ChipRow, FilterChip, IconButton } from "@/components/ui";
import { StudyState } from "@/components/study/StudyUI";
import { studyResources, type StudyResource } from "@/lib/deepStudyApi";

// COMMENTARIES — the commentary library on its own. The same commentary records Deep Study compares
// (lib/deepStudyApi): the live catalogue, limited to the commentaries P2P Global has reviewed.
type Filter = "all" | "pd" | "bysa";
export default function CommentariesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [list, setList] = useState<StudyResource[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const load = useCallback(() => { setError(null); studyResources().then((r) => { setList(r.commentaries); setOffline(!!(r as { offline?: boolean }).offline); }, (e) => setError(e?.message ?? "Couldn't load the commentaries.")); }, []);
  useEffect(load, [load]);
  const shown = (list ?? []).filter((r) => (filter === "all" || (filter === "pd" ? !r.credit.shareAlike : r.credit.shareAlike))
    && (!q.trim() || `${r.name} ${r.author}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("deepStudy.commentaries", { defaultValue: "Commentaries" })}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.lead}>{t("deepStudy.commentaryLead", { defaultValue: "Classic commentaries and open study notes, shown as published. They are their authors' views, not P2P Global teaching." })}</Text>
        <TextInput value={q} onChangeText={setQ} placeholder={t("deepStudy.searchCommentaries", { defaultValue: "Search by title or author" })} placeholderTextColor={c.textMuted} style={s.input}
          accessibilityLabel={t("deepStudy.searchCommentaries", { defaultValue: "Search by title or author" })} />
        <ChipRow accessibilityLabel={t("deepStudy.filter", { defaultValue: "Filter" })} single>
          <FilterChip label={t("deepStudy.all", { defaultValue: "All" })} selected={filter === "all"} selection="single" onPress={() => setFilter("all")} />
          <FilterChip label={t("deepStudy.publicDomain", { defaultValue: "Public domain" })} selected={filter === "pd"} selection="single" onPress={() => setFilter("pd")} />
          <FilterChip label="CC BY-SA" selected={filter === "bysa"} selection="single" onPress={() => setFilter("bysa")} />
        </ChipRow>
        <StudyState loading={!list && !error} error={error} onRetry={load} offline={offline} />
        {list && !shown.length ? <StudyState empty={t("deepStudy.noMatches", { defaultValue: "Nothing matches." })} /> : null}
        {shown.map((r) => (
          <TouchableOpacity key={r.id} style={s.card} onPress={() => router.push({ pathname: "/commentaries/[id]", params: { id: r.id } } as any)} accessibilityRole="button">
            <View style={s.icon}><Ionicons name="library-outline" size={20} color={c.primaryGreen} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.name}>{r.name}</Text>
              <Text style={s.meta}>{r.author}</Text>
              <Text style={s.meta}>{r.language} · {r.coverage.books ?? "?"} {t("deepStudy.books", { defaultValue: "books" })} · {r.credit?.licence?.name ?? ""}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    lead: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    input: { minHeight: 46, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, backgroundColor: c.card },
    card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
