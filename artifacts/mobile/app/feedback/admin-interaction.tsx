import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";

const RATING_OPTIONS = [
  { value: 1, emoji: "😞", label: "Poor" },
  { value: 2, emoji: "😐", label: "Okay" },
  { value: 3, emoji: "🙂", label: "Good" },
  { value: 4, emoji: "😊", label: "Great" },
  { value: 5, emoji: "🌟", label: "Excellent" },
];

export default function AdminInteractionFeedbackScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { conversationId, helpRequestId, adminUserId } = useLocalSearchParams<{
    conversationId: string; helpRequestId?: string; adminUserId?: string;
  }>();
  const { submitAdminFeedback } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [rating, setRating] = useState<number | null>(null);
  const [wasTimely, setWasTimely] = useState(false);
  const [wasRespectful, setWasRespectful] = useState(false);
  const [wasHelpful, setWasHelpful] = useState(false);
  const [wasRude, setWasRude] = useState(false);
  const [didNotAddressConcern, setDidNotAddressConcern] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!conversationId || !adminUserId) return;
    setSubmitting(true);
    const err = await submitAdminFeedback({
      conversationId, helpRequestId: helpRequestId || null, adminUserId,
      rating: rating ?? 0, wasTimely, wasRespectful, wasHelpful, wasRude, didNotAddressConcern, freeText,
    });
    setSubmitting(false);
    if (!err) setSubmitted(true);
  }

  if (submitted) {
    return (
      <View style={[styles.container, styles.centerFill, { paddingTop: insets.top }]}>
        <Ionicons name="checkmark-circle" size={48} color={colors.accentGreen} />
        <Text style={styles.thankYouTitle}>Thank you for your feedback.</Text>
        <Text style={styles.thankYouSub}>It helps us serve you better.</Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Support Feedback" />
      <View style={styles.content}>
        <Text style={styles.title}>How was your support experience?</Text>
        <Text style={styles.subtitle}>The P2P Global support team responded to your request.</Text>

        <Text style={styles.sectionLabel}>How did you feel?</Text>
        <View style={styles.ratingRow}>
          {RATING_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.ratingChip, rating === opt.value && styles.ratingChipActive]}
              onPress={() => setRating(opt.value)}
            >
              <Text style={styles.ratingEmoji}>{opt.emoji}</Text>
              <Text style={styles.ratingLabel}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Was the response: (select all that apply)</Text>
        <CheckRow label="Timely" checked={wasTimely} onToggle={() => setWasTimely((v) => !v)} colors={colors} />
        <CheckRow label="Respectful" checked={wasRespectful} onToggle={() => setWasRespectful((v) => !v)} colors={colors} />
        <CheckRow label="Helpful" checked={wasHelpful} onToggle={() => setWasHelpful((v) => !v)} colors={colors} />
        <CheckRow label="Rude or dismissive" checked={wasRude} onToggle={() => setWasRude((v) => !v)} colors={colors} destructive />
        <CheckRow label="Did not address my concern" checked={didNotAddressConcern} onToggle={() => setDidNotAddressConcern((v) => !v)} colors={colors} />

        <Text style={styles.sectionLabel}>Tell us more (optional)</Text>
        <TextInput
          style={styles.textArea}
          value={freeText}
          onChangeText={setFreeText}
          placeholder="Anything else you'd like us to know..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={4}
        />

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting || rating === null}>
          {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Submit Feedback</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={() => router.back()}>
          <Text style={styles.skipBtnText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CheckRow({ label, checked, onToggle, colors, destructive }: { label: string; checked: boolean; onToggle: () => void; colors: AppColors; destructive?: boolean }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle}>
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? (destructive ? "#B91C1C" : colors.accentGreen) : colors.textMuted}
      />
      <Text style={[styles.checkLabel, destructive && checked && { color: "#B91C1C" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    content: { padding: 20 },
    title: { fontSize: 19, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 20, fontFamily: "Inter_400Regular" },
    sectionLabel: { fontSize: 12, fontWeight: "700", color: c.textMid, marginTop: 16, marginBottom: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    ratingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    ratingChip: {
      alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
      borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, minWidth: 62,
    },
    ratingChipActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.1)" },
    ratingEmoji: { fontSize: 22 },
    ratingLabel: { fontSize: 10, color: c.textMid, fontFamily: "Inter_500Medium" },
    checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    checkLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    textArea: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      padding: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", minHeight: 100, textAlignVertical: "top",
    },
    submitBtn: { backgroundColor: c.accentGreen, borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center", marginTop: 20 },
    submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
    skipBtn: { alignItems: "center", marginTop: 14 },
    skipBtnText: { color: c.textMuted, fontSize: 13, fontFamily: "Inter_500Medium" },
    thankYouTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    thankYouSub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    doneBtn: { backgroundColor: c.accentGreen, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 10 },
    doneBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}