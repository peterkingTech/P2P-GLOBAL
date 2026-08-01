import React, { useRef, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

interface CompletionCardProps {
  visible: boolean;
  firstName: string;
  completionDate: string; // ISO date string
  onClose: () => void;
}

export default function CompletionCard({ visible, firstName, completionDate, onClose }: CompletionCardProps) {
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShot>(null);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);

  const formattedDate = new Date(completionDate).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  async function captureImage(): Promise<string | null> {
    try {
      const uri = await shotRef.current?.capture?.();
      return uri ?? null;
    } catch {
      return null;
    }
  }

  async function handleShare() {
    setBusy("share");
    try {
      const uri = await captureImage();
      if (!uri) throw new Error("Could not capture the card");
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing unavailable", "Sharing isn't available on this device.");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Share your Kingdom School completion",
      });
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to save your completion card.");
        return;
      }
      const uri = await captureImage();
      if (!uri) throw new Error("Could not capture the card");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Saved", "Your completion card was saved to your photos.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={[styles.closeBtn, { top: insets.top + 12 }]} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={styles.shotWrap}>
          <View style={styles.card}>
            <View style={styles.treeRing}>
              <Ionicons name="leaf" size={30} color="#0B3A2E" />
            </View>
            <Text style={styles.title}>Kingdom School Foundation</Text>
            <Text style={styles.subtitle}>Core Curriculum Complete</Text>

            <View style={styles.divider} />

            <Text style={styles.name}>{firstName}</Text>
            <Text style={styles.date}>{formattedDate}</Text>

            <View style={styles.divider} />

            <Text style={styles.scripture}>"Well done, good and faithful servant"</Text>
            <Text style={styles.scriptureRef}>Matthew 25:23</Text>
          </View>
        </ViewShot>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShare} disabled={busy !== null} activeOpacity={0.85}>
            {busy === "share" ? (
              <ActivityIndicator color="#0B3A2E" size="small" />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color="#0B3A2E" />
                <Text style={styles.actionBtnText}>Share</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtnOutline} onPress={handleSave} disabled={busy !== null} activeOpacity={0.85}>
            {busy === "save" ? (
              <ActivityIndicator color="#E0A441" size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color="#E0A441" />
                <Text style={styles.actionBtnOutlineText}>Save to Photos</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(6,17,13,0.96)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  closeBtn: { position: "absolute", right: 16 },
  shotWrap: { borderRadius: 24, overflow: "hidden" },
  card: {
    width: 300,
    backgroundColor: "#0B1F19",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "rgba(224,164,65,0.4)",
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  treeRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E0A441",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    ...Platform.select({
      web: { boxShadow: "0 0 0 3px rgba(224,164,65,0.25)" },
      default: {},
    }),
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12,
    color: "#E0A441",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 4,
  },
  divider: {
    width: 40,
    height: 1,
    backgroundColor: "rgba(224,164,65,0.35)",
    marginVertical: 18,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  date: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  scripture: {
    fontSize: 14,
    color: "#F3E6C8",
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 21,
  },
  scriptureRef: {
    fontSize: 12,
    color: "#E0A441",
    fontFamily: "Inter_500Medium",
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 28,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E0A441",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minWidth: 110,
    justifyContent: "center",
  },
  actionBtnText: { fontSize: 14, fontWeight: "700", color: "#0B3A2E", fontFamily: "Inter_700Bold" },
  actionBtnOutline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#E0A441",
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 150,
    justifyContent: "center",
  },
  actionBtnOutlineText: { fontSize: 14, fontWeight: "600", color: "#E0A441", fontFamily: "Inter_600SemiBold" },
  doneBtn: { marginTop: 18, paddingVertical: 8, paddingHorizontal: 14 },
  doneBtnText: { color: "#C9B48A", fontSize: 14, fontFamily: "Inter_500Medium" },
});
