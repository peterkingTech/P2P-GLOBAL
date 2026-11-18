import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { StudyState as StateView, SectionTitle } from "@/components/study/StudyUI";
import SaveScriptureSheet, { type SaveTarget } from "@/components/library/SaveScriptureSheet";
import { addHighlight, bibleRoute, bookByCode, formatRef, getMyChapter } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import {
  STUDY_GROUPS, createStudy, getStudy, markStudyOpened, searchStudy, updateStudy,
  type Finding, type SavedStudy, type StudyGroup, type StudyResults, type StudyState,
} from "@/lib/studyWorkspaceApi";
import { enqueue, isNetworkError, kvGet, kvSet, newKey } from "@/lib/offline";
import SyncStatusBanner from "@/components/offline/SyncStatusBanner";
import { setStudyOverlay, useStudyOverlay } from "@/lib/studyOverlay";
import MeaningPanel from "@/components/study/MeaningPanel";
import NamesSection from "@/components/study/NamesSection";

// MY PLAN — PERSONAL BIBLE STUDY WORKSPACE (owner brief 2026-11-18 §5–6). Type any word, subject or question;
// findings arrive in eight groups (Scriptures, Bible Stories, Definitions, Greek and Hebrew, Commentaries,
// Cross-references, Historical Context, My notes & playlists — Biblical Themes removed 2026-11-18, owner), each with a count, WHY it is there and its SOURCE
// (api-server lib/studySearch — source-grounded only). The person keeps what helps: saved findings, notes and
// TEMPORARY study highlights (grouped Old/New Testament and direct/related). Study highlights are never written
// into the person's Bible highlights unless they choose "Save as my highlights" — and then verses they have
// already highlighted are left exactly as they are. Everything is saved to Deep Study History (offline-safe:
// kept on the phone and sent once when the connection returns).

type Match = "all" | "direct" | "conceptual" | "background";
type StudyHl = NonNullable<StudyState["studyHighlights"]>[number];
type SavedFinding = NonNullable<StudyState["findings"]>[number];


const passageOf = (f: { ref: Record<string, unknown> }) => {
  const r = f.ref as { book?: string; chapter?: number; startVerse?: number; endVerse?: number };
  return r.book && r.chapter ? { book: r.book, chapter: r.chapter, startVerse: r.startVerse ?? 1, endVerse: r.endVerse ?? r.startVerse ?? 1 } : null;
};

export default function StudyWorkspace() {
  const p = useLocalSearchParams<{ id?: string; q?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);

  const [study, setStudy] = useState<SavedStudy | null>(null);
  const [clientKey] = useState(() => newKey("study"));
  const [title, setTitle] = useState("");
  const [q, setQ] = useState(p.q ? String(p.q) : "");
  const [results, setResults] = useState<StudyResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<StudyGroup | "all">("all");
  const [match, setMatch] = useState<Match>("all");
  const [saved, setSaved] = useState<SavedFinding[]>([]);
  const [hls, setHls] = useState<StudyHl[]>([]);
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SavedStudy | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SaveTarget[] | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (m: string) => { setMessage(m); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setMessage(null), 4000); };

  useEffect(() => { loadPosition().then((pos) => setTranslation(pos?.translation ?? null)).catch(() => {}); }, []);

  const apply = (st: SavedStudy) => {
    setStudy(st); setTitle(st.title); setQ(st.state?.q ?? ""); setSaved(st.state?.findings ?? []); setHls(st.state?.studyHighlights ?? []);
    setNotes(st.notes ?? ""); setDirty(false);
    if (st.state?.filters?.[0] && (STUDY_GROUPS as string[]).includes(st.state.filters[0])) setGroup(st.state.filters[0] as StudyGroup); // an old study filtered on a removed group opens on All
  };
  // Reopen (from Deep Study History): the server copy, or the copy kept on this phone when offline.
  useEffect(() => {
    if (!p.id) return;
    const id = String(p.id);
    getStudy(id).then((r) => { apply(r.study); void kvSet(`study:${id}`, r.study); void markStudyOpened(id); if (r.study.state?.q) void run(r.study.state.q); })
      .catch(async (e) => {
        const local = await kvGet<SavedStudy>(`study:${id}`);
        if (local) { apply(local); flash(t("study.offlineCopy", { defaultValue: "You're offline — this is the copy saved on this phone." })); }
        else setError(e?.message ?? t("study.openFailed", { defaultValue: "Couldn't open this study." }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const run = useCallback(async (query: string) => {
    const qq = query.trim();
    if (qq.length < 2) return;
    setLoading(true); setError(null);
    try {
      const r = await searchStudy(qq, translation ?? undefined);
      setResults(r);
      void kvSet(`study:search:${qq.toLowerCase()}`, r);
    } catch (e) {
      const local = isNetworkError(e) ? await kvGet<StudyResults>(`study:search:${qq.toLowerCase()}`) : null;
      if (local) { setResults(local); flash(t("study.offlineResults", { defaultValue: "You're offline — showing the results saved on this phone." })); }
      else setError(isNetworkError(e) ? t("study.needsInternet", { defaultValue: "Searching needs an internet connection. Your saved studies still open offline." }) : (e as Error)?.message ?? "");
    } finally { setLoading(false); }
  }, [translation, t]);
  useEffect(() => { if (p.q && !p.id) void run(String(p.q)); /* first open with a subject */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => (results?.findings ?? []).filter((f) => (group === "all" || f.group === group) && (match === "all" || f.match === match)), [results, group, match]);
  const isSaved = (k: string) => saved.some((x) => x.key === k);
  const toggleSave = (f: Finding) => {
    setDirty(true);
    setSaved((cur) => cur.some((x) => x.key === f.key) ? cur.filter((x) => x.key !== f.key)
      : [...cur, { key: f.key, kind: f.kind, ref: f.ref, title: f.title, why: whyText(f), savedAt: new Date().toISOString() }]);
  };
  const isHl = (f: Finding) => { const ps = passageOf(f); return !!ps && hls.some((h) => h.book === ps.book && h.chapter === ps.chapter && h.startVerse === ps.startVerse && h.endVerse === ps.endVerse); };
  const toggleHl = (f: Finding) => {
    const ps = passageOf(f); if (!ps) return;
    setDirty(true);
    setHls((cur) => isHl(f) ? cur.filter((h) => !(h.book === ps.book && h.chapter === ps.chapter && h.startVerse === ps.startVerse && h.endVerse === ps.endVerse))
      : [...cur, { ...ps, group: f.match === "direct" ? "direct" : "related" }]);
  };

  const whyText = (f: Finding) => t(`study.why.${f.why.code}`, { defaultValue: WHY_DEFAULT[f.why.code] ?? "", ...(f.why.params ?? {}) });
  const open = (f: { kind: string; ref: Record<string, unknown> }) => {
    const r = f.ref as Record<string, any>;
    switch (f.kind) {
      case "bible_passage": return router.push(bibleRoute({ book: r.book, chapter: r.chapter, v: r.startVerse, ve: r.endVerse, translation }) as any);
      case "kingdom_story": return router.push(`/kingdom-stories/${r.id}` as any);
      case "reference_article": return router.push({ pathname: "/dictionary/article/[id]", params: { id: r.id } } as any);
      case "dictionary_term": return router.push({ pathname: "/dictionary/term/[key]", params: { key: r.key } } as any);
      case "commentary": return router.push({ pathname: "/deep-study", params: { book: r.book, chapter: String(r.chapter), tab: "commentaries" } } as any);
      case "deep_study": return router.push({ pathname: "/deep-study", params: { book: r.book, chapter: String(r.chapter), tab: r.tab === "original" ? "original" : "xref",
        ...(r.startVerse ? { v: String(r.startVerse), ve: String(r.endVerse ?? r.startVerse) } : {}), ...(translation ? { t: translation } : {}) } } as any);
      case "my_playlist": return router.push({ pathname: "/scripture-collections/[id]", params: { id: r.id } } as any);
      case "scripture_topic": return router.push({ pathname: "/bible-study/topic/[slug]", params: { slug: r.slug } } as any);
      case "concept": { const next = String(r.q ?? ""); setQ(next); return void run(next); }
    }
  };

  // ── Save to Deep Study History ──
  const stateNow = (): StudyState => ({ q: q.trim() || undefined, findings: saved, studyHighlights: hls, filters: group === "all" ? [] : [group] });
  async function save() {
    const name = title.trim() || q.trim() || t("study.untitled", { defaultValue: "My study" });
    setSaving(true);
    try {
      if (study) {
        const r = await updateStudy(study.id, { baseVersion: study.version, title: name, state: stateNow(), notes: notes || null });
        apply(r.study); void kvSet(`study:${r.study.id}`, r.study);
      } else {
        const r = await createStudy({ clientKey, kind: "my_plan", title: name, focus: { q: q.trim() }, state: stateNow(), notes: notes || null });
        apply(r.study); void kvSet(`study:${r.study.id}`, r.study);
      }
      flash(t("study.saved", { defaultValue: "Saved to Deep Study History." }));
    } catch (e: any) {
      if (isNetworkError(e)) {
        // Kept on this phone and sent once the connection returns (the client key prevents a duplicate).
        if (study) await enqueue({ id: `study.update:${study.id}`, type: "study.update", payload: { id: study.id, baseVersion: study.version, title: name, state: stateNow(), notes: notes || null }, label: name });
        else await enqueue({ id: clientKey, type: "study.create", payload: { clientKey, kind: "my_plan", title: name, focus: { q: q.trim() }, state: stateNow(), notes: notes || null }, label: name });
        setDirty(false);
        flash(t("study.savedOffline", { defaultValue: "Saved on this phone — it will sync when you're back online." }));
      } else if (e?.status === 409 && e?.current) {
        setConflict(e.current as SavedStudy); // never overwrite: the person chooses
      } else flash(e?.message ?? t("study.saveFailed", { defaultValue: "Couldn't save the study." }));
    } finally { setSaving(false); }
  }
  async function keepMine() {
    if (!conflict) return;
    setStudy(conflict); setConflict(null);
    try { const r = await updateStudy(conflict.id, { baseVersion: conflict.version, title: title.trim() || conflict.title, state: stateNow(), notes: notes || null }); apply(r.study); flash(t("study.saved", { defaultValue: "Saved to Deep Study History." })); }
    catch (e: any) { flash(e?.message ?? ""); }
  }
  const keepTheirs = () => { if (conflict) apply(conflict); setConflict(null); };

  // ── Study highlights → my highlights (verses I already highlighted stay exactly as they are) ──
  async function saveAsMine() {
    if (!translation) { flash(t("study.pickTranslation", { defaultValue: "Open the Bible once to choose a translation first." })); return; }
    setSaving(true);
    let added = 0, skipped = 0;
    try {
      const byChapter = new Map<string, StudyHl[]>();
      for (const h of hls) { const k = `${h.book}.${h.chapter}`; byChapter.set(k, [...(byChapter.get(k) ?? []), h]); }
      for (const list of byChapter.values()) {
        const mine = await getMyChapter(translation, list[0].book, list[0].chapter);
        if (!mine.available) { flash(t("study.highlightsUnavailable", { defaultValue: "Highlights aren't available for this translation." })); return; }
        const taken = new Set<number>();
        for (const m of mine.highlights) for (let v = m.startVerse; v <= m.endVerse; v++) taken.add(v);
        for (const h of list) {
          // Split around verses already highlighted, so nothing of theirs is replaced.
          let runStart: number | null = null;
          const flush = async (end: number) => { if (runStart !== null) { await addHighlight({ translationCode: translation, bookCode: h.book, chapter: h.chapter, startVerse: runStart, endVerse: end }, "gold"); added++; runStart = null; } };
          for (let v = h.startVerse; v <= h.endVerse; v++) {
            if (taken.has(v)) { skipped++; await flush(v - 1); } else if (runStart === null) runStart = v;
          }
          await flush(h.endVerse);
        }
      }
      flash(skipped
        ? t("study.highlightsSavedSkipped", { defaultValue: "{{added}} saved to your highlights. {{skipped}} verses you'd already highlighted were left as they are.", added, skipped })
        : t("study.highlightsSaved", { defaultValue: "{{added}} saved to your highlights.", added }));
    } catch (e: any) {
      flash(isNetworkError(e) ? t("study.needsInternetHl", { defaultValue: "Saving to your highlights needs an internet connection." }) : e?.message ?? "");
    } finally { setSaving(false); }
  }
  const playlistTargets = (): SaveTarget[] => !translation ? [] : hls.map((h) => ({
    ref: { translationCode: translation, bookCode: h.book, chapter: h.chapter, startVerse: h.startVerse, endVerse: h.endVerse },
    reference: formatRef(bookByCode(h.book), h.chapter, h.startVerse, h.endVerse),
  }));

  // Grouped by the person's OWN areas (they choose them — nothing is auto-classified), or by Old / New
  // Testament then direct / related.
  const [groupBy, setGroupBy] = useState<"area" | "testament">("testament");
  const [areaFor, setAreaFor] = useState<StudyHl | null>(null);
  const [newArea, setNewArea] = useState("");
  const areas = useMemo(() => [...new Set(hls.map((h) => h.area).filter((a): a is string => !!a))], [hls]);
  const setArea = (h: StudyHl, area: string | null) => { setDirty(true); setHls((cur) => cur.map((x) => (x === h ? { ...x, area } : x))); setAreaFor(null); setNewArea(""); };
  const hlGroups = useMemo(() => {
    const out: { key: string; label: string; items: StudyHl[] }[] = [];
    if (groupBy === "area") {
      for (const a of areas) out.push({ key: `area-${a}`, label: a, items: hls.filter((h) => h.area === a) });
      const none = hls.filter((h) => !h.area);
      if (none.length) out.push({ key: "area-none", label: t("study.noArea", { defaultValue: "Not in an area yet" }), items: none });
      return out;
    }
    for (const tm of ["OT", "NT"] as const) for (const g of ["direct", "related"] as const) {
      const items = hls.filter((h) => bookByCode(h.book)?.testament === tm && (h.group ?? "related") === g);
      if (items.length) out.push({ key: `${tm}-${g}`, label: `${t(`study.testament.${tm}`, { defaultValue: tm === "OT" ? "Old Testament" : "New Testament" })} · ${t(`study.match.${g}`, { defaultValue: g === "direct" ? "Direct" : "Related" })}`, items });
    }
    return out;
  }, [hls, t, groupBy, areas]);
  // Show this study's passages in the Bible reader (temporary; off by default; lib/studyOverlay).
  const overlay = useStudyOverlay();
  const overlayOn = !!overlay && (overlay.studyId ? overlay.studyId === study?.id : overlay.title === (title.trim() || q.trim()));
  const toggleOverlay = () => void setStudyOverlay(overlayOn ? null : { title: title.trim() || q.trim() || t("study.untitled", { defaultValue: "My study" }), studyId: study?.id ?? null, passages: hls });
  // Keep the shown passages in step while the study changes.
  useEffect(() => { if (overlayOn) void setStudyOverlay({ title: overlay!.title, studyId: overlay!.studyId, passages: hls }); }, [hls]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <>
      <Stack.Screen options={{ title: t("study.title", { defaultValue: "My Plan · Study" }), headerRight: () => (
        <IconButton icon="time-outline" accessibilityLabel={t("study.historyOpen", { defaultValue: "Deep Study History" })} onPress={() => router.push("/study/history" as any)} />
      ) }} />
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 14, maxWidth: 820, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <SyncStatusBanner />

        <TextInput value={title} onChangeText={(v) => { setTitle(v); setDirty(true); }} placeholder={t("study.titlePlaceholder", { defaultValue: "Name this study (optional)" })}
          placeholderTextColor={c.textMuted} style={s.title} accessibilityLabel={t("study.titleLabel", { defaultValue: "Study name" })} />
        <View style={s.searchRow}>
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => run(q)} returnKeyType="search" style={s.search}
            placeholder={t("study.searchPlaceholder2", { defaultValue: "A word, phrase, question or reference: grace, John 3:16" })} placeholderTextColor={c.textMuted}
            accessibilityLabel={t("study.searchLabel", { defaultValue: "Search the Bible and study tools" })} />
          <AppButton label={t("study.search", { defaultValue: "Study" })} icon="search" onPress={() => run(q)} disabled={q.trim().length < 2} loading={loading} />
        </View>

        {results?.meaning?.terms?.length ? (
          <MeaningPanel meaning={results.meaning} translation={translation} onStudyWord={(w) => { setQ(w); void run(w); }} />
        ) : null}
        {results?.names ? <NamesSection names={results.names} /> : null}

        {results ? (
          <>
            {results.meaning?.terms?.length || results.names ? <Text style={s.groupHead}>{t("study.meaning.everything", { defaultValue: "Everything in Bible Study for your search" })}</Text> : null}
            <ChipRow accessibilityLabel={t("study.groupsLabel", { defaultValue: "Result groups" })} single>
              <FilterChip label={`${t("study.all", { defaultValue: "All" })} ${results.findings.length}`} selected={group === "all"} selection="single" onPress={() => setGroup("all")} />
              {STUDY_GROUPS.map((g) => (
                <FilterChip key={g} label={`${t(`study.group.${g}`, { defaultValue: GROUP_DEFAULT[g] })} ${results.counts[g] ?? 0}`} selected={group === g} selection="single"
                  disabled={!results.counts[g]} onPress={() => setGroup(g)} />
              ))}
            </ChipRow>
            <ChipRow accessibilityLabel={t("study.matchLabel", { defaultValue: "How each result connects" })} single>
              {(["all", "direct", "conceptual", "background"] as Match[]).map((m) => (
                <FilterChip key={m} label={t(`study.matchFilter.${m}`, { defaultValue: MATCH_DEFAULT[m] })} selected={match === m} selection="single" onPress={() => setMatch(m)} />
              ))}
            </ChipRow>
            {results.bibleTotal != null ? <Text style={s.note}>{t("study.bibleTotal", { defaultValue: "The words appear in {{count}} verses of the Bible text — the first are shown.", count: results.bibleTotal })}</Text> : null}
            {results.bibleNote ? <Text style={s.note}>{results.bibleNote}</Text> : null}
            {results.concepts?.length ? (
              <View style={{ gap: 6 }}>
                <Text style={s.groupHead}>{t("study.connected", { defaultValue: "Connected concepts" })}</Text>
                <ChipRow accessibilityLabel={t("study.connected", { defaultValue: "Connected concepts" })}>
                  {results.concepts.map((cpt) => <FilterChip key={cpt} label={cpt} selected={false} icon="git-network-outline" onPress={() => { setQ(cpt); void run(cpt); }}
                    accessibilityLabel={t("study.searchConcept", { defaultValue: "Study {{concept}}", concept: cpt })} />)}
                </ChipRow>
                <Text style={s.note}>{t("study.connectedNote2", { defaultValue: "Each link has a source: Easton's Bible Dictionary, how the original Greek and Hebrew words are translated, or passages P2P editors chose for both topics." })}</Text>
              </View>
            ) : null}
          </>
        ) : null}

        <StateView loading={loading && !results} error={error} onRetry={() => run(q)}
          empty={results && !shown.length ? t("study.none", { defaultValue: "Nothing found here. Try another word, or a related subject." }) : null} />

        {shown.map((f) => (
          <View key={f.key} style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.groupTag}>{t(`study.group.${f.group}`, { defaultValue: GROUP_DEFAULT[f.group] })} · {t(`study.match.${f.match}`, { defaultValue: MATCH_DEFAULT[f.match] })}</Text>
              <IconButton icon={isSaved(f.key) ? "bookmark" : "bookmark-outline"} size="sm" selected={isSaved(f.key)}
                accessibilityLabel={isSaved(f.key) ? t("study.unsave", { defaultValue: "Remove from this study" }) : t("study.save", { defaultValue: "Keep in this study" })} onPress={() => toggleSave(f)} />
            </View>
            <Text style={s.cardTitle}>{f.title}</Text>
            {f.subtitle ? <Text style={s.cardSub} numberOfLines={4}>{f.subtitle}</Text> : null}
            <Text style={s.why}>{t("study.whyLabel", { defaultValue: "Why:" })} {whyText(f)}</Text>
            <Text style={s.source}>{t("study.sourceLabel", { defaultValue: "Source:" })} {f.source}</Text>
            <View style={s.actions}>
              <AppButton label={f.kind === "bible_passage" ? t("study.readChapter", { defaultValue: "Read in the Bible" }) : t("study.open", { defaultValue: "Open" })} size="sm" variant="secondary" onPress={() => open(f)} />
              {f.kind === "bible_passage" ? (
                <>
                  <AppButton label={t("study.compareTr", { defaultValue: "Compare" })} size="sm" variant="outline" icon="git-compare-outline" onPress={() => {
                    const ps = passageOf(f)!; router.push(bibleRoute({ book: ps.book, chapter: ps.chapter, v: ps.startVerse, ve: ps.endVerse, translation, compare: true }) as any);
                  }} />
                  <AppButton label={t("study.listen", { defaultValue: "Listen" })} size="sm" variant="outline" icon="headset-outline" onPress={() => {
                    const ps = passageOf(f)!; router.push(bibleRoute({ book: ps.book, chapter: ps.chapter, v: ps.startVerse, ve: ps.endVerse, translation, listen: true }) as any);
                  }} />
                  <AppButton label={isHl(f) ? t("study.unmark", { defaultValue: "Unmark" }) : t("study.mark", { defaultValue: "Study highlight" })} size="sm" variant={isHl(f) ? "primary" : "outline"} icon="color-wand-outline" onPress={() => toggleHl(f)} />
                  <AppButton label={t("study.addToPlaylistOne", { defaultValue: "Playlist" })} size="sm" variant="outline" icon="list-outline" onPress={() => {
                    const ps = passageOf(f)!;
                    if (!translation) return flash(t("study.pickTranslation", { defaultValue: "Open the Bible once to choose a translation first." }));
                    setSheet([{ ref: { translationCode: translation, bookCode: ps.book, chapter: ps.chapter, startVerse: ps.startVerse, endVerse: ps.endVerse }, reference: f.title }]);
                  }} />
                  <AppButton label={t("study.concordance", { defaultValue: "Concordance" })} size="sm" variant="tertiary" onPress={() => router.push({ pathname: "/concordance", params: { q: contentWordOf(q) } } as any)} />
                  <AppButton label={t("study.compare", { defaultValue: "Deep Study" })} size="sm" variant="tertiary" onPress={() => {
                    const ps = passageOf(f)!; router.push({ pathname: "/deep-study", params: { book: ps.book, chapter: String(ps.chapter), v: String(ps.startVerse), ve: String(ps.endVerse), ...(translation ? { t: translation } : {}) } } as any);
                  }} />
                </>
              ) : null}
            </View>
          </View>
        ))}

        {/* Study highlights (temporary, this study only) */}
        <SectionTitle>{t("study.highlightsTitle", { defaultValue: "Study highlights" })}</SectionTitle>
        <Text style={s.note}>{t("study.highlightsNote", { defaultValue: "These stay in this study. They don't change your Bible highlights unless you save them." })}</Text>
        {hls.length ? (
          <ChipRow accessibilityLabel={t("study.groupByLabel", { defaultValue: "Organise study highlights" })} single>
            <FilterChip label={t("study.byTestament", { defaultValue: "By Testament" })} selected={groupBy === "testament"} selection="single" onPress={() => setGroupBy("testament")} />
            <FilterChip label={t("study.byArea", { defaultValue: "By my areas" })} selected={groupBy === "area"} selection="single" onPress={() => setGroupBy("area")} />
          </ChipRow>
        ) : null}
        {hlGroups.length ? hlGroups.map((g) => (
          <View key={g.key} style={{ gap: 6 }}>
            <Text style={s.groupHead}>{g.label}</Text>
            {g.items.map((h) => {
              const ref = formatRef(bookByCode(h.book), h.chapter, h.startVerse, h.endVerse);
              return (
                <View key={ref} style={{ gap: 6 }}>
                  <View style={s.hlRow}>
                    <TouchableOpacity style={{ flex: 1 }} accessibilityRole="link" onPress={() => open({ kind: "bible_passage", ref: h })}>
                      <Text style={s.hlRef}>{ref}</Text>
                      {h.area ? <Text style={s.note}>{h.area}</Text> : null}
                    </TouchableOpacity>
                    <IconButton icon="folder-open-outline" size="sm" accessibilityLabel={t("study.chooseArea", { defaultValue: "Choose an area for {{ref}}", ref })} onPress={() => setAreaFor(areaFor === h ? null : h)} />
                    <IconButton icon="close" size="sm" accessibilityLabel={t("study.removeHl", { defaultValue: "Remove {{ref}}", ref })}
                      onPress={() => { setDirty(true); setHls((cur) => cur.filter((x) => x !== h)); }} />
                  </View>
                  {areaFor === h ? (
                    <View style={[s.card, { gap: 8 }]}>
                      <Text style={s.note}>{t("study.areaHelp", { defaultValue: "Put this passage in one of your own areas. You decide; nothing is sorted automatically." })}</Text>
                      <View style={s.actions}>
                        {[...new Set([...areas, ...SUGGESTED_AREAS.map((a) => t(`study.area.${a.key}`, { defaultValue: a.label }))])].map((a) => (
                          <FilterChip key={a} label={a} selected={h.area === a} selection="single" onPress={() => setArea(h, h.area === a ? null : a)} />
                        ))}
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <TextInput value={newArea} onChangeText={setNewArea} placeholder={t("study.newArea", { defaultValue: "Or name a new area" })} placeholderTextColor={c.textMuted}
                          style={[s.search, { minHeight: 44 }]} maxLength={60} accessibilityLabel={t("study.newArea", { defaultValue: "Or name a new area" })} />
                        <AppButton label={t("common.save", { defaultValue: "Save" })} size="sm" disabled={!newArea.trim()} onPress={() => setArea(h, newArea.trim())} />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )) : <Text style={s.muted}>{t("study.noHighlights", { defaultValue: "Tap “Study highlight” on a Scripture to collect it here." })}</Text>}
        {hls.length ? (
          <View style={s.actions}>
            <AppButton label={overlayOn ? t("study.overlayOff", { defaultValue: "Stop showing in my Bible" }) : t("study.overlayOn", { defaultValue: "Show in my Bible while I study" })}
              size="sm" variant={overlayOn ? "primary" : "outline"} icon="book-outline" onPress={toggleOverlay} />
            <AppButton label={t("study.saveAsMine", { defaultValue: "Save as my highlights" })} size="sm" icon="color-fill-outline" onPress={saveAsMine} loading={saving} />
            <AppButton label={t("study.addToPlaylist", { defaultValue: "Add to a playlist" })} size="sm" variant="secondary" icon="list-outline"
              onPress={() => { const tg = playlistTargets(); if (tg.length) setSheet(tg); else flash(t("study.pickTranslation", { defaultValue: "Open the Bible once to choose a translation first." })); }} />
          </View>
        ) : null}

        {/* Saved findings */}
        {saved.length ? (
          <>
            <SectionTitle>{t("study.keptTitle", { defaultValue: "Kept in this study" })} ({saved.length})</SectionTitle>
            {saved.map((f) => (
              <TouchableOpacity key={f.key} style={s.hlRow} onPress={() => open(f)} accessibilityRole="link">
                <Text style={[s.hlRef, { flex: 1 }]}>{f.title}</Text>
                {f.why ? <Text style={s.muted} numberOfLines={1}>{f.why}</Text> : null}
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        <SectionTitle>{t("study.notesTitle", { defaultValue: "My notes" })}</SectionTitle>
        <TextInput value={notes} onChangeText={(v) => { setNotes(v); setDirty(true); }} multiline style={s.notes} maxLength={20000}
          placeholder={t("study.notesPlaceholder", { defaultValue: "Do not enter sensitive personal information" })} placeholderTextColor={c.textMuted}
          accessibilityLabel={t("study.notesTitle", { defaultValue: "My notes" })} />

        {conflict ? (
          <View style={s.conflict} accessibilityLiveRegion="assertive">
            <Text style={s.cardTitle}>{t("study.conflictTitle", { defaultValue: "This study changed on another device" })}</Text>
            <Text style={s.cardSub}>{t("study.conflictBody", { defaultValue: "Choose which version to keep. Nothing has been overwritten." })}</Text>
            <View style={s.actions}>
              <AppButton label={t("study.keepMine", { defaultValue: "Keep this phone's version" })} size="sm" onPress={keepMine} />
              <AppButton label={t("study.keepTheirs", { defaultValue: "Use the other version" })} size="sm" variant="secondary" onPress={keepTheirs} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 10 }]}>
        {message ? <Text style={s.flash} accessibilityLiveRegion="polite">{message}</Text> : null}
        <AppButton label={study ? t("study.saveChanges", { defaultValue: "Save changes" }) : t("study.saveStudy", { defaultValue: "Save to Deep Study History" })}
          icon="save-outline" onPress={save} loading={saving} disabled={!dirty && !!study} fullWidth />
      </View>
      {saving && !message ? <ActivityIndicator style={{ position: "absolute", top: 12, alignSelf: "center" }} color={c.accentGreen} /> : null}
      <SaveScriptureSheet visible={!!sheet} targets={sheet ?? []} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); flash(m); }} />
    </>
  );
}

/** Area names offered when organising study highlights (the brief's examples). The person chooses — these are
 *  just names to pick from, never an automatic classification of any passage. */
const SUGGESTED_AREAS = [
  { key: "identity", label: "Identity and nature" }, { key: "work", label: "Work and ministry" }, { key: "believers", label: "Relationship with believers" },
  { key: "gifts", label: "Gifts and fruit" }, { key: "church", label: "The Church" }, { key: "promises", label: "Promises" }, { key: "commands", label: "Commands to obey" },
];
/** The concordance looks up one word: the longest meaningful word of the search ("grace of God" → grace). */
const contentWordOf = (q: string) => q.toLowerCase().replace(/[^a-z' ]+/g, " ").split(" ").filter((w) => w.length > 2 && !["god", "the", "how", "what", "with", "and", "for", "lord", "being"].includes(w)).sort((a, b) => b.length - a.length)[0] ?? q.trim();
const GROUP_DEFAULT: Record<StudyGroup, string> = {
  scriptures: "Scriptures", stories: "Bible Stories", definitions: "Definitions", greek_hebrew: "Greek and Hebrew",
  commentaries: "Commentaries", cross_references: "Cross-references", history: "Historical Context", mine: "My notes & playlists",
};
const MATCH_DEFAULT: Record<string, string> = { all: "All", direct: "Direct", conceptual: "Related", background: "Background", related: "Related" };
const WHY_DEFAULT: Record<string, string> = {
  wordsInText: "The words appear in the Bible text ({{translation}}).",
  referenceTyped: "The passage you searched for.",
  topicIncludes: "P2P editors chose {{passage}} for this topic.",
  originalWordsOf: "The Hebrew or Greek words of {{passage}}, word by word.",
  myNote: "One of your notes.",
  myHighlight: "You highlighted this passage.",
  myPlaylist: "One of your playlists.",
  wordsInTextPart: "The words “{{words}}” appear in the Bible text ({{translation}}).",
  conceptRendering: "{{lemma}} ({{strongs}}), the original word for “{{word}}”, is also translated “{{concept}}” in the BSB ({{count}} times).",
  conceptEaston: "Easton's Bible Dictionary article “{{article}}” connects it with {{concept}}.",
  topicCore: "A key passage P2P editors chose for “{{topic}}”.",
  topicSupporting: "A supporting passage P2P editors chose for “{{topic}}”.",
  storyRetells: "Chapter {{chapter}} retells one of these passages.",
  storyQuotes: "Chapter {{chapter}} quotes one of these passages.",
  articleTitle: "A dictionary article on this word.",
  articleMentions: "Background: the article discusses these words ({{count}} mentions).",
  meaningMatches: "{{count}} original-language words carry this meaning ({{languages}}).",
  commentaryOn: "Commentaries on {{passage}}.",
  crossRefsFor: "Passages that cross-reference {{passage}}.",
  topicNamed: "A Scripture topic with this name.",
  topicConnected: "Shares {{shared}} editor-chosen passage(s) with this subject, e.g. {{via}}.",
};

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  title: { fontSize: 20, fontWeight: "700", color: c.textDark, paddingVertical: 6 },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  search: { flex: 1, minWidth: 200, minHeight: 48, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.textDark, backgroundColor: c.card },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  muted: { color: c.textMuted, fontSize: 14 },
  card: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: c.borderBeige },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupTag: { color: c.accentGreen, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  cardTitle: { color: c.textDark, fontSize: 17, fontWeight: "700" },
  cardSub: { color: c.textMid, fontSize: 15, lineHeight: 22 },
  why: { color: c.textMid, fontSize: 13 },
  source: { color: c.textMuted, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 },
  groupHead: { color: c.textMid, fontSize: 13, fontWeight: "700", marginTop: 4 },
  hlRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.card, minHeight: 44 },
  hlRef: { color: c.textDark, fontSize: 15, fontWeight: "600" },
  notes: { minHeight: 120, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, fontSize: 16, color: c.textDark, backgroundColor: c.card, textAlignVertical: "top" },
  conflict: { padding: 14, borderRadius: 14, borderWidth: 2, borderColor: c.amber, gap: 6, backgroundColor: c.card },
  footer: { paddingHorizontal: 16, paddingTop: 10, gap: 6, backgroundColor: c.lightCream, borderTopWidth: 1, borderTopColor: c.borderBeige },
  flash: { color: c.textDark, fontSize: 14, textAlign: "center" },
});
