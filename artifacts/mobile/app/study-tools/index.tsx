import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { IconButton } from "@/components/ui";
import { SectionTitle } from "@/components/study/StudyUI";
import { studyResources, type StudyResource } from "@/lib/deepStudyApi";

// STUDY TOOLS — each tool on its own, over the SAME records as Deep Study: the lexicon tools open the
// same entries a tapped word opens, and the passage tools open Deep Study on that view. Only tools with
// real data behind them are listed; their sizes come from the live catalogue.
type Tool = { key: string; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; go: () => void; dataset: string };
export default function StudyToolsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [datasets, setDatasets] = useState<StudyResource[]>([]);
  useEffect(() => { studyResources().then((r) => setDatasets(r.datasets)).catch(() => {}); }, []);
  const size = (id: string) => {
    const d = datasets.find((x) => x.id === id);
    if (!d) return null;
    const n = d.coverage.entries ?? d.coverage.references ?? d.coverage.words;
    return n ? n.toLocaleString() : null;
  };
  const lex = (language?: string, mode?: string) => router.push({ pathname: "/study-tools/lexicon", params: { ...(language ? { language } : {}), ...(mode ? { mode } : {}) } } as any);
  const passage = (tab: string) => router.push({ pathname: "/deep-study", params: { tab } } as any);
  const groups: [string, Tool[]][] = [
    [t("deepStudy.toolsWords", { defaultValue: "Words and meanings" }), [
      { key: "hebrew", icon: "text-outline", title: t("deepStudy.hebrewLexicon", { defaultValue: "Hebrew lexicon" }), sub: t("deepStudy.hebrewLexiconSub", { defaultValue: "Old Testament words, with every sense" }), go: () => lex("hebrew"), dataset: "stepbible-lexicon" },
      { key: "greek", icon: "text-outline", title: t("deepStudy.greekLexicon", { defaultValue: "Greek lexicon" }), sub: t("deepStudy.greekLexiconSub", { defaultValue: "New Testament words, with every sense" }), go: () => lex("greek"), dataset: "stepbible-lexicon" },
      { key: "aramaic", icon: "text-outline", title: t("deepStudy.aramaicLexicon", { defaultValue: "Aramaic lexicon" }), sub: t("deepStudy.aramaicLexiconSub", { defaultValue: "The Aramaic of Daniel and Ezra" }), go: () => lex("aramaic"), dataset: "stepbible-lexicon" },
      { key: "strongs", icon: "keypad-outline", title: t("deepStudy.strongsLookup", { defaultValue: "Strong's lookup" }), sub: t("deepStudy.strongsLookupSub", { defaultValue: "Open a word by its number, e.g. H1254 or G3056" }), go: () => lex(undefined, "strongs"), dataset: "stepbible-lexicon" },
      { key: "word", icon: "search-outline", title: t("deepStudy.wordStudy", { defaultValue: "Word study" }), sub: t("deepStudy.wordStudySub", { defaultValue: "A word's meanings, and where it is used in a chapter" }), go: () => lex(undefined, "word"), dataset: "stepbible-lexicon" },
    ]],
    [t("deepStudy.toolsPassages", { defaultValue: "Passages" }), [
      { key: "interlinear", icon: "language-outline", title: t("deepStudy.interlinear", { defaultValue: "Original-language interlinear" }), sub: t("deepStudy.interlinearSub", { defaultValue: "Hebrew, Aramaic and Greek, word by word" }), go: () => passage("original"), dataset: "bsb-interlinear" },
      { key: "xref", icon: "git-network-outline", title: t("deepStudy.crossRefExplorer", { defaultValue: "Cross-reference explorer" }), sub: t("deepStudy.crossRefExplorerSub", { defaultValue: "Verses that speak to each other" }), go: () => passage("xref"), dataset: "open-cross-ref" },
      { key: "people", icon: "people-outline", title: t("deepStudy.peoplePlaces", { defaultValue: "People, places and events" }), sub: t("deepStudy.peoplePlacesSub", { defaultValue: "Who and where, in any passage" }), go: () => passage("people"), dataset: "theographic" },
    ]],
  ];
  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("deepStudy.studyTools", { defaultValue: "Study Tools" })}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}>
        {groups.map(([g, tools]) => (
          <View key={g} style={{ gap: 8 }}>
            <SectionTitle>{g}</SectionTitle>
            {tools.map((tool) => (
              <TouchableOpacity key={tool.key} style={s.card} onPress={tool.go} accessibilityRole="button" accessibilityHint={tool.sub}>
                <View style={s.icon}><Ionicons name={tool.icon} size={20} color={c.primaryGreen} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.name}>{tool.title}</Text>
                  <Text style={s.meta}>{tool.sub}{size(tool.dataset) ? ` · ${size(tool.dataset)}` : ""}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <Text style={s.meta}>{t("deepStudy.toolsNote", { defaultValue: "Lexicons and notes are in English; the original words keep their own script." })}</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
  });
}
