import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { getLibrary, type Bookmark, type NewRef } from "@/lib/bibleReaderApi";

// Choose passages from the reader's own saved passages (migration 207) to add
// to a collection or playlist. Only references are passed on.
export default function PassagePicker({ visible, title, onClose, onChoose }: { visible: boolean; title: string; onClose: () => void; onChoose: (refs: NewRef[]) => void }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Bookmark[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = async (offset: number) => {
    setLoading(true);
    try {
      const r = await getLibrary("saved", offset);
      setItems((x) => (offset ? [...x, ...(r.items as Bookmark[])] : (r.items as Bookmark[])));
      setHasMore(r.hasMore); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load your saved passages."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (visible) { setPicked(new Set()); void load(0); } }, [visible]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = items.filter((i) => picked.has(i.id));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={s.head}>
            <Text style={s.title} numberOfLines={2} accessibilityRole="header">{title}</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
          </View>
          <Text style={s.muted}>Choose from your saved passages.</Text>
          {error ? <Text style={s.muted}>{error}</Text> : null}
          <FlatList
            data={items} keyExtractor={(i) => i.id} style={{ flexGrow: 0, maxHeight: 420, marginTop: 8 }}
            ListEmptyComponent={loading ? <ActivityIndicator color={c.accentGreen} style={{ margin: 20 }} /> : <Text style={[s.muted, { padding: 12 }]}>No saved passages yet. Select verses in the Bible reader and tap Save.</Text>}
            renderItem={({ item }) => {
              const on = picked.has(item.id);
              return (
                <Pressable style={[s.row, on && { backgroundColor: `${c.accentGreen}14` }]} onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${item.reference}, ${item.translationCode}`}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accentGreen : c.textMuted} />
                  <Text style={s.ref}>{item.reference} <Text style={s.muted}>{item.translationCode}</Text></Text>
                </Pressable>
              );
            }}
            ListFooterComponent={hasMore ? <AppButton label="Load more" variant="tertiary" size="sm" onPress={() => load(items.length)} loading={loading} /> : null}
          />
          <AppButton label={chosen.length ? `Add ${chosen.length} ${chosen.length === 1 ? "passage" : "passages"}` : "Choose passages"} disabled={!chosen.length} fullWidth
            onPress={() => onChoose(chosen.map((b) => ({ translationCode: b.translationCode, bookCode: b.bookCode, chapter: b.chapter, startVerse: b.startVerse, endVerse: b.endVerse })))} style={{ marginTop: 12 }} />
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, maxWidth: 640, width: "100%", alignSelf: "center" },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    muted: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 8, borderRadius: 12 },
    ref: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
