import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";

const MIN_LENGTH = 50;

const PROMPTS = [
  "What growth did you witness in {name} over this journey?",
  "What do you believe God has for their future?",
  "What do you want them to know as they now guide others?",
  "What has this journey meant to you as their guide?",
];

export default function WriteCompletionLetterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { learnerId } = useLocalSearchParams<{ learnerId: string }>();
  const { profile } = useAuth();

  const [learnerName, setLearnerName] = useState("your disciple");
  const [text, setText] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [alreadySent, setAlreadySent] = useState(false);
  const [openPrompt, setOpenPrompt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"draft" | "send" | null>(null);

  useEffect(() => {
    if (!learnerId) return;
    (async () => {
      const { data: learner } = await supabase.from("p2p_profiles").select("full_name").eq("id", learnerId).maybeSingle();
      if (learner?.full_name) setLearnerName(learner.full_name);

      const { data: existing } = await supabase
        .from("p2p_completion_letters")
        .select("id, letter_text, is_draft")
        .eq("learner_id", learnerId)
        .maybeSingle();
      if (existing) {
        setExistingId(existing.id);
        setText(existing.letter_text ?? "");
        setAlreadySent(!existing.is_draft);
      }
      setLoading(false);
    })();
  }, [learnerId]);

  async function handleSaveDraft() {
    if (!learnerId || !profile?.id) return;
    setSaving("draft");
    try {
      const { error } = await supabase.from("p2p_completion_letters").upsert(
        { learner_id: learnerId, peer_guide_id: profile.id, letter_text: text, is_draft: true },
        { onConflict: "learner_id" }
      );
      if (error) throw error;
      Alert.alert("Saved", "Your draft has been saved.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Something went wrong.");
    } finally {
      setSaving(null);
    }
  }

  function handleSendPress() {
    Alert.alert(
      "Send this letter?",
      "Once sent, this letter cannot be edited. It will stay with them forever.",
      [
        { text: "Keep Editing", style: "cancel" },
        { text: "Send", style: "default", onPress: handleSend },
      ]
    );
  }

  async function handleSend() {
    if (!learnerId || !profile?.id) return;
    setSaving("send");
    try {
      const { error } = await supabase.from("p2p_completion_letters").upsert(
        { learner_id: learnerId, peer_guide_id: profile.id, letter_text: text, is_draft: false, written_at: new Date().toISOString() },
        { onConflict: "learner_id" }
      );
      if (error) throw error;

      fetch(`${getApiUrl()}/discipleship/notify-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: learnerId,
          title: "A letter from your peer guide",
          message: `${profile.displayName?.split(" ")[0] ?? "Your peer guide"} has written you a letter.`,
        }),
      }).catch(() => {});

      Alert.alert("Sent", "Your letter has been sent.", [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert("Couldn't send", e.message ?? "Something went wrong.");
    } finally {
      setSaving(null);
    }
  }

  const canSend = text.trim().length >= MIN_LENGTH && !alreadySent;
  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);

  if (loading) {
    return (
      <View style={[styles.root, styles.centerFill, { paddingTop: topPad }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={22} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Write a letter for {learnerName}</Text>
        <Text style={styles.subtitle}>This letter will stay with them forever</Text>

        {alreadySent && (
          <View style={styles.sentBanner}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
            <Text style={styles.sentBannerText}>This letter has already been sent and can no longer be edited.</Text>
          </View>
        )}

        <View style={styles.promptsWrap}>
          {PROMPTS.map((p, i) => (
            <TouchableOpacity key={i} style={styles.promptRow} onPress={() => setOpenPrompt(openPrompt === i ? null : i)} activeOpacity={0.8}>
              <Ionicons name={openPrompt === i ? "chevron-down" : "chevron-forward"} size={14} color={colors.amber} />
              <Text style={styles.promptText}>{p.replace("{name}", learnerName)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={setText}
          placeholder="Write freely — there's no character limit."
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          editable={!alreadySent}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{text.trim().length} / {MIN_LENGTH} minimum</Text>

        {!alreadySent && (
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.draftBtn} onPress={handleSaveDraft} disabled={saving !== null}>
              {saving === "draft" ? <ActivityIndicator color={colors.amber} size="small" /> : <Text style={styles.draftBtnText}>Save Draft</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} onPress={handleSendPress} disabled={!canSend || saving !== null}>
              {saving === "send" ? <ActivityIndicator color="#0B1F19" size="small" /> : <Text style={styles.sendBtnText}>Send Letter</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#06110D" },
  centerFill: { alignItems: "center", justifyContent: "center" },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  content: { paddingHorizontal: 24, paddingTop: 8 },
  header: { fontSize: 22, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textAlign: "center" },
  subtitle: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6, marginBottom: 24, fontStyle: "italic" },

  sentBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
    padding: 12, marginBottom: 20,
  },
  sentBannerText: { flex: 1, fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_400Regular" },

  promptsWrap: { gap: 8, marginBottom: 20 },
  promptRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 6 },
  promptText: { flex: 1, fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", lineHeight: 19 },

  textArea: {
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14, padding: 16, minHeight: 220, color: "#fff", fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24,
  },
  charCount: { fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "right" },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  draftBtn: {
    flex: 1, height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(224,164,65,0.4)",
  },
  draftBtnText: { color: colors.amber, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sendBtn: { flex: 1, height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.amber },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#0B1F19", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
