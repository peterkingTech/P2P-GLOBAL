import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Button, Card, Chip, ConfirmDialog, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { guardTap, noteDialogClosed } from "@/components/studio/StudioSteps";
import {
  getStoryCollectionsAdmin, createStoryCollection, updateStoryCollection, setStoryCollectionStories, deleteStoryCollection,
  getKingdomStoriesAdminList, formatTopicNumber, type StoryCollectionAdmin, type KingdomStory,
} from "@/lib/kingdomStoriesApi";
import { IconButton } from "@/components/ui";

// Editorial collections for the Kingdom Stories homepage (migration 215):
// "Start Here", "Stories of Faith"… Each references existing stories in an
// order the editors choose (no copies). Only published collections — and
// only their published stories — reach readers. Deleting moves a collection
// to the Admin Recycle Bin.

export default function StoryCollectionsAdmin() {
  const { data, loading, error, reload } = useStudioQuery(async () => {
    const [cols, stories] = await Promise.all([getStoryCollectionsAdmin(), getKingdomStoriesAdminList()]);
    return { collections: cols.collections, stories };
  }, []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [picking, setPicking] = useState<StoryCollectionAdmin | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [removing, setRemoving] = useState<StoryCollectionAdmin | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); setOutcome({ tone: "success", text: ok }); }
    catch (e: any) { setOutcome({ tone: "error", text: e?.message ?? "Something went wrong." }); }
    finally { setBusy(false); await reload(); }
  }
  const storyById = new Map((data?.stories ?? []).map((s) => [s.id, s]));
  const cols = [...(data?.collections ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
  const move = (c: StoryCollectionAdmin, dir: -1 | 1) => {
    const i = cols.findIndex((x) => x.id === c.id), j = i + dir;
    if (j < 0 || j >= cols.length) return;
    const other = cols[j];
    act(async () => { await updateStoryCollection(c.id, { displayOrder: j }); await updateStoryCollection(other.id, { displayOrder: i }); }, "Order updated.");
  };

  return (
    <ScrollView style={ss.screen} contentContainerStyle={[ss.content, { maxWidth: 900, alignSelf: "center", width: "100%" }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading} accessibilityRole="header">Story collections</Text>
      <Text style={ss.meta}>Curated rows on the Kingdom Stories homepage. A collection appears once it is published, and shows only published stories, in the order you set here.</Text>
      {outcome ? <Banner tone={outcome.tone} text={outcome.text} onDismiss={() => setOutcome(null)} /> : null}

      <Card>
        <Text style={ss.title}>New collection</Text>
        <TextInput style={ss.input} value={title} onChangeText={setTitle} placeholder="Title, e.g. Start Here" placeholderTextColor={colors.textMuted} maxLength={120} accessibilityLabel="Collection title" />
        <TextInput style={[ss.input, { minHeight: 60 }]} value={description} onChangeText={setDescription} placeholder="Short description (optional)" placeholderTextColor={colors.textMuted} multiline maxLength={600} accessibilityLabel="Collection description" />
        <View style={ss.row}>
          <Button label="Create (as draft)" icon="add" disabled={!title.trim()} busy={busy}
            onPress={() => act(async () => { await createStoryCollection({ title: title.trim(), description: description.trim() || undefined, displayOrder: cols.length }); setTitle(""); setDescription(""); }, "Collection created as a draft.")} />
        </View>
      </Card>

      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} />
        : cols.length === 0 ? <StateView empty emptyText="No collections yet. Create one above." />
        : cols.map((c, i) => (
          <Card key={c.id}>
            <View style={[ss.row, { justifyContent: "space-between" }]}>
              <Text style={[ss.title, { flex: 1 }]}>{c.title}</Text>
              <Chip label={c.status === "published" ? "Published" : c.status === "archived" ? "Archived" : "Draft"} tone={c.status === "published" ? "green" : "grey"} />
            </View>
            {c.description ? <Text style={ss.body}>{c.description}</Text> : null}
            <Text style={ss.meta}>{c.storyIds.length} {c.storyIds.length === 1 ? "story" : "stories"}{c.storyIds.length ? `: ${c.storyIds.slice(0, 4).map((id) => storyById.get(id)?.title ?? "—").join(", ")}${c.storyIds.length > 4 ? "…" : ""}` : ""}</Text>
            {c.storyIds.some((id) => storyById.get(id)?.status !== "published") ? <Text style={ss.meta}>Unpublished stories in it stay hidden from readers until they're published.</Text> : null}
            <View style={ss.row}>
              <Button label="Choose stories" icon="list" tone="secondary" onPress={guardTap(() => { setPicked(c.storyIds); setPicking(c); })} />
              {c.status !== "published"
                ? <Button label="Publish" icon="cloud-upload-outline" disabled={!c.storyIds.length} onPress={guardTap(() => act(() => updateStoryCollection(c.id, { status: "published" }), `"${c.title}" is published.`))} />
                : <Button label="Unpublish" tone="secondary" onPress={guardTap(() => act(() => updateStoryCollection(c.id, { status: "draft" }), `"${c.title}" is a draft again.`))} />}
              <Button label="Up" icon="arrow-up" tone="secondary" disabled={i === 0} onPress={guardTap(() => move(c, -1))} />
              <Button label="Down" icon="arrow-down" tone="secondary" disabled={i === cols.length - 1} onPress={guardTap(() => move(c, 1))} />
              <Button label="Delete" icon="trash-outline" tone="danger" onPress={guardTap(() => setRemoving(c))} />
            </View>
          </Card>
        ))}

      <Modal visible={!!picking} transparent animationType="fade" onRequestClose={() => { noteDialogClosed(); setPicking(null); }}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={ss.title}>{picking?.title}: choose stories</Text>
            <Text style={ss.meta}>Tap to add or remove. The order below is the order readers see.</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {picked.map((id, i) => {
                const s = storyById.get(id);
                return (
                  <View key={id} style={styles.pickRow}>
                    <Text style={styles.pickNo}>{i + 1}</Text>
                    <Text style={[ss.body, { flex: 1 }]} numberOfLines={2}>{[formatTopicNumber(s?.topicNumber), s?.title ?? "Unknown story"].filter(Boolean).join(" · ")}{s && s.status !== "published" ? ` (${s.status})` : ""}</Text>
                    <IconButton icon="arrow-up" accessibilityLabel="Move up" onPress={() => setPicked((p) => { const n = [...p]; if (i > 0) [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} size="sm" color={colors.textMid} palette="fixedLight" />
                    <IconButton icon="close" accessibilityLabel="Remove" onPress={() => setPicked((p) => p.filter((x) => x !== id))} size="sm" color="#B91C1C" palette="fixedLight" />
                  </View>
                );
              })}
              <Text style={[ss.meta, { marginTop: 10 }]}>Add:</Text>
              {(data?.stories ?? []).filter((s: KingdomStory) => !picked.includes(s.id)).map((s: KingdomStory) => (
                <TouchableOpacity key={s.id} style={styles.pickRow} onPress={() => setPicked((p) => [...p, s.id])} accessibilityRole="button" accessibilityLabel={`Add ${s.title}`}>
                  <Ionicons name="add-circle-outline" size={18} color={colors.accentGreen} />
                  <Text style={[ss.body, { flex: 1 }]} numberOfLines={2}>{[formatTopicNumber(s.topicNumber), s.title].filter(Boolean).join(" · ")}{s.status !== "published" ? ` (${s.status})` : ""}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={[ss.row, { justifyContent: "flex-end" }]}>
              <Button label="Cancel" tone="secondary" onPress={() => { noteDialogClosed(); setPicking(null); }} />
              <Button label="Save" busy={busy} onPress={() => { const c = picking!; noteDialogClosed(); setPicking(null); act(() => setStoryCollectionStories(c.id, picked), `"${c.title}" updated.`); }} />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog visible={!!removing} title="Move collection to the Recycle Bin?"
        message={removing ? `"${removing.title}" leaves the homepage now. Its stories are not affected. It can be restored from Admin → Recycle Bin.` : ""}
        confirmLabel="Move to Recycle Bin" tone="danger" busy={busy}
        onConfirm={() => { const c = removing!; noteDialogClosed(); setRemoving(null); act(() => deleteStoryCollection(c.id), `"${c.title}" moved to the Recycle Bin.`); }}
        onCancel={() => { noteDialogClosed(); setRemoving(null); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, color: colors.textDark, fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 },
  sheet: { width: "100%", maxWidth: 620, alignSelf: "center", backgroundColor: colors.lightCream, borderRadius: 14, padding: 16, gap: 10 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderBeige },
  pickNo: { width: 22, fontSize: 12, color: colors.textMuted, fontFamily: "Inter_700Bold", textAlign: "right" },
});
