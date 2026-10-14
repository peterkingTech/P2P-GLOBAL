import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Button, Card, Chip, ConfirmDialog, Pager, Pill, StateView, nativeTone, reviewTone, studioStyles as ss } from "@/components/studio/StudioUI";
import { getReviewQueue, type ReviewState, type StudioItem } from "@/lib/studioApi";
import { NATIVE_STATUS_LABELS, REVIEW_LABELS, deviceTimeZone, formatInZone, isApprovalStale, publishNowBlocker, reviewActions, reviewStateOf, type ReviewAction } from "@/lib/studioModel";
import { runReviewChange, runStatusChange, type ActionOutcome } from "@/lib/studioActions";

// Review & Approvals for Kingdom Stories, one queue at a time. Offers only
// the steps the API allows for the current state; the API and database
// re-check role, independent reviewer, version and content on every request.
// A 409 (someone else changed it) reloads the latest state instead of
// overwriting it.

const QUEUES: { state: ReviewState; label: string; empty: string }[] = [
  { state: "in_review", label: "Awaiting review", empty: "Nothing is waiting for review." },
  { state: "changes_requested", label: "Changes requested", empty: "No stories are waiting on changes." },
  { state: "approved", label: "Approved", empty: "No approved stories." },
  { state: "draft", label: "Not yet submitted", empty: "Every draft has been submitted." },
];

type Pending = { item: StudioItem; action: ReviewAction } | { item: StudioItem; publish: true };

export default function StudioReview() {
  const router = useRouter();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const tz = deviceTimeZone();
  const [state, setState] = useState<ReviewState>("in_review");
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useStudioQuery(() => getReviewQueue(state, page, 20), [state, page]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  async function confirm(note: string) {
    if (!pending) return;
    setBusy(true);
    const r = "publish" in pending ? await runStatusChange(pending.item, "published") : await runReviewChange(pending.item, pending.action.to, note);
    setBusy(false); setPending(null); setOutcome(r);
    await reload(); // always show the server's state, including after a conflict
  }

  const editable = !!data?.editable;
  const ctx = { editable, userId: profile?.id ?? null, role: profile?.role ?? null };
  const pendingAction = pending && "action" in pending ? pending.action : null;
  return (
    <ScrollView style={ss.screen} contentContainerStyle={[ss.content, width >= 1000 && { maxWidth: 1100, alignSelf: "center", width: "100%" }]}>
      <View style={ss.row} accessibilityRole="tablist">
        {QUEUES.map((q) => <Pill key={q.state} label={q.label} selected={state === q.state} onPress={() => { setState(q.state); setPage(0); setOutcome(null); }} />)}
      </View>
      {data && !editable ? <Banner tone="info" text="Your role can see review status but cannot submit, approve, request changes or publish." /> : null}
      <Text style={ss.meta}>Approval covers a story exactly as it is when approved. Any later change to its text, media or sources means it must be reviewed again before it can publish.</Text>
      {outcome ? <Banner tone={outcome.tone} text={outcome.text} onDismiss={() => setOutcome(null)} /> : null}

      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : data ? (
        <>
          <Text style={ss.h2} accessibilityRole="header">{QUEUES.find((q) => q.state === state)!.label} ({data.total})</Text>
          {data.items.length === 0 ? <StateView empty emptyText={QUEUES.find((q) => q.state === state)!.empty} /> : data.items.map((item) => {
            const actions = reviewActions(item, ctx);
            const st = item.studio;
            const publishBlock = publishNowBlocker(item, editable);
            return (
              <Card key={item.sourceId}>
                <TouchableOpacity onPress={() => router.push(`/admin/kingdom-stories/${item.sourceId}` as any)} accessibilityRole="link" accessibilityLabel={`Open ${item.title} in the story editor`} style={{ minHeight: 44, justifyContent: "center" }}>
                  <Text style={[ss.title, { color: colors.primaryGreen }]}>{item.title}</Text>
                </TouchableOpacity>
                <View style={ss.row}>
                  <Chip label={REVIEW_LABELS[reviewStateOf(item)]} tone={reviewTone(reviewStateOf(item))} />
                  <Chip label={`Story status: ${NATIVE_STATUS_LABELS[item.nativeStatus] ?? item.nativeStatus}`} tone={nativeTone(item.nativeStatus)} />
                  {isApprovalStale(item) ? <Chip label="Changed since approval — review again" tone="red" /> : null}
                </View>
                {st?.submittedAt ? <Text style={ss.meta}>Submitted {formatInZone(st.submittedAt, tz)}{st.submittedBy === profile?.id ? " by you" : ""}</Text> : null}
                {st?.reviewedAt ? <Text style={ss.meta}>Reviewed {formatInZone(st.reviewedAt, tz)}{st.reviewedBy === profile?.id ? " by you" : ""}</Text> : null}
                {st?.reviewNote ? <Text style={[ss.body, styles.note]}>Review note: {st.reviewNote}</Text> : null}
                <View style={ss.row}>
                  {actions.map((a) => (
                    <Button key={a.to + a.label} label={a.label} tone={a.tone} disabled={!!a.disabledReason} accessibilityHint={a.disabledReason}
                      onPress={() => { setOutcome(null); setPending({ item, action: a }); }} />
                  ))}
                  {state === "approved" && editable && !publishBlock ? (
                    <Button label="Publish now" icon="cloud-upload-outline" onPress={() => { setOutcome(null); setPending({ item, publish: true }); }} />
                  ) : null}
                  {state === "approved" && editable ? (
                    <Button label="Schedule" icon="time-outline" tone="secondary" onPress={() => router.push({ pathname: "/admin/studio/schedule", params: { sourceId: item.sourceId } } as any)} />
                  ) : null}
                </View>
                {actions.find((a) => a.disabledReason) ? <Text style={ss.meta}>{actions.find((a) => a.disabledReason)!.disabledReason}</Text> : null}
              </Card>
            );
          })}
          {data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
        </>
      ) : null}

      <ConfirmDialog
        visible={!!pending}
        title={pending ? ("publish" in pending ? "Publish this story now?" : pending.action.confirmTitle) : ""}
        message={pending ? ("publish" in pending
          ? `"${pending.item.title}" will be visible to everyone. The server publishes it only if its approval still matches its content exactly.`
          : `${pending.action.confirmMessage}\n\n"${pending.item.title}"`) : ""}
        confirmLabel={pending ? ("publish" in pending ? "Publish now" : pending.action.label) : "Confirm"}
        tone={pendingAction?.tone === "danger" ? "danger" : "primary"}
        notePrompt={pendingAction?.notePrompt}
        noteRequired={pendingAction?.noteRequired}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: { backgroundColor: "#fff", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: colors.borderBeige },
});
