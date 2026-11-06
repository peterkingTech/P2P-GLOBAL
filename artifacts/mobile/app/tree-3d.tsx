import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { IconButton } from "@/components/ui";
import GrowthModelView, { statusLine } from "@/components/growth/GrowthModelView";
import type { TreeViewerStatus } from "@/components/growth/TreeModelViewer";
import { GROWTH_MODELS, SUPPORTING_MODELS, isGrowthModelId, limitNote, type GrowthModelId } from "@/lib/growthModels";

// Full-screen 3D view of a growth-journey model (lib/growthModels.ts). Turn it by dragging,
// zoom by pinching or with the buttons; the detailed copy downloads only when zoomed in.
// A model's known limitation (front-only, no close-up) is stated, never hidden.

export default function Tree3DScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ model?: string }>();
  const stageModel: GrowthModelId = isGrowthModelId(params.model) ? params.model : "seed";
  const [shown, setShown] = useState<GrowthModelId>(stageModel);
  const [status, setStatus] = useState<TreeViewerStatus>({ state: "loading", progress: 0 });
  const model = GROWTH_MODELS[shown];
  const options = [stageModel, ...(SUPPORTING_MODELS[stageModel] ?? [])];
  const topPad = insets.top + (Platform.OS === "web" ? 16 : 6);
  const note = limitNote(model);
  const onStatus = useCallback((s: TreeViewerStatus) => setStatus(s), []);
  const choose = (id: GrowthModelId) => { if (id !== shown) { setShown(id); setStatus({ state: "loading", progress: 0 }); } };
  const hint = model.limits?.frontOnly ? "Drag to turn a little · pinch or use the buttons to zoom · two fingers to move"
    : "Drag to turn · pinch or use the buttons to zoom · two fingers to move";

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <IconButton palette="fixedLight" icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header">{model.title}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
      </View>

      {options.length > 1 ? (
        <View style={styles.chips} accessibilityRole="tablist">
          {options.map((id) => {
            const active = id === shown;
            return (
              <TouchableOpacity key={id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => choose(id)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{GROWTH_MODELS[id].title}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      <GrowthModelView modelId={shown} onStatus={onStatus} style={styles.stage} />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.status} accessibilityLiveRegion="polite">{statusLine(model.title, status, !!model.detailed)}</Text>
        {note ? (
          <View style={styles.note} accessible accessibilityRole="text">
            <Ionicons name="information-circle-outline" size={16} color={colors.amber} />
            <Text style={styles.noteText}>{note}</Text>
          </View>
        ) : null}
        <Text style={styles.desc}>{model.description}</Text>
        <Text style={styles.meta}>
          About {model.standardMb} MB to download, kept on your device afterwards.
          {model.detailedMb ? ` The detailed version (${model.detailedMb} MB) downloads only when you zoom in.` : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMuted },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: colors.card, justifyContent: "center" },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  chipTextActive: { color: colors.lightCream },
  stage: { flex: 1, marginHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige },
  footer: { paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  status: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primaryGreen, minHeight: 18 },
  note: { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "rgba(186,117,23,0.08)", borderRadius: 10, padding: 8 },
  noteText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: colors.textMid },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.textMid },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted },
});
