import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, SegmentedControl } from "@/components/ui";
import { createCollection, listCollections, PERMISSION_LABEL, type CollectionCard, type CollectionKind } from "@/lib/scriptureCollectionsApi";

// Scripture Collections — my collections and listening playlists, and the
// ones people have shared with me. Each card says what it is: an original,
// my personal copy of someone's collection, or shared with me (by whom, and
// what I may do). Private until I share it.

type Tab = "collection" | "playlist" | "shared";
const TABS: { value: Tab; label: string }[] = [
  { value: "collection", label: "Collections" },
  { value: "playlist", label: "Playlists" },
  { value: "shared", label: "Shared with me" },
];

export default function ScriptureCollectionsScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<{ mine: CollectionCard[]; shared: CollectionCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("collection");
  const [naming, setNaming] = useState<CollectionKind | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await listCollections()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your collections."); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function create() {
    if (!naming || !name.trim()) return;
    setBusy(true);
    try {
      const { id } = await createCollection(naming, name.trim());
      setNaming(null); setName("");
      router.push({ pathname: "/scripture-collections/[id]", params: { id } } as any);
    } catch (e: any) { setError(e?.message ?? "Couldn't create it."); }
    finally { setBusy(false); }
  }

  const list = !data ? [] : tab === "shared" ? data.shared : data.mine.filter((x) => x.kind === tab);
  const kindWord = tab === "playlist" ? "playlist" : "collection";

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "Scripture Collections" }} />
      <Text style={s.intro}>Gather passages into collections, arrange them into listening playlists, and share them with your people. Private until you share.</Text>
      <SegmentedControl accessibilityLabel="Show" value={tab} onChange={(v) => setTab(v as Tab)} options={TABS} style={{ marginBottom: 14 }} />

      {tab !== "shared" && (naming ? (
        <View style={s.newBox}>
          <Text style={s.label}>Name your new {naming}</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder={naming === "playlist" ? "e.g. Morning Psalms" : "e.g. Promises of comfort"}
            placeholderTextColor={c.textMuted} maxLength={120} autoFocus onSubmitEditing={create} accessibilityLabel={`Name of the new ${naming}`} />
          <View style={s.row}>
            <AppButton label="Create" onPress={create} disabled={!name.trim() || busy} loading={busy} size="sm" />
            <AppButton label="Cancel" onPress={() => { setNaming(null); setName(""); }} variant="tertiary" size="sm" />
          </View>
        </View>
      ) : (
        <AppButton label={`New ${kindWord}`} icon="add" onPress={() => setNaming(tab as CollectionKind)} variant="secondary" style={{ marginBottom: 14 }} />
      ))}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}
      {data && !list.length ? (
        <View style={s.empty}>
          <Ionicons name={tab === "shared" ? "people-outline" : tab === "playlist" ? "musical-notes-outline" : "albums-outline"} size={28} color={c.accentGreen} />
          <Text style={s.emptyText}>
            {tab === "shared" ? "When someone shares a collection or playlist with you, it appears here."
              : tab === "playlist" ? "Make a playlist from a collection, or add passages to a new one, to listen in your own order."
                : "Start a collection, then add passages from the Bible reader or your saved passages."}
          </Text>
        </View>
      ) : null}

      {list.map((x) => (
        <Pressable key={x.id} onPress={() => router.push({ pathname: "/scripture-collections/[id]", params: { id: x.id } } as any)}
          style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]} accessibilityRole="button"
          accessibilityLabel={`${x.title}. ${x.itemCount} passages. ${badge(x)}`}>
          <View style={s.icon}><Ionicons name={x.kind === "playlist" ? "musical-notes-outline" : "albums-outline"} size={20} color={c.accentGreen} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.title} numberOfLines={2}>{x.title}</Text>
            <Text style={s.meta} numberOfLines={2}>{x.itemCount} {x.itemCount === 1 ? "passage" : "passages"} · {badge(x)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function badge(x: CollectionCard): string {
  if (x.ownerName) return `Shared by ${x.sharedByName ?? x.ownerName}${x.permission ? ` · ${PERMISSION_LABEL[x.permission]}` : ""}`;
  if (x.isCopy) return `Your copy of ${x.originOwnerName ?? "someone"}'s`;
  return x.shareCount ? `Shared with ${x.shareCount}` : "Private";
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, paddingBottom: 48 },
    intro: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 14 },
    newBox: { padding: 14, borderRadius: 16, backgroundColor: c.card, gap: 10, marginBottom: 14 },
    label: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 15 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 10 },
    empty: { alignItems: "center", gap: 10, padding: 24, borderRadius: 18, backgroundColor: c.card },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: c.card, marginBottom: 10, minHeight: 64 },
    icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: `${c.accentGreen}1A` },
    title: { fontSize: 15.5, lineHeight: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
