import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import TranslationPicker from "@/components/bible/TranslationPicker";
import SaveScriptureSheet, { type SaveTarget } from "@/components/library/SaveScriptureSheet";
import { bibleRoute, bookByCode, bookByName, formatRef, getChapter, getTranslations, searchBible, type BibleTranslation, type NewRef } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import { classifyQuery, containsPhrase } from "@/lib/libraryRules";
import { playRefs } from "@/lib/listen/playlistSession";

// Add Scripture: find passages and add them to the library — by reference
// ("John 3:16", "Psalm 23:1-6", "1 Cor 13"), by words ("faith", "peace") or
// by an exact phrase in quotes ("The Lord is my shepherd"). The Bible service
// decides what a reference is; word search uses the provider's own search
// (relevance, not exact). A quoted phrase is checked against the returned
// verses, and the page says plainly when matches are only approximate.
// Translations without word search (AO Lab) still find references.
// Results show the licensed text live — nothing is stored but references.

interface Result { key: string; ref: NewRef; reference: string; text: string }

export default function AddScripture() {
  const { to } = useLocalSearchParams<{ to?: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [t, setT] = useState<string>("");
  const [pickT, setPickT] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<SaveTarget[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([getTranslations(), loadPosition()]).then(([r, pos]) => {
      setTranslations(r.translations);
      setT((cur) => cur || (pos && r.translations.some((x) => x.code === pos.translation) ? pos.translation : r.translations.find((x) => x.isDefault && x.language === "en")?.code ?? r.translations[0]?.code ?? ""));
    }).catch((e: any) => setError(e?.message ?? "Couldn't load translations."));
  }, []);
  const tInfo = translations.find((x) => x.code === t);
  const kind = classifyQuery(q, (name) => !!bookByName(name));

  async function run(offset = 0) {
    if (kind.kind === "empty" || !t) return;
    ac.current?.abort(); const a = new AbortController(); ac.current = a;
    setBusy(true); setError(null); if (!offset) { setResults(null); setNote(null); setChosen(new Set()); }
    try {
      const term = kind.kind === "phrase" ? kind.phrase : q.trim();
      const r = await searchBible(term, t, offset, a.signal);
      if (r.kind === "reference" && r.reference) {
        const ch = await getChapter(r.reference.bookCode, r.reference.chapter, t, a.signal);
        const sv = r.reference.startVerse ?? 1, ev = r.reference.endVerse ?? r.reference.startVerse ?? ch.verses[ch.verses.length - 1]?.verse ?? 1;
        const verses = ch.verses.filter((v) => v.verse >= sv && v.verse <= ev);
        if (!verses.length) { setResults([]); setNote("That passage isn't in this translation."); return; }
        const ref = { translationCode: t, bookCode: r.reference.bookCode, chapter: r.reference.chapter, startVerse: verses[0].verse, endVerse: verses[verses.length - 1].verse };
        setResults([{ key: "ref", ref, reference: formatRef(bookByCode(ref.bookCode), ref.chapter, ref.startVerse, ref.endVerse), text: verses.map((v) => v.text).join(" ") }]);
        setNote(r.reference.startVerse == null ? "The whole chapter." : null); setMore(null);
        return;
      }
      let list: Result[] = r.results.map((x) => ({ key: `${x.bookCode}.${x.chapter}.${x.verse}`, ref: { translationCode: t, bookCode: x.bookCode, chapter: x.chapter, startVerse: x.verse, endVerse: x.verse }, reference: x.reference, text: x.text }));
      if (kind.kind === "phrase") {
        const exact = list.filter((x) => containsPhrase(x.text, kind.phrase));
        setNote(exact.length ? `Verses containing “${kind.phrase}” exactly, from the top matches in this translation.` : `No verse among the top matches contains “${kind.phrase}” exactly — these are the closest matches.`);
        if (exact.length) list = exact;
      } else setNote(r.total ? `${r.total} matching verses, best matches first.` : null);
      setResults((cur) => (offset && cur ? [...cur, ...list.filter((x) => !cur.some((y) => y.key === x.key))] : list));
      setMore(r.results.length === 20 && offset + 20 < r.total ? offset + 20 : null);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message ?? "Search didn't work. Please try again."); if (!offset) setResults([]);
    } finally { if (ac.current === a) setBusy(false); }
  }

  const toggle = (k: string) => setChosen((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const selected = (results ?? []).filter((r) => chosen.has(r.key));
  const hint = kind.kind === "reference" ? "Looks like a Bible reference" : kind.kind === "phrase" ? "Exact phrase" : kind.kind === "words" ? "Word search" : "";

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: to ? "Add Scripture" : "Find Scripture" }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 120 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={s.search}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput style={s.input} value={q} onChangeText={setQ} onSubmitEditing={() => run(0)} placeholder='John 3:16 · faith · "The Lord is my shepherd"' placeholderTextColor={c.textMuted}
            returnKeyType="search" autoCorrect={false} accessibilityLabel="Search by reference, words or an exact phrase in quotes" />
          {q ? <IconButton icon="close-circle" size="sm" color={c.textMuted} accessibilityLabel="Clear" onPress={() => { setQ(""); setResults(null); setNote(null); }} /> : null}
        </View>
        <View style={s.row}>
          <Pressable style={s.tChip} onPress={() => setPickT(true)} accessibilityRole="button" accessibilityLabel={`Translation: ${tInfo?.name ?? t}. Change`}>
            <Ionicons name="language-outline" size={16} color={c.accentGreen} />
            <Text style={s.tText} numberOfLines={1}>{tInfo?.abbreviation ?? t}{tInfo?.name ? ` · ${tInfo.name}` : ""}</Text>
            <Ionicons name="chevron-down" size={14} color={c.textMuted} />
          </Pressable>
          <AppButton label="Search" size="sm" onPress={() => run(0)} disabled={kind.kind === "empty" || !t} loading={busy && !results} />
        </View>
        {hint ? <Text style={s.hint}>{hint}{tInfo?.provider === "helloao" && kind.kind !== "reference" ? " — this translation can only be searched by reference. Switch translation to search words." : ""}</Text> : null}
        {flash ? <Text style={s.flash} accessibilityLiveRegion="polite">{flash}</Text> : null}
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {note ? <Text style={s.hint}>{note}</Text> : null}
        {results === null && !busy ? (
          <View style={s.empty}>
            <Ionicons name="book-outline" size={28} color={c.accentGreen} />
            <Text style={s.emptyText}>Search by reference (John 3:16, Psalm 23:1-6), by a word (hope, forgiveness) or by a phrase in quotes. Choose several results and add them in one go.</Text>
          </View>
        ) : null}
        {results?.length === 0 && !error && !note ? <Text style={s.hint}>Nothing found. Try other words or a reference.</Text> : null}
        {results?.map((r) => {
          const on = chosen.has(r.key);
          const rtl = tInfo?.textDirection === "rtl";
          return (
            <View key={r.key} style={[s.result, on && { borderColor: c.accentGreen }]}>
              <Pressable onPress={() => toggle(r.key)} style={{ flexDirection: "row", gap: 10 }} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Select ${r.reference}`}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accentGreen : c.textMuted} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.ref}>{r.reference} <Text style={s.trans}>{tInfo?.abbreviation ?? t}</Text></Text>
                  <Text style={[s.text, rtl && { writingDirection: "rtl", textAlign: "right" }]} numberOfLines={4}>{r.text}</Text>
                </View>
              </Pressable>
              <View style={s.actions}>
                <AppButton label="Add" icon="add" size="sm" variant="secondary" onPress={() => setSaving([{ ref: r.ref, reference: r.reference }])} accessibilityLabel={`Add ${r.reference}`} />
                <AppButton label="Listen" icon="headset-outline" size="sm" variant="tertiary" onPress={() => playRefs(r.reference, [{ ref: r.ref, reference: r.reference }], "search")} accessibilityLabel={`Listen to ${r.reference}`} />
                <AppButton label="Open" icon="book-outline" size="sm" variant="tertiary" onPress={() => router.push(bibleRoute({ book: r.ref.bookCode, chapter: r.ref.chapter, v: r.ref.startVerse, ve: r.ref.endVerse, translation: t }) as any)} accessibilityLabel={`Open ${r.reference} in the Bible reader`} />
              </View>
            </View>
          );
        })}
        {more != null ? <AppButton label="More results" variant="tertiary" onPress={() => run(more)} loading={busy} /> : null}
      </ScrollView>

      {selected.length ? (
        <View style={[s.bottom, { paddingBottom: 12 + insets.bottom }]}>
          <Text style={s.bottomText}>{selected.length} selected</Text>
          <AppButton label="Clear" size="sm" variant="tertiary" onPress={() => setChosen(new Set())} />
          <AppButton label={`Add selected Scriptures`} icon="add" onPress={() => setSaving(selected.map((r) => ({ ref: r.ref, reference: r.reference })))} />
        </View>
      ) : null}

      <TranslationPicker visible={pickT} onClose={() => setPickT(false)} translations={translations} current={t} onSelect={(code) => { setT(code); setPickT(false); setResults(null); setNote(null); }} />
      <SaveScriptureSheet visible={!!saving} targets={saving ?? []} initialCollectionIds={to ? [to] : []} onClose={() => setSaving(null)}
        onDone={(m) => { setSaving(null); setChosen(new Set()); setFlash(m); }} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, maxWidth: 820, width: "100%", alignSelf: "center" },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.card },
    input: { flex: 1, minHeight: 46, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 15 },
    row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
    tChip: { flex: 1, minWidth: 180, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige },
    tText: { flex: 1, fontSize: 13.5, color: c.textDark, fontFamily: "Inter_500Medium" },
    hint: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
    flash: { fontSize: 13, lineHeight: 18, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 8 },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium", marginTop: 8 },
    empty: { alignItems: "center", gap: 10, padding: 22, borderRadius: 18, backgroundColor: c.card, marginTop: 16 },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    result: { padding: 12, borderRadius: 16, backgroundColor: c.card, marginTop: 10, gap: 8, borderWidth: 1.5, borderColor: "transparent" },
    ref: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    trans: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    text: { fontSize: 14, lineHeight: 21, color: c.textMid, fontFamily: "Inter_400Regular" },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginLeft: 26 },
    bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 12, backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    bottomText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
