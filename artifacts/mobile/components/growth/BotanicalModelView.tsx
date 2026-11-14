import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, type ViewStyle, type StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import colors from "@/constants/colors";
import { AppButton, IconButton } from "@/components/ui";
import TreeModelViewer, { type TreeModelViewerHandle, type TreeViewerStatus } from "@/components/growth/TreeModelViewer";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { botanicalAsset, botanicalAssetUrl } from "@/lib/growthTreeAssets";

// ONE botanical asset from the shared register (lib/growthTreeAssets.ts BOTANICAL_REGISTRY) in 3D — the same
// renderer as the Growth Tree (TreeModelViewer → lib/treeViewerHtml.ts: caching, close-up rules, disposal,
// pause when hidden). Wind only for assets that have leaves or petals (registry `wind`). Loading, Try again,
// or "not available yet" — never a picture or another model in its place.
export default function BotanicalModelView({ assetId, background = colors.lightCream, style, compact = false, label }: {
  assetId: string;
  background?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  /** Spoken description (defaults to the register's). */
  label?: string;
}) {
  const asset = botanicalAsset(assetId);
  const url = botanicalAssetUrl(assetId);
  const reduceMotion = useReduceMotion();
  const [status, setStatus] = useState<TreeViewerStatus>({ state: "loading", progress: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const viewer = useRef<TreeModelViewerHandle>(null);
  const pathname = usePathname();
  const openedOn = useRef(pathname).current;
  const description = label ?? asset?.depicts ?? "3D model";
  return (
    <View style={[styles.stage, { backgroundColor: background }, style]} accessibilityRole="image" accessibilityLabel={`3D model: ${description}`}>
      {url ? (
        <TreeModelViewer ref={viewer} key={assetId} reloadKey={reloadKey} standardUrl={url} detailedUrl={null} noCloseUp background={background}
          reduceMotion={reduceMotion} wind={!!asset?.wind && !reduceMotion} compact={compact} paused={pathname !== openedOn} onStatus={setStatus} />
      ) : (
        <View style={[styles.overlay, { backgroundColor: background }]}>
          <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
          <Text style={styles.text}>This 3D model isn&apos;t available yet.</Text>
        </View>
      )}
      {url && status.state === "loading" ? (
        <View style={[styles.overlay, { backgroundColor: background }]} pointerEvents="none">
          <ActivityIndicator color={colors.primaryGreen} />
          {!compact ? <Text style={styles.text}>Loading{status.progress ? ` · ${status.progress}%` : ""}</Text> : null}
        </View>
      ) : null}
      {url && status.state === "error" ? (
        <View style={[styles.overlay, { backgroundColor: background }]}>
          <Ionicons name="cloud-offline-outline" size={24} color={colors.textMuted} />
          <Text style={styles.text}>{status.message ?? "The model couldn't be loaded."}</Text>
          <AppButton label="Try again" onPress={() => { setStatus({ state: "loading", progress: 0 }); setReloadKey((k) => k + 1); }} variant="secondary" size="sm" palette="fixedLight" />
        </View>
      ) : null}
      {url && !compact && status.state !== "loading" && status.state !== "error" ? (
        <View style={styles.controls}>
          <IconButton variant="tinted" palette="fixedLight" icon="add" accessibilityLabel="Zoom in" onPress={() => viewer.current?.zoom(0.75)} />
          <IconButton variant="tinted" palette="fixedLight" icon="remove" accessibilityLabel="Zoom out" onPress={() => viewer.current?.zoom(1.33)} />
          <IconButton variant="tinted" palette="fixedLight" icon="scan-outline" accessibilityLabel="Reset the view" onPress={() => viewer.current?.reset()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { overflow: "hidden" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 8, padding: 16, opacity: 0.94 },
  text: { fontSize: 13.5, fontFamily: "Inter_500Medium", color: colors.textMid, textAlign: "center" },
  controls: { position: "absolute", right: 8, bottom: 8, gap: 6 },
});
