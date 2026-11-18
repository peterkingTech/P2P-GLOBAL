// One biblical name / title / description — collapsed in lists, expanded in full (owner brief 2026-11-18 §10).
// Shows ONLY verified data as fact (Scripture wording, STEPBible lexicon, Easton); context and interpretive notes
// are labelled as draft P2P study notes awaiting editor review. Actions: open Scripture, read the chapter, compare
// translations, original-language study, lexicon / dictionary, related names, personal note, highlight, playlist,
// continue studying.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import SaveScriptureSheet, { type SaveTarget } from "@/components/library/SaveScriptureSheet";
import { addHighlight, addNote, bibleRoute } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import { getNameEntry, KIND_LABEL, LANGUAGE_LABEL, PERSON_LABEL, type NameEntryFull, type NameSummary } from "@/lib/biblicalNamesApi";

const RTL = /[֐-׿]/;
const RELATED_WHY: Record<string, string> = { sameWord: "Same original word", sameArticle: "Same dictionary article", sameVerse: "Same verse", sameName: "Same name or rendering" };

export default function NameCard({ item, initiallyOpen = false, onOpenRelated }: { item: NameSummary; initiallyOpen?: boolean; onOpenRelated?: (id: string) => void }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(initiallyOpen);
  const [full, setFull] = useState<NameEntryFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTr, setShowTr] = useState<string>("BSB");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SaveTarget[] | null>(null);

  useEffect(() => { loadPosition().then((p) => setTranslation(p?.translation ?? null)).catch(() => {}); }, []);
  useEffect(() => {
    if (!open || full) return;
    getNameEntry(item.id).then((r) => setFull(r.entry)).catch((e) => setErr((e as Error)?.message ?? t("names.openFailed", { defaultValue: "Couldn't open this entry." })));
  }, [open, full, item.id, t]);

  const p = full?.primary ?? item.primary;
  const ref = p ? { book: p.book, chapter: p.chapter, v: p.start, ve: p.end, translation } : null;
  const newRef = p ? { translationCode: translation ?? "BSB", bookCode: p.book, chapter: p.chapter, startVerse: p.start, endVerse: p.end } : null;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); };

  const kindLabel = t(`names.kind.${item.kind}`, { defaultValue: KIND_LABEL[item.kind] });
  const persons = item.persons.map((x) => t(`names.person.${x}`, { defaultValue: PERSON_LABEL[x] })).join(" · ");

  return (
    <View style={[s.card, item.status === "needs_verification" && s.unverified]}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={s.head}
        accessibilityLabel={`${item.name}. ${kindLabel}. ${open ? t("names.collapse", { defaultValue: "Collapse" }) : t("names.expand", { defaultValue: "Open the full entry" })}`}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.name}>{item.name}</Text>
          {item.original.length ? (
            <Text style={s.origLine} numberOfLines={1}>{item.original.map((o) => `${o.lemma} ${o.transliteration}`).join("  ·  ")}</Text>
          ) : null}
          <Text style={s.meta}>{kindLabel}{persons ? ` · ${persons}` : ""}{item.primary ? ` · ${item.primary.display}` : ""}</Text>
          <View style={s.badges}>
            {item.status === "verified" ? <Text style={[s.badge, s.badgeOk]}>{t("names.verified", { defaultValue: "Scripture wording verified" })}</Text> : null}
            {item.status === "no_scripture_wording" ? <Text style={s.badge}>{t("names.noWording", { defaultValue: "Not Scripture wording" })}</Text> : null}
            {item.status === "needs_verification" ? <Text style={[s.badge, s.badgeWarn]}>{t("names.needsVerification", { defaultValue: "Needs source verification" })}</Text> : null}
            {item.interpretive ? <Text style={[s.badge, s.badgeWarn]}>{t("names.interpretive", { defaultValue: "Interpretation / debated" })}</Text> : null}
            {item.languages.map((l) => <Text key={l} style={s.badge}>{t(`names.lang.${l}`, { defaultValue: LANGUAGE_LABEL[l] ?? l })}</Text>)}
          </View>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={22} color={c.textMuted} />
      </TouchableOpacity>

      {open && !full && !err ? <ActivityIndicator color={c.accentGreen} /> : null}
      {err ? <Text style={s.note}>{err}</Text> : null}

      {open && full ? (
        <View style={{ gap: 12 }}>
          {full.also.length ? <Text style={s.small}><Text style={s.label}>{t("names.alsoLabel", { defaultValue: "Also searched as: " })}</Text>{full.also.join(" · ")}</Text> : null}

          {full.primary ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>{t("names.primary", { defaultValue: "Primary Scripture" })} — {full.primary.display} ({full.primary.testament === "OT" ? t("study.testament.OT", { defaultValue: "Old Testament" }) : t("study.testament.NT", { defaultValue: "New Testament" })})</Text>
              <ChipRow accessibilityLabel={t("names.translations", { defaultValue: "Translations" })} single>
                {Object.keys(full.primary.texts).map((k) => (
                  <FilterChip key={k} label={full.primary?.matched?.includes(k) ? `${k} ✓` : k} selected={showTr === k} selection="single" onPress={() => setShowTr(k)} />
                ))}
              </ChipRow>
              <Text style={s.verse}>{full.primary.texts[showTr] ?? Object.values(full.primary.texts)[0]}</Text>
              <Text style={s.source}>{t("names.wordingNote", { defaultValue: "✓ = the wording of this entry appears in that translation. Public-domain texts from bible.helloao.org." })}</Text>
            </View>
          ) : (
            <Text style={s.note}>{t("names.noScripture", { defaultValue: "This is not Scripture wording. It is listed so you can see where it comes from and what Scripture does say." })}</Text>
          )}

          {full.original.length || full.aramaicWord ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>{t("names.original", { defaultValue: "Original language" })}</Text>
              {full.original.map((o) => (
                <TouchableOpacity key={o.strongs} style={s.orig} accessibilityRole="link" onPress={() => router.push({ pathname: "/study-tools/word/[strongs]", params: { strongs: o.strongs } } as any)}
                  accessibilityLabel={t("names.openLexicon", { defaultValue: "Open {{word}} in the lexicon", word: o.transliteration })}>
                  <Text style={[s.lemma, RTL.test(o.lemma) && { writingDirection: "rtl" }]}>{o.lemma}</Text>
                  <Text style={s.small}>
                    {t(`names.lang.${o.language}`, { defaultValue: LANGUAGE_LABEL[o.language] ?? o.language })} · {t("names.translit", { defaultValue: "transliteration" })} {o.transliteration} · {o.strongs}
                    {"\n"}{t("names.gloss", { defaultValue: "Meaning (lexicon gloss)" })}: “{o.gloss}” · {t("names.uses", { defaultValue: "{{count}} uses in {{verses}} verses", count: o.uses, verses: o.occurrences })}
                    {o.inPrimary ? `\n${t("names.inPrimary", { defaultValue: "Tagged in {{ref}} (BSB interlinear)", ref: full.primary?.display ?? "" })}` : ""}
                  </Text>
                </TouchableOpacity>
              ))}
              {full.aramaicWord ? <Text style={s.small}><Text style={s.label}>{t("names.aramaic", { defaultValue: "Aramaic word: " })}</Text>“{full.aramaicWord.quote}” — {full.aramaicWord.source}</Text> : null}
              <Text style={s.source}>{t("names.lexSource", { defaultValue: "Source: STEPBible lexicons (TBESH / TBESG, CC BY 4.0) with BSB interlinear tagging. Transliteration shows syllables; no pronunciation is invented." })}</Text>
            </View>
          ) : null}

          {full.eastonExcerpt && full.easton ? (
            <View style={{ gap: 4 }}>
              <Text style={s.label}>{t("names.dictionary", { defaultValue: "Dictionary — historical and biblical background" })}</Text>
              <Text style={s.body}>{full.eastonExcerpt}</Text>
              <Text style={s.source}>{t("study.sourceLabel", { defaultValue: "Source:" })} Easton's Bible Dictionary (1897, public domain) — “{full.easton.title}”</Text>
            </View>
          ) : null}

          {full.note ? (
            <View style={s.draft}>
              <Text style={s.label}>{t("names.context", { defaultValue: "Setting, speaker and meaning" })}</Text>
              <Text style={s.body}>{full.note}</Text>
              <Text style={s.draftLabel}>{t("names.draftLabel", { defaultValue: "Draft P2P study note — awaiting editor review. Check it against the passages." })}</Text>
            </View>
          ) : null}
          {full.interp ? (
            <View style={s.draft}>
              <Text style={s.label}>{t("names.interpLabel", { defaultValue: "Interpretation, translation and cautions" })}</Text>
              <Text style={s.body}>{full.interp}</Text>
              <Text style={s.draftLabel}>{t("names.draftLabel", { defaultValue: "Draft P2P study note — awaiting editor review. Check it against the passages." })}</Text>
            </View>
          ) : null}

          {full.refs.length ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>{t("names.moreRefs", { defaultValue: "Other Scriptures" })}</Text>
              {full.refs.map((r) => (
                <TouchableOpacity key={`${r.display}${r.connected ? "~" : ""}`} style={s.refRow} accessibilityRole="link"
                  onPress={() => router.push(bibleRoute({ book: r.book, chapter: r.chapter, v: r.start, ve: r.end, translation }) as any)}>
                  <Text style={s.refTitle}>{r.display}{r.person ? ` · ${t(`names.person.${r.person}`, { defaultValue: PERSON_LABEL[r.person] })}` : ""}</Text>
                  <Text style={s.small} numberOfLines={3}>{r.connected ? t("names.connected", { defaultValue: "Connected passage (setting, fulfilment or related wording)" }) : r.text ?? ""}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {full.related.length ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>{t("names.related", { defaultValue: "Related names" })}</Text>
              <ChipRow accessibilityLabel={t("names.related", { defaultValue: "Related names" })}>
                {full.related.map((r) => <FilterChip key={r.id} label={r.name} selected={false} icon="git-network-outline"
                  accessibilityLabel={`${r.name} — ${t(`names.why.${r.why}`, { defaultValue: RELATED_WHY[r.why] })}`}
                  onPress={() => (onOpenRelated ? onOpenRelated(r.id) : router.push({ pathname: "/bible-study/names", params: { id: r.id } } as any))} />)}
              </ChipRow>
            </View>
          ) : null}

          <View style={s.actions}>
            {ref ? (
              <>
                <AppButton size="sm" variant="secondary" icon="book-outline" label={t("names.openScripture", { defaultValue: "Open Scripture" })} onPress={() => router.push(bibleRoute(ref) as any)} />
                <AppButton size="sm" variant="secondary" icon="reader-outline" label={t("names.readChapter", { defaultValue: "Read the full chapter" })} onPress={() => router.push(bibleRoute({ book: ref.book, chapter: ref.chapter, translation }) as any)} />
                <AppButton size="sm" variant="secondary" icon="git-compare-outline" label={t("names.compare", { defaultValue: "Compare translations" })} onPress={() => router.push(bibleRoute({ ...ref, compare: true }) as any)} />
                <AppButton size="sm" variant="secondary" icon="language-outline" label={t("names.originalStudy", { defaultValue: "Original-language study" })}
                  onPress={() => router.push({ pathname: "/deep-study", params: { book: ref.book, chapter: String(ref.chapter), tab: "original", v: String(ref.v), ve: String(ref.ve), ...(translation ? { t: translation } : {}) } } as any)} />
              </>
            ) : null}
            {full.easton ? <AppButton size="sm" variant="secondary" icon="library-outline" label={t("names.openDictionary", { defaultValue: "Dictionary entry" })} onPress={() => router.push({ pathname: "/dictionary/article/[id]", params: { id: full.easton!.id } } as any)} /> : null}
            {newRef ? (
              <>
                <AppButton size="sm" variant="tertiary" icon="create-outline" label={t("names.addNote", { defaultValue: "Add to my notes" })} onPress={() => setNoteOpen((o) => !o)} />
                <AppButton size="sm" variant="tertiary" icon="color-fill-outline" label={t("names.highlight", { defaultValue: "Highlight Scripture" })}
                  onPress={() => addHighlight(newRef, "gold").then(() => flash(t("names.highlighted", { defaultValue: "Highlighted in your Bible." }))).catch((e) => flash((e as Error)?.message ?? ""))} />
                <AppButton size="sm" variant="tertiary" icon="musical-notes-outline" label={t("names.playlist", { defaultValue: "Add to a study playlist" })} onPress={() => setSheet([{ ref: newRef, reference: full.primary!.display }])} />
              </>
            ) : null}
            <AppButton size="sm" variant="tertiary" icon="search" label={t("names.continue", { defaultValue: "Continue studying" })} onPress={() => router.push({ pathname: "/study", params: { q: item.name } } as any)} />
          </View>
          {noteOpen && newRef ? (
            <View style={{ gap: 8 }}>
              <TextInput value={noteText} onChangeText={setNoteText} multiline style={s.noteInput} placeholderTextColor={c.textMuted}
                placeholder={t("names.notePlaceholder", { defaultValue: "Your note on {{name}} ({{ref}})", name: item.name, ref: full.primary?.display ?? "" })}
                accessibilityLabel={t("names.addNote", { defaultValue: "Add to my notes" })} />
              <AppButton size="sm" label={t("names.saveNote", { defaultValue: "Save note" })} disabled={!noteText.trim()}
                onPress={() => addNote(newRef, item.name, noteText.trim()).then(() => { setNoteText(""); setNoteOpen(false); flash(t("names.noteSaved", { defaultValue: "Saved to your notes." })); }).catch((e) => flash((e as Error)?.message ?? ""))} />
            </View>
          ) : null}
          {msg ? <Text style={s.flash} accessibilityLiveRegion="polite">{msg}</Text> : null}
        </View>
      ) : null}
      {sheet ? <SaveScriptureSheet visible targets={sheet} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); flash(m); }} /> : null}
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: c.borderBeige },
  unverified: { borderColor: c.amber, borderStyle: "dashed" },
  head: { flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 44 },
  name: { color: c.textDark, fontSize: 18, fontWeight: "800" },
  origLine: { color: c.textMid, fontSize: 16 },
  meta: { color: c.textMuted, fontSize: 13 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: "700", color: c.textMid, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  badgeOk: { color: c.accentGreen, borderColor: c.accentGreen },
  badgeWarn: { color: c.amber, borderColor: c.amber },
  label: { color: c.textMid, fontSize: 13, fontWeight: "800" },
  verse: { color: c.textDark, fontSize: 16, lineHeight: 24, fontStyle: "italic" },
  body: { color: c.textDark, fontSize: 15, lineHeight: 22 },
  small: { color: c.textMid, fontSize: 13, lineHeight: 19 },
  source: { color: c.textMuted, fontSize: 12 },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  orig: { gap: 2, paddingVertical: 6, minHeight: 44 },
  lemma: { color: c.textDark, fontSize: 22, fontWeight: "700" },
  draft: { gap: 4, borderLeftWidth: 3, borderLeftColor: c.amber, paddingLeft: 10 },
  draftLabel: { color: c.amber, fontSize: 12, fontWeight: "700" },
  refRow: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.lightCream, gap: 2, minHeight: 44 },
  refTitle: { color: c.accentGreen, fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  noteInput: { minHeight: 90, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, fontSize: 16, color: c.textDark, backgroundColor: c.lightCream, textAlignVertical: "top" },
  flash: { color: c.textDark, fontSize: 14 },
});
