import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Share } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import SaveScriptureSheet, { type SaveTarget } from "@/components/library/SaveScriptureSheet";
import { SCRIPTURE_FONT, bibleRoute, getChapter, saveBookmark } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import { DAILY_WORD_FALLBACK_TRANSLATION, dailyWordFor } from "@/lib/dailyWord";
import { isNetworkError } from "@/lib/offline";
import { listen, useListenOwner } from "@/lib/listen";
import ListenPlayer from "@/components/listen/ListenPlayer";

// DAILY WORD (owner brief 2026-11-18 §8): TODAY's scripture only — in the person's own translation — with its
// theme and "Today's Instruction", and Read the full chapter, Save, Add to a playlist and Share. There is no
// list of other days: tomorrow's word stays a surprise. Before a translation is chosen, or offline without a
// kept copy, the Berean Standard Bible text (public domain) is shown and labelled.
export default function DailyWordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const entry = useMemo(() => dailyWordFor(), []);
  // P2P Listen: today's word read aloud (theme, the verse in the public-domain BSB, Today's Instruction) — kind
  // "daily_word", so a chosen P2P Voice may read it (owner brief). The full chapter stays with the Bible reader.
  useListenOwner("daily-word");
  const listenToday = () => {
    if (!entry) return;
    const day = new Date().toISOString().slice(0, 10);
    void listen.play({ key: `daily_word:${day}`, owner: "daily-word", kind: "daily_word", title: t("dailyWord.title", { defaultValue: "Daily Word" }), subtitle: entry.ref, language: "en", highlight: "sentence",
      sections: [{ id: "word", title: entry.ref, parts: [
        { key: "theme", text: `${entry.theme}.` },
        { key: "verse", text: `${entry.ref}. ${entry.text}` },
        { key: "instruction", text: `${t("dailyWord.instructionLabel", { defaultValue: "Today's Instruction" })}. ${entry.instruction}` },
      ] }], route: { pathname: "/daily-word" } } as any, "start");
  };
  const [translation, setTranslation] = useState<string | null>(null);
  const [live, setLive] = useState<{ text: string; name: string; copy: boolean; offline?: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SaveTarget[] | null>(null);

  useEffect(() => { loadPosition().then((p) => setTranslation(p?.translation ?? null)).catch(() => setTranslation(null)); }, []);
  useEffect(() => {
    const tg = entry?.target;
    if (!tg || !translation) return;
    let gone = false;
    // getChapter keeps a phone copy only where the translation's licence permits offline use.
    getChapter(tg.book, tg.chapter, translation).then((ch) => {
      const from = tg.v ?? 1, to = tg.ve ?? from;
      const text = ch.verses.filter((v) => v.verse >= from && v.verse <= to).map((v) => v.text).join(" ").trim();
      if (!gone && text) setLive({ text, name: ch.translation.name, copy: ch.translation.textCopyAllowed, offline: ch.offline });
    }).catch(() => {});
    return () => { gone = true; };
  }, [entry, translation]);

  if (!entry) return null;
  const text = live?.text ?? entry.text;
  const tg = entry.target;
  const passage = tg && translation ? { translationCode: translation, bookCode: tg.book, chapter: tg.chapter, startVerse: tg.v ?? 1, endVerse: tg.ve ?? tg.v ?? 1 } : null;
  const flash = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 3500); };
  const needTranslation = () => flash(t("dailyWord.openBibleFirst", { defaultValue: "Open the Bible once to choose a translation first." }));

  async function save() {
    if (!passage) return needTranslation();
    try { await saveBookmark(passage); flash(t("dailyWord.saved", { defaultValue: "Saved to your passages." })); }
    catch (e: any) { flash(isNetworkError(e) ? t("dailyWord.needsInternet", { defaultValue: "Saving needs an internet connection." }) : e?.message ?? ""); }
  }
  async function share() {
    // Licensed text is shared only where the translation allows copying; otherwise the reference alone.
    const body = live && !live.copy ? entry!.ref : `“${text}” — ${entry!.ref}${live ? ` (${live.name})` : " (BSB)"}`;
    try { await Share.share({ message: `${body}\n\n${t("dailyWord.instructionLabel", { defaultValue: "Today's Instruction" })}: ${entry!.instruction}` }); } catch {}
  }

  return (
    <>
      <Stack.Screen options={{ title: t("dailyWord.title", { defaultValue: "Daily Word" }) }} />
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 40, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        <View style={s.card}>
          <Text style={s.kicker}>{t("dailyWord.today", { defaultValue: "Today" })}{entry.theme ? ` · ${entry.theme}` : ""}</Text>
          <Text style={s.verse} accessibilityRole="text">“{text}”</Text>
          <Text style={s.ref}>— {entry.ref} ({live?.name ?? "BSB"})</Text>
          {live?.offline ? <Text style={s.note}>{t("dailyWord.offlineCopy", { defaultValue: "Offline — the copy saved on this phone." })}</Text>
            : !live ? <Text style={s.note}>{t("dailyWord.fallbackNote", { defaultValue: "{{translation}}. Open the Bible to read it in your own translation.", translation: DAILY_WORD_FALLBACK_TRANSLATION })}</Text> : null}
        </View>
        <View style={s.instruction}>
          <Text style={s.instrLabel}>{t("dailyWord.instructionLabel", { defaultValue: "Today's Instruction" })}</Text>
          <Text style={s.instrText}>{entry.instruction}</Text>
        </View>
        <View style={s.actions}>
          {tg ? <AppButton label={t("dailyWord.readFull", { defaultValue: "Read the full chapter" })} icon="book-outline" fullWidth onPress={() => router.push(bibleRoute({ ...tg, translation }) as any)} /> : null}
          <View style={s.row}>
            <AppButton label={t("dailyWord.save", { defaultValue: "Save" })} icon="bookmark-outline" variant="secondary" style={s.grow} onPress={save} />
            <AppButton label={t("dailyWord.playlist", { defaultValue: "Add to playlist" })} icon="list-outline" variant="secondary" style={s.grow}
              onPress={() => (passage ? setSheet([{ ref: passage, reference: entry.ref }]) : needTranslation())} />
            <AppButton label={t("dailyWord.share", { defaultValue: "Share" })} icon="share-outline" variant="secondary" style={s.grow} onPress={share} />
            <AppButton label={t("dailyWord.listenToday", { defaultValue: "Listen to today's word" })} icon="headset-outline" variant="secondary" style={s.grow} onPress={listenToday} />
            {tg ? <AppButton label={t("dailyWord.listenChapter", { defaultValue: "Listen to the chapter" })} icon="book-outline" variant="secondary" style={s.grow}
              onPress={() => router.push(bibleRoute({ ...tg, translation, listen: true }) as any)} /> : null}
          </View>
        </View>
        {message ? <Text style={s.flash} accessibilityLiveRegion="polite">{message}</Text> : null}
        <Text style={s.note}>{t("dailyWord.comeBack", { defaultValue: "A new word is waiting for you tomorrow." })}</Text>
      </ScrollView>
      <ListenPlayer owner="daily-word" bottomInset={insets.bottom} />
      <SaveScriptureSheet visible={!!sheet} targets={sheet ?? []} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); flash(m); }} />
    </>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  card: { backgroundColor: c.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: c.borderBeige },
  kicker: { color: c.accentGreen, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  verse: { color: c.textDark, fontSize: 21, lineHeight: 32, fontFamily: SCRIPTURE_FONT },
  ref: { color: c.textMid, fontSize: 15, fontWeight: "600" },
  note: { color: c.textMuted, fontSize: 12, textAlign: "left" },
  instruction: { borderLeftWidth: 3, borderLeftColor: c.amber, paddingLeft: 14, paddingVertical: 6, gap: 4 },
  instrLabel: { color: c.textMid, fontSize: 11, fontWeight: "700" }, // smaller than the verse (owner 2026-11-18)
  instrText: { color: c.textMid, fontSize: 14, lineHeight: 20 },
  actions: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grow: { flexGrow: 1, flexBasis: 100 },
  flash: { color: c.textDark, fontSize: 14 },
});
