import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import type { KingdomStoryChapter, KingdomStoryMedia } from "@/lib/kingdomStoriesApi";
import KingdomStoryMediaGallery from "@/components/KingdomStoryMediaGallery";

// A story's chapters for readers (and the editor's reader preview). One
// chapter open at a time keeps long stories readable on a phone. Each chapter:
// people/places/dates, Scripture, the narrative, what the account rests on
// (documented fact, testimony, tradition, disputed claims — kept apart), its
// image(s), then — as cards in the same style as a P2P Global lesson — the 5
// Lessons, the 5 Reflection questions and the Assignment, and its sources.
const EVIDENCE: { key: keyof KingdomStoryChapter["evidence"]; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "documented", label: "Documented history", icon: "document-text-outline" },
  { key: "testimony", label: "Testimony", icon: "chatbubble-ellipses-outline" },
  { key: "tradition", label: "Tradition", icon: "library-outline" },
  { key: "disputed", label: "Disputed or uncertain", icon: "help-circle-outline" },
];

export default function StoryChapters({ chapters, media = [] }: { chapters: KingdomStoryChapter[]; media?: KingdomStoryMedia[] }) {
  const { colors: c } = useTheme();
  const s = makeStyles(c);
  const [open, setOpen] = useState<string | null>(chapters[0]?.id ?? null);
  if (!chapters.length) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.heading}>{chapters.length === 1 ? "1 chapter" : `${chapters.length} chapters`}</Text>
      {chapters.map((ch) => {
        const isOpen = open === ch.id;
        const meta = [ch.dates, ch.places, ch.people].filter(Boolean) as string[];
        const images = media.filter((m) => m.chapterId === ch.id);
        return (
          <View key={ch.id} style={s.chapter}>
            <TouchableOpacity
              style={s.chapterHead}
              onPress={() => setOpen(isOpen ? null : ch.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`Chapter ${ch.chapterNumber}: ${ch.title}`}
            >
              <View style={s.numBadge}><Text style={s.numText}>{ch.chapterNumber}</Text></View>
              <Text style={s.chapterTitle}>{ch.title || `Chapter ${ch.chapterNumber}`}</Text>
              <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
            </TouchableOpacity>

            {isOpen && (
              <View style={s.chapterBody}>
                {!!images.length && <View style={s.images}><KingdomStoryMediaGallery media={images} /></View>}
                {meta.map((m, i) => <Text key={i} style={s.meta}>{m}</Text>)}
                {!!ch.scriptureRefs && (
                  <View style={s.scripture}>
                    <Ionicons name="book" size={13} color={c.accentGreen} />
                    <Text style={s.scriptureText}>{ch.scriptureRefs}</Text>
                  </View>
                )}

                {!!ch.narrative && <Text style={s.narrative}>{ch.narrative}</Text>}

                {EVIDENCE.some((e) => ch.evidence[e.key]) && (
                  <View style={s.evidenceBox}>
                    <Text style={s.boxLabel}>What this account rests on</Text>
                    {EVIDENCE.filter((e) => ch.evidence[e.key]).map((e) => (
                      <View key={e.key} style={s.evidenceRow}>
                        <Ionicons name={e.icon} size={14} color={c.textMuted} style={{ marginTop: 2 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.evidenceLabel}>{e.label}</Text>
                          <Text style={s.evidenceText}>{ch.evidence[e.key]}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {!!ch.lessons.length && (
                  <View style={s.card}>
                    <View style={s.cardHeader}>
                      <Ionicons name="bulb" size={16} color={c.accentGreen} />
                      <Text style={s.cardTitle}>Lessons</Text>
                    </View>
                    {ch.lessons.map((l, i) => (
                      <View key={i} style={s.item}>
                        <Text style={[s.itemNum, { color: c.accentGreen }]}>{i + 1}</Text>
                        <Text style={s.itemText}>{l}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {!!ch.reflections.length && (
                  <View style={s.card}>
                    <View style={s.cardHeader}>
                      <Ionicons name="people" size={16} color={c.accentGreen} />
                      <Text style={s.cardTitle}>Reflection</Text>
                    </View>
                    {ch.reflections.map((r, i) => (
                      <View key={i} style={s.item}>
                        <Text style={s.itemNum}>{i + 1}</Text>
                        <Text style={s.itemText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {!!(ch.assignment?.title || ch.assignment?.text) && (
                  <View style={s.card}>
                    <View style={s.cardHeader}>
                      <Ionicons name="create" size={16} color={c.accentGreen} />
                      <Text style={s.cardTitle}>Assignment</Text>
                    </View>
                    {!!ch.assignment?.title && <Text style={s.assignmentTitle}>{ch.assignment.title}</Text>}
                    {!!ch.assignment?.text && <Text style={s.assignmentText}>{ch.assignment.text}</Text>}
                  </View>
                )}

                {!!ch.sources.length && (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <Text style={s.boxLabel}>Chapter sources</Text>
                    {ch.sources.map((src) => (
                      <View key={src.id} style={s.sourceRow}>
                        <Text style={s.sourceTitle}>{src.title}</Text>
                        {!!(src.publisher || src.citation) && <Text style={s.sourceMeta}>{[src.publisher, src.citation].filter(Boolean).join(" · ")}</Text>}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    wrap: { marginTop: 20, gap: 10 },
    heading: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    chapter: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, overflow: "hidden" },
    chapterHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, minHeight: 52 },
    numBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
    numText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    chapterTitle: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    chapterBody: { paddingHorizontal: 14, paddingBottom: 16, gap: 10 },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    scripture: { flexDirection: "row", alignItems: "center", gap: 6 },
    scriptureText: { flex: 1, fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    narrative: { fontSize: 15, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 23 },
    boxLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
    evidenceBox: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, gap: 8 },
    evidenceRow: { flexDirection: "row", gap: 8 },
    evidenceLabel: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    evidenceText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    images: { marginHorizontal: -14 },
    // Same card as a P2P Global lesson's discussion-questions / assignment card.
    card: { backgroundColor: c.lightCream, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 10 },
    cardHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 4 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    assignmentTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    assignmentText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 22 },
    item: { flexDirection: "row", gap: 10 },
    itemNum: { width: 16, fontSize: 14, color: c.textMuted, fontFamily: "Inter_700Bold", lineHeight: 21 },
    itemText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 21 },
    sourceRow: { paddingLeft: 6, borderLeftWidth: 2, borderLeftColor: c.borderBeige },
    sourceTitle: { fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },
    sourceMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
