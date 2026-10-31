import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AppColors } from "@/constants/themes";
import { withAlpha } from "@/lib/colorUtils";
import { SCRIPTURE_FONT } from "@/lib/bibleReaderApi";
import { listen, type ChunkPosition, type ListenState } from "@/lib/listen";

// Read & Listen: the content's own text while it is read aloud. The sentence
// being spoken (a whole verse in the Bible) is highlighted — weight and a
// soft wash, not colour alone — sentences already read are quieter, and the
// text follows the voice gently: it only scrolls when the current sentence
// leaves the comfortable middle of the screen. Scrolling by hand pauses the
// following (never the audio) and offers "Return to current reading".
// Tapping a sentence or verse listens from there. The highlight moves when
// the speech engine starts each sentence — real events, not a timer. The
// displayed words are exactly the content's own (never the spoken copy).

type Relation = "past" | "current" | "future";
interface PartView { section: number; part: number; key: string; text: string; heading: boolean; verse: number | null; chunks: { i: number; start: number; end: number }[] }

// Signposts the content adds for listeners ("Chapter 1: …", "Personal Reflections.", section headings).
const isHeadingKey = (k: string) => k === "title" || k === "story" || k === "heading" || k === "label" || k === "lessons" || k === "scripture-label" || /:(label|title)$/.test(k);

export default function ReadAlongText({ state, c, dark, scale, highlight, follow, onDetachedChange }: {
  state: ListenState; c: AppColors; dark: boolean; scale: number;
  /** Highlight the current sentence/verse, and keep it in view. */
  highlight: boolean; follow: boolean;
  onDetachedChange?: (detached: boolean) => void;
}) {
  const content = state.content;
  const bible = content?.kind === "bible";
  const unit = content?.highlight ?? "sentence";
  const s = useMemo(() => makeStyles(c, dark, scale, bible), [c, dark, scale, bible]);

  // The text as parts (paragraphs / verses), each with the sentences spoken from it.
  const parts = useMemo<PartView[]>(() => {
    if (!content) return [];
    const byPart = new Map<string, { i: number; start: number; end: number }[]>();
    state.chunks.forEach((ch: ChunkPosition, i: number) => {
      const k = `${ch.section}:${ch.part}`;
      if (!byPart.has(k)) byPart.set(k, []);
      byPart.get(k)!.push({ i, start: ch.start, end: ch.end });
    });
    const out: PartView[] = [];
    content.sections.forEach((sec, si) => sec.parts.forEach((p, pi) => {
      if (!String(p.text ?? "").trim()) return;
      out.push({ section: si, part: pi, key: p.key, text: p.text, heading: isHeadingKey(p.key), verse: bible && /^\d+$/.test(p.key) ? Number(p.key) : null, chunks: byPart.get(`${si}:${pi}`) ?? [] });
    }));
    return out;
  }, [content, state.chunks, bible]);

  const cur = state.chunks[state.chunk];
  const active = state.status === "playing" || state.status === "paused";
  const relationOf = (p: PartView): Relation => {
    if (!cur || !active) return state.status === "completed" ? "past" : "future";
    if (p.section === cur.section && p.part === cur.part) return "current";
    return p.section < cur.section || (p.section === cur.section && p.part < cur.part) ? "past" : "future";
  };

  // ── Following the voice ──────────────────────────────────────────────────
  const scrollRef = useRef<ScrollView>(null);
  const layout = useRef(new Map<string, { y: number; h: number }>());
  const scrollY = useRef(0);
  const ownScrollUntil = useRef(0);
  const [viewH, setViewH] = useState(0);
  const [detached, setDetachedState] = useState(false);
  const setDetached = (d: boolean) => { setDetachedState(d); onDetachedChange?.(d); };
  // A new item starts in view; following resumes.
  useEffect(() => { setDetached(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [content?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const followNow = (force = false) => {
    if (!cur || !viewH) return;
    const L = layout.current.get(`${cur.section}:${cur.part}`);
    if (!L) return;
    const partLen = Math.max(1, (content?.sections[cur.section]?.parts[cur.part]?.text ?? "").length);
    // Within a long paragraph, the sentence's share of the paragraph's height (layout, not timing).
    const y = L.y + (unit === "part" ? 0 : L.h * (cur.start / partLen));
    const top = scrollY.current;
    if (!force && y >= top + viewH * 0.18 && y <= top + viewH * 0.6) return; // already comfortably in view
    ownScrollUntil.current = Date.now() + 900;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - viewH * 0.32), animated: true });
  };
  useEffect(() => { if (follow && !detached) followNow(); }, [state.chunk, content?.key, follow, detached, viewH]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const moved = Math.abs(y - scrollY.current);
    scrollY.current = y;
    // The listener moved the text (not our own follow scroll): stop following, keep playing.
    if (follow && !detached && Date.now() > ownScrollUntil.current && moved > 2) setDetached(true);
  };

  if (!content) return null;
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setViewH(e.nativeEvent.layout.height)}>
      <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={32} onScrollBeginDrag={() => { if (follow) setDetached(true); }}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: Math.max(120, viewH * 0.5) }} showsVerticalScrollIndicator={false}>
        {parts.map((p) => (
          <View key={`${p.section}:${p.part}`} onLayout={(e) => layout.current.set(`${p.section}:${p.part}`, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}>
            <PartText p={p} rel={relationOf(p)} curChunk={relationOf(p) === "current" ? state.chunk : -1} unit={unit} highlight={highlight} s={s} c={c} />
          </View>
        ))}
      </ScrollView>
      {follow && detached && active && (
        <Pressable style={s.returnPill} onPress={() => { setDetached(false); setTimeout(() => followNow(true), 0); }}
          accessibilityRole="button" accessibilityLabel="Return to current reading">
          <Ionicons name="locate" size={16} color="#fff" />
          <Text style={s.returnText}>Return to current reading</Text>
        </Pressable>
      )}
    </View>
  );
}

// One paragraph / verse. Re-renders only when its relation to the voice changes.
const PartText = memo(function PartText({ p, rel, curChunk, unit, highlight, s, c }: {
  p: PartView; rel: Relation; curChunk: number; unit: "part" | "sentence"; highlight: boolean; s: Styles; c: AppColors;
}) {
  const base = [p.heading ? s.heading : s.para, highlight && rel === "past" && s.past];
  // Text between spoken sentences (spaces) is shown as-is; each sentence can be tapped to listen from it.
  const nodes: React.ReactNode[] = [];
  let at = 0;
  p.chunks.forEach(({ i, start, end }) => {
    if (start > at) nodes.push(p.text.slice(at, start));
    const now = highlight && rel === "current" && (unit === "part" || i === curChunk);
    const before = highlight && rel === "current" && unit === "sentence" && i < curChunk;
    nodes.push(
      <Text key={i} onPress={() => listen.seekChunk(i)} suppressHighlighting style={[now && s.now, before && s.past]}
        accessibilityRole="button" accessibilityLabel={now ? `Being read: ${p.text.slice(start, end)}` : undefined} accessibilityHint="Listen from here">
        {p.text.slice(start, end)}
      </Text>,
    );
    at = end;
  });
  if (at < p.text.length) nodes.push(p.text.slice(at));
  return (
    <Text style={base}>
      {p.verse != null && <Text style={s.verseNum}>{p.verse}{" "}</Text>}
      {nodes}
    </Text>
  );
});

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (c: AppColors, dark: boolean, scale: number, bible: boolean) => {
  const size = Math.round(19 * scale);
  return StyleSheet.create({
    para: { color: c.textDark, fontSize: size, lineHeight: Math.round(size * 1.6), fontFamily: bible ? SCRIPTURE_FONT : "Inter_400Regular", marginBottom: Math.round(size * 0.75) },
    heading: { color: c.textDark, fontSize: Math.round(size * 0.9), lineHeight: Math.round(size * 1.35), fontFamily: "Inter_700Bold", marginTop: Math.round(size * 0.5), marginBottom: Math.round(size * 0.6), letterSpacing: 0.2 },
    past: { color: c.textMuted },
    // Weight + a soft wash of the theme accent: never colour alone.
    now: { color: c.textDark, fontFamily: bible ? SCRIPTURE_FONT : "Inter_600SemiBold", fontWeight: "700", backgroundColor: withAlpha(c.accentGreen, dark ? 0.3 : 0.18) },
    verseNum: { color: c.accentGreen, fontSize: Math.round(size * 0.62), fontFamily: "Inter_700Bold" },
    returnPill: {
      position: "absolute", alignSelf: "center", bottom: 12, flexDirection: "row", alignItems: "center", gap: 8,
      minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.accentGreen,
      shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
    },
    returnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  });
};
