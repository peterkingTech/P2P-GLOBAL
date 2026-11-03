import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import CoverArt from "@/components/library/CoverArt";
import { COVER_ARTWORK, COVER_COLOURS } from "@/constants/libraryCovers";
import type { CollectionCover } from "@/lib/scriptureCollectionsApi";

// Personalise a playlist / collection: its cover (built-in Scripture artwork,
// a theme colour, or the default) and optional tags. Saved by the caller.
// Uploading your own image isn't offered yet — see docs/scripture-listening-library.md.
const SUGGESTED_TAGS = ["Prayer", "Faith", "Hope", "Love", "Healing", "Wisdom", "Forgiveness", "Encouragement", "Memorisation"];

export default function CoverPicker({ visible, kind, cover, tags, onClose, onSave }: {
  visible: boolean; kind: "collection" | "playlist"; cover: CollectionCover | null; tags: string[];
  onClose: () => void; onSave: (look: { cover: CollectionCover | null; tags: string[] }) => Promise<void>;
}) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<CollectionCover | null>(cover);
  const [tagList, setTagList] = useState<string[]>(tags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setPick(cover); setTagList(tags); setDraft(""); setError(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const same = (x: CollectionCover | null) => (x?.kind ?? null) === (pick?.kind ?? null) && (x?.ref ?? null) === (pick?.ref ?? null);
  const addTag = (t: string) => {
    const tag = t.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!tag || tagList.some((x) => x.toLowerCase() === tag.toLowerCase()) || tagList.length >= 20) return;
    setTagList([...tagList, tag]); setDraft("");
  };
  const option = (x: CollectionCover | null, label: string) => (
    <Pressable key={label} onPress={() => setPick(x)} style={[s.option, same(x) && { borderColor: c.accentGreen }]} accessibilityRole="radio" accessibilityState={{ checked: same(x) }} accessibilityLabel={label}>
      <CoverArt cover={x} kind={kind} size={72} />
      <Text style={s.optionLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">Cover and tags</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
          </View>
          <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Scripture artwork</Text>
            <View style={s.grid} accessibilityRole="radiogroup">
              {option(null, "Default")}
              {COVER_ARTWORK.map((a) => option({ kind: "artwork", ref: a.id }, a.label))}
            </View>
            <Text style={s.label}>Colour</Text>
            <View style={s.grid} accessibilityRole="radiogroup">
              {COVER_COLOURS.map((col) => option({ kind: "colour", ref: col.id }, col.label))}
            </View>

            <Text style={s.label}>Tags (optional)</Text>
            <View style={s.tags}>
              {tagList.map((t) => (
                <Pressable key={t} style={s.tag} onPress={() => setTagList(tagList.filter((x) => x !== t))} accessibilityRole="button" accessibilityLabel={`Remove tag ${t}`}>
                  <Text style={s.tagText}>{t}</Text>
                  <Ionicons name="close" size={14} color={c.textMid} />
                </Pressable>
              ))}
            </View>
            <TextInput style={s.input} value={draft} onChangeText={setDraft} onSubmitEditing={() => addTag(draft)} placeholder="Add a tag" placeholderTextColor={c.textMuted}
              maxLength={30} accessibilityLabel="Add a tag" returnKeyType="done" blurOnSubmit={false} />
            <View style={s.tags}>
              {SUGGESTED_TAGS.filter((t) => !tagList.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
                <Pressable key={t} style={[s.tag, s.suggest]} onPress={() => addTag(t)} accessibilityRole="button" accessibilityLabel={`Add tag ${t}`}>
                  <Ionicons name="add" size={14} color={c.accentGreen} />
                  <Text style={[s.tagText, { color: c.accentGreen }]}>{t}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.row}>
            <AppButton label="Save" loading={busy} onPress={async () => {
              setBusy(true); setError(null);
              try { await onSave({ cover: pick, tags: tagList }); onClose(); } catch (e: any) { setError(e?.message ?? "Couldn't save."); } finally { setBusy(false); }
            }} />
            <AppButton label="Cancel" variant="tertiary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, maxWidth: 680, width: "100%", alignSelf: "center", gap: 10 },
    head: { flexDirection: "row", alignItems: "center" },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    label: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold", marginTop: 12, marginBottom: 8 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    option: { width: 84, alignItems: "center", gap: 4, padding: 4, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
    optionLabel: { fontSize: 11.5, color: c.textMid, fontFamily: "Inter_500Medium" },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 6 },
    tag: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: c.card },
    suggest: { borderWidth: 1, borderColor: `${c.accentGreen}55`, backgroundColor: "transparent" },
    tagText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.card, fontFamily: "Inter_400Regular", fontSize: 15 },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium" },
    row: { flexDirection: "row", gap: 8 },
  });
}
