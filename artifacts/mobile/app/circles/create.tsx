import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

const CIRCLE_TYPES: { value: string; label: string }[] = [
  { value: "open", label: "Open — anyone can request to join" },
  { value: "closed", label: "Closed — invite only" },
];

const MEETING_OPTIONS: { value: string; label: string }[] = [
  { value: "in_app", label: "In-app" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "zoom", label: "Zoom" },
  { value: "flexible", label: "Flexible" },
];

export default function CreateCircleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { plans, modules } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<"plan" | "module" | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [circleType, setCircleType] = useState("open");
  const [maxMembers, setMaxMembers] = useState("8");
  const [language, setLanguage] = useState(profile?.contentLanguage ?? "en");
  const [timezone, setTimezone] = useState("");
  const [meetingPreference, setMeetingPreference] = useState("flexible");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { Alert.alert("Name required", "Please give your circle a name."); return; }
    if (!profile?.id) return;
    setSaving(true);
    try {
      const selectedModule = modules.find((m) => m.id === selectedModuleId);
      const res = await fetch(`${getApiUrl()}/circles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          planId: source === "plan" ? selectedPlanId : null,
          curriculumId: source === "module" ? selectedModule?.curriculumId ?? null : null,
          moduleId: source === "module" ? selectedModuleId : null,
          circleType,
          leaderId: profile.id,
          maxMembers: parseInt(maxMembers, 10) || 8,
          minMembers: 3,
          languageCode: language,
          timezone: timezone.trim() || null,
          meetingPreference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not create circle");
      router.replace(`/circles/${data.id}` as any);
    } catch (e: any) {
      Alert.alert("Couldn't create circle", e.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Create Circle</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Circle name *</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Freedom Circle" placeholderTextColor={colors.textMuted} />

        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="What is this circle about?" placeholderTextColor={colors.textMuted} multiline />

        <Text style={styles.fieldLabel}>What will you go through together?</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity style={[styles.chip, source === "plan" && styles.chipActive]} onPress={() => { setSource("plan"); setSelectedModuleId(null); }}>
            <Text style={[styles.chipText, source === "plan" && styles.chipTextActive]}>A Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, source === "module" && styles.chipActive]} onPress={() => { setSource("module"); setSelectedPlanId(null); }}>
            <Text style={[styles.chipText, source === "module" && styles.chipTextActive]}>Foundation Module</Text>
          </TouchableOpacity>
        </View>

        {source === "plan" && (
          <View style={styles.pickList}>
            {plans.map((p) => (
              <TouchableOpacity key={p.id} style={[styles.pickRow, selectedPlanId === p.id && styles.pickRowActive]} onPress={() => setSelectedPlanId(p.id)}>
                <Text style={[styles.pickRowText, selectedPlanId === p.id && styles.pickRowTextActive]} numberOfLines={1}>{p.title}</Text>
                {selectedPlanId === p.id && <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />}
              </TouchableOpacity>
            ))}
          </View>
        )}
        {source === "module" && (
          <View style={styles.pickList}>
            {modules.map((m) => (
              <TouchableOpacity key={m.id} style={[styles.pickRow, selectedModuleId === m.id && styles.pickRowActive]} onPress={() => setSelectedModuleId(m.id)}>
                <Text style={[styles.pickRowText, selectedModuleId === m.id && styles.pickRowTextActive]} numberOfLines={1}>{m.title}</Text>
                {selectedModuleId === m.id && <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.fieldLabel}>Circle type</Text>
        <View style={{ gap: 8 }}>
          {CIRCLE_TYPES.map((t) => (
            <TouchableOpacity key={t.value} style={[styles.optionRow, circleType === t.value && styles.optionRowActive]} onPress={() => setCircleType(t.value)}>
              <Text style={[styles.optionRowText, circleType === t.value && styles.optionRowTextActive]}>{t.label}</Text>
              {circleType === t.value && <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Max members</Text>
        <TextInput style={styles.input} value={maxMembers} onChangeText={setMaxMembers} keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.textMuted} />

        <Text style={styles.fieldLabel}>Language</Text>
        <TextInput style={styles.input} value={language} onChangeText={setLanguage} placeholder="en" placeholderTextColor={colors.textMuted} autoCapitalize="none" />

        <Text style={styles.fieldLabel}>Timezone</Text>
        <TextInput style={styles.input} value={timezone} onChangeText={setTimezone} placeholder="e.g. America/New_York" placeholderTextColor={colors.textMuted} autoCapitalize="none" />

        <Text style={styles.fieldLabel}>Meeting preference</Text>
        <View style={styles.chipRow}>
          {MEETING_OPTIONS.map((m) => (
            <TouchableOpacity key={m.value} style={[styles.chip, meetingPreference === m.value && styles.chipActive]} onPress={() => setMeetingPreference(m.value)}>
              <Text style={[styles.chipText, meetingPreference === m.value && styles.chipTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleCreate} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Create Circle</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    scroll: { padding: 20 },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 8, marginTop: 16, fontFamily: "Inter_600SemiBold" },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    multiline: { minHeight: 80, textAlignVertical: "top" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.card },
    chipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    chipTextActive: { color: "#fff", fontWeight: "700" },
    pickList: { gap: 6, marginTop: 10, maxHeight: 220 },
    pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12 },
    pickRowActive: { borderColor: c.accentGreen },
    pickRowText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    pickRowTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14 },
    optionRowActive: { borderColor: c.accentGreen },
    optionRowText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    optionRowTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    submitBtn: { backgroundColor: c.accentGreen, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", marginTop: 32 },
    submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
