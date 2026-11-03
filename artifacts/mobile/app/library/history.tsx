import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { bibleRoute } from "@/lib/bibleReaderApi";
import { clearHistory, listHistory, type HistoryItem } from "@/lib/scriptureLibraryApi";
import { playRefs, resumePlaylist } from "@/lib/listen/playlistSession";

// Listening history — what I listened to, private to me. "Listened" means
// heard to the end; others show when they were started. Clearing removes the
// history only: playlists, saved Scriptures and favourites stay. Encouraging,
// never a score: no streaks, totals of minutes or rankings.

export default function HistoryScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems((await listHistory(100)).items); setError(null); }
    catch (e: any) { setError(e?.status === 503 ? "Listening history is coming soon." : e?.message ?? "Couldn't load your history."); setItems((x) => x ?? []); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const clear = () => {
    const go = async () => { try { const r = await clearHistory(); setNotice(`Cleared ${r.cleared} ${r.cleared === 1 ? "entry" : "entries"}. Your playlists and saved Scriptures are unchanged.`); } catch (e: any) { setNotice(e?.message ?? "Couldn't clear it."); } load(); };
    if (Platform.OS === "web") { if (globalThis.confirm?.("Clear your listening history? Playlists and saved Scriptures stay.")) go(); return; }
    Alert.alert("Clear history", "Clear your listening history? Playlists and saved Scriptures stay.", [{ text: "Cancel", style: "cancel" }, { text: "Clear", style: "destructive", onPress: go }]);
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  let lastDay = "";

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Listening history" }} />
      <Text style={s.hint}>Only you can see this.</Text>
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text style={s.hint}>{error}</Text> : null}
      {!items ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}
      {items && !items.length && !error ? (
        <View style={s.empty}>
          <Ionicons name="headset-outline" size={28} color={c.accentGreen} />
          <Text style={s.emptyText}>Start listening to Scripture — what you hear appears here.</Text>
          <AppButton label="Open my library" variant="secondary" onPress={() => router.push("/library" as any)} />
        </View>
      ) : null}
      {items?.map((h) => {
        const d = day(h.startedAt);
        const header = d !== lastDay ? (lastDay = d) : null;
        return (
          <View key={h.id}>
            {header ? <Text style={s.day} accessibilityRole="header">{header}</Text> : null}
            <View style={s.row}>
              <Ionicons name={h.completedAt ? "checkmark-circle" : "time-outline"} size={20} color={h.completedAt ? c.accentGreen : c.textMuted} accessibilityLabel={h.completedAt ? "Listened" : "Started"} />
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{h.reference} <Text style={s.trans}>{h.translationCode}</Text></Text>
                <Text style={s.meta}>{h.completedAt ? "Listened" : "Started"} · {new Date(h.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{h.collection ? ` · ${h.collection.title}` : ""}</Text>
              </View>
              {h.collection ? <IconButton icon="play-circle-outline" accessibilityLabel={`Continue ${h.collection.title}`} onPress={() => resumePlaylist(h.collection!.id).catch((e) => setNotice(e?.message ?? "Couldn't continue."))} />
                : <IconButton icon="headset-outline" accessibilityLabel={`Listen to ${h.reference} again`} onPress={() => playRefs(h.reference, [{ ref: h, reference: h.reference }], "library")} />}
              <IconButton icon="book-outline" accessibilityLabel={`Read ${h.reference}`} onPress={() => router.push(bibleRoute({ book: h.bookCode, chapter: h.chapter, v: h.startVerse, ve: h.endVerse, translation: h.translationCode }) as any)} />
            </View>
          </View>
        );
      })}
      {items?.length ? <AppButton label="Clear listening history" icon="trash-outline" variant="tertiary" onPress={clear} style={{ marginTop: 12 }} /> : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 8, paddingBottom: 120, maxWidth: 820, width: "100%", alignSelf: "center" },
    hint: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, lineHeight: 18, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    day: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold", marginTop: 12, marginBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 14, backgroundColor: c.card, minHeight: 58 },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    trans: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular" },
    empty: { alignItems: "center", gap: 10, padding: 22, borderRadius: 18, backgroundColor: c.card },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
