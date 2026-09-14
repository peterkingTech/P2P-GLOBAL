import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getScriptureReference, type ScriptureReference } from "@/lib/prayerTopicsApi";
import { getScriptureText } from "@/lib/prayerScriptureDisplay";
import { createJournalEntry } from "@/lib/prayerJournal2Api";
import { saveScripture, logPrayerActivity } from "@/lib/prayerLibraryApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

type Step = "read" | "reflect" | "respond";
const STEP_LABEL: Record<Step, string> = { read: "READ", reflect: "REFLECT", respond: "RESPOND" };
const STEP_INDEX: Record<Step, number> = { read: 1, reflect: 2, respond: 3 };

const REFLECTION_QUESTIONS = [
  "What is God showing you through this Scripture?",
  "What stands out to you?",
  "How does this Scripture speak to what you are praying about?",
];

// Prayer -> "Study this Scripture" -> Scripture Devotional Study.
// Replaces the prior generic route into Kingdom School with a focused,
// deterministic READ -> REFLECT -> RESPOND devotional for the EXACT
// Scripture the peer was praying with. No AI-generated content anywhere
// here — the devotional structure (prompts, questions) is fixed and
// curated; only the Scripture reference and its resolved text (via the
// existing licensed Bible pipeline) vary per entry. Steps are strictly
// sequential within this screen's own local state — there is nothing to
// deep-link past, since the route only ever receives a scriptureId, never
// a step number.
export default function ScriptureDevotionalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { scriptureId, topicTitle } = useLocalSearchParams<{ scriptureId: string; topicTitle?: string }>();

  const [loading, setLoading] = useState(true);
  const [scripture, setScripture] = useState<ScriptureReference | null>(null);
  const [verseText, setVerseText] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("read");
  const [reflectionNote, setReflectionNote] = useState("");
  const [responseNote, setResponseNote] = useState("");
  const [scriptureSaved, setScriptureSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!scriptureId) return;
    (async () => {
      try {
        const ref = await getScriptureReference(scriptureId);
        setScripture(ref);
        const resolved = await getScriptureText(ref);
        setVerseText(resolved?.text ?? null);
      } catch (e: any) {
        showAlert("Couldn't open this Scripture", e.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [scriptureId]);

  async function handleSaveScripture() {
    if (!scripture) return;
    try { await saveScripture(scripture.id); setScriptureSaved(true); }
    catch (e: any) { showAlert("Couldn't save this Scripture", e.message ?? "Please try again."); }
  }

  async function handlePrayThisScripture() {
    if (!scripture) return;
    setSaving(true);
    try {
      const sections = [
        reflectionNote.trim() ? `Reflection: ${reflectionNote.trim()}` : null,
        responseNote.trim() ? `My Response: ${responseNote.trim()}` : null,
      ].filter(Boolean);
      await createJournalEntry({
        prayerText: sections.length ? sections.join("\n\n") : `Praying through ${scripture.referenceDisplay}.`,
        category: "scripture-devotional", scriptureReferenceId: scripture.id,
      });
      await logPrayerActivity("scripture_devotional_completed", { id: scripture.id, scriptureId: scripture.id }).catch(() => {});
      setCompleted(true);
      showAlert("Saved to your Journal", "Your reflection and prayer were saved privately.");
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  if (!scripture) return <View style={[styles.screen, styles.centerFill]}><Text style={styles.emptyText}>This Scripture isn't available right now.</Text></View>;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scripture Study</Text>
        <Text style={styles.headerCount}>{STEP_INDEX[step]}/3</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {step === "read" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>{STEP_LABEL.read}</Text></View>
            <Text style={styles.referenceText}>{scripture.referenceDisplay}</Text>
            {verseText ? (
              <Text style={styles.verseText}>"{verseText}"</Text>
            ) : (
              <Text style={styles.verseUnavailable}>This verse's text couldn't be loaded right now — you can still reflect using the reference above.</Text>
            )}
            <Text style={styles.contextText}>
              {topicTitle
                ? `This Scripture is part of our curated collection on ${topicTitle}. `
                : ""}
              Read it slowly. Let the words settle before moving on — there's no need to rush.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep("reflect")}>
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {step === "reflect" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>{STEP_LABEL.reflect}</Text></View>
            {REFLECTION_QUESTIONS.map((q, i) => (
              <Text key={i} style={styles.questionText}>• {q}</Text>
            ))}
            <TextInput
              style={styles.textarea} value={reflectionNote} onChangeText={setReflectionNote} multiline
              placeholder="Write your reflection (optional)..." placeholderTextColor={c.textMuted}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep("respond")}>
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {step === "respond" && (
          <View style={styles.card}>
            <View style={styles.labelPill}><Text style={styles.labelPillText}>{STEP_LABEL.respond}</Text></View>
            <Text style={styles.promptText}>Take a moment to respond to God in light of this Scripture.</Text>
            <TextInput
              style={styles.textarea} value={responseNote} onChangeText={setResponseNote} multiline
              placeholder="What are you bringing before God?" placeholderTextColor={c.textMuted}
            />

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleSaveScripture} disabled={scriptureSaved}>
              <Ionicons name={scriptureSaved ? "bookmark" : "bookmark-outline"} size={16} color={c.accentGreen} />
              <Text style={styles.secondaryBtnText}>{scriptureSaved ? "Scripture Saved" : "Save Scripture"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={handlePrayThisScripture} disabled={saving || completed}>
              {saving ? <ActivityIndicator size="small" color={c.accentGreen} /> : (
                <>
                  <Ionicons name={completed ? "checkmark-circle" : "hand-left-outline"} size={16} color={c.accentGreen} />
                  <Text style={styles.secondaryBtnText}>{completed ? "Prayed & Saved" : "Pray This Scripture"}</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/prayer/pray-the-word" as any)}>
              <Ionicons name="book-outline" size={16} color={c.accentGreen} />
              <Text style={styles.secondaryBtnText}>Study More</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
              <Text style={styles.primaryBtnText}>Continue Prayer</Text>
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
    centerFill: { alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 16 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    headerCount: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, padding: 20, gap: 14 },
    labelPill: { alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    labelPillText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    referenceText: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    verseText: { fontSize: 17, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 26, fontStyle: "italic" },
    verseUnavailable: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19 },
    contextText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    questionText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium", lineHeight: 21 },
    promptText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
    textarea: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      padding: 14, minHeight: 90, textAlignVertical: "top", color: c.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
    },
    primaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
    primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    secondaryBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12 },
    secondaryBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
