import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, type ImageSourcePropType } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { AppColors } from "@/constants/themes";
import { CoverArt } from "@/components/kingdom-stories/DiscoverRow";
import { ARTWORK_FILL } from "@/constants/artwork";

// The Learning Centre's building blocks — one image treatment and one card
// language for Continue Learning, Explore Learning and Your Learning Journey.
//
// Images: every photo is shown WHOLE (never cropped, no blur — the owner's
// rule for Learning). The frame has a fixed height and takes the photo's own
// shape once it loads, so faces and characters always show, with no empty
// bands. Without a photo the frame shows the experience's icon.

export interface LearningArtSource {
  /** A Kingdom Stories media path (signed on display). */
  path?: string | null;
  /** A ready-to-show image URL (e.g. a Kingdom School module photo). */
  url?: string | null;
  /** Bundled artwork (e.g. the Bible cover). */
  bundled?: ImageSourcePropType;
  /** Behind the artwork, so any spare space blends in. */
  background?: string;
  /** Known shape (width / height) — skips measuring. */
  ratio?: number;
}

export function LearningArt({ art, icon, height, maxWidth, colors, onDark = false, radius = 12, defaultRatio = 2 / 3 }: {
  art: LearningArtSource; icon: string; height: number; maxWidth?: number; colors: AppColors; onDark?: boolean; radius?: number; defaultRatio?: number;
}) {
  const [ratio, setRatio] = useState<number | null>(art.ratio ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setRatio(art.ratio ?? null);
    if (!art.path && art.url) Image.getSize(art.url, (w, h) => { if (w && h) setRatio(w / h); }, () => {});
  }, [art.path, art.url, art.ratio]);

  const hasPhoto = !!art.bundled || !!art.path || (!!art.url && !failed);
  const r = hasPhoto ? Math.min(2, Math.max(0.5, ratio ?? defaultRatio)) : 1;
  const width = Math.min(height * r, maxWidth ?? Infinity);
  const frame = { width, height: width / r, borderRadius: radius };
  const tint = onDark ? "rgba(255,255,255,0.10)" : `${colors.accentGreen}1A`;

  let content: React.ReactNode = <Ionicons name={icon as any} size={Math.round(frame.height * 0.36)} color={onDark ? "#fff" : colors.accentGreen} />;
  if (art.bundled) content = <Image source={art.bundled} style={ARTWORK_FILL} resizeMode="contain" />;
  else if (art.path) content = <CoverArt path={art.path} fit="whole" onRatio={setRatio} />;
  else if (art.url && !failed) content = <Image source={{ uri: art.url }} style={StyleSheet.absoluteFill} resizeMode="contain" onError={() => setFailed(true)} />;

  return (
    <View style={[styles.art, frame, { backgroundColor: hasPhoto ? art.background ?? colors.cardBeige : tint }]}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {content}
    </View>
  );
}

/** A slim progress bar (0..1, from real progress only). */
export function ProgressBar({ value, color, track, height = 5 }: { value: number; color: string; track: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: height, overflow: "hidden", backgroundColor: track }}>
      <View style={{ height, width: `${Math.max(3, Math.min(100, Math.round(value * 100)))}%`, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

const pressed = { opacity: 0.92, transform: [{ scale: 0.985 }] };

export interface FeaturedLearning {
  typeLabel: string;
  title: string;
  detail: string | null;
  progress: number | null;
  icon: string;
  art: LearningArtSource;
}

/**
 * The one thing to pick up next — a deep, cinematic card in every theme
 * (near-black with the theme's own green), so it reads as the page's focus.
 */
export function FeaturedLearningCard({ item, colors, wide, onPress }: { item: FeaturedLearning; colors: AppColors; wide: boolean; onPress: () => void }) {
  const pct = item.progress !== null ? Math.round(item.progress * 100) : null;
  return (
    <Pressable onPress={onPress} style={({ pressed: p }) => [styles.featured, { backgroundColor: colors.darkBg }, p && pressed]}
      accessibilityRole="button" accessibilityLabel={`Continue ${item.typeLabel}: ${item.title}${item.detail ? `. ${item.detail}` : ""}${pct !== null ? `. ${pct}% complete` : ""}`}>
      <LinearGradient colors={[`${colors.primaryGreen}73`, `${colors.primaryGreen}14`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.featuredRow, wide && { gap: 24, padding: 20 }]}>
        <LearningArt art={item.art} icon={item.icon} height={wide ? 220 : 156} maxWidth={wide ? 360 : 140} colors={colors} onDark radius={wide ? 16 : 12} />
        <View style={styles.featuredText}>
          <Text style={[styles.kicker, { color: colors.brightYellow }]}>{item.typeLabel}</Text>
          <Text style={[styles.featuredTitle, wide && { fontSize: 26, lineHeight: 32 }]} numberOfLines={3}>{item.title}</Text>
          {item.detail ? <Text style={styles.featuredDetail} numberOfLines={2}>{item.detail}</Text> : null}
          {pct !== null ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              <ProgressBar value={item.progress!} color={colors.brightYellow} track="rgba(255,255,255,0.16)" />
              <Text style={styles.featuredPct}>{pct}% complete</Text>
            </View>
          ) : null}
          <View style={styles.continuePill}>
            <Text style={[styles.continueText, { color: colors.darkBg }]}>Continue</Text>
            <Ionicons name="arrow-forward" size={15} color={colors.darkBg} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** A smaller "also in progress" card for the row under the featured card. */
export function CompactLearningCard({ item, colors, onPress }: { item: FeaturedLearning; colors: AppColors; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed: p }) => [styles.compact, { backgroundColor: colors.card }, p && pressed]}
      accessibilityRole="button" accessibilityLabel={`Continue ${item.typeLabel}: ${item.title}${item.detail ? `. ${item.detail}` : ""}`}>
      <LearningArt art={item.art} icon={item.icon} height={72} maxWidth={104} colors={colors} radius={10} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.kicker, { color: colors.amber }]} numberOfLines={1}>{item.typeLabel}</Text>
        <Text style={[styles.compactTitle, { color: colors.textDark }]} numberOfLines={2}>{item.title}</Text>
        {item.detail ? <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>{item.detail}</Text> : null}
        {item.progress !== null && item.progress > 0 ? <View style={{ marginTop: 3 }}><ProgressBar value={item.progress} color={colors.progressFill} track={colors.progressTrack} height={3} /></View> : null}
      </View>
    </Pressable>
  );
}

/** A Learning Journey figure: a number, what it counts, and an icon that lights up when there's something there. */
export function ProgressStat({ value, label, icon, colors, highlight = false, wide = false }: { value: number | string; label: string; icon: string; colors: AppColors; highlight?: boolean; wide?: boolean }) {
  const lit = highlight && value !== 0;
  return (
    <View style={[styles.stat, wide && { flexBasis: "22%" }, { backgroundColor: lit ? `${colors.amber}17` : colors.lightCream }]}>
      <Ionicons name={icon as any} size={16} color={lit ? colors.amber : value ? colors.accentGreen : colors.textMuted} />
      <Text style={[styles.statValue, { color: colors.textDark }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_700Bold", letterSpacing: 1, textTransform: "uppercase" },
  meta: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  featured: { borderRadius: 22, overflow: "hidden" },
  featuredRow: { flexDirection: "row", alignItems: "center", gap: 16, padding: 14 },
  featuredText: { flex: 1, gap: 5 },
  featuredTitle: { fontSize: 20, lineHeight: 25, color: "#fff", fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  featuredDetail: { fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.74)", fontFamily: "Inter_400Regular" },
  featuredPct: { fontSize: 11.5, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_600SemiBold" },
  continuePill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 8, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: "#fff" },
  continueText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  compact: { width: 272, flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 16 },
  compactTitle: { fontSize: 14, lineHeight: 18, fontFamily: "Inter_700Bold" },
  status: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  stat: { flexGrow: 1, flexBasis: "45%", minWidth: 120, padding: 12, borderRadius: 14, gap: 2 },
  statValue: { fontSize: 22, lineHeight: 27, fontFamily: "Inter_700Bold", letterSpacing: -0.4, marginTop: 4 },
  statLabel: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
});
