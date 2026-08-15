import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useData, Church } from "@/contexts/DataContext";
import { shareChurchInvite } from "@/lib/sharing";
import colors from "@/constants/colors";

const ROLE_OPTIONS = ["Senior Pastor", "Lead Elder", "Discipleship Pastor", "Church Administrator", "Other"];

export default function RegisterChurchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { registerChurch } = useData();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [createdChurch, setCreatedChurch] = useState<Church | null>(null);

  const [name, setName] = useState("");
  const [denomination, setDenomination] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [languageCode, setLanguageCode] = useState("en");
  const [timezone, setTimezone] = useState("");

  async function handleSubmit() {
    setSubmitting(true);
    const { church, error } = await registerChurch({
      name: name.trim(), denomination: denomination || undefined, city: city.trim() || undefined,
      country: country.trim(), website: website.trim() || undefined,
      contactName: contactName.trim() || undefined, contactEmail: contactEmail.trim() || undefined,
      languageCode, timezone: timezone || undefined,
    });
    setSubmitting(false);
    if (error || !church) {
      Alert.alert("Couldn't register church", error ?? "Please try again.");
      return;
    }
    setCreatedChurch(church);
    setStep(4);
  }

  if (step === 4 && createdChurch) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.confirmTitle}>Your church is ready ✓</Text>
        <Text style={styles.confirmChurchName}>{createdChurch.name}</Text>
        <Text style={styles.confirmLocation}>{[createdChurch.city, createdChurch.country].filter(Boolean).join(", ")}</Text>
        {contactName ? <Text style={styles.confirmRegisteredBy}>Registered by: {contactName}</Text> : null}

        <View style={styles.freeCard}>
          <Text style={styles.freeCardText}>✓ Completely free — no subscription, no payment, no tiers. Every church gets full access to everything, always.</Text>
        </View>

        <Text style={styles.label}>Your church invite link</Text>
        <View style={styles.linkBox}>
          <Text style={styles.linkText} numberOfLines={2}>{createdChurch.inviteLink}</Text>
        </View>
        <Text style={styles.helperText}>Share this link with your congregation to invite them to your church grove.</Text>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={async () => { await Clipboard.setStringAsync(createdChurch.inviteLink); Alert.alert("Copied", "Invite link copied to clipboard."); }}
        >
          <Ionicons name="copy-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.secondaryBtnText}>Copy Invite Link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => shareChurchInvite({ name: createdChurch.name, inviteLink: createdChurch.inviteLink, city: createdChurch.city ?? "", country: createdChurch.country })}
        >
          <Ionicons name="share-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.secondaryBtnText}>Share Invite Link</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/church" as any)}>
          <Text style={styles.primaryBtnText}>Go to My Church</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 24) }]}>
      <TouchableOpacity onPress={() => (step === 1 ? router.back() : setStep(step - 1))} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={colors.lightGreen} />
      </TouchableOpacity>
      <Text style={styles.title}>Register Your Church</Text>
      <Text style={styles.stepIndicator}>Step {step} of 3</Text>

      {step === 1 && (
        <View style={styles.form}>
          <Field label="Church Name" value={name} onChangeText={setName} placeholder="Lighthouse Church" />
          <Text style={styles.label}>Denomination (optional)</Text>
          <View style={styles.chipRow}>
            {["Baptist", "Pentecostal", "Anglican", "Non-denominational", "Other"].map((d) => (
              <TouchableOpacity key={d} style={[styles.chip, denomination === d && styles.chipActive]} onPress={() => setDenomination(d)}>
                <Text style={[styles.chipText, denomination === d && styles.chipTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Field label="City" value={city} onChangeText={setCity} placeholder="Zürich" />
          <Field label="Country" value={country} onChangeText={setCountry} placeholder="Switzerland" />
          <Field label="Website (optional)" value={website} onChangeText={setWebsite} placeholder="lighthousechurch.org" autoCapitalize="none" />
          <TouchableOpacity style={[styles.primaryBtn, !name.trim() || !country.trim() ? styles.btnDisabled : null]} onPress={() => setStep(2)} disabled={!name.trim() || !country.trim()}>
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 2 && (
        <View style={styles.form}>
          <Text style={styles.subtitle}>Who is registering this church?</Text>
          <Field label="Your name" value={contactName} onChangeText={setContactName} placeholder="Peter King" />
          <Field label="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="pastor@church.org" keyboardType="email-address" autoCapitalize="none" />
          <Text style={styles.helperText}>Used for important church notifications</Text>
          <Text style={styles.label}>Your role</Text>
          {ROLE_OPTIONS.map((r) => (
            <TouchableOpacity key={r} style={styles.roleRow} onPress={() => setRole(r)}>
              <Ionicons name={role === r ? "radio-button-on" : "radio-button-off"} size={18} color={role === r ? colors.accentGreen : colors.textMuted} />
              <Text style={styles.roleLabel}>{r}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(3)}>
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 3 && (
        <View style={styles.form}>
          <Text style={styles.subtitle}>Help us serve your congregation</Text>
          <Field label="Primary language (code)" value={languageCode} onChangeText={setLanguageCode} placeholder="en" autoCapitalize="none" />
          <Field label="Timezone (optional)" value={timezone} onChangeText={setTimezone} placeholder="Europe/Zurich" autoCapitalize="none" />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Register Church</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: any; autoCapitalize?: any }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize ?? "words"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  content: { paddingHorizontal: 28, paddingBottom: 60 },
  backBtn: { marginBottom: 20 },
  title: { fontSize: 24, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  stepIndicator: { fontSize: 13, color: colors.lightGreen, opacity: 0.7, marginTop: 4, marginBottom: 24, fontFamily: "Inter_400Regular" },
  form: { gap: 4 },
  subtitle: { fontSize: 15, color: colors.cream, marginBottom: 16, fontFamily: "Inter_600SemiBold" },
  label: { color: colors.lightGreen, fontSize: 13, opacity: 0.75, marginBottom: 6, fontFamily: "Inter_500Medium" },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, padding: 14, color: colors.cream, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  helperText: { fontSize: 12, color: colors.textMuted, marginTop: -8, marginBottom: 16, fontFamily: "Inter_400Regular" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  chipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  chipText: { fontSize: 12, color: colors.lightGreen, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  roleLabel: { fontSize: 14, color: colors.cream, fontFamily: "Inter_400Regular" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 52, marginTop: 20,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
  confirmTitle: { fontSize: 22, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  confirmChurchName: { fontSize: 18, fontWeight: "700", color: colors.accentGreen, marginTop: 12, fontFamily: "Inter_700Bold" },
  confirmLocation: { fontSize: 13, color: colors.lightGreen, opacity: 0.8, marginTop: 2, fontFamily: "Inter_400Regular" },
  confirmRegisteredBy: { fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: "Inter_400Regular" },
  freeCard: { backgroundColor: "rgba(29,158,117,0.1)", borderWidth: 1, borderColor: "rgba(29,158,117,0.3)", borderRadius: 12, padding: 14, marginTop: 20, marginBottom: 24 },
  freeCardText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium", lineHeight: 18 },
  linkBox: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, padding: 12 },
  linkText: { fontSize: 13, color: colors.cream, fontFamily: "Inter_400Regular" },
  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, height: 46, marginTop: 12,
  },
  secondaryBtnText: { color: colors.accentGreen, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
});