import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { updateKingdomStoryMedia, IMAGE_KIND_LABELS, type KingdomStory, type KingdomImageKind } from "@/lib/kingdomStoriesApi";

// Editors: each image's caption/credit, accessibility description, what kind
// of image it is, its source and licence (migration 212). Saved field by field
// when the editor leaves it. Read-only while the story is live.
const KINDS = Object.keys(IMAGE_KIND_LABELS) as KingdomImageKind[];

export default function MediaDetailsEditor({ story, locked, onChanged, onError }: {
  story: KingdomStory; locked: boolean; onChanged: () => Promise<void> | void; onError: (title: string, e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const images = (story.media ?? []).filter((m) => m.mediaType === "image");
  if (!images.length) return null;
  const chapterNo = new Map((story.chapters ?? []).map((c) => [c.id, c.chapterNumber]));
  const missingAlt = images.filter((m) => !m.altText).length;

  async function save(mediaId: string, updates: Parameters<typeof updateKingdomStoryMedia>[2]) {
    try { await updateKingdomStoryMedia(story.id, mediaId, updates); await onChanged(); }
    catch (e) { onError("Couldn't save image details", e); }
  }

  return (
    <View style={{ gap: 8, marginTop: 10 }}>
      <TouchableOpacity onPress={() => setOpen(!open)} style={s.head} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name="pricetags-outline" size={15} color={colors.textMid} />
        <Text style={s.headText}>Image details — captions, credits, descriptions{missingAlt ? ` (${missingAlt} without a description)` : ""}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {open && images.map((m, i) => (
        <View key={`${m.id}:${m.caption}:${m.altText}:${m.imageKind}`} style={s.card}>
          <Text style={s.where}>{m.chapterId ? `Chapter ${chapterNo.get(m.chapterId) ?? "?"}` : m.isCover ? "Cover" : "Story"} · image {i + 1}</Text>
          <Text style={s.label}>Caption / credit (shown under the image)</Text>
          <TextInput style={s.input} defaultValue={m.caption ?? ""} editable={!locked} placeholder="e.g. Image: bible.art" placeholderTextColor={colors.textMuted}
            onEndEditing={(e) => save(m.id, { caption: e.nativeEvent.text })} accessibilityLabel="Caption or credit" />
          <Text style={s.label}>Description for screen readers</Text>
          <TextInput style={[s.input, { minHeight: 56 }]} multiline defaultValue={m.altText ?? ""} editable={!locked} placeholder="What the image shows, in a sentence" placeholderTextColor={colors.textMuted}
            onEndEditing={(e) => save(m.id, { altText: e.nativeEvent.text })} accessibilityLabel="Image description" />
          <Text style={s.label}>Kind of image</Text>
          <View style={s.chips}>
            {KINDS.map((k) => (
              <TouchableOpacity key={k} disabled={locked} onPress={() => save(m.id, { imageKind: m.imageKind === k ? null : k })}
                style={[s.chip, m.imageKind === k && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: m.imageKind === k }}>
                <Text style={[s.chipText, m.imageKind === k && s.chipTextOn]}>{IMAGE_KIND_LABELS[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>Source (where the image comes from)</Text>
          <TextInput style={s.input} defaultValue={m.sourceUrl ?? ""} editable={!locked} autoCapitalize="none" placeholder="https://…" placeholderTextColor={colors.textMuted}
            onEndEditing={(e) => save(m.id, { sourceUrl: e.nativeEvent.text })} accessibilityLabel="Image source" />
          <Text style={s.label}>Licence / permission</Text>
          <TextInput style={s.input} defaultValue={m.licenseNote ?? ""} editable={!locked} placeholder="e.g. Used with permission of …" placeholderTextColor={colors.textMuted}
            onEndEditing={(e) => save(m.id, { licenseNote: e.nativeEvent.text })} accessibilityLabel="Licence or permission" />
        </View>
      ))}
      {open && <Text style={s.hint}>Only publish images you have the right to use. Label AI-generated or artistic images as such — never present them as historical records.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  headText: { flex: 1, fontSize: 13, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12, gap: 4 },
  where: { fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  label: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  input: { backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  chipTextOn: { color: "#fff" },
  hint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
