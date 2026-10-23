import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { getKingdomStoryMediaSignedUrl, IMAGE_KIND_LABELS, type KingdomStoryMedia } from "@/lib/kingdomStoriesApi";

// One storybook illustration: private image via a short-lived signed URL,
// cached on disk by its storage path (the URL changes, the picture doesn't),
// with loading and error states, an accessibility description, and its
// caption/credit underneath. An AI-generated or artistic image is labelled as
// such — never presented as a historical record.
export default function StoryImage({ media, aspectRatio = 4 / 3, rounded = 14, showCaption = true, thumb = false }: {
  media: KingdomStoryMedia; aspectRatio?: number; rounded?: number; showCaption?: boolean; thumb?: boolean;
}) {
  const { colors: c } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    getKingdomStoryMediaSignedUrl(media.mediaPath).then((u) => { if (live) { if (u) setUrl(u); else setFailed(true); } }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [media.mediaPath]);

  const label = media.altText || (media.caption ? `Illustration. ${media.caption}` : "Story illustration");
  const kind = media.imageKind && media.imageKind !== "other" ? IMAGE_KIND_LABELS[media.imageKind] : null;
  const box = { aspectRatio, borderRadius: rounded, backgroundColor: c.cardBeige ?? c.card, overflow: "hidden" as const };

  return (
    <View style={thumb ? undefined : styles.wrap}>
      <View style={box} accessible accessibilityRole="image" accessibilityLabel={label}>
        {failed ? (
          <View style={styles.center}>
            <Ionicons name="image-outline" size={thumb ? 16 : 28} color={c.textMuted} />
            {!thumb && <Text style={[styles.fallback, { color: c.textMuted }]}>Image unavailable</Text>}
          </View>
        ) : url ? (
          <Image source={{ uri: url, cacheKey: media.mediaPath }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150}
            cachePolicy="memory-disk" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
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
  caption: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center", paddingHorizontal: 8 },
});
