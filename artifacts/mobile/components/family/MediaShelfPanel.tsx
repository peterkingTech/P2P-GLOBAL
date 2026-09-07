import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { youtubeProvider } from "@/lib/mediaProviders/youtube";
import type { WorshipQueueItem, MediaPermission } from "@/lib/familyApi";

interface Props {
  visible: boolean;
  onClose: () => void;
  queue: WorshipQueueItem[];
  canControl: boolean;
  isGuide: boolean;
  onAdd: (mediaId: string, title: string | null, thumbnailUrl: string | null) => void;
  onRemove: (itemId: string) => void;
  onReorder: (orderedItemIds: string[]) => void;
  onPlayNext: () => void;
  mediaPermission: MediaPermission;
  onChangePermission: (permission: MediaPermission) => void;
  autoAdvance: boolean;
  onChangeAutoAdvance: (v: boolean) => void;
  myUserId: string | undefined;
  companions: { userId: string; name: string }[];
  trustedUserIds: string[];
  onToggleTrusted: (userId: string) => void;
}

const PERMISSION_LABELS: Record<MediaPermission, string> = {
  guide_only: "Guide Only", trusted: "Guide + Trusted", everyone: "Everyone",
};

// P2P's own Media Shelf — a plain ordered list with up/down reordering
// (not a drag-and-drop clone of any streaming app's queue UI).
export default function MediaShelfPanel({
  visible, onClose, queue, canControl, isGuide, onAdd, onRemove, onReorder, onPlayNext,
  mediaPermission, onChangePermission, autoAdvance, onChangeAutoAdvance, myUserId,
  companions, trustedUserIds, onToggleTrusted,
}: Props) {
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    const value = input.trim();
    if (!value || !youtubeProvider.matches(value)) return;
    const id = youtubeProvider.extractId(value);
    if (!id) return;
    setAdding(true);
    try {
      const meta = await youtubeProvider.getMetadata(id);
      onAdd(id, meta?.title ?? null, meta?.thumbnailUrl ?? null);
      setInput("");
    } finally {
      setAdding(false);
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= queue.length) return;
    const next = [...queue];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((q) => q.id));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>MEDIA SHELF</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {isGuide && (
            <View style={styles.permissionRow}>
              {(Object.keys(PERMISSION_LABELS) as MediaPermission[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.permissionChip, mediaPermission === p && styles.permissionChipActive]}
                  onPress={() => onChangePermission(p)}
                >
                  <Text style={[styles.permissionChipText, mediaPermission === p && styles.permissionChipTextActive]}>{PERMISSION_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.autoAdvanceToggle} onPress={() => onChangeAutoAdvance(!autoAdvance)}>
                <Ionicons name={autoAdvance ? "checkbox" : "square-outline"} size={16} color="#1D9E75" />
                <Text style={styles.autoAdvanceText}>Auto-play next</Text>
              </TouchableOpacity>
            </View>
          )}

          {isGuide && mediaPermission === "trusted" && companions.length > 0 && (
            <View style={styles.trustedSection}>
              <Text style={styles.trustedLabel}>TRUSTED COMPANIONS</Text>
              {companions.map((c) => {
                const trusted = trustedUserIds.includes(c.userId);
                return (
                  <TouchableOpacity key={c.userId} style={styles.trustedRow} onPress={() => onToggleTrusted(c.userId)}>
                    <Text style={styles.trustedName}>{c.name}</Text>
                    <Ionicons name={trusted ? "checkbox" : "square-outline"} size={16} color={trusted ? "#1D9E75" : "rgba(255,255,255,0.4)"} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <ScrollView contentContainerStyle={styles.list}>
            {queue.length === 0 ? (
              <Text style={styles.emptyText}>The Media Shelf is empty.</Text>
            ) : (
              queue.map((item, i) => (
                <View key={item.id} style={styles.itemRow}>
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbFallback]}><Text style={{ fontSize: 16 }}>🎵</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.title ?? item.mediaId}</Text>
                    <Text style={styles.itemMeta}>Added by {item.addedByName}</Text>
                  </View>
                  {canControl && (
                    <View style={styles.itemControls}>
                      <TouchableOpacity onPress={() => moveItem(i, -1)} disabled={i === 0} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="chevron-up" size={16} color={i === 0 ? "rgba(255,255,255,0.2)" : "#fff"} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moveItem(i, 1)} disabled={i === queue.length - 1} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="chevron-down" size={16} color={i === queue.length - 1 ? "rgba(255,255,255,0.2)" : "#fff"} />
                      </TouchableOpacity>
                    </View>
                  )}
                  {(canControl || item.addedBy === myUserId) && (
                    <TouchableOpacity onPress={() => onRemove(item.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.6)" />
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </ScrollView>

          {canControl && queue.length > 0 && (
            <TouchableOpacity style={styles.playNextBtn} onPress={onPlayNext}>
              <Ionicons name="play-skip-forward" size={14} color="#fff" />
              <Text style={styles.playNextText}>Play Next</Text>
            </TouchableOpacity>
          )}

          {canControl && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Paste a YouTube link to add…"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={input}
                onChangeText={setInput}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd} disabled={adding || !input.trim()}>
                {adding ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 10 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },

  permissionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  permissionChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  permissionChipActive: { backgroundColor: "#1D9E75", borderColor: "#1D9E75" },
  permissionChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "Inter_500Medium" },
  permissionChipTextActive: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  autoAdvanceToggle: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: "auto" },
  autoAdvanceText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "Inter_400Regular" },

  list: { paddingHorizontal: 20, gap: 10, paddingBottom: 10 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#000" },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  itemTitle: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
  itemMeta: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  itemControls: { gap: 2 },

  playNextBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginHorizontal: 20, marginTop: 6, backgroundColor: "rgba(29,158,117,0.2)", borderRadius: 10, paddingVertical: 10,
  },
  playNextText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

  trustedSection: { paddingHorizontal: 20, paddingBottom: 12, gap: 6 },
  trustedLabel: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 2 },
  trustedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  trustedName: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular" },

  inputRow: { flexDirection: "row", gap: 8, padding: 20, paddingTop: 12 },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
});