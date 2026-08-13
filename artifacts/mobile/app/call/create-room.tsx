import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

interface RoomPreset { key: string; label: string; icon: string; roomType: string; category: string | null }

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function CreateRoomScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [presets, setPresets] = useState<RoomPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<RoomPreset | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [speakingMode, setSpeakingMode] = useState<"open" | "structured">("open");
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/calls/rooms/presets`);
        setPresets(await res.json());
      } catch {
        setPresets([]);
      } finally {
        setLoadingPresets(false);
      }
    })();
  }, []);

  function pickPreset(preset: RoomPreset) {
    setSelectedPreset(preset);
    setName(preset.key === "custom" ? "" : preset.label);
    setStep(2);
  }

  async function launchRoom() {
    if (!profile?.id || !name.trim()) return;
    setLaunching(true);
    try {
      const res = await fetch(`${getApiUrl()}/calls/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: profile.id, name: name.trim(), description: description.trim() || undefined,
          roomType: selectedPreset?.roomType ?? "open", category: selectedPreset?.category ?? null,
          speakingMode,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const room = await res.json();
      router.replace({ pathname: "/call/room" as any, params: { roomId: room.id } });
    } catch {
      showAlert("Couldn't start room", "Please try again.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => (step === 1 ? router.back() : setStep((s) => (s - 1) as 1 | 2))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name={step === 1 ? "close" : "arrow-back"} size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>
          {step === 1 ? "Start a Room" : step === 2 ? "Configure" : "Preview"}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.stepDots}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.stepDot, step >= n && { backgroundColor: colors.accentGreen }]} />
        ))}
      </View>

      {step === 1 && (
        loadingPresets ? (
          <View style={styles.loadingWrap}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.stepHint}>Pick what this room is about, or start something custom.</Text>
            <View style={styles.presetGrid}>
              {presets.map((p) => (
                <TouchableOpacity key={p.key} style={styles.presetCard} onPress={() => pickPreset(p)}>
                  <Text style={styles.presetIcon}>{p.icon}</Text>
                  <Text style={styles.presetLabel} numberOfLines={2}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )
      )}

      {step === 2 && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.fieldLabel}>Room name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Give your room a name" placeholderTextColor={colors.textMuted} />

          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]} value={description} onChangeText={setDescription}
            placeholder="What will you be talking about?" placeholderTextColor={colors.textMuted} multiline
          />

          <Text style={styles.fieldLabel}>Speaking mode</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modeCard, speakingMode === "open" && styles.modeCardActive]} onPress={() => setSpeakingMode("open")}>
              <Ionicons name="mic" size={18} color={speakingMode === "open" ? "#fff" : colors.textMid} />
              <Text style={[styles.modeCardTitle, speakingMode === "open" && styles.modeCardTitleActive]}>Open</Text>
              <Text style={[styles.modeCardSub, speakingMode === "open" && styles.modeCardSubActive]}>Everyone can speak</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeCard, speakingMode === "structured" && styles.modeCardActive]} onPress={() => setSpeakingMode("structured")}>
              <Ionicons name="hand-left" size={18} color={speakingMode === "structured" ? "#fff" : colors.textMid} />
              <Text style={[styles.modeCardTitle, speakingMode === "structured" && styles.modeCardTitleActive]}>Structured</Text>
              <Text style={[styles.modeCardSub, speakingMode === "structured" && styles.modeCardSubActive]}>One speaker at a time</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.continueBtn, !name.trim() && styles.continueBtnDisabled]} onPress={() => setStep(3)} disabled={!name.trim()}>
            <Text style={styles.continueBtnText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {step === 3 && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.previewCard}>
            <Text style={styles.previewIcon}>{selectedPreset?.icon ?? "✨"}</Text>
            <Text style={styles.previewName}>{name}</Text>
            {description ? <Text style={styles.previewDesc}>{description}</Text> : null}
            <View style={styles.previewMetaRow}>
              <Ionicons name={speakingMode === "open" ? "mic" : "hand-left"} size={14} color={colors.accentGreen} />
              <Text style={styles.previewMetaText}>{speakingMode === "open" ? "Open — everyone can speak" : "Structured — one speaker at a time"}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.launchBtn} onPress={launchRoom} disabled={launching}>
            {launching ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="radio" size={16} color="#fff" />
                <Text style={styles.launchBtnText}>Go Live</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    stepDots: { flexDirection: "row", justifyContent: "center", gap: 8, paddingVertical: 14 },
    stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.borderBeige },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: { padding: 20, paddingBottom: 60 },
    stepHint: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 16 },

    presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    presetCard: {
      width: "47%", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14,
      padding: 16, alignItems: "center", gap: 8,
    },
    presetIcon: { fontSize: 28 },
    presetLabel: { fontSize: 12, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },

    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 16 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    inputMultiline: { minHeight: 70, textAlignVertical: "top" },
    modeRow: { flexDirection: "row", gap: 10 },
    modeCard: { flex: 1, backgroundColor: c.card, borderWidth: 1.5, borderColor: c.borderBeige, borderRadius: 12, padding: 14, alignItems: "center", gap: 4 },
    modeCardActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    modeCardTitle: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    modeCardTitleActive: { color: "#fff" },
    modeCardSub: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    modeCardSubActive: { color: "rgba(255,255,255,0.85)" },

    continueBtn: { backgroundColor: c.accentGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 28 },
    continueBtnDisabled: { opacity: 0.5 },
    continueBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

    previewCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 16, padding: 22, alignItems: "center", gap: 8 },
    previewIcon: { fontSize: 36 },
    previewName: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    previewDesc: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" },
    previewMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    previewMetaText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },

    launchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#DC2626", borderRadius: 12, paddingVertical: 15, marginTop: 24 },
    launchBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}