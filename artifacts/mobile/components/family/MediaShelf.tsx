import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { youtubeProvider } from "@/lib/mediaProviders/youtube";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
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
export default function MediaShelf({
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
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close Media Shelf">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {isGuide && (
            <View style={styles.permissionRow}>
              {(Object.keys(PERMISSION_LABELS) as MediaPermission[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.permissionChip, mediaPermission === p && styles.permissionChipActive]}
                  onPress={() => onChangePermission(p)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Media Permission: ${PERMISSION_LABELS[p]}`}
                  accessibilityState={{ selected: mediaPermission === p }}
                >
                  <Text style={[styles.permissionChipText, mediaPermission === p && styles.permissionChipTextActive]}>{PERMISSION_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.autoAdvanceToggle}
                onPress={() => onChangeAutoAdvance(!autoAdvance)}
                accessibilityRole="checkbox"
                accessibilityLabel="Auto-play next item"
                accessibilityState={{ checked: autoAdvance }}
              >
                <Ionicons name={autoAdvance ? "checkbox" : "square-outline"} size={16} color={colors.growth} />
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
                  <TouchableOpacity
                    key={c.userId} style={styles.trustedRow} onPress={() => onToggleTrusted(c.userId)}
                    accessibilityRole="checkbox" accessibilityLabel={`Trust ${c.name} with media control`} accessibilityState={{ checked: trusted }}
                  >
                    <Text style={styles.trustedName}>{c.name}</Text>
                    <Ionicons name={trusted ? "checkbox" : "square-outline"} size={16} color={trusted ? colors.growth : colors.textFaint} />
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
                      <TouchableOpacity
                        onPress={() => moveItem(i, -1)} disabled={i === 0} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button" accessibilityLabel={`Move ${item.title ?? "this item"} up`}
                      >
                        <Ionicons name="chevron-up" size={16} color={i === 0 ? colors.textFaint : colors.textPrimary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveItem(i, 1)} disabled={i === queue.length - 1} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button" accessibilityLabel={`Move ${item.title ?? "this item"} down`}
                      >
                        <Ionicons name="chevron-down" size={16} color={i === queue.length - 1 ? colors.textFaint : colors.textPrimary} />
                      </TouchableOpacity>
                    </View>
                  )}
                  {(canControl || item.addedBy === myUserId) && (
                    <TouchableOpacity
                      onPress={() => onRemove(item.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityRole="button" accessibilityLabel={`Remove ${item.title ?? "this item"} from the Media Shelf`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </ScrollView>

          {canControl && queue.length > 0 && (
            <TouchableOpacity style={styles.playNextBtn} onPress={onPlayNext} accessibilityRole="button" accessibilityLabel="Play next item now">
              <Ionicons name="play-skip-forward" size={14} color={colors.textPrimary} />
              <Text style={styles.playNextText}>Play Next</Text>
            </TouchableOpacity>
          )}

          {canControl && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Paste a YouTube link to add…"
                placeholderTextColor={colors.textFaint}
                value={input}
                onChangeText={setInput}
                autoCapitalize="none"
                accessibilityLabel="YouTube link to add to the Media Shelf"
              />
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd} disabled={adding || !input.trim()} accessibilityRole="button" accessibilityLabel="Add to Media Shelf">
                {adding ? <ActivityIndicator color={colors.textPrimary} size="small" /> : <Ionicons name="add" size={18} color={colors.textPrimary} />}
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
  sheet: { backgroundColor: colors.sheet, borderTopLeftRadius: radii.xl + 4, borderTopRightRadius: radii.xl + 4, maxHeight: "80%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.xl, paddingBottom: spacing.sm },
  title: { color: colors.textPrimary, ...type.title, letterSpacing: 0.6 },

  permissionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  permissionChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: spacing.md, minHeight: MIN_TOUCH_TARGET - 12, justifyContent: "center" },
  permissionChipActive: { backgroundColor: colors.growth, borderColor: colors.growth },
  permissionChipText: { color: colors.textSecondary, ...type.caption },
  permissionChipTextActive: { color: colors.textPrimary, fontFamily: "Inter_700Bold" },
  autoAdvanceToggle: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: "auto", minHeight: MIN_TOUCH_TARGET - 12 },
  autoAdvanceText: { color: colors.textSecondary, ...type.caption },

  list: { paddingHorizontal: spacing.xl, gap: spacing.md, paddingBottom: spacing.md },
  emptyText: { color: colors.textFaint, ...type.body, textAlign: "center", marginTop: spacing.md },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: "#000" },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  itemTitle: { color: colors.textPrimary, fontSize: 13, fontFamily: "Inter_500Medium" },
  itemMeta: { color: colors.textFaint, ...type.micro, marginTop: 2 },
  itemControls: { gap: 2 },

  playNextBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    marginHorizontal: spacing.xl, marginTop: spacing.xs, backgroundColor: colors.growthSoft, borderRadius: radii.md, minHeight: MIN_TOUCH_TARGET, alignSelf: "stretch",
  },
  playNextText: { color: colors.textPrimary, ...type.bodyEmph },

  trustedSection: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.xs },
  trustedLabel: { color: colors.textTertiary, ...type.label, marginBottom: 2 },
  trustedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: MIN_TOUCH_TARGET - 8 },
  trustedName: { color: colors.textPrimary, ...type.body },

  inputRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.xl, paddingTop: spacing.md },
  input: { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: MIN_TOUCH_TARGET, color: colors.textPrimary, ...type.body },
  addBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: radii.md, backgroundColor: colors.growth, alignItems: "center", justifyContent: "center" },
});
