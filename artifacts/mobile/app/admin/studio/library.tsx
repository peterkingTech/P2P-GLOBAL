import React, { useState } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Button, Chip, ConfirmDialog, Pager, Pill, StateView, nativeTone, reviewTone, studioStyles as ss } from "@/components/studio/StudioUI";
import { getStudioItems, type SourceType, type StudioItem } from "@/lib/studioApi";
import {
  ACTION_LABELS, NATIVE_STATUS_LABELS, REVIEW_LABELS, SOURCE_LABELS, STATUS_FILTERS, STUDIO_AUDIT_ROLES,
  deviceTimeZone, formatInZone, isApprovalStale, nextSchedule, publishNowBlocker, reviewStateOf,
} from "@/lib/studioModel";
import { runStatusChange, type ActionOutcome } from "@/lib/studioActions";
import { AppButton } from "@/components/ui";

// Content Library: the canonical records themselves (no copies), page by page.
// Kingdom Stories open in their existing editor and can be published (after
// approval), unpublished or scheduled; every other type is read-only here and
// links to the place it is actually managed.

const TYPES: SourceType[] = ["kingdom_story", "kingdom_win", "curriculum", "prayer_topic", "prayer_path"];
const PAGE_SIZE = 20;

export default function StudioLibrary() {
  const router = useRouter();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const tz = deviceTimeZone();
  const [type, setType] = useState<SourceType>("kingdom_story");
  const [queryText, setQueryText] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<{ item: StudioItem; status: "published" | "draft" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const { data, loading, error, reload } = useStudioQuery(() => getStudioItems({ sourceType: type, q, status, page, pageSize: PAGE_SIZE }), [type, q, status, page]);
  const canAudit = !!profile && STUDIO_AUDIT_ROLES.includes(profile.role);

  const chooseType = (t: SourceType) => { setType(t); setStatus(""); setPage(0); setOutcome(null); };
  const search = () => { setQ(queryText.trim()); setPage(0); };

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const r = await runStatusChange(pending.item, pending.status);
    setBusy(false); setPending(null); setOutcome(r);
    await reload();
  }

  const renderStory = (item: StudioItem) => {
    const next = nextSchedule(item);
    const rs = reviewStateOf(item);
    const blocker = publishNowBlocker(item, !!data?.editable);
    return (
      <>
        <View style={ss.row}>
          <Chip label={NATIVE_STATUS_LABELS[item.nativeStatus] ?? item.nativeStatus} tone={nativeTone(item.nativeStatus)} />
          <Chip label={REVIEW_LABELS[rs]} tone={reviewTone(rs)} />
          {isApprovalStale(item) ? <Chip label="Changed since approval" tone="red" /> : null}
          {next ? <Chip label={`${ACTION_LABELS[next.action]} ${formatInZone(next.runAt, tz)}`} tone="blue" /> : null}
          {item.schedules.some((s) => s.status === "failed") ? <Chip label="Scheduled job failed" tone="red" /> : null}
        </View>
        <View style={[styles.actions, wide && styles.actionsWide]}>
          <IconAction icon="create-outline" label="Open editor" onPress={() => router.push(`/admin/kingdom-stories/${item.sourceId}` as any)} />
          <IconAction icon="time-outline" label="Schedule" onPress={() => router.push({ pathname: "/admin/studio/schedule", params: { sourceId: item.sourceId } } as any)} />
          {canAudit ? <IconAction icon="list-outline" label="History" onPress={() => router.push({ pathname: "/admin/studio/audit", params: { sourceId: item.sourceId, title: item.title } } as any)} /> : null}
          {data?.editable && !blocker ? <IconAction icon="cloud-upload-outline" label="Publish now" onPress={() => { setOutcome(null); setPending({ item, status: "published" }); }} /> : null}
          {data?.editable && item.nativeStatus === "published" ? <IconAction icon="cloud-offline-outline" label="Unpublish" onPress={() => { setOutcome(null); setPending({ item, status: "draft" }); }} /> : null}
        </View>
      </>
    );
  };

  return (
    <View style={ss.screen}>
      <View style={styles.filters}>
        <View style={ss.row} accessibilityRole="radiogroup" accessibilityLabel="Content type">
          {TYPES.map((t) => <Pill key={t} label={SOURCE_LABELS[t]} selected={type === t} onPress={() => chooseType(t)} />)}
        </View>
        <View style={[ss.row, { flexWrap: "nowrap" }]}>
          <TextInput
            style={[ss.input, { flex: 1 }]}
            value={queryText}
            onChangeText={setQueryText}
            onSubmitEditing={search}
            placeholder="Search by title"
            placeholderTextColor={colors.textMutedLight}
            accessibilityLabel="Search by title"
            returnKeyType="search"
          />
          <Button label="Search" icon="search" tone="secondary" onPress={search} />
        </View>
        <View style={ss.row}>
          <Text style={ss.label}>Status</Text>
          <Pill label="Any" selected={status === ""} onPress={() => { setStatus(""); setPage(0); }} />
          {STATUS_FILTERS[type].map((s) => <Pill key={s} label={NATIVE_STATUS_LABELS[s] ?? s} selected={status === s} onPress={() => { setStatus(s); setPage(0); }} />)}
        </View>
      </View>
      {data?.readOnlyReason ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 10, gap: 8 }}>
          <Banner tone="info" text={data.readOnlyReason} />
          {data.manage.path ? <IconAction icon="open-outline" label={data.manage.label} onPress={() => router.push(data.manage.path as any)} />
            : <Text style={ss.meta}>{data.manage.label}.</Text>}
        </View>
      ) : null}
      {outcome ? <View style={{ paddingHorizontal: 14, paddingTop: 10 }}><Banner tone={outcome.tone} text={outcome.text} onDismiss={() => setOutcome(null)} /></View> : null}
      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : data ? (
        <FlatList
          data={data.items}
          keyExtractor={(i) => i.sourceId}
          contentContainerStyle={ss.content}
          onRefresh={reload}
          refreshing={loading}
          ListEmptyComponent={<StateView empty emptyText={q || status ? "No content matches these filters." : `No ${SOURCE_LABELS[type]} yet.`} />}
          ListFooterComponent={data.total > PAGE_SIZE ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={ss.title} numberOfLines={2}>{item.title}</Text>
              {type === "kingdom_story" ? renderStory(item) : (
                <View style={ss.row}>
                  <Chip label={NATIVE_STATUS_LABELS[item.nativeStatus] ?? item.nativeStatus} tone={nativeTone(item.nativeStatus)} />
                  <Chip label="Read-only" tone="blue" />
                </View>
              )}
              <Text style={ss.meta}>Updated {formatInZone(item.updatedAt, tz)}{item.publishedAt ? ` · Published ${formatInZone(item.publishedAt, tz)}` : ""}</Text>
            </View>
          )}
        />
      ) : null}
      <ConfirmDialog
        visible={!!pending}
        title={pending?.status === "published" ? "Publish this story now?" : "Unpublish this story?"}
        message={pending ? (pending.status === "published"
          ? `"${pending.item.title}" will be visible to everyone. The server publishes it only if its approval still matches its content exactly.`
          : `"${pending.item.title}" will stop being visible and become a draft. It must be approved again before it can be published.`) : ""}
        confirmLabel={pending?.status === "published" ? "Publish now" : "Unpublish"}
        tone={pending?.status === "published" ? "primary" : "danger"}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

function IconAction({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  return (
    <AppButton label={`${label}`} onPress={onPress} variant="secondary" icon={icon} accessibilityLabel={label} style={{ alignSelf: "flex-start" }} palette="fixedLight" />
  );
}

const styles = StyleSheet.create({
  filters: { padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  row: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  actionsWide: { justifyContent: "flex-start" },
  iconAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, minHeight: 44, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige, alignSelf: "flex-start" },
  iconActionText: { fontSize: 13, color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
});
