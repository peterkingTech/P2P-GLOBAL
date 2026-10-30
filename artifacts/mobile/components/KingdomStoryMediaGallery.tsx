import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import SignedPhotoView from "@/components/SignedPhotoView";
import VideoPlayer from "@/components/media/VideoPlayer";
import colors from "@/constants/colors";
import { getKingdomStoryMediaSignedUrl, type KingdomStoryMedia } from "@/lib/kingdomStoriesApi";

// Ordered, swipeable image/video gallery for a Kingdom Story — the one
// genuinely new piece of media UI this feature needed, since every other
// domain in this app renders a single media item, not an ordered set.
// Deliberately NOT an Instagram-style component: no like/share overlay,
// just media + caption + a simple position indicator.
interface Props { media: KingdomStoryMedia[] }


export default function KingdomStoryMediaGallery({ media }: Props) {
  // Pages are as wide as the gallery itself — measured, because on tablets
  // the story sits in a page column narrower than the window. Phones: the
  // gallery spans the window, so this equals the window width as before.
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const SCREEN_WIDTH = measuredWidth ?? windowWidth;
  const [index, setIndex] = useState(0);
  if (!media.length) return null;

  return (
    <View style={styles.wrap} onLayout={(e) => {
      const w = Math.round(e.nativeEvent.layout.width);
      setMeasuredWidth((prev) => (prev === w ? prev : w));
    }}>
      <ScrollView
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
      >
        {media.map((item) => (
          <View key={item.id} style={{ width: SCREEN_WIDTH }}>
            <View style={{ paddingHorizontal: 20 }}>
              {item.mediaType === "video" ? (
                <VideoPlayer mediaPath={item.mediaPath} resolveUrl={getKingdomStoryMediaSignedUrl} accessibilityLabel={item.altText ?? item.caption ?? "Story video"} />
              ) : (
                <SignedPhotoView bucket="kingdom-stories-media" path={item.mediaPath} />
              )}
            </View>
          </View>
        ))}
      </ScrollView>
      {media.length > 1 && (
        <View style={styles.dotsRow}>
          {media.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
      )}
      {!!media[index]?.caption && <Text style={styles.caption}>{media[index].caption}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderBeige },
  dotActive: { backgroundColor: colors.accentGreen },
  caption: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center", paddingHorizontal: 24 },
});
