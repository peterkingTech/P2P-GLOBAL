import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Platform } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { type as TT, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import { ART_TEXT, useStoryStyles, type StoryPalette } from "@/lib/storyTheme";
import { formatTopicNumber, getKingdomStoryMediaSignedUrl, type StoryCard } from "@/lib/kingdomStoriesApi";

// Cinematic Kingdom Stories rows, in the reader's light/dark theme
// (lib/storyTheme.ts). Cards show only real data: cover art, topic number,
// title, the reader's own progress, whether it's a favourite and — on
// recommendations — why it is suggested.

/**
 * A private storybook image (signed URL, cached by its storage path), never
 * cropped: the whole picture — including the "P2P Global | Creative Studios"
 * credit in its corner — shows inside the card/banner shape, over a soft
 * blurred copy of itself. `position: "top"` pins it to the top (the hero,
 * whose title sits over the lower part).
 */
export function CoverArt({ path, alt, style, position = "center" }: { path: string | null | undefined; alt?: string | null; style?: object; position?: "center" | "top" }) {
  const { T, s } = useStoryStyles(makeStyles);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) getKingdomStoryMediaSignedUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [path]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: T.sheet }, style]} accessible={!!alt} accessibilityLabel={alt ?? undefined}>
      {url ? (
        <>
          <Image source={{ uri: url, cacheKey: path ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={28} accessible={false} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.25)" }]} />
          <Image source={{ uri: url, cacheKey: path ?? undefined }} style={StyleSheet.absoluteFill} contentFit="contain" contentPosition={position} transition={200} />
        </>
      ) : <View style={s.coverFallback}><Ionicons name="book-outline" size={26} color={T.textFaint} /></View>}
    </View>
  );
}

/**
 * The reader's progress in words, from the storybook's own rules: a chapter is
 * done when its Comprehensive Check is submitted (or the chapter is finished);
 * "Completed" only once every chapter is also peer-approved.
 */
export function progressOf(s: StoryCard): { fraction: number; label: string; finished: boolean } | null {
  const p = s.myProgress;
  if (!p || !p.totalChapters || !p.started) return null;
  const done = Math.min(p.doneChapters, p.totalChapters);
  if (done >= p.totalChapters) {
    const waiting = p.completedChapters !== undefined && p.completedChapters < p.totalChapters;
    return { fraction: 1, label: waiting ? "Finished · awaiting review" : "Completed", finished: true };
  }
  const at = s.lastChapterNumber ?? done + 1;
  return { fraction: done / p.totalChapters, label: `Chapter ${at} of ${p.totalChapters}`, finished: false };
}

/** The main button for a story, from real progress (opening a story never counts). */
export function storyAction(s: StoryCard): { label: "Start Story" | "Continue Story" | "Review Story"; icon: "book" | "refresh" } {
  const p = progressOf(s);
  if (!p) return { label: "Start Story", icon: "book" };
  return p.finished ? { label: "Review Story", icon: "refresh" } : { label: "Continue Story", icon: "book" };
}

export function StoryPosterCard({ story, onPress, width = 132, wide = false }: { story: StoryCard; onPress: () => void; width?: number; wide?: boolean }) {
  const { s } = useStoryStyles(makeStyles);
  const cover = story.media?.[0] ?? null;
  const prog = progressOf(story);
  const num = formatTopicNumber(story.topicNumber);
  const w = wide ? Math.round(width * 1.7) : width;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ width: w }}
      accessibilityRole="button"
      accessibilityLabel={[story.reasonLabel, num, story.title, story.category?.title, prog?.label, story.mine?.favourite ? "In your favourites" : null].filter(Boolean).join(". ")}>
      <View style={[s.poster, { aspectRatio: wide ? 16 / 9 : 2 / 3 }]}>
        {/* The whole cover shows (credit included); nothing is laid over its lower corners. */}
        <CoverArt path={cover?.mediaPath} />
        {num ? <View style={s.numPill}><Text style={s.numText}>{num.replace("Topic ", "")}</Text></View> : null}
        {story.mine?.favourite ? <Ionicons name="heart" size={16} color="#FB7185" style={s.heart} /> : null}
      </View>
      {prog && prog.fraction < 1 ? <View style={s.track}><View style={[s.fill, { width: `${Math.max(4, Math.round(prog.fraction * 100))}%` }]} /></View> : null}
      <View style={s.posterText}>
        {story.reasonLabel ? <Text style={s.reason} numberOfLines={2}>{story.reasonLabel}</Text> : null}
        <Text style={s.posterTitle} numberOfLines={2}>{story.title}</Text>
        {prog ? <Text style={s.posterMeta} numberOfLines={1}>{prog.label}</Text>
          : wide && story.category?.title ? <Text style={s.posterMeta} numberOfLines={1}>{story.category.title}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export function DiscoverRow({ title, subtitle, stories, onOpen, onSeeAll, wide = false, width }: {
  title: string; subtitle?: string | null; stories: StoryCard[]; onOpen: (s: StoryCard) => void; onSeeAll?: () => void; wide?: boolean; width?: number;
}) {
  const { T, s } = useStoryStyles(makeStyles);
  if (!stories.length) return null;
  return (
    <View style={s.row}>
      <View style={s.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll} style={s.seeAll} accessibilityRole="button" accessibilityLabel={`See all: ${title}`}>
            <Text style={s.seeAllText}>See all</Text><Ionicons name="chevron-forward" size={14} color={T.growth} />
          </TouchableOpacity>
        ) : null}
      </View>
      <FlatList horizontal data={stories} keyExtractor={(x) => x.id} showsHorizontalScrollIndicator={Platform.OS === "web"}
        accessibilityLabel={title} initialNumToRender={5} windowSize={5}
        contentContainerStyle={s.rowList} renderItem={({ item }) => <StoryPosterCard story={item} wide={wide} width={width} onPress={() => onOpen(item)} />} />
    </View>
  );
}

function makeStyles(T: StoryPalette) {
  return StyleSheet.create({
    coverFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
    poster: { borderRadius: 12, overflow: "hidden", backgroundColor: T.sheet, borderWidth: StyleSheet.hairlineWidth, borderColor: T.borderFaint },
    numPill: { position: "absolute", top: 8, left: 8, backgroundColor: ART_TEXT.scrim, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    numText: { color: ART_TEXT.text, ...TT.micro, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    heart: { position: "absolute", top: 8, right: 8 },
    posterText: { paddingTop: 6, paddingHorizontal: 2, gap: 2 },
    reason: { color: T.light, ...TT.micro, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    posterTitle: { color: T.textPrimary, fontSize: 13, lineHeight: 17, fontFamily: "Inter_700Bold" },
    posterMeta: { color: T.textSecondary, ...TT.micro },
    track: { marginTop: 5, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: T.border },
    fill: { height: 4, backgroundColor: T.growth },
    row: { marginTop: 22 },
    rowHead: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, marginBottom: 10, gap: 8 },
    rowTitle: { color: T.textPrimary, ...TT.display },
    rowSub: { color: T.textTertiary, ...TT.caption },
    seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 4 },
    seeAllText: { color: T.growth, ...TT.bodyEmph, fontSize: 13 },
    rowList: { paddingHorizontal: 16, gap: 10 },
  });
}
