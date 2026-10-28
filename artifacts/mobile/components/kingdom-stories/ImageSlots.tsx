import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, ScrollView, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import colors from "@/constants/colors";
import {
  addKingdomStoryMedia, updateKingdomStoryMedia, uploadKingdomStoryImage, getKingdomStoryMediaSignedUrl,
  type KingdomStory, type KingdomStoryMedia, type MediaRole,
} from "@/lib/kingdomStoriesApi";

// Story artwork, slot by slot (migration 215 image roles): each field says
// where the image appears and how it is cropped, previews it at that shape,
// and offers Upload / Choose from this story's images / Remove from slot.
// "Remove" only takes the image out of that slot — the file and any other
// use stay. Placeholders are empty states, never stored as artwork.
// A live story's images are frozen except their placement (hero/overview).

type SlotKey = "cover" | "hero" | "overview";
const SLOTS: { key: SlotKey; label: string; where: string; format: string; aspect: number }[] = [
  { key: "cover", label: "Story Cover Image", where: "Story cards, library shelves and the top of the story page.", format: "Portrait or square artwork, subject centred (cards crop to 2:3, the story page to 1:1).", aspect: 2 / 3 },
  { key: "hero", label: "Featured Hero Image", where: "Full width at the top of the Kingdom Stories homepage when this story is Featured.", format: "Wide landscape artwork (16:9), key subject away from the bottom third (title text sits there).", aspect: 16 / 9 },
  { key: "overview", label: "Story Overview Image", where: "With the introduction on the story page.", format: "Landscape (4:3).", aspect: 4 / 3 },
];
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

function holder(media: KingdomStoryMedia[], key: SlotKey): KingdomStoryMedia | null {
  const images = media.filter((m) => m.mediaType === "image");
  if (key === "cover") return images.find((m) => m.isCover) ?? null;
  return images.find((m) => m.role === key) ?? null;
}

function Preview({ path, aspect }: { path: string | null; aspect: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; setUrl(null); if (path) getKingdomStoryMediaSignedUrl(path).then((u) => live && setUrl(u)); return () => { live = false; }; }, [path]);
  return (
    <View style={[styles.preview, { aspectRatio: aspect }]}>
      {path ? (url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityIgnoresInvertColors /> : <ActivityIndicator color={colors.accentGreen} />)
        : <View style={styles.placeholder}><Ionicons name="image-outline" size={22} color={colors.textMuted} /><Text style={styles.placeholderText}>[ Upload or Select Image ]</Text></View>}
    </View>
  );
}

export default function ImageSlots({ story, locked, onChanged, onError }: { story: KingdomStory; locked: boolean; onChanged: () => Promise<void> | void; onError: (title: string, e: unknown) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<SlotKey | { chapterId: string } | null>(null);
  const media = story.media ?? [];
  const images = media.filter((m) => m.mediaType === "image");
  const chapters = [...(story.chapters ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber);

  async function place(key: SlotKey, m: KingdomStoryMedia) {
    if (key === "cover") {
      const cur = holder(media, "cover");
      if (cur && cur.id !== m.id) await updateKingdomStoryMedia(story.id, cur.id, { isCover: false });
      await updateKingdomStoryMedia(story.id, m.id, { isCover: true });
    } else {
      const cur = holder(media, key);
      if (cur && cur.id !== m.id && key !== "hero") await updateKingdomStoryMedia(story.id, cur.id, { role: null }); // hero: the server clears the old one
      await updateKingdomStoryMedia(story.id, m.id, { role: key });
    }
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); await onChanged(); }
    catch (e) { onError(`Couldn't update ${label.toLowerCase()}`, e); }
    finally { setBusy(null); }
  }

  /** Pick, validate (type, size), upload, then add — into a slot or a chapter. */
  async function upload(target: { slot: SlotKey } | { chapterId: string }, label: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return onError("Photo access needed", new Error("Please allow photo library access."));
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    if (a.mimeType && !ACCEPTED.includes(a.mimeType)) return onError("That file can't be used", new Error("Use a JPEG, PNG or WebP image."));
    if (a.fileSize && a.fileSize > MAX_BYTES) return onError("That image is too large", new Error("Choose an image under 10 MB."));
    await run(label, async () => {
      const up = await uploadKingdomStoryImage(story.id, { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName });
      if (!up) throw new Error("The upload didn't finish. Check your connection and try again.");
      if ("chapterId" in target) {
        await addKingdomStoryMedia(story.id, { id: up.mediaId, mediaType: "image", mediaPath: up.mediaPath, displayOrder: media.length, chapterId: target.chapterId, role: "chapter" });
      } else {
        const added = await addKingdomStoryMedia(story.id, { id: up.mediaId, mediaType: "image", mediaPath: up.mediaPath, displayOrder: media.length,
          ...(target.slot === "cover" ? {} : { role: target.slot }) });
        if (target.slot === "cover") await place("cover", added);
      }
    });
  }

  return (
    <View style={{ gap: 14 }}>
      {locked ? <Text style={styles.note}>This story is live. You can change which image is the Featured Hero or Overview; uploading, removing or changing the cover needs “Unpublish to edit”.</Text> : null}
      {SLOTS.map((slot) => {
        const h = holder(media, slot.key);
        const canChange = !locked || slot.key !== "cover";
        return (
          <View key={slot.key} style={styles.slot}>
            <Text style={styles.slotLabel}>{slot.label}</Text>
            <Text style={styles.slotWhere}>{slot.where}</Text>
            <Text style={styles.slotFormat}>Recommended: {slot.format}</Text>
            <View style={{ width: slot.aspect < 1 ? 140 : "100%", maxWidth: 420 }}><Preview path={h?.mediaPath ?? null} aspect={slot.aspect} /></View>
            {h?.altText ? <Text style={styles.slotFormat}>Alt text: {h.altText}</Text> : h ? <Text style={styles.warn}>No alt text yet — add one in Image details below.</Text> : null}
            <View style={styles.actions}>
              {!locked ? <Action icon="cloud-upload-outline" label={h ? "Replace (upload)" : "Upload image"} onPress={() => upload({ slot: slot.key }, slot.label)} busy={busy === slot.label} /> : null}
              {canChange && images.length > 0 ? <Action icon="images-outline" label="Choose from this story" onPress={() => setChoosing(slot.key)} /> : null}
              {h && canChange ? <Action icon="remove-circle-outline" label="Remove from slot" onPress={() => run(slot.label, () => updateKingdomStoryMedia(story.id, h.id, slot.key === "cover" ? { isCover: false } : { role: null }).then(() => {}))} /> : null}
            </View>
          </View>
        );
      })}

      {chapters.length > 0 && (
        <View style={styles.slot}>
          <Text style={styles.slotLabel}>Chapter Images</Text>
          <Text style={styles.slotWhere}>At the top of each chapter, and as the chapter's picture in the contents.</Text>
          <Text style={styles.slotFormat}>Recommended: landscape (4:3).</Text>
          {chapters.map((ch) => {
            const img = images.find((m) => m.chapterId === ch.id) ?? null;
            return (
              <View key={ch.id} style={styles.chapterRow}>
                <View style={{ width: 96 }}><Preview path={img?.mediaPath ?? null} aspect={4 / 3} /></View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.chapterTitle} numberOfLines={2}>Chapter {ch.chapterNumber}: {ch.title}</Text>
                  {!img ? <Text style={styles.warn}>No image for this chapter.</Text> : null}
                  {!locked ? (
                    <View style={styles.actions}>
                      <Action icon="cloud-upload-outline" label={img ? "Add another" : "Upload"} onPress={() => upload({ chapterId: ch.id }, `Chapter ${ch.chapterNumber} image`)} busy={busy === `Chapter ${ch.chapterNumber} image`} />
                      {images.some((m) => !m.chapterId) ? <Action icon="images-outline" label="Choose" onPress={() => setChoosing({ chapterId: ch.id })} /> : null}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Modal visible={!!choosing} transparent animationType="fade" onRequestClose={() => setChoosing(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setChoosing(null)} accessibilityLabel="Close">
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose an image from this story</Text>
            <ScrollView contentContainerStyle={styles.chooseGrid}>
              {(choosing && typeof choosing === "object" ? images.filter((m) => !m.chapterId) : images).map((m) => (
                <TouchableOpacity key={m.id} style={styles.chooseCell} onPress={() => {
                  const target = choosing; setChoosing(null);
                  if (!target) return;
                  if (typeof target === "object") run("Chapter image", () => updateKingdomStoryMedia(story.id, m.id, { chapterId: target.chapterId, role: "chapter" }).then(() => {}));
                  else run(SLOTS.find((x) => x.key === target)!.label, () => place(target, m));
                }} accessibilityRole="button" accessibilityLabel={m.altText ?? m.caption ?? "Story image"}>
                  <Preview path={m.mediaPath} aspect={1} />
                  {m.isCover || m.role ? <Text style={styles.chooseTag}>{m.isCover ? "Cover" : m.role}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function Action({ icon, label, onPress, busy }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; busy?: boolean }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label}>
      {busy ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name={icon} size={15} color={colors.accentGreen} />}
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium", backgroundColor: "rgba(234,179,8,0.15)", padding: 10, borderRadius: 10 },
  slot: { gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff" },
  slotLabel: { fontSize: 12, color: colors.textDark, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6 },
  slotWhere: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  slotFormat: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  warn: { fontSize: 12, color: "#8A5410", fontFamily: "Inter_500Medium" },
  preview: { borderRadius: 10, overflow: "hidden", backgroundColor: colors.cardBeige ?? "#F4EFE4", alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderBeige },
  placeholder: { alignItems: "center", gap: 4, padding: 8 },
  placeholderText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.accentGreen },
  actionText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  chapterRow: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderBeige },
  chapterTitle: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { maxHeight: "75%", backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetTitle: { fontSize: 16, color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 10 },
  chooseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 16 },
  chooseCell: { width: 96, gap: 4 },
  chooseTag: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_600SemiBold", textTransform: "capitalize", textAlign: "center" },
});
