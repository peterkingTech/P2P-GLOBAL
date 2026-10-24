import React, { useState } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import { Button, ConfirmDialog, studioStyles as ss } from "@/components/studio/StudioUI";
import { getStudioItem, type StudioItem } from "@/lib/studioApi";
import { publishNowBlocker, reviewActions, reviewStateOf, type ReviewAction } from "@/lib/studioModel";
import { runReviewChange, runStatusChange, type ActionOutcome } from "@/lib/studioActions";

// A story's next Publishing Studio steps (Submit → Approve → Publish, plus
// the side steps the rules allow), each behind a confirmation. Shared by the
// Review screen and the story editor so there is one review process. After
// any step it reloads the story's Studio state, so the next step is offered
// straight away on the same card with the right version.

// A tap that closes a dialog can land on whatever is underneath once it is
// gone (react-native-web) — ignore taps for a moment after any dialog closes.
let lastDialogClose = 0;
const TAP_GUARD_MS = 600;
export function guardTap(fn: () => void): () => void {
  return () => { if (Date.now() - lastDialogClose >= TAP_GUARD_MS) fn(); };
}

type Pending = { action: ReviewAction } | { publish: true };

export function StudioSteps({ item, editable, userId, role, onDone }: {
  item: StudioItem; editable: boolean; userId: string | null; role: string | null;
  /** Called after every attempt with the outcome and the story's fresh state (null if it could not be reloaded). */
  onDone: (outcome: ActionOutcome, fresh: StudioItem | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const actions = reviewActions(item, { editable, userId, role });
  const publishBlock = publishNowBlocker(item, editable);
  const approved = reviewStateOf(item) === "approved" && item.nativeStatus !== "published";

  function close() { lastDialogClose = Date.now(); setPending(null); }

  async function confirm(note: string) {
    if (!pending) return;
    setBusy(true);
    const outcome = "publish" in pending ? await runStatusChange(item, "published") : await runReviewChange(item, pending.action.to, note);
    let fresh: StudioItem | null = null;
    try { fresh = (await getStudioItem(item.sourceId)).item; } catch { /* the caller reloads its list anyway */ }
    setBusy(false); close();
    onDone(outcome, fresh);
  }

  const pendingAction = pending && "action" in pending ? pending.action : null;
  const disabledReason = actions.find((a) => a.disabledReason)?.disabledReason;
  return (
    <>
      {actions.map((a) => (
        <Button key={a.to + a.label} label={a.label} tone={a.tone} disabled={!!a.disabledReason} accessibilityHint={a.disabledReason}
          onPress={guardTap(() => setPending({ action: a }))} />
      ))}
      {editable && !publishBlock ? <Button label="Publish now" icon="cloud-upload-outline" onPress={guardTap(() => setPending({ publish: true }))} /> : null}
      {editable && approved ? (
        <Button label="Schedule" icon="time-outline" tone="secondary" onPress={guardTap(() => router.push({ pathname: "/admin/studio/schedule", params: { sourceId: item.sourceId } } as any))} />
      ) : null}
      {disabledReason ? <Text style={ss.meta}>{disabledReason}</Text> : null}
      <ConfirmDialog
        visible={!!pending}
        title={pending ? ("publish" in pending ? "Publish this story now?" : pending.action.confirmTitle) : ""}
        message={pending ? ("publish" in pending
          ? `"${item.title}" will be visible to everyone. The server publishes it only if its approval still matches its content exactly.`
          : `${pending.action.confirmMessage}\n\n"${item.title}"`) : ""}
        confirmLabel={pending ? ("publish" in pending ? "Publish now" : pending.action.label) : "Confirm"}
        tone={pendingAction?.tone === "danger" ? "danger" : "primary"}
        notePrompt={pendingAction?.notePrompt}
        noteRequired={pendingAction?.noteRequired}
        busy={busy}
        onConfirm={confirm}
        onCancel={close}
      />
    </>
  );
}
