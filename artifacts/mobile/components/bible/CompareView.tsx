import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { BibleApiError, SCRIPTURE_FONT, getChapter, type BibleChapter, type BibleTranslation } from "@/lib/bibleReaderApi";
import { alignVerses, compareColumns, type PanelState } from "@/lib/bibleCompare";
import { withAlpha } from "@/lib/colorUtils";

// The chapter in several licensed translations, verse by verse. Wide screens
// put translations side by side; phones stack them under each verse, so every
// translation stays on the same verse while scrolling. Each translation loads
// (and can fail and retry) on its own. Tapping a verse selects it in the
// translation being read, for the reader's usual highlight / note / save bar.
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

export default function CompareView({ bookCode, chapter, primary, others, translations, width, fontSize, lineHeight, verseNumbers, selected, onTapVerse }: Props) {
  const { colors: c, resolvedMode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const [attempt, setAttempt] = useState<Record<string, number>>({});

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
  const nameOf = (code: string) => translations.find((t) => t.code === code);
  const wash = withAlpha(c.accentGreen, resolvedMode === "dark" ? 0.28 : 0.16);
  const isSel = (v: number) => !!selected && v >= selected.start && v <= selected.end;

  return (
    <View>
      <View style={[styles.legend, cols > 1 && styles.legendCols]}>
        {order.map((code, i) => {
          const p = all[code];
          return (
            <View key={code} style={[styles.legendItem, cols > 1 && { flex: 1 }]}>
              <View style={styles.legendHead}>
                <Text style={styles.code}>{code}</Text>
                {i === 0 ? <Text style={styles.reading}>reading</Text> : null}
                {p?.status === "loading" ? <ActivityIndicator size="small" color={c.accentGreen} accessibilityLabel={`Loading ${code}`} /> : null}
              </View>
              <Text style={styles.name} numberOfLines={1}>{nameOf(code)?.name ?? code}</Text>
              {p?.status === "error" ? (
                <View style={styles.errRow}>
                  <Text style={styles.err}>{p.message}</Text>
                  {p.httpStatus !== 404 ? (
                    <TouchableOpacity onPress={() => setAttempt((a) => ({ ...a, [code]: (a[code] ?? 0) + 1 }))} accessibilityRole="button" accessibilityLabel={`Try loading ${code} again`}>
                      <Text style={styles.retry}>Try again</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {rows.map((row) => (
        <TouchableOpacity key={row.verse} activeOpacity={0.7} onPress={() => onTapVerse(row.verse)} style={[styles.row, isSel(row.verse) && { backgroundColor: wash }]}
          accessibilityRole={Platform.OS === "web" ? undefined : "button"} accessibilityState={{ selected: isSel(row.verse) }}
          accessibilityLabel={`Verse ${row.verse} in ${order.length} translations`}>
          {cols > 1 ? (
            <View style={styles.cols}>
              {row.cells.map((cell) => (
                <Text key={cell.code} style={[styles.text, { fontSize, lineHeight, flex: 1 }]}>
                  {verseNumbers ? <Text style={[styles.num, { fontSize: Math.round(fontSize * 0.62) }]}>{row.verse}{" "}</Text> : null}
                  {cell.text ?? <Text style={styles.missing}>{cell.state === "ok" ? "Not in this translation" : cell.state === "loading" ? "…" : "—"}</Text>}
                </Text>
              ))}
            </View>
          ) : (
            <View style={styles.stack}>
              <Text style={[styles.num, styles.stackNum]}>{row.verse}</Text>
              {row.cells.map((cell) => (
                <View key={cell.code} style={styles.stackLine}>
                  <Text style={styles.stackCode}>{cell.code}</Text>
                  <Text style={[styles.text, { fontSize, lineHeight, flex: 1 }]}>
                    {cell.text ?? <Text style={styles.missing}>{cell.state === "ok" ? "Not in this translation" : cell.state === "loading" ? "…" : "—"}</Text>}
                  </Text>
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
    legend: { gap: 8, marginBottom: 10 },
    legendCols: { flexDirection: "row", gap: 16 },
    legendItem: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    legendHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    code: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    reading: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    name: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    errRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 },
    err: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    retry: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", paddingVertical: 6 },
    row: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    cols: { flexDirection: "row", gap: 16 },
    stack: { gap: 4 },
    stackNum: { fontSize: 12 },
    stackLine: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    stackCode: { width: 44, fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", paddingTop: 3 },
    text: { color: c.textDark, fontFamily: SCRIPTURE_FONT },
    num: { color: c.accentGreen, fontFamily: "Inter_700Bold" },
    missing: { color: c.textMuted, fontStyle: "italic", fontSize: 13 },
  });
}
