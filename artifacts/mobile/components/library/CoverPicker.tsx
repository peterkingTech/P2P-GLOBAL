import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, TextInput, Image, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import CoverArt from "@/components/library/CoverArt";
import { COVER_ARTWORK, COVER_COLOURS } from "@/constants/libraryCovers";
import { removePhoto, uploadPhoto, type CollectionCover, type PhotoSlot } from "@/lib/scriptureCollectionsApi";

// Personalise a playlist / collection: your own photos (a square cover and a
// wide header photo across the top of the page — uploaded and saved at once),
// built-in Scripture artwork, a theme colour or the default, and optional
// tags (saved with Save). Photos are private: only people who can see the
// playlist see them.
const SUGGESTED_TAGS = ["Prayer", "Faith", "Hope", "Love", "Healing", "Wisdom", "Forgiveness", "Encouragement", "Memorisation"];

export default function CoverPicker({ visible, kind, cover, tags, onClose, onSave, collectionId, header, onPhotosChanged }: {
  visible: boolean; kind: "collection" | "playlist"; cover: CollectionCover | null; tags: string[];
  onClose: () => void; onSave: (look: { cover: CollectionCover | null; tags: string[] }) => Promise<void>;
  /** Your own photos (migration 228): the playlist, its current header photo, and a refresh after a change. */
  collectionId?: string; header?: { url: string } | null; onPhotosChanged?: () => Promise<void> | void;
}) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<CollectionCover | null>(cover);
  const [tagList, setTagList] = useState<string[]>(tags);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<PhotoSlot | null>(null);
  useEffect(() => { if (visible) { setPick(cover); setTagList(tags); setDraft(""); setError(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible && cover?.kind === "image") setPick(cover); }, [cover?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pick a photo (square for the cover, wide for the header), upload it, use it. */
  async function choosePhoto(slot: PhotoSlot) {
    if (!collectionId) return;
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: slot === "cover" ? [1, 1] : [16, 9], quality: 0.8 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setPhotoBusy(slot);
    try {
      await uploadPhoto(collectionId, slot, { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
      await onPhotosChanged?.();
    } catch (e: any) { setError(e?.message ?? "Couldn't upload the photo."); }
    finally { setPhotoBusy(null); }
  }
  async function dropPhoto(slot: PhotoSlot) {
    if (!collectionId) return;
    setPhotoBusy(slot); setError(null);
    try { await removePhoto(collectionId, slot); if (slot === "cover") setPick(null); await onPhotosChanged?.(); }
    catch (e: any) { setError(e?.message ?? "Couldn't remove the photo."); }
    finally { setPhotoBusy(null); }
  }
  const ownCover = cover?.kind === "image" && cover.url ? cover : null;

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
            {collectionId ? (
              <>
                <Text style={s.label}>Your photos</Text>
                <View style={s.photos}>
                  <View style={s.photoCol}>
                    <Pressable style={[s.photoSquare, ownCover && same(ownCover) && { borderColor: c.accentGreen }]} onPress={() => (ownCover ? setPick(ownCover) : choosePhoto("cover"))}
                      accessibilityRole="button" accessibilityLabel={ownCover ? "Use your cover photo" : "Upload a cover photo"}>
                      {photoBusy === "cover" ? <ActivityIndicator color={c.accentGreen} /> : ownCover ? <CoverArt cover={ownCover} kind={kind} size={72} /> : <Ionicons name="image-outline" size={26} color={c.accentGreen} />}
                    </Pressable>
                    <Text style={s.optionLabel}>Cover photo</Text>
                    <View style={s.photoActions}>
                      <IconButton icon="cloud-upload-outline" size="sm" accessibilityLabel={ownCover ? "Change the cover photo" : "Upload a cover photo"} onPress={() => choosePhoto("cover")} disabled={!!photoBusy} />
                      {ownCover ? <IconButton icon="trash-outline" size="sm" color={c.textMuted} accessibilityLabel="Remove the cover photo" onPress={() => dropPhoto("cover")} disabled={!!photoBusy} /> : null}
                    </View>
                  </View>
                  <View style={[s.photoCol, { flex: 1 }]}>
                    <Pressable style={s.photoWide} onPress={() => choosePhoto("header")} accessibilityRole="button" accessibilityLabel={header ? "Change the header photo" : "Upload a header photo"}>
                      {photoBusy === "header" ? <ActivityIndicator color={c.accentGreen} /> : header ? <Image source={{ uri: header.url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : (
                        <>
                          <Ionicons name="image-outline" size={26} color={c.accentGreen} />
                          <Text style={s.optionLabel}>Wide photo across the top</Text>
                        </>
                      )}
                    </Pressable>
                    <Text style={s.optionLabel}>Header photo</Text>
                    <View style={s.photoActions}>
                      <IconButton icon="cloud-upload-outline" size="sm" accessibilityLabel={header ? "Change the header photo" : "Upload a header photo"} onPress={() => choosePhoto("header")} disabled={!!photoBusy} />
                      {header ? <IconButton icon="trash-outline" size="sm" color={c.textMuted} accessibilityLabel="Remove the header photo" onPress={() => dropPhoto("header")} disabled={!!photoBusy} /> : null}
                    </View>
                  </View>
                </View>
                <Text style={s.hint}>Only people who can see this {kind} see your photos. JPEG, PNG, WebP or HEIC, up to 8 MB.</Text>
              </>
            ) : null}
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
    photos: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    photoCol: { alignItems: "center", gap: 4 },
    photoSquare: { width: 84, height: 84, borderRadius: 14, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center", backgroundColor: c.card },
    photoWide: { width: "100%", height: 84, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: c.card },
    photoActions: { flexDirection: "row" },
    hint: { fontSize: 12, lineHeight: 16, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 6 },
    tag: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: c.card },
    suggest: { borderWidth: 1, borderColor: `${c.accentGreen}55`, backgroundColor: "transparent" },
    tagText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.card, fontFamily: "Inter_400Regular", fontSize: 15 },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium" },
    row: { flexDirection: "row", gap: 8 },
  });
}
