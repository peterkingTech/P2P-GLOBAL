import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Share, Platform, Alert } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getKingdomStory, saveStory, unsaveStory, markStoryOpened, formatTopicNumber, CONTENT_TYPE_LABELS, IMAGE_KIND_LABELS, type KingdomStory, type KingdomStoryChapter, type KingdomStoryMedia } from "@/lib/kingdomStoriesApi";
import ShareStorySheet from "@/components/kingdom-stories/ShareStorySheet";
import SharedStudySheet from "@/components/study/SharedStudySheet";
import { getScriptureReference, type ScriptureReference } from "@/lib/prayerTopicsApi";
import { SCRIPTURE_FONT } from "@/lib/bibleReaderApi";
import { storyIntro, progressSummary, STATE_LABEL, lockedMessage } from "@/lib/storybook";
import StoryImage from "@/components/kingdom-stories/StoryImage";
import { ScriptureChips } from "@/components/kingdom-stories/ScriptureLinks";
import KingdomStoryMediaGallery from "@/components/KingdomStoryMediaGallery";

// A Kingdom Story as a book: cover, introduction, the reader's progress,
// Start/Continue Reading, a table of contents (each chapter's status in words
// as well as an icon), then sources and image credits. Chapters are read on
// their own screen (kingdom-stories/chapter). Locked chapters show their title
// only — the server never sends a locked chapter's text to a reader.

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const STATE_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  locked: "lock-closed", available: "book-outline", in_progress: "create-outline",
  awaiting_review: "people-outline", completed: "checkmark-circle", preview: "eye-outline",
};

export default function KingdomStoryBookScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = makeStyles(c);
  // open=next: "Start / Continue Story" from discovery — open the reader at the
  // chapter the reader is up to (once; the book stays underneath for Back).
  const { id, open } = useLocalSearchParams<{ id: string; open?: string }>();
  const autoOpened = useRef(false);
  const [loading, setLoading] = useState(true);
  const [story, setStory] = useState<KingdomStory | null>(null);
  const [scripture, setScripture] = useState<ScriptureReference | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [mine, setMine] = useState<{ favourite: boolean; later: boolean }>({ favourite: false, later: false });

  // Reloaded whenever the book comes back into view, so finishing a chapter
  // updates the contents and progress straight away.
  useFocusEffect(useCallback(() => {
    if (!id) return;
    let live = true;
    getKingdomStory(id).then((st) => {
      if (!live) return;
      setStory(st);
      if (st.mine) setMine(st.mine);
      if (st.status === "published") markStoryOpened(st.id); // Recently viewed (never counts as progress)
      if (open === "next" && !autoOpened.current) {
        autoOpened.current = true;
        const chs = [...(st.chapters ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber);
        const target = (st.progress?.finished ? chs[0] : chs.find((ch) => ch.id === st.progress?.currentChapterId)) ?? chs[0];
        if (target && target.learning?.state !== "locked") router.push({ pathname: "/kingdom-stories/chapter", params: { id: st.id, chapter: target.id } } as any);
      }
      if (st.scriptureReferenceId) getScriptureReference(st.scriptureReferenceId).then((r) => live && setScripture(r)).catch(() => {});
    }).catch((e: any) => { if (live && !story) showAlert("Couldn't open this story", e?.message ?? "Please try again."); })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]));

  if (loading) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={c.accentGreen} /></View>;
  if (!story) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><Text style={s.muted}>This story isn't available.</Text></View>;

  const chapters = [...(story.chapters ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const media = story.media ?? [];
  const cover = media.find((m) => m.isCover && m.mediaType === "image") ?? media.find((m) => !m.chapterId && m.mediaType === "image") ?? null;
  // Story Overview image (migration 215 role) sits with the introduction, not in the gallery.
  const overview = media.find((m) => m.role === "overview" && m.mediaType === "image") ?? null;
  const gallery = media.filter((m) => !m.chapterId && m.id !== cover?.id && m.id !== overview?.id);
  const intro = storyIntro(story.body);
  const prog = progressSummary(story.progress);
  const current = chapters.find((ch) => ch.id === story.progress?.currentChapterId) ?? null;
  const preview = story.status !== "published";
  const openChapter = (ch: KingdomStoryChapter) => {
    if (ch.learning?.state === "locked") return showAlert(`Chapter ${ch.chapterNumber} is locked`, lockedMessage(chapters, ch.id));
    router.push({ pathname: "/kingdom-stories/chapter", params: { id: story.id, chapter: ch.id } } as any);
  };
  const primary = !chapters.length ? null
    : story.progress?.finished ? { label: "Review Story", ch: chapters[0], icon: "refresh" as const }
    : story.progress?.started && current ? { label: `Continue Reading · Chapter ${current.chapterNumber}`, ch: current, icon: "book" as const }
    : { label: "Start Reading", ch: chapters[0], icon: "book-outline" as const };
  const credits = media.filter((m) => m.caption || m.sourceUrl || m.licenseNote);
  const chapterNo = new Map(chapters.map((ch) => [ch.id, ch.chapterNumber]));

  // Share in a P2P chat or outside P2P (ShareStorySheet) — the story only, never progress.
  function handleShare() { setShareOpen(true); }
  // Favourite / Saved for Later: shown at once, undone if the server refuses.
  async function toggleSave(kind: "favourite" | "later") {
    const on = !mine[kind];
    setMine((m) => ({ ...m, [kind]: on }));
    try { await (on ? saveStory(story!.id, kind) : unsaveStory(story!.id, kind)); }
    catch (e: any) { setMine((m) => ({ ...m, [kind]: !on })); showAlert("Couldn't update your library", e?.message ?? "Please try again."); }
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button" style={s.iconBtn}>
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={s.headerType} numberOfLines={1}>{story.category?.title ?? (story.contentType ? CONTENT_TYPE_LABELS[story.contentType] : "Kingdom Story")}</Text>
        <TouchableOpacity onPress={handleShare} accessibilityLabel="Share" accessibilityRole="button" style={s.iconBtn}>
          <Ionicons name="share-outline" size={20} color={c.textDark} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {preview && (
          // Only editors can open an unpublished story: this is their reader preview.
          <View style={s.previewBanner}>
            <Ionicons name="eye-outline" size={14} color={c.textDark} />
            <Text style={s.previewText}>Preview — readers can't see this story until it is published. Activities open once it is published.</Text>
          </View>
        )}

        <View style={s.page}>
          {cover ? <StoryImage media={cover} aspectRatio={1} rounded={18} /> : null}

          {formatTopicNumber(story.topicNumber) ? <Text style={s.topicNo}>{formatTopicNumber(story.topicNumber)}</Text> : null}
          <Text style={s.title} accessibilityRole="header">{story.title}</Text>
          {!!story.subtitle && <Text style={s.subtitle}>{story.subtitle}</Text>}
          <Text style={s.meta}>
            {[story.category?.title, story.historicalPeriod, story.location, chapters.length ? `${chapters.length} chapters` : null].filter(Boolean).join(" · ")}
          </Text>

          {!!prog.total && !preview && (
            <View style={s.progressBox} accessible accessibilityLabel={`Reading progress: ${prog.label}${story.progress?.awaitingReviewChapters ? `, ${story.progress.awaitingReviewChapters} awaiting peer review` : ""}`}>
              <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(prog.fraction * 100)}%` }]} /></View>
              <Text style={s.progressText}>
                {story.progress?.finished ? "Story finished · " : ""}{prog.label}
                {story.progress?.awaitingReviewChapters ? ` · ${story.progress.awaitingReviewChapters} awaiting peer review` : ""}
              </Text>
            </View>
          )}

          {primary && (
            // Study Alone = your own reading; Study Together = a shared study
            // with a peer or your group (each person keeps their own progress).
            <View style={s.studyModes}>
              <TouchableOpacity style={[s.primaryBtn, s.studyModeBtn]} onPress={() => openChapter(primary.ch)} accessibilityRole="button" accessibilityHint="Study alone">
                <Ionicons name={primary.icon} size={18} color="#fff" />
                <View style={{ flexShrink: 1 }}>
                  <Text style={s.studyModeLabel}>Study Alone</Text>
                  <Text style={s.primaryBtnText} numberOfLines={1}>{primary.label}</Text>
                </View>
              </TouchableOpacity>
              {!preview ? (
                <TouchableOpacity style={[s.primaryBtn, s.studyModeBtn, s.togetherBtn]} onPress={() => setStudyOpen(true)} accessibilityRole="button" accessibilityLabel="Study Together" accessibilityHint="Invite a peer or start a study with your group">
                  <Ionicons name="people-outline" size={18} color={c.primaryGreen ?? c.accentGreen} />
                  <View style={{ flexShrink: 1 }}>
                    <Text style={[s.studyModeLabel, { color: c.textMuted }]}>With others</Text>
                    <Text style={[s.primaryBtnText, { color: c.primaryGreen ?? c.accentGreen }]}>Study Together</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {!preview && (
            <View style={s.libraryRow}>
              <TouchableOpacity style={[s.libraryBtn, mine.favourite && s.libraryBtnOn]} onPress={() => toggleSave("favourite")}
                accessibilityRole="button" accessibilityState={{ selected: mine.favourite }} accessibilityLabel={mine.favourite ? "Remove from My Favourites" : "Add to My Favourites"}>
                <Ionicons name={mine.favourite ? "heart" : "heart-outline"} size={18} color={mine.favourite ? "#E11D48" : c.textMid} />
                <Text style={s.libraryText}>Favourite</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.libraryBtn, mine.later && s.libraryBtnOn]} onPress={() => toggleSave("later")}
                accessibilityRole="button" accessibilityState={{ selected: mine.later }} accessibilityLabel={mine.later ? "Remove from Saved for Later" : "Save for Later"}>
                <Ionicons name={mine.later ? "bookmark" : "bookmark-outline"} size={18} color={mine.later ? c.accentGreen : c.textMid} />
                <Text style={s.libraryText}>{mine.later ? "Saved" : "Save for Later"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.libraryBtn} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share this story">
                <Ionicons name="share-social-outline" size={18} color={c.textMid} />
                <Text style={s.libraryText}>Share</Text>
              </TouchableOpacity>
            </View>
          )}

          {(intro.theme || intro.scripture.length > 0 || intro.paragraphs.length > 0) && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Introduction</Text>
              {overview ? <StoryImage media={overview} /> : null}
              {!!intro.theme && <Text style={s.theme}>{intro.theme}</Text>}
              {intro.scripture.map((line, i) => <ScriptureChips key={i} line={line} label={i === 0 ? "Primary Scripture" : "Supporting Scripture"} />)}
              {intro.paragraphs.map((p, i) => <Text key={i} style={s.body}>{p}</Text>)}
            </View>
          )}

          {scripture && (
            <TouchableOpacity style={s.scriptureRow}
              onPress={() => router.push({ pathname: "/prayer/study/[scriptureId]", params: { scriptureId: scripture.id, topicTitle: story.title } } as any)}>
              <Ionicons name="book" size={14} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.scriptureText}>{scripture.referenceDisplay}</Text>
                <Text style={s.scriptureSub}>Study this Scripture</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.accentGreen} />
            </TouchableOpacity>
          )}

          {chapters.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel} accessibilityRole="header">Contents</Text>
              {chapters.map((ch) => {
                const st = ch.learning?.state ?? "available";
                const locked = st === "locked";
                const isCurrent = !preview && ch.id === story.progress?.currentChapterId && !story.progress?.finished;
                const thumb = media.find((m) => m.chapterId === ch.id && m.mediaType === "image");
                return (
                  <TouchableOpacity key={ch.id} style={[s.tocRow, isCurrent && s.tocCurrent]} onPress={() => openChapter(ch)}
                    accessibilityRole="button" accessibilityLabel={`Chapter ${ch.chapterNumber}: ${ch.title}. ${STATE_LABEL[st]}${locked ? `. ${lockedMessage(chapters, ch.id)}` : ""}`}>
                    <View style={[s.tocThumb, locked && { opacity: 0.45 }]}>
                      {thumb ? <StoryImage media={thumb} aspectRatio={1} rounded={10} thumb showCaption={false} />
                        : <View style={s.tocNum}><Text style={s.tocNumText}>{ch.chapterNumber}</Text></View>}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.tocKicker}>Chapter {ch.chapterNumber}{isCurrent ? " · Up next" : ""}</Text>
                      <Text style={[s.tocTitle, locked && { color: c.textMuted }]} numberOfLines={2}>{ch.title || `Chapter ${ch.chapterNumber}`}</Text>
                      <View style={s.stateRow}>
                        <Ionicons name={STATE_ICON[st]} size={13} color={st === "completed" ? c.accentGreen : c.textMuted} />
                        <Text style={[s.stateText, st === "completed" && { color: c.accentGreen }]}>{locked ? lockedMessage(chapters, ch.id) : STATE_LABEL[st]}</Text>
                      </View>
                    </View>
                    <Ionicons name={locked ? "lock-closed-outline" : "chevron-forward"} size={16} color={c.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {!chapters.length && <StoryWithoutChapters story={story} s={s} />}

          {gallery.length > 0 && <View style={{ marginTop: 18, marginHorizontal: -20 }}><KingdomStoryMediaGallery media={gallery} /></View>}

          {(story.related?.missionField || story.related?.missionStory || story.related?.curriculum || story.related?.kingdomWin) && (
            <View style={s.actionsRow}>
              {story.related?.missionField && (
                <TouchableOpacity style={s.actionBtn} onPress={() => router.push(`/missions/field/${story.related!.missionField!.slug}` as any)}>
                  <Ionicons name="flag-outline" size={16} color={c.textMuted} /><Text style={s.actionText}>Explore Missions</Text>
                </TouchableOpacity>
              )}
              {story.related?.missionStory && (
                <TouchableOpacity style={s.actionBtn} onPress={() => router.push(`/missions/story/${story.related!.missionStory!.id}` as any)}>
                  <Ionicons name="flag-outline" size={16} color={c.textMuted} /><Text style={s.actionText}>Mission Story</Text>
                </TouchableOpacity>
              )}
              {story.related?.curriculum && (
                <TouchableOpacity style={s.actionBtn} onPress={() => router.push(`/curriculum/${story.related!.curriculum!.id}` as any)}>
                  <Ionicons name="school-outline" size={16} color={c.textMuted} /><Text style={s.actionText}>Study This</Text>
                </TouchableOpacity>
              )}
              {story.related?.kingdomWin && (
                <TouchableOpacity style={s.actionBtn} onPress={() => router.push(`/kingdom-wins/${story.related!.kingdomWin!.id}` as any)}>
                  <Ionicons name="sparkles-outline" size={16} color={c.textMuted} /><Text style={s.actionText}>Kingdom Win</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {story.related?.story && (
            <TouchableOpacity style={s.relatedCard} onPress={() => router.push(`/kingdom-stories/${story.related!.story!.id}` as any)}>
              <Ionicons name="book-outline" size={14} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.relatedLabel}>Related Kingdom Story</Text>
                <Text style={s.relatedTitle}>{story.related.story.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          )}

          {/* Before and after this story in its category's order (published stories only). */}
          {!preview && (story.sequence?.previous || story.sequence?.next) ? (
            <View style={s.section}>
              <Text style={s.sectionLabel} accessibilityRole="header">In biblical order</Text>
              {([["previous", "Before this story", "arrow-back"], ["next", "Next in the story", "arrow-forward"]] as const).map(([key, label, icon]) => {
                const link = story.sequence?.[key];
                if (!link) return null;
                return (
                  <TouchableOpacity key={key} style={s.relatedCard} onPress={() => router.push(`/kingdom-stories/${link.id}` as any)}
                    accessibilityRole="button" accessibilityLabel={`${label}: ${[formatTopicNumber(link.topicNumber), link.title].filter(Boolean).join(", ")}`}>
                    <Ionicons name={icon} size={14} color={c.accentGreen} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.relatedLabel}>{[label, formatTopicNumber(link.topicNumber)].filter(Boolean).join(" · ")}</Text>
                      <Text style={s.relatedTitle}>{link.title}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {(!!story.sources?.some((x) => !x.chapterId) || credits.length > 0) && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Sources & credits</Text>
              {(story.sources ?? []).filter((x) => !x.chapterId).map((x) => (
                <View key={x.id} style={s.sourceRow}>
                  <Text style={s.sourceTitle}>{x.title}</Text>
                  {!!(x.publisher || x.citation) && <Text style={s.sourceMeta}>{[x.publisher, x.citation].filter(Boolean).join(" · ")}</Text>}
                </View>
              ))}
              {credits.map((m) => <CreditRow key={m.id} m={m} chapter={m.chapterId ? chapterNo.get(m.chapterId) : undefined} s={s} />)}
            </View>
          )}
        </View>
      </ScrollView>
      <ShareStorySheet visible={shareOpen} onClose={() => setShareOpen(false)} story={story} />
      <SharedStudySheet visible={studyOpen} onClose={() => setStudyOpen(false)} content={{ type: "kingdom_story", id: story.id, title: story.title }}
        onStarted={(sid) => { setStudyOpen(false); router.push(`/study-together/${sid}` as any); }} />
    </View>
  );
}

function CreditRow({ m, chapter, s }: { m: KingdomStoryMedia; chapter?: number; s: ReturnType<typeof makeStyles> }) {
  const where = chapter ? `Chapter ${chapter} illustration` : m.isCover ? "Cover image" : "Image";
  return (
    <View style={s.sourceRow}>
      <Text style={s.sourceTitle}>{where}{m.imageKind && m.imageKind !== "other" ? ` · ${IMAGE_KIND_LABELS[m.imageKind]}` : ""}</Text>
      <Text style={s.sourceMeta}>{[m.caption, m.licenseNote, m.sourceUrl].filter(Boolean).join(" · ") || "Credit not recorded"}</Text>
    </View>
  );
}

// Older stories without chapters keep their single-page text.
function StoryWithoutChapters({ story, s }: { story: KingdomStory; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.section}>
      {!!story.learningSection && <><Text style={s.sectionLabel}>What can we learn?</Text><Text style={s.body}>{story.learningSection}</Text></>}
      {!!story.reflection && <><Text style={s.sectionLabel}>Reflection</Text><Text style={s.body}>{story.reflection}</Text></>}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center" },
    muted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, marginBottom: 4 },
    iconBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    headerType: { flex: 1, textAlign: "center", fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },
    previewBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 10, borderRadius: 10, backgroundColor: "rgba(234,179,8,0.18)" },
    previewText: { flex: 1, fontSize: 12, color: c.textDark, fontFamily: "Inter_500Medium" },
    page: { paddingHorizontal: 16, maxWidth: 720, width: "100%", alignSelf: "center" },
    topicNo: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 1, textTransform: "uppercase", textAlign: "left", marginTop: 18 },
    libraryRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 12, flexWrap: "wrap" },
    libraryBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    libraryBtnOn: { borderColor: c.accentGreen },
    libraryText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    title: { fontSize: 28, lineHeight: 34, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontWeight: "700", marginTop: 18, textAlign: "left" },
    subtitle: { fontSize: 16, lineHeight: 23, color: c.textMid, fontFamily: SCRIPTURE_FONT, fontStyle: "italic", marginTop: 8, textAlign: "left" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 10, textAlign: "left" },
    progressBox: { marginTop: 16, gap: 6 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.borderBeige, overflow: "hidden" },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: c.accentGreen },
    progressText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium", textAlign: "left" },
    primaryBtn: { marginTop: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen ?? c.accentGreen, borderRadius: 14, minHeight: 52, paddingHorizontal: 16 },
    primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
    studyModes: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
    studyModeBtn: { marginTop: 0, flexGrow: 1, flexBasis: 220, justifyContent: "flex-start", paddingVertical: 8 },
    togetherBtn: { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.primaryGreen ?? c.accentGreen },
    studyModeLabel: { fontSize: 11, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
    section: { marginTop: 28, gap: 10 },
    sectionLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.8 },
    theme: { fontSize: 17, lineHeight: 26, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontStyle: "italic" },
    body: { fontSize: 16, lineHeight: 26, color: c.textMid, fontFamily: SCRIPTURE_FONT },
    scriptureRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16 },
    scriptureText: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    scriptureSub: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_400Regular", marginTop: 1 },
    tocRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    tocCurrent: { backgroundColor: c.card, borderWidth: 1, borderColor: c.accentGreen },
    tocThumb: { width: 56, height: 56 },
    tocNum: { flex: 1, borderRadius: 10, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
    tocNumText: { fontSize: 18, color: c.accentGreen, fontFamily: SCRIPTURE_FONT, fontWeight: "700" },
    tocKicker: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
    tocTitle: { fontSize: 16, lineHeight: 21, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontWeight: "600" },
    stateRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
    stateText: { flex: 1, fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 20 },
    actionBtn: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 12, minHeight: 40 },
    actionText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    relatedCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginTop: 20 },
    relatedLabel: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    relatedTitle: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 1 },
    sourceRow: { paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: c.borderBeige, gap: 2 },
    sourceTitle: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sourceMeta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
