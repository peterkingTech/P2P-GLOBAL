import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth, supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// ── Types ─────────────────────────────────────────────────────────────────────

type Language = { code: string; name: string };

const FALLBACK_LANGUAGES: Language[] = [
  { code: "en", name: "English" }, { code: "de", name: "German" },
  { code: "es", name: "Spanish" }, { code: "fr", name: "French" },
  { code: "pt", name: "Portuguese" }, { code: "sw", name: "Swahili" },
  { code: "ar", name: "Arabic" }, { code: "hi", name: "Hindi" },
];

const DURATION_OPTIONS = [
  { value: "less_than_1_year", label: "Less than 1 year" },
  { value: "1_3_years", label: "1–3 years" },
  { value: "3_10_years", label: "3–10 years" },
  { value: "10_plus_years", label: "10+ years" },
];

const BORN_AGAIN_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "other", label: "Other / Not sure" },
];

const FAITH_STAGE_LABELS = [
  "Just exploring",
  "New believer",
  "Growing in faith",
  "Established believer",
  "Mature believer, leading others",
];

// ── Section 1 ─────────────────────────────────────────────────────────────────

type Section1 = {
  full_name: string;
  email: string;
  location_city: string;
  location_country: string;
  contact: string;
  primary_language: string;
  other_languages: string[];
};

// ── Section 2 ─────────────────────────────────────────────────────────────────

type Section2 = {
  faith_journey_stage: number;
  born_again: "yes" | "no" | "other" | "";
  born_again_other: string;
  walking_with_christ_duration: string;
  church_involvement: string;
};

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function IntakeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();

  const [step, setStep] = useState(1);
  const [languages, setLanguages] = useState<Language[]>(FALLBACK_LANGUAGES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [s1, setS1] = useState<Section1>({
    full_name: profile?.displayName ?? "",
    email: profile?.email ?? "",
    location_city: profile?.city ?? "",
    location_country: profile?.country ?? "",
    contact: "",
    primary_language: "en",
    other_languages: [],
  });

  const [s2, setS2] = useState<Section2>({
    faith_journey_stage: 0,
    born_again: "",
    born_again_other: "",
    walking_with_christ_duration: "",
    church_involvement: "",
  });

  // Fetch languages from DB (falls back to FALLBACK_LANGUAGES on error)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("p2p_languages").select("code,name").order("name");
        if (data && data.length > 0) setLanguages(data as Language[]);
      } catch {}
    })();
  }, []);

  // Pre-fill from profile when it loads
  useEffect(() => {
    if (profile) {
      setS1((p) => ({
        ...p,
        full_name: p.full_name || profile.displayName,
        email: p.email || profile.email,
        location_city: p.location_city || (profile.city ?? ""),
        location_country: p.location_country || (profile.country ?? ""),
      }));
    }
  }, [profile]);

  // ── Validation ──────────────────────────────────────────────────────────────

  function validateStep1(): string | null {
    if (!s1.full_name.trim()) return "Please enter your full name.";
    if (!s1.email.trim()) return "Please enter your email address.";
    if (!s1.location_city.trim()) return "Please enter your city.";
    if (!s1.location_country.trim()) return "Please enter your country.";
    if (!s1.primary_language) return "Please select your primary language.";
    return null;
  }

  function validateStep2(): string | null {
    if (!s2.faith_journey_stage) return "Please select your faith journey stage.";
    if (!s2.born_again) return "Please answer the born again question.";
    if (s2.born_again === "other" && !s2.born_again_other.trim())
      return "Please describe your situation below the born again question.";
    if (!s2.walking_with_christ_duration) return "Please select how long you've been walking with Christ.";
    return null;
  }

  function handleNext() {
    const e = validateStep1();
    if (e) { setError(e); return; }
    setError(null);
    setStep(2);
  }

  async function handleSubmit() {
    const e = validateStep2();
    if (e) { setError(e); return; }
    setError(null);
    setSaving(true);

    try {
      const { error: dbErr } = await supabase.from("p2p_registration_profiles").upsert(
        {
          user_id: user?.id ?? null,
          full_name: s1.full_name.trim(),
          email: s1.email.trim(),
          location_city: s1.location_city.trim(),
          location_country: s1.location_country.trim(),
          contact: s1.contact.trim() || null,
          primary_language: s1.primary_language,
          other_languages: s1.other_languages,
          faith_journey_stage: s2.faith_journey_stage,
          born_again: s2.born_again,
          born_again_other: s2.born_again === "other" ? s2.born_again_other.trim() || null : null,
          walking_with_christ_duration: s2.walking_with_christ_duration,
          church_involvement: s2.church_involvement.trim() || null,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (dbErr) throw new Error(dbErr.message);
      // Move on to gifts / profile setup
      router.replace("/(auth)/profile-setup");
    } catch (ex: any) {
      setError(ex.message ?? "Could not save your information. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 40 : 20);

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: insets.bottom + 48 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Tell us about yourself</Text>
        <Text style={styles.subtitle}>
          {step === 1 ? "Section 1 of 2 — Basic Information" : "Section 2 of 2 — Spiritual Background"}
        </Text>
        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: step === 1 ? "50%" : "100%" }]} />
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {step === 1 ? (
        <Section1Form
          values={s1}
          onChange={setS1}
          languages={languages}
        />
      ) : (
        <Section2Form
          values={s2}
          onChange={setS2}
        />
      )}

      {/* Navigation buttons */}
      <View style={styles.navRow}>
        {step === 2 && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => { setError(null); setStep(1); }}
          >
            <Ionicons name="arrow-back" size={18} color={colors.accentGreen} />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, step === 1 ? { flex: 1 } : { flex: 1 }]}
          onPress={step === 1 ? handleNext : handleSubmit}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <>
              <Text style={styles.nextBtnText}>{step === 1 ? "Next" : "Finish"}</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.cream} />
            </>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => router.replace("/(auth)/profile-setup")}
      >
        <Text style={styles.skipText}>Skip for now</Text>
      </TouchableOpacity>
    </KeyboardAwareScrollView>
  );
}

// ── Section 1 Form Component ──────────────────────────────────────────────────

function Section1Form({
  values,
  onChange,
  languages,
}: {
  values: Section1;
  onChange: (v: Section1) => void;
  languages: Language[];
}) {
  function set(field: keyof Section1, val: any) {
    onChange({ ...values, [field]: val });
  }

  function toggleOtherLang(code: string) {
    const has = values.other_languages.includes(code);
    set(
      "other_languages",
      has
        ? values.other_languages.filter((c) => c !== code)
        : [...values.other_languages, code]
    );
  }

  return (
    <View style={styles.form}>
      <Field label="Full Name *">
        <TextInput
          style={styles.input}
          value={values.full_name}
          onChangeText={(v) => set("full_name", v)}
          placeholder="Your full name"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
        />
      </Field>

      <Field label="Email *">
        <TextInput
          style={styles.input}
          value={values.email}
          onChangeText={(v) => set("email", v)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="your@email.com"
          placeholderTextColor={colors.textMuted}
        />
      </Field>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="City *">
            <TextInput
              style={styles.input}
              value={values.location_city}
              onChangeText={(v) => set("location_city", v)}
              placeholder="City"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Country *">
            <TextInput
              style={styles.input}
              value={values.location_country}
              onChangeText={(v) => set("location_country", v)}
              placeholder="Country"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
          </Field>
        </View>
      </View>

      <Field label="Contact / WhatsApp (optional)">
        <TextInput
          style={styles.input}
          value={values.contact}
          onChangeText={(v) => set("contact", v)}
          placeholder="Phone number or username"
          placeholderTextColor={colors.textMuted}
        />
      </Field>

      <Field label="Primary Language *">
        <View style={styles.pillWrap}>
          {languages.map((l) => {
            const selected = values.primary_language === l.code;
            return (
              <TouchableOpacity
                key={l.code}
                style={[styles.pill, selected && styles.pillSelected]}
                onPress={() => set("primary_language", l.code)}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {l.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>

      <Field label="Other Languages (optional)">
        <View style={styles.pillWrap}>
          {languages
            .filter((l) => l.code !== values.primary_language)
            .map((l) => {
              const selected = values.other_languages.includes(l.code);
              return (
                <TouchableOpacity
                  key={l.code}
                  style={[styles.pill, selected && styles.pillSelected]}
                  onPress={() => toggleOtherLang(l.code)}
                >
                  {selected && <Ionicons name="checkmark" size={12} color={colors.cream} style={{ marginRight: 3 }} />}
                  <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                    {l.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
        </View>
      </Field>
    </View>
  );
}

// ── Section 2 Form Component ──────────────────────────────────────────────────

function Section2Form({
  values,
  onChange,
}: {
  values: Section2;
  onChange: (v: Section2) => void;
}) {
  function set(field: keyof Section2, val: any) {
    onChange({ ...values, [field]: val });
  }

  return (
    <View style={styles.form}>
      {/* Faith Journey Stage — 5-step selector */}
      <Field label="Where are you in your faith journey? *">
        <View style={styles.stageWrap}>
          {FAITH_STAGE_LABELS.map((label, i) => {
            const stageNum = i + 1;
            const selected = values.faith_journey_stage === stageNum;
            return (
              <TouchableOpacity
                key={stageNum}
                style={[styles.stageTile, selected && styles.stageTileSelected]}
                onPress={() => set("faith_journey_stage", stageNum)}
                activeOpacity={0.8}
              >
                <View style={[styles.stageCircle, selected && styles.stageCircleSelected]}>
                  <Text style={[styles.stageNum, selected && styles.stageNumSelected]}>
                    {stageNum}
                  </Text>
                </View>
                <Text style={[styles.stageLabel, selected && styles.stageLabelSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>

      {/* Born Again */}
      <Field label="Have you been born again? *">
        <View style={styles.pillWrap}>
          {BORN_AGAIN_OPTIONS.map((o) => {
            const selected = values.born_again === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.pill, selected && styles.pillSelected]}
                onPress={() => set("born_again", o.value)}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {values.born_again === "other" && (
          <TextInput
            style={[styles.input, { marginTop: 8 }]}
            value={values.born_again_other}
            onChangeText={(v) => set("born_again_other", v)}
            placeholder="Please describe your situation…"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />
        )}
      </Field>

      {/* Walking with Christ Duration */}
      <Field label="How long have you been walking with Christ? *">
        <View style={styles.durationWrap}>
          {DURATION_OPTIONS.map((o) => {
            const selected = values.walking_with_christ_duration === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.durationOption, selected && styles.durationSelected]}
                onPress={() => set("walking_with_christ_duration", o.value)}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioDot} />}
                </View>
                <Text style={[styles.durationLabel, selected && styles.durationLabelSelected]}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>

      {/* Church Involvement */}
      <Field label="Church involvement (optional)">
        <TextInput
          style={[styles.input, { minHeight: 80 }]}
          value={values.church_involvement}
          onChangeText={(v) => set("church_involvement", v)}
          placeholder="Tell us about your church background or current involvement…"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />
      </Field>
    </View>
  );
}

// ── Field Wrapper ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 22 },

  header: { marginBottom: 28 },
  title: { fontSize: 24, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 12 },
  progressBar: { height: 4, backgroundColor: colors.progressTrack, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: colors.accentGreen, borderRadius: 2 },

  errorBanner: {
    backgroundColor: "rgba(185,28,28,0.1)", borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(185,28,28,0.3)",
    padding: 12, flexDirection: "row", gap: 8,
    alignItems: "flex-start", marginBottom: 16,
  },
  errorText: { color: "#B91C1C", fontSize: 13, flex: 1, fontFamily: "Inter_400Regular" },

  form: { gap: 20, marginBottom: 28 },
  row: { flexDirection: "row", gap: 10 },

  fieldGroup: { gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },

  input: {
    backgroundColor: "#fff",
    borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 13,
    color: colors.textDark, fontSize: 15,
    fontFamily: "Inter_400Regular",
  },

  // Language pills
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    borderColor: colors.borderBeige,
    backgroundColor: "#fff",
  },
  pillSelected: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  pillText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  pillTextSelected: { color: colors.cream },

  // Faith stage
  stageWrap: { gap: 10 },
  stageTile: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 13, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borderBeige,
    backgroundColor: "#fff",
  },
  stageTileSelected: { borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.06)" },
  stageCircle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.cardBeige,
  },
  stageCircleSelected: { backgroundColor: colors.accentGreen },
  stageNum: { fontSize: 14, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold" },
  stageNumSelected: { color: colors.cream },
  stageLabel: { fontSize: 13, color: colors.textMid, flex: 1, fontFamily: "Inter_400Regular" },
  stageLabelSelected: { color: colors.textDark, fontFamily: "Inter_500Medium" },

  // Duration / radio
  durationWrap: { gap: 8 },
  durationOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borderBeige,
    backgroundColor: "#fff",
  },
  durationSelected: { borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.06)" },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.borderBeige,
    alignItems: "center", justifyContent: "center",
  },
  radioSelected: { borderColor: colors.accentGreen },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accentGreen },
  durationLabel: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular" },
  durationLabelSelected: { color: colors.textDark, fontFamily: "Inter_500Medium" },

  // Navigation
  navRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 18, height: 52,
    borderRadius: 14, borderWidth: 1, borderColor: colors.accentGreen,
  },
  backBtnText: { fontSize: 15, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  nextBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 52, borderRadius: 14,
    backgroundColor: colors.accentGreen,
  },
  nextBtnText: { fontSize: 16, fontWeight: "600", color: colors.cream, fontFamily: "Inter_600SemiBold" },
  skipBtn: { alignItems: "center", paddingVertical: 12 },
  skipText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
