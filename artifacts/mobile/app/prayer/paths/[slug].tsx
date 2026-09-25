import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getPrayerPath, updatePathProgress, type PrayerPathDetail } from "@/lib/prayerPathsApi";
import { getScriptureText } from "@/lib/prayerScriptureDisplay";
import { createJournalEntry } from "@/lib/prayerJournal2Api";
import { savePath, saveScripture, logPrayerActivity } from "@/lib/prayerLibraryApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

type ScreenState = "landing" | "active" | "complete";

export default function PrayerPathFlowScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState<PrayerPathDetail | null>(null);
  const [screen, setScreen] = useState<ScreenState>("landing");
  const [stepIndex, setStepIndex] = useState(0);
  const [verseText, setVerseText] = useState<string | null>(null);
  const [verseLoading, setVerseLoading] = useState(false);
  const [reflection, setReflection] = useState("");
  const [prayerText, setPrayerText] = useState("");
  const [response, setResponse] = useState("");
  const [pathSaved, setPathSaved] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const p = await getPrayerPath(slug);
        setPath(p);
        if (p.myProgress && p.myProgress.status === "in_progress") {
          setStepIndex(Math.max(0, p.myProgress.currentStepOrder - 1));
        }
      } catch (e: any) {
        showAlert("Couldn't open this prayer path", e.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const currentStep = path?.steps[stepIndex] ?? null;

  useEffect(() => {
    if (screen !== "active" || !currentStep?.scripture) return;
    setVerseText(null);
    setVerseLoading(true);
    getScriptureText(currentStep.scripture).then((r) => { setVerseText(r?.text ?? null); setVerseLoading(false); });
  }, [screen, currentStep?.id]);

  async function handleStart() {
    if (!path) return;
    setScreen("active");
    setStepIndex(0);
    await logPrayerActivity("prayer_path_started", { id: path.id, pathId: path.id, slug: path.slug });
    await updatePathProgress(path.id, 1).catch(() => {});
  }

  async function goToStep(nextIndex: number) {
    if (!path) return;
    setReflection(""); setPrayerText(""); setResponse("");
    if (nextIndex >= path.steps.length) {
      await updatePathProgress(path.id, path.steps.length).catch(() => {});
      setScreen("complete");
      return;
    }
    setStepIndex(nextIndex);
    await updatePathProgress(path.id, nextIndex + 1).catch(() => {});
  }

  async function handleSaveReflection() {
    if (!path || !currentStep) return;
    const sections = [
      reflection.trim() ? `Reflection: ${reflection.trim()}` : null,
      prayerText.trim() ? `My Prayer: ${prayerText.trim()}` : null,
      response.trim() ? `Bringing before God: ${response.trim()}` : null,
    ].filter(Boolean);
    if (sections.length === 0) { showAlert("Nothing to save yet", "Write a reflection, prayer, or response first."); return; }
    setSaving(true);
    try {
      await createJournalEntry({
        prayerText: sections.join("\n\n"), category: `path:${path.slug}`,
        scriptureReferenceId: currentStep.scriptureId, topicId: path.topicId,
      });
      showAlert("Saved to your Journal", "Your reflection was saved privately.");
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveScriptureStep() {
    if (!currentStep?.scripture || !path) return;
    try { await saveScripture(currentStep.scripture.id, path.topicId ?? undefined); showAlert("Saved", "Scripture saved to your library."); }
    catch (e: any) { showAlert("Couldn't save", e.message ?? "Please try again."); }
  }

  async function handleSavePath() {
    if (!path) return;
    try { await savePath(path.id); setPathSaved(true); } catch (e: any) { showAlert("Couldn't save path", e.message ?? "Please try again."); }
  }

  async function handleWriteCompletionReflection() {
    if (!path) return;
    setSaving(true);
    try {
      await createJournalEntry({ prayerText: `Completed the "${path.title}" Prayer Path.`, category: `path:${path.slug}`, topicId: path.topicId });
      setReflectionSaved(true);
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <><Stack.Screen options={{ headerShown: false }} /><View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View></>;
  if (!path) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, styles.centerFill]}>
          <Text style={styles.emptyText}>This prayer path isn't available right now.</Text>
        </View>
      </>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{path.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {screen === "landing" && (
          <View style={styles.card}>
            <Text style={styles.pathTitle}>{path.title}</Text>
            {!!path.description && <Text style={styles.pathDesc}>{path.description}</Text>}
            <View style={styles.metaRow}>
              <Ionicons name="book-outline" size={14} color={c.textMuted} />
              <Text style={styles.metaText}>{path.steps.length} Scriptures</Text>
              {!!path.estimatedMinutes && (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Ionicons name="time-outline" size={14} color={c.textMuted} />
                  <Text style={styles.metaText}>~{path.estimatedMinutes} minutes</Text>
                </>
              )}
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleStart}>
              <Text style={styles.primaryBtnText}>{path.myProgress?.status === "in_progress" ? "Resume Prayer Path" : "Start Prayer Path"}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {screen === "active" && currentStep && (
          <View style={styles.card}>
            <Text style={styles.stepCount}>Step {stepIndex + 1} of {path.steps.length}</Text>

            <View style={styles.labelPill}><Text style={styles.labelPillText}>SCRIPTURE</Text></View>
            <Text style={styles.referenceText}>{currentStep.scripture?.referenceDisplay}</Text>
            {verseLoading ? <ActivityIndicator color={c.accentGreen} /> : verseText ? (
              <Text style={styles.verseText}>"{verseText}"</Text>
            ) : (
              <Text style={styles.verseUnavailable}>This verse's text couldn't be loaded right now.</Text>
            )}
            <TouchableOpacity onPress={handleSaveScriptureStep} style={styles.inlineSaveBtn}>
              <Ionicons name="bookmark-outline" size={14} color={c.accentGreen} />
              <Text style={styles.inlineSaveText}>Save this Scripture</Text>
            </TouchableOpacity>

            <View style={styles.divider} />
            <View style={styles.labelPill}><Text style={styles.labelPillText}>REFLECT</Text></View>
            <Text style={styles.promptText}>{currentStep.reflectPrompt ?? "What does this Scripture reveal about God?"}</Text>
            <TextInput style={styles.textarea} value={reflection} onChangeText={setReflection} multiline placeholder="Write what stands out..." placeholderTextColor={c.textMuted} />

            <View style={styles.labelPill}><Text style={styles.labelPillText}>PRAY</Text></View>
            <Text style={styles.promptText}>{currentStep.prayPrompt ?? "Turn this Scripture into your own prayer."}</Text>
            <TextInput style={styles.textarea} value={prayerText} onChangeText={setPrayerText} multiline placeholder="Lord..." placeholderTextColor={c.textMuted} />

            <View style={styles.labelPill}><Text style={styles.labelPillText}>RESPOND</Text></View>
            <Text style={styles.promptText}>{currentStep.respondPrompt ?? "What are you bringing before God today?"}</Text>
            <TextInput style={styles.textarea} value={response} onChangeText={setResponse} multiline placeholder="Write it out..." placeholderTextColor={c.textMuted} />

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleSaveReflection} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={c.accentGreen} /> : (
                <><Ionicons name="book-outline" size={16} color={c.accentGreen} /><Text style={styles.secondaryBtnText}>Save to Journal</Text></>
              )}
            </TouchableOpacity>

            <View style={styles.navRow}>
              <TouchableOpacity style={[styles.navBtn, stepIndex === 0 && styles.navBtnDisabled]} onPress={() => stepIndex > 0 && goToStep(stepIndex - 1)} disabled={stepIndex === 0}>
                <Ionicons name="arrow-back" size={16} color={stepIndex === 0 ? c.textMuted : c.textDark} />
                <Text style={[styles.navBtnText, stepIndex === 0 && { color: c.textMuted }]}>Previous</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navBtnPrimary} onPress={() => goToStep(stepIndex + 1)}>
                <Text style={styles.navBtnPrimaryText}>{stepIndex + 1 < path.steps.length ? "Next" : "Finish"}</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {screen === "complete" && (
          <View style={styles.card}>
            <Text style={styles.completeEmoji}>🙏</Text>
            <Text style={styles.pathTitle}>Prayer Path Complete</Text>
            <Text style={styles.pathDesc}>You've reached the end of "{path.title}."</Text>

            {!reflectionSaved ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleWriteCompletionReflection} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={c.accentGreen} /> : (
                  <><Ionicons name="create-outline" size={16} color={c.accentGreen} /><Text style={styles.secondaryBtnText}>Write Reflection</Text></>
                )}
              </TouchableOpacity>
            ) : <Text style={styles.savedNote}>Saved to your journal.</Text>}

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleSavePath} disabled={pathSaved}>
              <Ionicons name={pathSaved ? "bookmark" : "bookmark-outline"} size={16} color={c.accentGreen} />
              <Text style={styles.secondaryBtnText}>{pathSaved ? "Path Saved" : "Save Path"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/prayer/pray-with-me" as any)}>
              <Ionicons name="people-outline" size={16} color={c.accentGreen} />
              <Text style={styles.secondaryBtnText}>Pray With Me</Text>
            </TouchableOpacity>

            {!!path.topicId && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/prayer/pray-the-word" as any)}>
                <Ionicons name="book-outline" size={16} color={c.accentGreen} />
                <Text style={styles.secondaryBtnText}>Read Related Scriptures</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/(tabs)/missions" as any)}>
              <Ionicons name="earth-outline" size={16} color={c.accentGreen} />
              <Text style={styles.secondaryBtnText}>Pray for Missions</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(tabs)/prayer" as any)}>
              <Text style={styles.primaryBtnText}>Return to Prayer</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 16 },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginHorizontal: 8 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, padding: 20, gap: 12 },
    pathTitle: { fontSize: 19, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    pathDesc: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center" },
    metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 },
    metaText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    metaDot: { color: c.textMuted, marginHorizontal: 2 },
    stepCount: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
    labelPill: { alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
    labelPillText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    referenceText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    verseText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 22, fontStyle: "italic" },
    verseUnavailable: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    inlineSaveBtn: { flexDirection: "row", gap: 5, alignItems: "center", alignSelf: "flex-start" },
    inlineSaveText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium" },
    divider: { height: 1, backgroundColor: c.borderBeige, marginVertical: 4 },
    promptText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
    textarea: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      padding: 12, minHeight: 70, textAlignVertical: "top", color: c.textDark, fontSize: 13, fontFamily: "Inter_400Regular",
    },
    primaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
    primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    secondaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12 },
    secondaryBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    savedNote: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium", textAlign: "center" },
    navRow: { flexDirection: "row", gap: 10, marginTop: 6 },
    navBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingVertical: 12 },
    navBtnDisabled: { opacity: 0.5 },
    navBtnText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    navBtnPrimary: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 12 },
    navBtnPrimaryText: { fontSize: 13, color: "#fff", fontFamily: "Inter_700Bold" },
    completeEmoji: { fontSize: 40, textAlign: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
