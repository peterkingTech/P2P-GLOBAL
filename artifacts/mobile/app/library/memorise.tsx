import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, SegmentedControl } from "@/components/ui";
import { getChapter } from "@/lib/bibleReaderApi";
import { listSaved, updateSaved, MEMORISATION_LABEL, type Memorisation, type SavedScripture } from "@/lib/scriptureLibraryApi";
import { playRefs } from "@/lib/listen/playlistSession";

// Learn Scripture by heart — the saved passages I marked To learn,
// Practising or Memorised (my own statuses, private to me). Listen as many
// times as I like, read it, hide the words and try to recall them, then
// reveal and check. Encouraging, never a score: no streaks, no rankings.
// The words come live from the Bible service when shown — nothing stored.

const asRef = (x: SavedScripture) => ({ translationCode: x.translationCode, bookCode: x.bookCode, chapter: x.chapter, startVerse: x.startVerse, endVerse: x.endVerse });

export default function MemoriseScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [status, setStatus] = useState<Memorisation>("to_learn");
  const [items, setItems] = useState<SavedScripture[] | null>(null);
  const [counts, setCounts] = useState<Record<Memorisation, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [a, b, m] = await Promise.all((["to_learn", "practising", "memorised"] as Memorisation[]).map((x) => listSaved({ memorisation: x })));
      const all = { to_learn: a, practising: b, memorised: m };
      setCounts({ to_learn: a.total, practising: b.total, memorised: m.total });
      setItems(all[status].items); setError(null);
    } catch (e: any) { setError(e?.status === 503 ? "Memorisation is coming soon." : e?.message ?? "Couldn't load your passages."); setItems([]); }
  }, [status]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function show(x: SavedScripture) {
    setOpen(open === x.id ? null : x.id);
    if (text[x.id]) return;
    try {
      const ch = await getChapter(x.bookCode, x.chapter, x.translationCode);
      setText((t) => ({ ...t, [x.id]: ch.verses.filter((v) => v.verse >= x.startVerse && v.verse <= x.endVerse).map((v) => v.text).join(" ") }));
    } catch { setText((t) => ({ ...t, [x.id]: "The words couldn't be loaded — check your connection." })); }
  }
  const move = async (x: SavedScripture, m: Memorisation | null) => { try { await updateSaved(x.id, { memorisation: m }); } catch (e: any) { setError(e?.message ?? "Couldn't update it."); } load(); };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Memorise Scripture" }} />
      {counts ? <Text style={s.hint}>{counts.memorised ? `${counts.memorised} by heart · ` : ""}{counts.practising} practising · {counts.to_learn} to learn</Text> : null}
      <SegmentedControl accessibilityLabel="Show" value={status} onChange={(v) => setStatus(v as Memorisation)}
        options={(Object.keys(MEMORISATION_LABEL) as Memorisation[]).map((m) => ({ value: m, label: `${MEMORISATION_LABEL[m]}${counts ? ` · ${counts[m]}` : ""}` }))} />
      {items && items.length > 1 ? <AppButton label={`Listen to all ${items.length}`} icon="headset-outline" variant="secondary"
        onPress={() => playRefs(`${MEMORISATION_LABEL[status]} — memorisation`, items.map((x) => ({ ref: asRef(x), reference: x.reference })), "library")} /> : null}
      {error ? <Text style={s.hint}>{error}</Text> : null}
      {!items ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}
      {items && !items.length && !error ? (
        <View style={s.empty}>
          <Ionicons name="school-outline" size={28} color={c.accentGreen} />
          <Text style={s.emptyText}>{status === "to_learn" ? "In Saved Scriptures, open a passage's details and choose “To learn” to start learning it by heart." : "Nothing here yet."}</Text>
          {status === "to_learn" ? <AppButton label="Saved Scriptures" variant="secondary" onPress={() => router.push("/library/saved" as any)} /> : null}
        </View>
      ) : null}
      {items?.map((x) => {
        const isOpen = open === x.id, shown = revealed.has(x.id);
        return (
          <View key={x.id} style={s.card}>
            <Pressable onPress={() => show(x)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }} accessibilityLabel={`${x.title ? `${x.title}, ` : ""}${x.reference}`}>
              {x.title ? <Text style={s.title}>{x.title}</Text> : null}
              <Text style={x.title ? s.sub : s.title}>{x.reference} <Text style={s.trans}>{x.translationCode}</Text></Text>
            </Pressable>
            {isOpen ? (
              <View style={{ gap: 10 }}>
                {shown ? <Text style={s.verse} accessibilityLiveRegion="polite">{text[x.id] ?? "…"}</Text>
                  : <Text style={s.hidden}>Say it from memory, then reveal the words to check.</Text>}
                <View style={s.row}>
                  <AppButton label={shown ? "Hide words" : "Reveal words"} icon={shown ? "eye-off-outline" : "eye-outline"} size="sm" variant="secondary"
                    onPress={() => setRevealed((r) => { const n = new Set(r); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} />
                  <AppButton label="Listen" icon="headset-outline" size="sm" variant="tertiary" onPress={() => playRefs(x.reference, [{ ref: asRef(x), reference: x.reference }], "library")} />
                </View>
                <View style={s.row}>
                  {status !== "practising" ? <AppButton label="Practising" size="sm" variant="tertiary" onPress={() => move(x, "practising")} /> : null}
                  {status !== "memorised" ? <AppButton label="I know it by heart" icon="checkmark" size="sm" variant="tertiary" onPress={() => move(x, "memorised")} /> : null}
                  {status === "memorised" ? <AppButton label="Practise again" size="sm" variant="tertiary" onPress={() => move(x, "practising")} /> : null}
                  <AppButton label="Stop learning" size="sm" variant="tertiary" onPress={() => move(x, null)} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <AppButton label="Memorisation reminders" icon="alarm-outline" variant="tertiary" onPress={() => router.push("/library/reminders" as any)} />
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 120 },
    hint: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    card: { padding: 14, borderRadius: 16, backgroundColor: c.card, gap: 8 },
    title: { fontSize: 15.5, lineHeight: 21, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
    trans: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    verse: { fontSize: 17, lineHeight: 27, color: c.textDark, fontFamily: "Inter_400Regular" },
    hidden: { fontSize: 14, lineHeight: 20, color: c.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: c.borderBeige },
    row: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    empty: { alignItems: "center", gap: 10, padding: 22, borderRadius: 18, backgroundColor: c.card },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
