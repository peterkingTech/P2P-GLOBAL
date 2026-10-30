import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getTopic, updateTopicProgress, type PrayerTopicDetail, type ScriptureReference } from "@/lib/prayerTopicsApi";
import { getScriptureText } from "@/lib/prayerScriptureDisplay";
import { createJournalEntry } from "@/lib/prayerJournal2Api";
import { saveScripture, logPrayerActivity } from "@/lib/prayerLibraryApi";
import ReadInBibleLink from "@/components/bible/ReadInBibleLink";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";


type Phase = "scripture" | "reflect" | "pray" | "respond" | "remember";
const PHASE_ORDER: Phase[] = ["scripture", "reflect", "pray", "respond", "remember"];

// "Pray the Word" Stage 2 — the core experience: Scripture -> Reflect ->
// Pray -> Respond -> Remember, cycling through a topic's curated
// Scriptures. Scripture text is fetched live (never stored here); the
// prayer prompt is explicitly a devotional FRAMEWORK, never presented as
// Scripture or as divinely authored.
export default function PrayTheWordFlowScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState<PrayerTopicDetail | null>(null);
  const [scriptureIndex, setScriptureIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("scripture");
  const [verseText, setVerseText] = useState<string | null>(null);
  const [translationName, setTranslationName] = useState<string | null>(null);
  const [verseLoading, setVerseLoading] = useState(false);

  const [reflection, setReflection] = useState("");
  const [prayerText, setPrayerText] = useState("");
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedThisRound, setSavedThisRound] = useState(false);
  const [scriptureSaved, setScriptureSaved] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const t = await getTopic(slug);
        setTopic(t);
        // Enhancement Stage 2 — resume exactly where the peer left off,
        // never further. currentScriptureOrder is a COUNT of completed
        // scriptures (0 = none yet), which is also the correct 0-based
        // index of the next one to view. Clamped so a fully-completed
        // topic still opens (at its last scripture) instead of crashing.
        const resumeIndex = Math.min(t.myProgress?.currentScriptureOrder ?? 0, Math.max(0, t.scriptures.length - 1));
        setScriptureIndex(resumeIndex);
      } catch (e: any) {
        showAlert("Couldn't open this topic", e.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const currentScripture: ScriptureReference | null = topic?.scriptures[scriptureIndex] ?? null;

  useEffect(() => {
    if (!currentScripture) return;
    setVerseText(null);
    setTranslationName(null);
    setScriptureSaved(false);
    setVerseLoading(true);
    getScriptureText(currentScripture).then((result) => {
      setVerseText(result?.text ?? null);
      setTranslationName(result?.translationName ?? null);
      setVerseLoading(false);
    });
    void logPrayerActivity("prayer_scripture_viewed", { id: currentScripture.id, scriptureId: currentScripture.id, topicSlug: slug });
  }, [currentScripture?.id]);

  useEffect(() => {
    if (topic) void logPrayerActivity("prayer_topic_viewed", { id: topic.id, topicId: topic.id, slug: topic.slug });
  }, [topic?.id]);

  function goToPhase(next: Phase) { setPhase(next); }

  async function handleSaveScripture() {
    if (!currentScripture || !topic) return;
    try {
      await saveScripture(currentScripture.id, topic.id);
      setScriptureSaved(true);
    } catch (e: any) {
      showAlert("Couldn't save this Scripture", e.message ?? "Please try again.");
    }
  }

  async function handleAddToJournal() {
    if (!currentScripture || !topic) return;
    setSaving(true);
    try {
      const sections = [
        reflection.trim() ? `Reflection: ${reflection.trim()}` : null,
        prayerText.trim() ? `My Prayer: ${prayerText.trim()}` : null,
        response.trim() ? `Bringing before God: ${response.trim()}` : null,
      ].filter(Boolean);
      if (sections.length === 0) { showAlert("Nothing to save yet", "Write a reflection, prayer, or response first."); setSaving(false); return; }

      await createJournalEntry({
        prayerText: sections.join("\n\n"),
        category: topic.slug,
        scriptureReferenceId: currentScripture.id,
        topicId: topic.id,
      });
      setSavedThisRound(true);
      showAlert("Saved to your Journal", "Your prayer and reflection were saved privately.");
    } catch (e: any) {
      showAlert("Couldn't save to your journal", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (!topic) return;
    // Enhancement Stage 2 — record completion of THIS scripture (1-based
    // position) before advancing. The server enforces this must be
    // exactly the next sequential step; since this screen only ever calls
    // it in order, that should always succeed — if it doesn't (e.g. a
    // stale session), navigation still proceeds rather than trapping the
    // peer, but progress simply won't have advanced server-side.
    await updateTopicProgress(topic.id, scriptureIndex + 1).catch(() => {});
    const nextIndex = scriptureIndex + 1;
    setReflection(""); setPrayerText(""); setResponse(""); setSavedThisRound(false);
    if (nextIndex < topic.scriptures.length) {
      setScriptureIndex(nextIndex);
      setPhase("scripture");
    } else {
      router.replace("/prayer/pray-the-word" as any);
    }
  }

  if (loading) return <><Stack.Screen options={{ headerShown: false }} /><View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View></>;
  if (!topic || !currentScripture) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, styles.centerFill]}>
          <Text style={styles.emptyText}>This topic isn't available right now.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={styles.linkText}>Go back</Text></TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{topic.title}</Text>
        <Text style={styles.headerCount}>{scriptureIndex + 1}/{topic.scriptures.length}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {phase === "scripture" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>SCRIPTURE</Text></View>
            <Text style={styles.referenceText}>{currentScripture.referenceDisplay}</Text>
            <ReadInBibleLink reference={currentScripture.referenceDisplay} label="Read in context" />
            {verseLoading ? (
              <ActivityIndicator color={c.accentGreen} style={{ marginTop: 16 }} />
            ) : verseText ? (
              <>
                <Text style={styles.verseText}>"{verseText}"</Text>
                {!!translationName && <Text style={styles.translationNote}>{translationName}</Text>}
              </>
            ) : (
              <Text style={styles.verseUnavailable}>This verse's text couldn't be loaded right now — you can still reflect and pray using the reference above.</Text>
            )}
            <AppButton label="Reflect" onPress={() => goToPhase("reflect")} icon="arrow-forward" iconPosition="trailing" style={{ marginTop: 4 }} />
          </View>
        )}

        {phase === "reflect" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>REFLECT</Text></View>
            <Text style={styles.promptText}>What does this Scripture reveal about God?</Text>
            <TextInput
              style={styles.textarea} value={reflection} onChangeText={setReflection} multiline
              placeholder="Write what stands out to you..." placeholderTextColor={c.textMuted}
            />
            <AppButton label="Pray" onPress={() => goToPhase("pray")} icon="arrow-forward" iconPosition="trailing" style={{ marginTop: 4 }} />
          </View>
        )}

        {phase === "pray" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>PRAY</Text></View>
            <Text style={styles.frameworkNote}>
              This is a prayer framework to help you begin — your own words, not Scripture, and not written for you by anyone else.
            </Text>
            <Text style={styles.promptText}>Turn this Scripture into your own prayer.</Text>
            <TextInput
              style={styles.textarea} value={prayerText} onChangeText={setPrayerText} multiline
              placeholder="Lord, thank You for..." placeholderTextColor={c.textMuted}
            />
            <AppButton label="Respond" onPress={() => goToPhase("respond")} icon="arrow-forward" iconPosition="trailing" style={{ marginTop: 4 }} />
          </View>
        )}

        {phase === "respond" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>RESPOND</Text></View>
            <Text style={styles.promptText}>What are you bringing before God today?</Text>
            <TextInput
              style={styles.textarea} value={response} onChangeText={setResponse} multiline
              placeholder="Write it out..." placeholderTextColor={c.textMuted}
            />
            <AppButton label="Remember" onPress={() => goToPhase("remember")} icon="arrow-forward" iconPosition="trailing" style={{ marginTop: 4 }} />
          </View>
        )}

        {phase === "remember" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>REMEMBER</Text></View>
            <Text style={styles.promptText}>{currentScripture.referenceDisplay}</Text>

            <AppButton label={scriptureSaved ? "Scripture Saved" : "Save Scripture"} onPress={handleSaveScripture} variant="outline" icon={scriptureSaved ? "bookmark" : "bookmark-outline"} disabled={scriptureSaved} />

            <AppButton label={savedThisRound ? "Saved to Journal" : "Add to Journal"} onPress={handleAddToJournal} variant="outline" icon={savedThisRound ? "checkmark-circle" : "book-outline"} disabled={saving || savedThisRound} loading={saving} />

            {/* Stage 7 ecosystem connections — route into EXISTING systems only */}
            <AppButton label="Pray With Me" onPress={() => router.push({ pathname: "/prayer/pray-with-me", params: { scriptureRef: currentScripture.referenceDisplay, topicTitle: topic.title } } as any)} variant="outline" icon="people-outline" />
            <AppButton label="Study This Scripture" onPress={() => router.push({ pathname: "/prayer/study/[scriptureId]", params: { scriptureId: currentScripture.id, topicTitle: topic.title } } as any)} variant="outline" icon="school-outline" />
            {topic.slug === "family" && (
              <AppButton label="Take to Family Circle Prayer" onPress={() => router.push("/family/prayer" as any)} variant="outline" icon="home-outline" />
            )}

            <AppButton label={scriptureIndex + 1 < topic.scriptures.length ? "Continue" : "Finish"} onPress={handleContinue} icon="arrow-forward" iconPosition="trailing" style={{ marginTop: 4 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", gap: 10 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 16 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    headerCount: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, padding: 20, gap: 14 },
    labelPill: { alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    labelPillText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    referenceText: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    verseText: { fontSize: 17, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 26, fontStyle: "italic" },
    translationNote: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    verseUnavailable: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19 },
    promptText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
    frameworkNote: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 17 },
    textarea: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      padding: 14, minHeight: 100, textAlignVertical: "top", color: c.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
    },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    linkText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
