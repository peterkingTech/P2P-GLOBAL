import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { authedFetch } from "@/lib/adminFetch";

// Settings → Account → Account status → Delete account permanently.
// Three calm steps: a reminder that a break is available, an optional
// reason, then what deletion means and a deliberate confirmation. The server
// decides everything (POST /account/deletion/request): it only ever acts on
// the signed-in account, checks leadership/calls, and schedules the deletion
// after a 14-day grace period during which signing in offers "Keep my account".

type Step = "remember" | "reason" | "confirm";

const REASONS: { code: string; label: string }[] = [
  { code: "need_break", label: "I need a break" },
  { code: "too_busy", label: "I'm too busy right now" },
  { code: "not_finding_what_i_need", label: "I'm not finding what I need" },
  { code: "family_or_community_difficulty", label: "I'm having difficulty with my family or community" },
  { code: "different_direction", label: "I want to take a different direction" },
  { code: "privacy", label: "Privacy concerns" },
  { code: "technical_problems", label: "Technical problems" },
  { code: "uncomfortable", label: "I'm uncomfortable with something" },
  { code: "want_to_talk", label: "I want to speak with someone" },
  { code: "other", label: "Other" },
];

const CONFIRM_WORD = "DELETE";

export default function DeleteAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<Step>("remember");
  const [reason, setReason] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canDelete = understood && typed.trim() === CONFIRM_WORD && !submitting;

  async function submit() {
    if (!canDelete) return;
    setSubmitting(true);
    try {
      const res = await authedFetch("/account/deletion/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_WORD, reasonCode: reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) {
        Alert.alert("Not available yet", "Account deletion isn't available yet. Please contact P2P Support and we'll help you.");
        return;
      }
      if (!res.ok) {
        Alert.alert("Your account can't be deleted yet", body.error ?? "Please try again later.");
        return;
      }
      const when = body.deletionScheduledFor
        ? new Date(body.deletionScheduledFor).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
        : "in 14 days";
      // The server has already signed this account out on every device.
      Alert.alert(
        "Deletion scheduled",
        `Your account will be permanently deleted on ${when}. If you change your mind before then, sign in and choose "Keep my account".`,
        [{ text: "OK", onPress: () => { void signOut(); } }],
      );
    } catch {
      Alert.alert("Couldn't request deletion", "Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Delete account" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {step === "remember" && (
          <View style={styles.card}>
            <Text style={styles.title}>Remember why you started</Text>
            <Text style={styles.body}>
              You began this journey to grow, learn, connect and help others grow. If you simply need some
              time away, you don't have to lose what you've built — you can take a break and come back
              whenever you're ready.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/settings/account-status" as any)}>
              <Text style={styles.primaryBtnText}>Take a break instead</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/messages/contact-p2p" as any)}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.secondaryBtnText}>Talk to someone</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => setStep("reason")}>
              <Text style={styles.linkText}>Continue to delete my account</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "reason" && (
          <View style={styles.card}>
            <Text style={styles.title}>Would you like to tell us why?</Text>
            <Text style={styles.body}>This is optional and helps us improve P2P. It isn't shared with anyone in your family or circle.</Text>
            {REASONS.map((r) => {
              const selected = reason === r.code;
              return (
                <TouchableOpacity
                  key={r.code}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setReason(selected ? null : r.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={18} color={selected ? colors.accentGreen : colors.textMuted} />
                  <Text style={styles.optionLabel}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
            {reason === "want_to_talk" && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/messages/contact-p2p" as any)}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accentGreen} />
                <Text style={styles.secondaryBtnText}>Contact P2P Support</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep("confirm")}>
              <Text style={styles.primaryBtnText}>{reason ? "Continue" : "Skip"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "confirm" && (
          <>
            <View style={styles.card}>
              <Text style={styles.title}>Permanently delete your account</Text>
              <Text style={styles.body}>This can't be undone once it's carried out. Your account will be deleted 14 days from now; until then you can sign in and keep it.</Text>
              <Text style={styles.sectionLabel}>What will be deleted</Text>
              {[
                "Your profile, sign-in and settings",
                "Your discipleship journey, growth records and curriculum progress",
                "Your plans, notes, highlights, prayer journal and saved items",
                "Your family and circle memberships",
                "Your photos, voice messages and other uploaded files",
              ].map((t) => <Bullet key={t} text={t} styles={styles} color={colors.textMid} />)}
              <Text style={styles.sectionLabel}>What other people keep</Text>
              {[
                "Messages and posts you wrote in shared conversations stay, shown as \"Deleted user\"",
                "Other people's call history stays, without your name",
                "Family Circles and Peer Circles you belonged to continue as normal",
              ].map((t) => <Bullet key={t} text={t} styles={styles} color={colors.textMid} />)}
            </View>

            <View style={styles.card}>
              <TouchableOpacity style={styles.checkRow} onPress={() => setUnderstood(!understood)} accessibilityRole="checkbox" accessibilityState={{ checked: understood }}>
                <Ionicons name={understood ? "checkbox" : "square-outline"} size={22} color={understood ? colors.accentGreen : colors.textMuted} />
                <Text style={styles.checkText}>I understand that my P2P journey and growth records will be permanently deleted.</Text>
              </TouchableOpacity>
              <Text style={styles.fieldLabel}>Type {CONFIRM_WORD} to confirm</Text>
              <TextInput
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={CONFIRM_WORD}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
              />
              <TouchableOpacity style={[styles.deleteBtn, !canDelete && styles.disabled]} onPress={submit} disabled={!canDelete}>
                {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.deleteBtnText}>Delete my account</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace("/settings/account-status" as any)}>
                <Text style={styles.linkText}>Take a break instead</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Bullet({ text, styles, color }: { text: string; styles: ReturnType<typeof makeStyles>; color: string }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="ellipse" size={6} color={color} style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 16 },
    title: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
    body: { fontSize: 13, lineHeight: 20, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 14 },
    sectionLabel: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 6, marginBottom: 6 },
    bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
    bulletDot: { marginTop: 7 },
    bulletText: { flex: 1, fontSize: 13, lineHeight: 19, color: c.textMid, fontFamily: "Inter_400Regular" },
    option: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 8 },
    optionSelected: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    optionLabel: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 },
    checkText: { flex: 1, fontSize: 13, lineHeight: 19, color: c.textDark, fontFamily: "Inter_500Medium" },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
    input: { backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12, color: c.textDark, fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 14, letterSpacing: 1 },
    primaryBtn: { backgroundColor: c.accentGreen, borderRadius: 12, minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 4 },
    primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
    secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.accentGreen, marginTop: 10, paddingHorizontal: 16 },
    secondaryBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    linkBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
    linkText: { color: c.textMuted, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
    deleteBtn: { backgroundColor: "#B91C1C", borderRadius: 12, minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    deleteBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
    disabled: { opacity: 0.45 },
  });
}
