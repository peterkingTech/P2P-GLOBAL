import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Button, Card, Chip, ConfirmDialog, Pager, Pill, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { guardTap, noteDialogClosed } from "@/components/studio/StudioSteps";
import {
  listRecycleBin, getRecycleEntry, restoreEntry, purgeEntry, describeCounts, PURGE_CONFIRMATION,
  type RecycleEntry, type RecycleStatus, type RecycleType,
} from "@/lib/recycleBinApi";
import { deviceTimeZone, formatInZone } from "@/lib/studioModel";

// Admin Recycle Bin (migration 214). Deleted admin content waits here with
// everything that belonged to it (learners' work included) until it is
// restored — same ids, same publication state, never published by a restore —
// or permanently deleted by a super admin (typed confirmation). The list shows
// only the content types the signed-in admin's role manages; the server and
// database re-check every action.

const STATUS_TABS: { value: RecycleStatus; label: string; empty: string }[] = [
  { value: "in_bin", label: "In the bin", empty: "Nothing has been deleted. Deleted content waits here until it is restored." },
  { value: "restored", label: "Restored", empty: "Nothing has been restored yet." },
  { value: "purged", label: "Permanently deleted", empty: "Nothing has been permanently deleted." },
];
const PARENT_LABEL: Record<string, string> = {
  curriculum: "In", module: "In module", lesson: "In lesson", kingdom_story: "In story", kingdom_story_category: "Category",
  prayer_topic: "Under topic", prayer_path: "In path", mission_field: "Field", mission_story: "For story",
};
type Pending = { entry: RecycleEntry; action: "restore" | "purge" };

export default function RecycleBinScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tz = deviceTimeZone();
  const [status, setStatus] = useState<RecycleStatus>("in_bin");
  const [type, setType] = useState<RecycleType | "">("");
  const [deletedBy, setDeletedBy] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useStudioQuery(() => listRecycleBin({ status, type, q, deletedBy, page }), [status, type, q, deletedBy, page]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: "success" | "error" | "info"; text: string; id?: string } | null>(null);
  const [open, setOpen] = useState<Record<string, RecycleEntry | "loading" | "error">>({});

  const reset = (fn: () => void) => { fn(); setPage(0); setOutcome(null); };
  async function toggleDetail(e: RecycleEntry) {
    if (open[e.id]) { setOpen((o) => { const n = { ...o }; delete n[e.id]; return n; }); return; }
    setOpen((o) => ({ ...o, [e.id]: "loading" }));
    try { const d = await getRecycleEntry(e.id); setOpen((o) => ({ ...o, [e.id]: d })); }
    catch { setOpen((o) => ({ ...o, [e.id]: "error" })); }
  }

  async function confirm(note: string) {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === "restore") {
        const r = await restoreEntry(pending.entry.id);
        setOutcome({ tone: r.warnings.length ? "info" : "success", id: pending.entry.id,
          text: `"${pending.entry.title}" is restored${pending.entry.originalStatus ? ` as ${pending.entry.originalStatus}` : ""}.${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}` });
      } else {
        const r = await purgeEntry(pending.entry.id, note.trim());
        setOutcome({ tone: r.fileErrors ? "info" : "success", id: pending.entry.id,
          text: `"${pending.entry.title}" was permanently deleted.${r.keptFiles ? ` ${r.keptFiles} file${r.keptFiles === 1 ? " is" : "s are"} still used elsewhere and ${r.keptFiles === 1 ? "was" : "were"} kept.` : ""}${r.fileErrors ? ` ${r.fileErrors} file${r.fileErrors === 1 ? "" : "s"} could not be removed from storage.` : ""}` });
      }
    } catch (e: any) {
      setOutcome({ tone: "error", text: e?.message ?? "Something went wrong.", id: pending.entry.id });
    } finally {
      setBusy(false); noteDialogClosed(); setPending(null);
      await reload();
    }
  }

  const tab = STATUS_TABS.find((t) => t.value === status)!;
  const filtered = !!(type || q || deletedBy);
  return (
    <ScrollView style={ss.screen} contentContainerStyle={[ss.content, width >= 1000 && { maxWidth: 1100, alignSelf: "center", width: "100%" }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading} accessibilityRole="header">Recycle Bin</Text>
      <Text style={ss.meta}>Deleting lessons, curricula, Kingdom Stories, chapters, images, prayer and mission content moves it here with everything that belonged to it, including learners' answers and progress. Restoring brings it back exactly as it was — never published by a restore.</Text>

      <View style={ss.row} accessibilityRole="tablist">
        {STATUS_TABS.map((t) => <Pill key={t.value} label={t.label} selected={status === t.value} onPress={guardTap(() => reset(() => setStatus(t.value)))} />)}
      </View>

      <View style={styles.filters}>
        <TextInput style={[ss.input, styles.search]} value={search} onChangeText={setSearch} placeholder="Search titles" placeholderTextColor={colors.textMuted}
          returnKeyType="search" onSubmitEditing={() => reset(() => setQ(search.trim()))} accessibilityLabel="Search deleted items by title" />
        <Button label="Search" icon="search" tone="secondary" onPress={() => reset(() => setQ(search.trim()))} />
        {filtered ? <Button label="Clear filters" tone="secondary" onPress={() => reset(() => { setType(""); setQ(""); setSearch(""); setDeletedBy(""); })} /> : null}
      </View>
      {data?.types?.length ? (
        <View style={ss.row}>
          <Pill label="All types" selected={!type} onPress={() => reset(() => setType(""))} />
          {data.types.map((t) => <Pill key={t.value} label={t.label} selected={type === t.value} onPress={() => reset(() => setType(t.value))} />)}
        </View>
      ) : null}
      {data?.deleters && data.deleters.length > 1 ? (
        <View style={ss.row}>
          <Text style={ss.meta}>Deleted by:</Text>
          <Pill label="Anyone" selected={!deletedBy} onPress={() => reset(() => setDeletedBy(""))} />
          {data.deleters.map((d) => <Pill key={d.id} label={d.name} selected={deletedBy === d.id} onPress={() => reset(() => setDeletedBy(d.id))} />)}
        </View>
      ) : null}

      {outcome && !outcome.id ? <Banner tone={outcome.tone} text={outcome.text} onDismiss={() => setOutcome(null)} /> : null}

      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : data ? (
        <>
          <Text style={ss.h2} accessibilityRole="header">{tab.label} ({data.total})</Text>
          {data.types.length === 0 ? <StateView empty emptyText="Your role doesn't manage any content that uses the Recycle Bin." />
            : data.items.length === 0 ? <StateView empty emptyText={filtered ? "Nothing matches these filters." : tab.empty} />
            : data.items.map((e) => {
              const d = open[e.id];
              return (
                <Card key={e.id}>
                  <Text style={ss.title}>{e.title}</Text>
                  <View style={ss.row}>
                    <Chip label={e.typeLabel} tone="blue" />
                    {e.originalStatus ? <Chip label={`Was ${e.originalStatus}`} tone={e.originalStatus === "published" ? "green" : "grey"} /> : null}
                    {e.fileCount ? <Chip label={`${e.fileCount} file${e.fileCount === 1 ? "" : "s"} kept`} /> : null}
                  </View>
                  {e.parentLabel ? <Text style={ss.meta}>{PARENT_LABEL[e.parentType ?? ""] ?? "In"}: {e.parentLabel}</Text> : null}
                  <Text style={ss.meta}>Deleted {formatInZone(e.deletedAt, tz)}{e.deletedBy ? ` by ${e.deletedBy.name}` : ""}</Text>
                  {e.restoredAt ? <Text style={ss.meta}>Restored {formatInZone(e.restoredAt, tz)}{e.restoredBy ? ` by ${e.restoredBy.name}` : ""}</Text> : null}
                  {e.purgedAt ? <Text style={ss.meta}>Permanently deleted {formatInZone(e.purgedAt, tz)}{e.purgedBy ? ` by ${e.purgedBy.name}` : ""}</Text> : null}
                  {describeCounts(e.counts) ? <Text style={ss.body}>Includes {describeCounts(e.counts)}.</Text> : null}
                  {e.restoreWarnings?.length ? <Banner tone="info" text={e.restoreWarnings.join(" ")} /> : null}
                  {outcome?.id === e.id ? <Banner tone={outcome.tone} text={outcome.text} onDismiss={() => setOutcome(null)} /> : null}
                  {d && d !== "loading" && d !== "error" && d.preview ? (
                    <View style={styles.preview} accessibilityLabel="Preview of the deleted item">
                      {Object.entries(d.preview).map(([k, v]) => <Text key={k} style={ss.body}><Text style={styles.previewKey}>{k.replace(/_/g, " ")}: </Text>{String(v)}</Text>)}
                    </View>
                  ) : d === "loading" ? <StateView loading /> : d === "error" ? <Text style={ss.meta}>The preview couldn't be loaded.</Text> : null}
                  <View style={ss.row}>
                    <Button label={d ? "Hide preview" : "Preview"} icon="eye-outline" tone="secondary" onPress={guardTap(() => toggleDetail(e))} />
                    {e.status === "in_bin" ? <Button label="Restore" icon="arrow-undo-outline" onPress={guardTap(() => { setOutcome(null); setPending({ entry: e, action: "restore" }); })} /> : null}
                    {e.status === "in_bin" && data.canPurge ? <Button label="Delete permanently" icon="trash-outline" tone="danger" onPress={guardTap(() => { setOutcome(null); setPending({ entry: e, action: "purge" }); })} /> : null}
                    {e.status === "restored" && e.contentType === "kingdom_story" ? <Button label="Open story" icon="open-outline" tone="secondary" onPress={guardTap(() => router.push(`/admin/kingdom-stories/${e.contentId}` as any))} /> : null}
                  </View>
                </Card>
              );
            })}
          {data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
        </>
      ) : null}

      <ConfirmDialog
        visible={!!pending}
        title={pending?.action === "purge" ? "Delete permanently?" : "Restore this item?"}
        message={pending ? (pending.action === "purge"
          ? `"${pending.entry.title}"${describeCounts(pending.entry.counts) ? ` and everything that belonged to it (${describeCounts(pending.entry.counts)})` : ""} will be deleted for good, including learners' answers and progress kept with it. Files no other content uses are removed from storage. This cannot be undone.`
          : `"${pending.entry.title}" comes back exactly as it was${pending.entry.originalStatus ? ` (${pending.entry.originalStatus})` : ""}, with everything that belonged to it. A restore never publishes anything.`) : ""}
        confirmLabel={pending?.action === "purge" ? "Delete permanently" : "Restore"}
        tone={pending?.action === "purge" ? "danger" : "primary"}
        notePrompt={pending?.action === "purge" ? `Type ${PURGE_CONFIRMATION} to confirm` : undefined}
        confirmText={pending?.action === "purge" ? PURGE_CONFIRMATION : undefined}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => { noteDialogClosed(); setPending(null); }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, color: colors.textDark, fontFamily: "Inter_700Bold" },
  filters: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  search: { flexGrow: 1, minWidth: 180, minHeight: 44 },
  preview: { backgroundColor: "#fff", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.borderBeige, gap: 4 },
  previewKey: { fontFamily: "Inter_600SemiBold", color: colors.textDark, textTransform: "capitalize" },
});
