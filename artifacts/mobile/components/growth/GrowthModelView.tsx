import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, type ViewStyle, type StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { AppButton, IconButton } from "@/components/ui";
import TreeModelViewer, { type TreeModelViewerHandle, type TreeViewerStatus } from "@/components/growth/TreeModelViewer";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { GROWTH_MODELS, modelUrls, type GrowthModelId } from "@/lib/growthModels";

// One growth model in 3D with its loading / error states and zoom + reset buttons (for people who
// can't pinch). Used full-screen (app/tree-3d.tsx) and as the Living Tree's hero.

export function statusLine(title: string, s: TreeViewerStatus, hasDetail: boolean): string {
  if (s.state === "loading") return `Loading ${title}${s.progress ? ` · ${s.progress}%` : ""}`;
  if (s.state === "detail-loading") return `Loading the detailed model${s.progress ? ` · ${s.progress}%` : ""}`;
  if (s.state === "detailed") return "Detailed model";
  if (s.state === "standard") return s.detailFailed ? "Detailed model unavailable right now" : hasDetail ? "Zoom in for the detailed model" : "";
  return "";
}

export default function GrowthModelView({ modelId, background = colors.lightCream, onStatus, style, extraControls }: {
  modelId: GrowthModelId;
  background?: string;
  onStatus?: (s: TreeViewerStatus) => void;
  style?: StyleProp<ViewStyle>;
  /** Extra buttons shown with the zoom controls once the model is ready (e.g. "open full screen"). */
  extraControls?: React.ReactNode;
}) {
  const model = GROWTH_MODELS[modelId];
  const urls = modelUrls(model);
  const [status, setStatus] = useState<TreeViewerStatus>({ state: "loading", progress: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const viewer = useRef<TreeModelViewerHandle>(null);
  const reduceMotion = useReduceMotion();
  const report = useRef(onStatus);
  report.current = onStatus;

  useEffect(() => { setStatus({ state: "loading", progress: 0 }); }, [modelId]);
  const handle = useCallback((s: TreeViewerStatus) => { setStatus(s); report.current?.(s); }, []);
  const retry = () => { handle({ state: "loading", progress: 0 }); setReloadKey((k) => k + 1); };

  return (
    <View style={[styles.stage, { backgroundColor: background }, style]} accessible accessibilityRole="image"
      accessibilityLabel={`3D model: ${model.title}. ${model.description}`}>
      <TreeModelViewer
        ref={viewer}
        key={modelId}
        reloadKey={reloadKey}
        standardUrl={urls.standard}
        detailedUrl={urls.detailed}
        frontOnly={model.limits?.frontOnly}
        noCloseUp={model.limits?.noCloseUp}
        background={background}
        reduceMotion={reduceMotion}
        onStatus={handle}
      />
      {status.state === "loading" ? (
        <View style={[styles.overlay, { backgroundColor: background }]} pointerEvents="none">
          <ActivityIndicator color={colors.primaryGreen} />
          <Text style={styles.overlayText}>{statusLine(model.title, status, !!model.detailed)}</Text>
        </View>
      ) : null}
      {status.state === "error" ? (
        <View style={[styles.overlay, { backgroundColor: background }]}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textMuted} />
          <Text style={styles.overlayText}>{status.message ?? "The model couldn't be loaded."}</Text>
          <AppButton label="Try again" onPress={retry} variant="secondary" size="sm" palette="fixedLight" />
        </View>
      ) : null}
      {status.state !== "loading" && status.state !== "error" ? (
        <View style={styles.controls}>
          <IconButton variant="tinted" palette="fixedLight" icon="add" accessibilityLabel="Zoom in" onPress={() => viewer.current?.zoom(0.75)} />
          <IconButton variant="tinted" palette="fixedLight" icon="remove" accessibilityLabel="Zoom out" onPress={() => viewer.current?.zoom(1.33)} />
          <IconButton variant="tinted" palette="fixedLight" icon="scan-outline" accessibilityLabel="Reset the view" onPress={() => viewer.current?.reset()} />
          {extraControls}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { overflow: "hidden" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, opacity: 0.94 },
  overlayText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.textMid, textAlign: "center" },
  controls: { position: "absolute", right: 10, bottom: 10, gap: 8 },
});
