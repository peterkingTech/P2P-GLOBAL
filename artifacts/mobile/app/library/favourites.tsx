import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton, SegmentedControl } from "@/components/ui";
import CoverArt from "@/components/library/CoverArt";
import { bibleRoute } from "@/lib/bibleReaderApi";
import { listFavourites, removeFavourite, type Favourites } from "@/lib/scriptureLibraryApi";
import { playRefs } from "@/lib/listen/playlistSession";

// Favourites — passages, playlists and collections I marked with a heart.
// Removing a favourite only removes the heart: the passage, playlist or
// collection itself stays. A playlist that's no longer shared with me drops out.
type Tab = "passages" | "playlists" | "collections";

export default function FavouritesScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<Favourites | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("passages");

  const load = useCallback(async () => {
    try { setData(await listFavourites()); setError(null); }
    catch (e: any) { setError(e?.status === 503 ? "Favourites are coming soon." : e?.message ?? "Couldn't load your favourites."); setData((d) => d ?? { passages: [], playlists: [], collections: [] }); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const unfavourite = async (id: string) => { try { await removeFavourite(id); } catch (e: any) { setError(e?.message ?? "Couldn't remove it."); } load(); };

  const lists = data ? { passages: data.passages.length, playlists: data.playlists.length, collections: data.collections.length } : null;
  const groups = data ? (tab === "playlists" ? data.playlists : data.collections) : [];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Favourites" }} />
      <SegmentedControl accessibilityLabel="Show" value={tab} onChange={(v) => setTab(v as Tab)}
        options={[{ value: "passages", label: `Scriptures${lists ? ` · ${lists.passages}` : ""}` }, { value: "playlists", label: `Playlists${lists ? ` · ${lists.playlists}` : ""}` }, { value: "collections", label: `Collections${lists ? ` · ${lists.collections}` : ""}` }]} />
      {error ? <Text style={s.hint}>{error}</Text> : null}
      {!data ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}

      {data && tab === "passages" ? (
        <>
          {data.passages.length > 1 ? <AppButton label="Listen to all" icon="headset-outline" variant="secondary" onPress={() => playRefs("Favourite Scriptures", data.passages.map((p) => ({ ref: p, reference: p.reference })), "library")} /> : null}
          {!data.passages.length ? <Empty s={s} c={c} text="Tap the heart when you save a passage, and it appears here." /> : data.passages.map((p) => (
            <View key={p.id} style={s.row}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(bibleRoute({ book: p.bookCode, chapter: p.chapter, v: p.startVerse, ve: p.endVerse, translation: p.translationCode }) as any)}
                accessibilityRole="button" accessibilityLabel={`Read ${p.reference}`}>
                <Text style={s.title}>{p.reference} <Text style={s.trans}>{p.translationCode}</Text></Text>
              </Pressable>
              <IconButton icon="headset-outline" accessibilityLabel={`Listen to ${p.reference}`} onPress={() => playRefs(p.reference, [{ ref: p, reference: p.reference }], "library")} />
              <IconButton icon="heart" color={c.accentGreen} accessibilityLabel={`Remove ${p.reference} from favourites`} onPress={() => unfavourite(p.id)} />
            </View>
          ))}
        </>
      ) : null}
      {data && tab !== "passages" ? (
        !groups.length ? <Empty s={s} c={c} text={`Tap the heart on a ${tab === "playlists" ? "playlist" : "collection"} to keep it here.`} /> : groups.map((g) => (
          <View key={g.id} style={s.row}>
            <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => router.push({ pathname: "/scripture-collections/[id]", params: { id: g.collectionId } } as any)}
              accessibilityRole="button" accessibilityLabel={`Open ${g.title}`}>
              <CoverArt cover={null} kind={g.kind} size={44} />
              <Text style={[s.title, { flex: 1 }]} numberOfLines={2}>{g.title}</Text>
            </Pressable>
            <IconButton icon="heart" color={c.accentGreen} accessibilityLabel={`Remove ${g.title} from favourites`} onPress={() => unfavourite(g.id)} />
          </View>
        ))
      ) : null}
    </ScrollView>
  );
}

function Empty({ s, c, text }: { s: ReturnType<typeof makeStyles>; c: AppColors; text: string }) {
  return <View style={s.empty}><Ionicons name="heart-outline" size={28} color={c.accentGreen} /><Text style={s.emptyText}>{text}</Text></View>;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 120 },
    hint: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    row: { flexDirection: "row", alignItems: "center", gap: 4, padding: 10, borderRadius: 16, backgroundColor: c.card, minHeight: 60 },
    title: { fontSize: 15, lineHeight: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    trans: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    empty: { alignItems: "center", gap: 10, padding: 22, borderRadius: 18, backgroundColor: c.card },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
