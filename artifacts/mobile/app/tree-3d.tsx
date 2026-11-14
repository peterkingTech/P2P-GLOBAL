import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";
import { STAGES, PERSONAL_STAGE_COUNT } from "@/constants/stages";
import { IconButton } from "@/components/ui";
import LivingTreeView, { bodyForStage } from "@/components/growth/LivingTreeView";
import { assetById } from "@/lib/growthTreeAssets";

// Full-screen 3D view of a growth stage's real Meshy model (the hosted v2 copy, components/growth/
// LivingTreeView — the same renderer as Home and My Tree). Turn it by dragging, zoom by pinching or with
// the buttons, jump to its roots or canopy; a close-up copy downloads only when zoomed in (large trees).
// ?stage=0…4 → that stage's model; ?mine=1 → your own tree with your verified fruit.
const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

export default function Tree3DScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ stage?: string; mine?: string }>();
  const n = Number(params.stage);
  const stageIndex = Number.isInteger(n) && n >= 0 && n < PERSONAL_STAGE_COUNT ? n : 0;
  const mine = params.mine === "1";
  const stage = STAGES[stageIndex];
  const asset = assetById(bodyForStage(stageIndex));
  const topPad = insets.top + (Platform.OS === "web" ? 16 : 6);

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <IconButton palette="fixedLight" icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header">{mine ? `Your tree · ${stage.name}` : stage.name}</Text>
          <Text style={styles.hint}>Drag to turn · pinch or use the buttons to zoom · two fingers to move</Text>
        </View>
      </View>

      <LivingTreeView stageIndex={stageIndex} mode={mine ? "tree" : "stage"} showViewControls style={styles.stage} />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.desc}>{stage.description}</Text>
        {asset?.file ? (
          <Text style={styles.meta}>
            About {mb(asset.file.bytes)} MB to download, kept on your device afterwards.
            {asset.file.close ? ` A close-up version (${mb(asset.file.close.bytes)} MB) downloads only when you zoom in.` : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMuted },
  stage: { flex: 1, marginHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige },
  footer: { paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.textMid },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted },
});
