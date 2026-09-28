import React, { useRef, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View, Dimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";
import { GROWTH_VIDEO_SOURCE } from "@/constants/growthVideo";

const { width: SW } = Dimensions.get("window");

interface GrowthVideoModalProps {
  startSec: number;
  endSec: number;
  stageName: string;
  eventLabel?: string | null;
  progressPct: number;
  nextStageName?: string | null;
  onClose: () => void;
}

export function GrowthVideoModal({
  startSec,
  endSec,
  stageName,
  eventLabel,
  progressPct,
  nextStageName,
  onClose,
}: GrowthVideoModalProps) {
  const insets = useSafeAreaInsets();
  const [reachedEnd, setReachedEnd] = useState(false);
  const hasSeekedRef = useRef(false);

  // timeUpdateEventInterval must be set explicitly (default 0 = the event
  // never fires) to get frequent enough position updates to catch the
  // end-boundary reliably, matching onPlaybackStatusUpdate's continuous
  // callbacks in the previous expo-av version.
  const player = useVideoPlayer(GROWTH_VIDEO_SOURCE, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "readyToPlay" && !hasSeekedRef.current) {
      hasSeekedRef.current = true;
      player.currentTime = startSec;
      player.play();
    }
  });

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (!reachedEnd && currentTime >= endSec - 0.08) {
      setReachedEnd(true);
      player.pause();
      player.currentTime = endSec;
    }
  });

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.screen}>
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={12}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <View style={styles.videoWrap}>
          <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />
        </View>

        <View style={[styles.infoPanel, { paddingBottom: insets.bottom + 20 }]}>
          {eventLabel ? <Text style={styles.eventLabel}>{eventLabel}</Text> : null}
          <Text style={styles.stageName}>{stageName}</Text>
          {nextStageName ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {progressPct}% toward {nextStageName}
              </Text>
            </View>
          ) : (
            <Text style={styles.progressText}>You&apos;ve reached the highest stage of growth.</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B0B0B" },
  closeBtn: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 18,
    padding: 4,
  },
  videoWrap: { flex: 1, backgroundColor: "#000" },
  video: { width: SW, height: "100%" },
  infoPanel: {
    paddingHorizontal: 24,
    paddingTop: 18,
    backgroundColor: "#0B0B0B",
    gap: 6,
  },
  eventLabel: {
    color: colors.brightYellow,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  stageName: {
    color: "#fff",
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  progressBlock: { gap: 6 },
  progressBarBg: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 3,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: colors.accentGreen,
    borderRadius: 3,
  },
  progressText: {
    color: "#C9D6D0",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});
