import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { BibleApiError, SCRIPTURE_FONT, getChapter, type BibleChapter, type BibleTranslation } from "@/lib/bibleReaderApi";
import { alignVerses, compareColumns, type PanelState } from "@/lib/bibleCompare";
import { darken, withAlpha } from "@/lib/colorUtils";

// The chapter in several licensed translations, verse by verse. Wide screens
// put translations side by side; phones stack them under each verse, so every
// translation stays on the same verse while scrolling. Each translation loads
// (and can fail and retry) on its own. Tapping a verse selects it in the
// translation being read, for the reader's usual highlight / note / save bar.
//
// Telling them apart: every translation keeps ONE colour everywhere — its badge
// in the key at the top, and a coloured edge + light tint on each of its verses
// (and, on phones, its badge on every line) — so you can follow one translation
// down the page and see at a glance which wording belongs to which.
interface Props {
  bookCode: string;
  chapter: number;
  primary: BibleChapter;                 // already loaded by the reader
  others: string[];                      // the extra translations
  translations: BibleTranslation[];
  width: number;
  fontSize: number;
  lineHeight: number;
  verseNumbers: boolean;
  selected: { start: number; end: number } | null;
  onTapVerse: (verse: number) => void;
}

/**
 * One colour per compared translation, in order, all from the theme: the one
 * being read keeps the app's green; then amber, deep green, deep amber (hues
 * alternate so neighbours always differ). The abbreviation badge is the
 * primary cue; colour reinforces it.
 */
export function compareColour(index: number, c: Pick<AppColors, "accentGreen" | "amber">): string {
  return [c.accentGreen, c.amber, darken(c.accentGreen, 0.45), darken(c.amber, 0.4)][index % 4];
}

export default function CompareView({ bookCode, chapter, primary, others, translations, width, fontSize, lineHeight, verseNumbers, selected, onTapVerse }: Props) {
  const { colors: c, resolvedMode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const [attempt, setAttempt] = useState<Record<string, number>>({});
  const dark = resolvedMode === "dark";

  const othersKey = others.join(",");
  useEffect(() => {
    const ac = new AbortController();
    setPanels(Object.fromEntries(others.map((code) => [code, { status: "loading" } as PanelState])));
    for (const code of others) {
      getChapter(bookCode, chapter, code, ac.signal)
        .then((ch) => setPanels((p) => ({ ...p, [code]: { status: "ok", chapter: ch } })))
        .catch((e) => {
          if (e?.name === "AbortError") return;
          const status = e instanceof BibleApiError ? e.status : 0;
          const message = status === 404 ? "Not available in this translation." : status === 0 ? "You're offline." : e instanceof BibleApiError ? e.message : "Couldn't load.";
          setPanels((p) => ({ ...p, [code]: { status: "error", message, httpStatus: status } }));
        });
    }
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookCode, chapter, othersKey, attempt]);

  const order = [primary.translation.code, ...others];
  const all: Record<string, PanelState> = { ...panels, [primary.translation.code]: { status: "ok", chapter: primary } };
  const rows = useMemo(() => alignVerses(order, all), [order.join(","), panels, primary]);
  const cols = compareColumns(width, order.length);
  const info = (code: string) => translations.find((t) => t.code === code);
  const label = (code: string) => info(code)?.abbreviation ?? code;
  const colour = (code: string) => compareColour(order.indexOf(code), c);
  const tint = (code: string) => withAlpha(colour(code), dark ? 0.14 : 0.07);
  const rtl = (code: string) => info(code)?.textDirection === "rtl" || ["ar", "fa", "ur", "he"].includes(info(code)?.language ?? "");
  const selWash = withAlpha(c.accentGreen, dark ? 0.28 : 0.16);
  const isSel = (v: number) => !!selected && v >= selected.start && v <= selected.end;
  const missing = (state: string) => <Text style={styles.missing}>{state === "ok" ? "Not in this translation" : state === "loading" ? "…" : "—"}</Text>;

  return (
    <View>
      {/* The key: one coloured badge per translation, in the same order as the columns / lines below. */}
      <View style={[styles.legend, cols > 1 && styles.legendCols]} accessibilityRole="summary" accessibilityLabel={`Comparing ${order.length} translations`}>
        {order.map((code, i) => {
          const p = all[code];
          return (
            <View key={code} style={[styles.legendItem, { borderLeftColor: colour(code), backgroundColor: tint(code) }, cols > 1 && { flex: 1 }]}>
              <View style={styles.legendHead}>
                <View style={[styles.badge, { backgroundColor: colour(code) }]}><Text style={styles.badgeText}>{label(code)}</Text></View>
                {i === 0 ? <Text style={[styles.reading, { color: colour(code) }]}>Reading</Text> : <Text style={styles.compareTag}>Comparing</Text>}
                {p?.status === "loading" ? <ActivityIndicator size="small" color={colour(code)} accessibilityLabel={`Loading ${code}`} /> : null}
              </View>
              <Text style={styles.name} numberOfLines={2}>{info(code)?.name ?? code}</Text>
              {p?.status === "error" ? (
                <View style={styles.errRow}>
                  <Text style={styles.err}>{p.message}</Text>
                  {p.httpStatus !== 404 ? (
                    <TouchableOpacity onPress={() => setAttempt((a) => ({ ...a, [code]: (a[code] ?? 0) + 1 }))} accessibilityRole="button" accessibilityLabel={`Try loading ${code} again`}>
                      <Text style={[styles.retry, { color: colour(code) }]}>Try again</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {rows.map((row) => (
        <TouchableOpacity key={row.verse} activeOpacity={0.7} onPress={() => onTapVerse(row.verse)} style={[styles.row, isSel(row.verse) && { backgroundColor: selWash }]}
          accessibilityRole={Platform.OS === "web" ? undefined : "button"} accessibilityState={{ selected: isSel(row.verse) }}
          accessibilityLabel={`Verse ${row.verse} in ${order.length} translations`}>
          {verseNumbers ? <Text style={styles.verseHead}>Verse {row.verse}</Text> : null}
          {cols > 1 ? (
            <View style={styles.cols}>
              {row.cells.map((cell) => (
                <View key={cell.code} style={[styles.cell, styles.col, { borderLeftColor: colour(cell.code), backgroundColor: tint(cell.code) }]}>
                  <Text style={[styles.text, { fontSize, lineHeight }, rtl(cell.code) && styles.rtl]}>{cell.text ?? missing(cell.state)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.stack}>
              {row.cells.map((cell) => (
                <View key={cell.code} style={[styles.cell, { borderLeftColor: colour(cell.code), backgroundColor: tint(cell.code) }]}
                  accessibilityLabel={`${info(cell.code)?.name ?? cell.code}: ${cell.text ?? "not available"}`}>
                  <View style={[styles.badge, styles.badgeSmall, { backgroundColor: colour(cell.code) }]}><Text style={[styles.badgeText, { fontSize: 10 }]}>{label(cell.code)}</Text></View>
                  <Text style={[styles.text, { fontSize, lineHeight }, rtl(cell.code) && styles.rtl]}>{cell.text ?? missing(cell.state)}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    legend: { gap: 8, marginBottom: 12 },
    legendCols: { flexDirection: "row", gap: 12 },
    legendItem: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderLeftWidth: 4, gap: 4 },
    legendHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
    badgeSmall: { paddingHorizontal: 6, paddingVertical: 2, marginBottom: 2 },
    badgeText: { fontSize: 12, color: "#fff", fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
    reading: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    compareTag: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
    name: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_500Medium" },
    errRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 },
    err: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    retry: { fontSize: 12, fontFamily: "Inter_600SemiBold", paddingVertical: 6 },
    row: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige, gap: 6 },
    verseHead: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
    cols: { flexDirection: "row", gap: 12 },
    // No flex on the cell itself: on phones (stacked) a flex basis of 0 collapses each line to zero height on web.
    cell: { borderLeftWidth: 3, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
    col: { flex: 1 },
    stack: { gap: 6 },
    text: { color: c.textDark, fontFamily: SCRIPTURE_FONT },
    rtl: { writingDirection: "rtl", textAlign: "right" },
    missing: { color: c.textMuted, fontStyle: "italic", fontSize: 13 },
  });
}
