import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors as T, type as TT, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import { formatTopicNumber, getKingdomStoryMediaSignedUrl, type StoryCard } from "@/lib/kingdomStoriesApi";

// Cinematic Kingdom Stories rows (dark "gathered room" palette from
// togetherTheme — P2P's own design language, no new brand colours). Cards
// show only real data: cover art, topic number, title, the reader's own
// progress and whether it's a favourite.

/** A private storybook image (signed URL, cached by its storage path). */
export function CoverArt({ path, alt, style }: { path: string | null | undefined; alt?: string | null; style?: object }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) getKingdomStoryMediaSignedUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [path]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: T.sheet }, style]} accessible={!!alt} accessibilityLabel={alt ?? undefined}>
      {url ? <Image source={{ uri: url, cacheKey: path ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        : <View style={styles.coverFallback}><Ionicons name="book-outline" size={26} color={T.textFaint} /></View>}
    </View>
  );
}

export function progressOf(s: StoryCard): { fraction: number; label: string } | null {
  const p = s.myProgress;
  if (!p || !p.totalChapters || !p.started) return null;
  const done = Math.min(p.doneChapters, p.totalChapters);
  if (done >= p.totalChapters) return { fraction: 1, label: "Completed" };
  const at = s.lastChapterNumber ?? done + 1;
  return { fraction: done / p.totalChapters, label: `Chapter ${at} of ${p.totalChapters}` };
}

export function StoryPosterCard({ story, onPress, width = 132, wide = false }: { story: StoryCard; onPress: () => void; width?: number; wide?: boolean }) {
  const cover = story.media?.[0] ?? null;
  const prog = progressOf(story);
  const num = formatTopicNumber(story.topicNumber);
  const w = wide ? Math.round(width * 1.7) : width;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ width: w }}
      accessibilityRole="button" accessibilityLabel={[num, story.title, story.category?.title, prog?.label, story.mine?.favourite ? "In your favourites" : null].filter(Boolean).join(". ")}>
      <View style={[styles.poster, { aspectRatio: wide ? 16 / 9 : 2 / 3 }]}>
        <CoverArt path={cover?.mediaPath} />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={styles.posterShade} pointerEvents="none" />
        {num ? <View style={styles.numPill}><Text style={styles.numText}>{num.replace("Topic ", "")}</Text></View> : null}
        {story.mine?.favourite ? <Ionicons name="heart" size={16} color="#FB7185" style={styles.heart} /> : null}
        <View style={styles.posterText}>
          <Text style={styles.posterTitle} numberOfLines={wide ? 2 : 3}>{story.title}</Text>
          {prog ? <Text style={styles.posterMeta} numberOfLines={1}>{prog.label}</Text> : null}
        </View>
        {prog && prog.fraction < 1 ? <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(4, Math.round(prog.fraction * 100))}%` }]} /></View> : null}
      </View>
    </TouchableOpacity>
  );
}

export function DiscoverRow({ title, subtitle, stories, onOpen, onSeeAll, wide = false }: {
  title: string; subtitle?: string | null; stories: StoryCard[]; onOpen: (s: StoryCard) => void; onSeeAll?: () => void; wide?: boolean;
}) {
  if (!stories.length) return null;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll} style={styles.seeAll} accessibilityRole="button" accessibilityLabel={`See all: ${title}`}>
            <Text style={styles.seeAllText}>See all</Text><Ionicons name="chevron-forward" size={14} color={T.growth} />
          </TouchableOpacity>
        ) : null}
      </View>
      <FlatList horizontal data={stories} keyExtractor={(s) => s.id} showsHorizontalScrollIndicator={Platform.OS === "web"}
        contentContainerStyle={styles.rowList} renderItem={({ item }) => <StoryPosterCard story={item} wide={wide} onPress={() => onOpen(item)} />} />
    </View>
  );
}

const styles = StyleSheet.create({
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  poster: { borderRadius: 12, overflow: "hidden", backgroundColor: T.sheet, borderWidth: StyleSheet.hairlineWidth, borderColor: T.borderFaint },
  posterShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  numPill: { position: "absolute", top: 8, left: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  numText: { color: T.textPrimary, ...TT.micro, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  heart: { position: "absolute", top: 8, right: 8 },
  posterText: { position: "absolute", left: 8, right: 8, bottom: 12, gap: 2 },
  posterTitle: { color: T.textPrimary, fontSize: 13, lineHeight: 17, fontFamily: "Inter_700Bold" },
  posterMeta: { color: T.textSecondary, ...TT.micro },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: "rgba(255,255,255,0.2)" },
  fill: { height: 4, backgroundColor: T.growth },
  row: { marginTop: 22 },
  rowHead: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, marginBottom: 10, gap: 8 },
  rowTitle: { color: T.textPrimary, ...TT.display },
  rowSub: { color: T.textTertiary, ...TT.caption },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 4 },
  seeAllText: { color: T.growth, ...TT.bodyEmph, fontSize: 13 },
  rowList: { paddingHorizontal: 16, gap: 10 },
});
