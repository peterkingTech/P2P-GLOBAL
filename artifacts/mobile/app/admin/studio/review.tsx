import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Button, Card, Chip, Pager, Pill, StateView, nativeTone, reviewTone, studioStyles as ss } from "@/components/studio/StudioUI";
import { StudioSteps, guardTap } from "@/components/studio/StudioSteps";
import { getReviewQueue, type ReviewState, type StudioItem } from "@/lib/studioApi";
import { NATIVE_STATUS_LABELS, REVIEW_LABELS, deviceTimeZone, formatInZone, isApprovalStale, reviewStateOf } from "@/lib/studioModel";
import type { ActionOutcome } from "@/lib/studioActions";

// Review & Approvals for Kingdom Stories, one queue at a time. Offers only
// the steps the API allows for the current state; the API and database
// re-check role, independent reviewer, version and content on every request.
// A story you act on stays on screen with its new state and its next step
// (Submit → Approve → Publish), so a story can be taken all the way through
// without switching queues; it moves to its new queue when you change tabs.

const QUEUES: { state: ReviewState; label: string; empty: string }[] = [
  { state: "in_review", label: "Awaiting review", empty: "Nothing is waiting for review." },
  { state: "changes_requested", label: "Changes requested", empty: "No stories are waiting on changes." },
  { state: "approved", label: "Approved", empty: "No approved stories." },
  { state: "draft", label: "Not yet submitted", empty: "Every draft has been submitted." },
];

export default function StudioReview() {
  const router = useRouter();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const tz = deviceTimeZone();
  const [state, setState] = useState<ReviewState>("in_review");
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useStudioQuery(() => getReviewQueue(state, page, 20), [state, page]);
  // Stories acted on in this queue view: kept in their place with their fresh
  // state until the queue or page changes. Keyed by story id.
  const [kept, setKept] = useState<{ order: string[]; items: Record<string, StudioItem>; outcomes: Record<string, ActionOutcome> }>({ order: [], items: {}, outcomes: {} });

  function switchQueue(next: ReviewState) { setState(next); setPage(0); setKept({ order: [], items: {}, outcomes: {} }); }

  function done(item: StudioItem, outcome: ActionOutcome, fresh: StudioItem | null) {
    setKept((k) => ({
      order: k.order.length ? k.order : (data?.items ?? []).map((i) => i.sourceId),
      items: fresh ? { ...k.items, [item.sourceId]: fresh } : k.items,
      outcomes: { ...k.outcomes, [item.sourceId]: outcome },
    }));
    reload(); // always show the server's state, including after a conflict
  }

  // The queue as loaded, with stories acted on here kept where they were.
  const queueItems = data?.items ?? [];
  const byId = new Map(queueItems.map((i) => [i.sourceId, i]));
  const shown: StudioItem[] = kept.order.length
    ? [...kept.order.map((id) => kept.items[id] ?? byId.get(id)).filter((i): i is StudioItem => !!i), ...queueItems.filter((i) => !kept.order.includes(i.sourceId))]
    : queueItems;

  const editable = !!data?.editable;
  return (
    <ScrollView style={ss.screen} contentContainerStyle={[ss.content, width >= 1000 && { maxWidth: 1100, alignSelf: "center", width: "100%" }]}>
      <View style={ss.row} accessibilityRole="tablist">
        {QUEUES.map((q) => <Pill key={q.state} label={q.label} selected={state === q.state} onPress={guardTap(() => switchQueue(q.state))} />)}
      </View>
      {data && !editable ? <Banner tone="info" text="Your role can see review status but cannot submit, approve, request changes or publish." /> : null}
      <Text style={ss.meta}>Approval covers a story exactly as it is when approved. Any later change to its text, media or sources means it must be reviewed again before it can publish.</Text>
      {editable ? <Text style={ss.meta}>Each story shows its next step here: Submit for review, then Approve, then Publish now. A story you act on stays on this list until you change tabs.</Text> : null}

      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : data ? (
        <>
          <Text style={ss.h2} accessibilityRole="header">{QUEUES.find((q) => q.state === state)!.label} ({data.total})</Text>
          {shown.length === 0 ? <StateView empty emptyText={QUEUES.find((q) => q.state === state)!.empty} /> : shown.map((item) => {
            const st = item.studio;
            const outcome = kept.outcomes[item.sourceId];
            return (
              <Card key={item.sourceId}>
                <Text style={ss.title}>{item.title}</Text>
                <View style={ss.row}>
                  <Chip label={REVIEW_LABELS[reviewStateOf(item)]} tone={reviewTone(reviewStateOf(item))} />
                  <Chip label={`Story status: ${NATIVE_STATUS_LABELS[item.nativeStatus] ?? item.nativeStatus}`} tone={nativeTone(item.nativeStatus)} />
                  {isApprovalStale(item) ? <Chip label="Changed since approval — review again" tone="red" /> : null}
                </View>
                {st?.submittedAt ? <Text style={ss.meta}>Submitted {formatInZone(st.submittedAt, tz)}{st.submittedBy === profile?.id ? " by you" : ""}</Text> : null}
                {st?.reviewedAt ? <Text style={ss.meta}>Reviewed {formatInZone(st.reviewedAt, tz)}{st.reviewedBy === profile?.id ? " by you" : ""}</Text> : null}
                {st?.reviewNote ? <Text style={[ss.body, styles.note]}>Review note: {st.reviewNote}</Text> : null}
                {outcome ? <Banner tone={outcome.tone} text={outcome.text} /> : null}
                <View style={ss.row}>
                  <StudioSteps item={item} editable={editable} userId={profile?.id ?? null} role={profile?.role ?? null} onDone={(o, fresh) => done(item, o, fresh)} />
                  <Button label="Open editor" icon="create-outline" tone="secondary" accessibilityHint={`Open ${item.title} in the story editor`}
                    onPress={guardTap(() => router.push(`/admin/kingdom-stories/${item.sourceId}` as any))} />
                </View>
              </Card>
            );
          })}
          {data.total > data.pageSize ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => { setPage(p); setKept({ order: [], items: {}, outcomes: {} }); }} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: { backgroundColor: "#fff", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: colors.borderBeige },
});
