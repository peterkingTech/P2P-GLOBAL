import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import type { NewRef } from "@/lib/bibleReaderApi";
import { addToCollection, createCollection, listCollections, type CollectionCard, type CollectionKind } from "@/lib/scriptureCollectionsApi";

// "Add to collection": put the selected passage(s) into one of my collections
// or playlists (or one shared with me for collaborative editing), or start a
// new one. Only the reference is added — never the text, never my notes.
export default function AddToCollectionSheet({ visible, refs, label, onClose, onDone }: {
  visible: boolean; refs: NewRef[]; label: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<CollectionCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [naming, setNaming] = useState<CollectionKind | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!visible) return;
    setList(null); setNaming(null); setName(""); setError(null);
    listCollections()
      .then((r) => setList([...r.mine, ...r.shared.filter((x) => x.permission === "collaborate")]))
      .catch((e: any) => { setError(e?.message ?? "Couldn't load your collections."); setList([]); });
  }, [visible]);

  async function addTo(x: CollectionCard) {
    setBusy(x.id);
    try { await addToCollection(x.id, refs); onDone(`Added to ${x.title}`); }
    catch (e: any) { setError(e?.message ?? "Couldn't add it."); }
    finally { setBusy(null); }
  }
  async function create() {
    if (!naming || !name.trim()) return;
    setBusy("new");
    try { await createCollection(naming, name.trim(), refs); onDone(`Added to ${name.trim()}`); }
    catch (e: any) { setError(e?.message ?? "Couldn't create it."); }
    finally { setBusy(null); }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={s.head}>
            <Text style={s.title} numberOfLines={2} accessibilityRole="header">Add {label}</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
            {!list ? <ActivityIndicator color={c.accentGreen} style={{ margin: 20 }} accessibilityLabel="Loading" /> : null}
            {list?.map((x) => (
              <Pressable key={x.id} style={s.row} onPress={() => addTo(x)} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Add to ${x.title}`}>
                <Ionicons name={x.kind === "playlist" ? "musical-notes-outline" : "albums-outline"} size={20} color={c.accentGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={2}>{x.title}</Text>
                  <Text style={s.muted}>{x.itemCount} {x.itemCount === 1 ? "passage" : "passages"}{x.ownerName ? ` · ${x.ownerName}'s` : ""}</Text>
                </View>
                {busy === x.id ? <ActivityIndicator color={c.accentGreen} /> : <Ionicons name="add-circle-outline" size={22} color={c.textMuted} />}
              </Pressable>
            ))}
          </ScrollView>
          {naming ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <TextInput style={s.input} value={name} onChangeText={setName} autoFocus maxLength={120} placeholder={`Name your new ${naming}`} placeholderTextColor={c.textMuted}
                onSubmitEditing={create} accessibilityLabel={`Name of the new ${naming}`} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <AppButton label="Create and add" size="sm" onPress={create} disabled={!name.trim() || !!busy} loading={busy === "new"} />
                <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => setNaming(null)} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <AppButton label="New collection" icon="add" size="sm" variant="secondary" onPress={() => setNaming("collection")} />
              <AppButton label="New playlist" icon="add" size="sm" variant="tertiary" onPress={() => setNaming("playlist")} />
            </View>
          )}
          <Text style={[s.muted, { marginTop: 10 }]}>Only the reference is added. Your notes and highlights stay private.</Text>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, maxWidth: 640, width: "100%", alignSelf: "center" },
    head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    muted: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium", marginBottom: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12 },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.card, fontFamily: "Inter_400Regular", fontSize: 15 },
  });
}
