import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, TextInput, StyleSheet, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Button, Card, Chip, ConfirmDialog, Pill, StateView, nativeTone, reviewTone, studioStyles as ss } from "@/components/studio/StudioUI";
import { getStudioItem, newIdempotencyKey, previewLocalTime, type ScheduleAction, type StudioSchedule, type TimePreview } from "@/lib/studioApi";
import {
  ACTION_LABELS, NATIVE_STATUS_LABELS, REVIEW_LABELS, SCHEDULE_STATUS_LABELS,
  buildLocalTime, describeError, deviceTimeZone, formatInZone, isApprovalStale, reviewStateOf, scheduleBlocker, timePreviewError,
} from "@/lib/studioModel";
import { runCancelSchedule, runCreateSchedule, runReschedule, type ActionOutcome } from "@/lib/studioActions";

// Schedule Editor for one Kingdom Story. The server converts the entered
// local time in the chosen IANA zone to UTC (DST-aware) — the preview below
// asks it, so what is shown is exactly what will be stored. A time that
// happens twice must be resolved explicitly. The scheduler runs server-side
// and re-checks approval and content when the job runs.

const ACTIONS: ScheduleAction[] = ["publish", "unpublish", "archive"];
const COMMON_ZONES = ["UTC", "Africa/Lagos", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Australia/Sydney"];

export default function StudioScheduleEditor() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ sourceId?: string }>();
  const deviceTz = deviceTimeZone();
  const { data, loading, error, reload } = useStudioQuery(() => (params.sourceId ? getStudioItem(params.sourceId) : Promise.resolve(null)), [params.sourceId]);
  const item = data?.item ?? null;
  const editable = !!data?.editable;

  const [action, setAction] = useState<ScheduleAction>("publish");
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [timezone, setTimezone] = useState(deviceTz);
  const [fold, setFold] = useState<"earlier" | "later" | null>(null);
  const [preview, setPreview] = useState<TimePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState<null | "schedule" | { cancel: StudioSchedule }>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const local = buildLocalTime(date, time);
  const existing = item?.schedules.find((s) => s.action === action && s.status === "pending") ?? null;
  // In reschedule mode the existing job is the one being replaced, so it is not itself a blocker.
  const blocker = item ? scheduleBlocker(existing ? { ...item, schedules: item.schedules.filter((s) => s.id !== existing.id) } : item, action, { editable }) : null;
  const runningSame = item?.schedules.find((s) => s.action === action && s.status === "running");

  // One key per distinct submission: retrying the same inputs reuses it.
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const sig = `${params.sourceId}|${action}|${local.ok ? local.localTime : ""}|${timezone}|${fold ?? ""}|${existing?.id ?? ""}`;
  const idempotencyKey = useMemo(() => {
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };
    return keyRef.current.key;
  }, [sig]);

  // A new date/time/zone needs a fresh answer to "which occurrence?".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setFold(null); }, [local.ok ? local.localTime : "", timezone]);
  useEffect(() => {
    setPreview(null); setPreviewErr(null);
    if (!local.ok || !timezone.trim()) return;
    let stale = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const p = await previewLocalTime(local.localTime, timezone.trim(), fold ?? "earlier");
        if (!stale) setPreview(p);
      } catch (e) {
        if (!stale) { const d = describeError(e); setPreviewErr(d.kind === "validation" ? timePreviewError(d.message) : d.message); }
      } finally {
        if (!stale) setPreviewing(false);
      }
    }, 400);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.ok ? local.localTime : "", timezone, fold]);

  const inPast = preview ? Date.parse(preview.utc) < Date.now() + 60_000 : false;
  const needsFold = !!preview?.ambiguous && fold === null;
  const canSubmit = !!item && !blocker && !runningSame && local.ok && !!preview && !previewErr && !inPast && !needsFold && !busy;

  async function doSchedule() {
    if (!item || !local.ok) return;
    setBusy(true);
    const input = { action, localTime: local.localTime, timezone: timezone.trim(), ...(preview?.ambiguous && fold ? { fold } : {}) };
    const r = existing ? await runReschedule(item, existing, input, idempotencyKey) : await runCreateSchedule(item, input, idempotencyKey);
    setBusy(false); setConfirming(null); setOutcome(r);
    if (r.ok) keyRef.current = null; // next submission gets a fresh key
    await reload();
  }
  async function doCancel(s: StudioSchedule) {
    setBusy(true);
    const r = await runCancelSchedule(s);
    setBusy(false); setConfirming(null); setOutcome(r);
    await reload();
  }

  if (!params.sourceId) return <StateView empty emptyText="Choose a story to schedule from the Library or Review screen." />;
  if (loading && !data) return <StateView loading />;
  if (error) return <StateView error={error} onRetry={reload} />;
  if (!item) return <StateView error={{ kind: "not_found", message: "This story was not found (it may have been deleted)." }} onRetry={reload} />;

  const rs = reviewStateOf(item);
  return (
    <ScrollView style={ss.screen} contentContainerStyle={[ss.content, width >= 900 && { maxWidth: 820, alignSelf: "center", width: "100%" }]}>
      <Card>
        <Text style={ss.title}>{item.title}</Text>
        <View style={ss.row}>
          <Chip label={`Story status: ${NATIVE_STATUS_LABELS[item.nativeStatus] ?? item.nativeStatus}`} tone={nativeTone(item.nativeStatus)} />
          <Chip label={REVIEW_LABELS[rs]} tone={reviewTone(rs)} />
          {isApprovalStale(item) ? <Chip label="Changed since approval" tone="red" /> : null}
        </View>
        <View style={ss.row}>
          <Button label="Open story editor" tone="secondary" icon="create-outline" onPress={() => router.push(`/admin/kingdom-stories/${item.sourceId}` as any)} />
          <Button label="History" tone="secondary" icon="list-outline" onPress={() => router.push({ pathname: "/admin/studio/audit", params: { sourceId: item.sourceId, title: item.title } } as any)} />
        </View>
      </Card>

      {outcome ? <Banner tone={outcome.tone} text={outcome.text} onDismiss={() => setOutcome(null)} /> : null}

      <Card>
        <Text style={ss.h2} accessibilityRole="header">Jobs for this story</Text>
        {item.schedules.length === 0 ? <Text style={ss.meta}>Nothing scheduled.</Text> : item.schedules.map((s) => (
          <View key={s.id} style={styles.job}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ss.body}>{ACTION_LABELS[s.action]} · {s.localTime.replace("T", " ")} {s.timezone}</Text>
              <Text style={ss.meta}>{formatInZone(s.runAt, deviceTz)}{s.attempts ? ` · attempt ${s.attempts}` : ""}{s.lastError ? ` · ${s.lastError}` : ""}</Text>
            </View>
            <Chip label={SCHEDULE_STATUS_LABELS[s.status]} tone={s.status === "failed" ? "red" : s.status === "running" ? "amber" : "blue"} />
            {s.status === "pending" && editable ? <Button label="Cancel" tone="secondary" onPress={() => { setOutcome(null); setConfirming({ cancel: s }); }} /> : null}
          </View>
        ))}
      </Card>

      <Card>
        <Text style={ss.h2} accessibilityRole="header">{existing ? "Reschedule" : "New schedule"}</Text>
        <Text style={ss.label}>Action</Text>
        <View style={ss.row} accessibilityRole="radiogroup">
          {ACTIONS.map((a) => <Pill key={a} label={ACTION_LABELS[a]} selected={action === a} onPress={() => setAction(a)} />)}
        </View>

        {blocker ? <Banner tone="error" text={blocker} /> : null}
        {runningSame ? <Banner tone="info" text="This action is running right now and cannot be changed." /> : null}
        {existing && !blocker ? <Banner tone="info" text={`Currently scheduled for ${existing.localTime.replace("T", " ")} ${existing.timezone}. Saving replaces it.`} /> : null}

        <View style={[styles.fields, width >= 600 && { flexDirection: "row" }]}>
          <View style={{ flex: 1 }}>
            <Text style={ss.label} nativeID="studio-date">Date (YYYY-MM-DD)</Text>
            <TextInput style={ss.input} value={date} onChangeText={setDate} accessibilityLabelledBy="studio-date" accessibilityLabel="Date, year month day" autoCapitalize="none" autoCorrect={false} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ss.label} nativeID="studio-time">Time (24-hour HH:MM)</Text>
            <TextInput style={ss.input} value={time} onChangeText={setTime} accessibilityLabelledBy="studio-time" accessibilityLabel="Time, 24 hour" autoCapitalize="none" autoCorrect={false} />
          </View>
        </View>
        <Text style={ss.label} nativeID="studio-tz">Time zone</Text>
        <TextInput style={ss.input} value={timezone} onChangeText={setTimezone} accessibilityLabelledBy="studio-tz" accessibilityLabel="Time zone" autoCapitalize="none" autoCorrect={false} />
        <View style={ss.row}>
          {Array.from(new Set([deviceTz, ...COMMON_ZONES])).map((z) => <Pill key={z} label={z === deviceTz ? `${z} (this device)` : z} selected={timezone === z} onPress={() => setTimezone(z)} />)}
        </View>

        <View style={styles.preview} accessibilityLiveRegion="polite">
          {!local.ok ? <Text style={styles.previewErr}>{local.error}</Text>
            : previewing ? <Text style={ss.meta}>Checking the time…</Text>
            : previewErr ? <Text style={styles.previewErr}>{previewErr}</Text>
            : preview ? (
              <>
                {preview.ambiguous ? (
                  <>
                    <Text style={styles.previewWarn}>This time happens twice (clocks go back). Choose which one:</Text>
                    <View style={ss.row}>
                      <Pill label="First occurrence" selected={fold === "earlier"} onPress={() => setFold("earlier")} />
                      <Pill label="Second occurrence" selected={fold === "later"} onPress={() => setFold("later")} />
                    </View>
                  </>
                ) : null}
                {!needsFold ? (
                  <>
                    <Text style={ss.body}>Runs at {formatInZone(preview.utc, timezone.trim())}</Text>
                    <Text style={ss.meta}>= {preview.utc.slice(0, 16).replace("T", " ")} UTC · {formatInZone(preview.utc, deviceTz)} on this device</Text>
                  </>
                ) : null}
                {inPast ? <Text style={styles.previewErr}>That time is in the past (or less than a minute away).</Text> : null}
              </>
            ) : null}
        </View>

        <Button label={existing ? "Review and reschedule" : "Review and schedule"} icon="time-outline" disabled={!canSubmit}
          accessibilityHint={blocker ?? (needsFold ? "Choose the first or second occurrence" : previewErr || undefined)} onPress={() => { setOutcome(null); setConfirming("schedule"); }} />
      </Card>

      <ConfirmDialog
        visible={confirming === "schedule"}
        title={existing ? `Reschedule ${ACTION_LABELS[action].toLowerCase()}?` : `Schedule ${ACTION_LABELS[action].toLowerCase()}?`}
        message={preview ? [
          `"${item.title}"`,
          `${ACTION_LABELS[action]} at ${formatInZone(preview.utc, timezone.trim())}.`,
          `That is ${preview.utc.slice(0, 16).replace("T", " ")} UTC.`,
          action === "publish" ? "When it runs, the server checks the story is still approved and unchanged since approval; if not, it will not publish." : "",
          existing ? "The current schedule for this action is cancelled first." : "",
        ].filter(Boolean).join("\n") : ""}
        confirmLabel={existing ? "Reschedule" : "Schedule"}
        busy={busy}
        onConfirm={doSchedule}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        visible={typeof confirming === "object" && confirming !== null}
        title="Cancel this scheduled job?"
        message={typeof confirming === "object" && confirming ? `${ACTION_LABELS[confirming.cancel.action]} at ${confirming.cancel.localTime.replace("T", " ")} ${confirming.cancel.timezone} will not run.` : ""}
        confirmLabel="Cancel job"
        tone="danger"
        busy={busy}
        onConfirm={() => typeof confirming === "object" && confirming && doCancel(confirming.cancel)}
        onCancel={() => setConfirming(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  job: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.borderBeige },
  fields: { gap: 10 },
  preview: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, gap: 6, minHeight: 48 },
  previewErr: { color: "#9B2C1F", fontSize: 13, fontFamily: "Inter_500Medium" },
  previewWarn: { color: "#8A5410", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
