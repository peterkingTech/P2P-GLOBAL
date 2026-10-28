import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { getKingdomStoryMediaSignedUrl, IMAGE_KIND_LABELS, type KingdomStoryMedia } from "@/lib/kingdomStoriesApi";

// One storybook illustration: private image via a short-lived signed URL,
// cached on disk by its storage path (the URL changes, the picture doesn't),
// with loading and error states, an accessibility description, and its
// caption/credit underneath. An AI-generated image is labelled as such —
// never presented as a historical record.
//
// Never cropped: P2P artwork carries its credit in a corner ("P2P Global |
// Creative Studios"), so the whole picture always shows. A full-width image
// takes the picture's own shape once it loads (`aspectRatio` is only the
// placeholder shape until then); a fixed box (`fixed`, e.g. square
// thumbnails) letterboxes the picture over a soft blurred copy of itself.
export default function StoryImage({ media, aspectRatio = 16 / 9, rounded = 14, showCaption = true, thumb = false, fixed = false }: {
  media: KingdomStoryMedia; aspectRatio?: number; rounded?: number; showCaption?: boolean; thumb?: boolean; fixed?: boolean;
}) {
  const { colors: c } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setNatural(null);
    getKingdomStoryMediaSignedUrl(media.mediaPath).then((u) => { if (live) { if (u) setUrl(u); else setFailed(true); } }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [media.mediaPath]);

  const boxed = fixed || thumb;
  const label = media.altText || (media.caption ? `Illustration. ${media.caption}` : "Story illustration");
  const kind = media.imageKind && media.imageKind !== "other" ? IMAGE_KIND_LABELS[media.imageKind] : null;
  const box = { aspectRatio: boxed ? aspectRatio : natural ?? aspectRatio, borderRadius: rounded, backgroundColor: c.cardBeige ?? c.card, overflow: "hidden" as const };
  const source = url ? { uri: url, cacheKey: media.mediaPath } : null;

  return (
    <View style={thumb ? undefined : styles.wrap}>
      <View style={box} accessible accessibilityRole="image" accessibilityLabel={label}>
        {failed ? (
          <View style={styles.center}>
            <Ionicons name="image-outline" size={thumb ? 16 : 28} color={c.textMuted} />
            {!thumb && <Text style={[styles.fallback, { color: c.textMuted }]}>Image unavailable</Text>}
          </View>
        ) : source ? (
          <>
            {boxed ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} cachePolicy="memory-disk" accessible={false} /> : null}
            <Image source={source} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} cachePolicy="memory-disk"
              onLoad={(e) => { const { width, height } = e.source ?? {}; if (width && height) setNatural(width / height); }}
              onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
          </>
        ) : (
          <View style={styles.center}><ActivityIndicator color={c.accentGreen} /></View>
        )}
      </View>
      {showCaption && !thumb && (!!media.caption || !!kind) && (
        <Text style={[styles.caption, { color: c.textMuted }]}>
          {[media.caption, kind].filter(Boolean).join(" · ")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  fallback: { fontSize: 12, fontFamily: "Inter_400Regular" },
  caption: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "left" },
});
