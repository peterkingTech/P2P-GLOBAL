// Publishing Studio — what happens when the user confirms an action.
// Separate from the screens (and from the network, via `api`) so the
// outcomes — success text, conflicts, permission errors, approval refusals,
// partial reschedules — are testable. After ANY write attempt the caller
// reloads, so the screen always shows the server's current state.

import {
  cancelSchedule, changeReviewState, createSchedule, setStoryStatus,
  type ReviewState, type ScheduleAction, type StudioItem, type StudioSchedule,
} from "@/lib/studioApi";
import { ACTION_LABELS, REVIEW_LABELS, describeError, versionOf } from "@/lib/studioModel";

export interface ActionOutcome { ok: boolean; tone: "success" | "error" | "info"; text: string; conflict?: boolean; permission?: boolean }

export interface StudioActionsApi {
  changeReviewState: typeof changeReviewState;
  createSchedule: typeof createSchedule;
  cancelSchedule: typeof cancelSchedule;
  setStoryStatus: typeof setStoryStatus;
}
const realApi: StudioActionsApi = { changeReviewState, createSchedule, cancelSchedule, setStoryStatus };

function failure(e: unknown, prefix?: string): ActionOutcome {
  const d = describeError(e);
  return { ok: false, tone: "error", text: prefix ? `${prefix} ${d.message}` : d.message, conflict: d.kind === "conflict", permission: d.kind === "permission" };
}

export async function runReviewChange(item: StudioItem, to: ReviewState, note: string, api: StudioActionsApi = realApi): Promise<ActionOutcome> {
  try {
    const r = await api.changeReviewState(item.sourceId, to, versionOf(item), note || undefined);
    const extra = r.cancelledPublishSchedules > 0 ? " Its scheduled publish was cancelled." : "";
    return { ok: true, tone: "success", text: `"${item.title}" is now ${REVIEW_LABELS[r.reviewState].toLowerCase()}.${extra}` };
  } catch (e) {
    return failure(e);
  }
}

/** Publish now (needs valid approval), unpublish or archive. */
export async function runStatusChange(item: StudioItem, status: "published" | "draft" | "archived", api: StudioActionsApi = realApi): Promise<ActionOutcome> {
  try {
    await api.setStoryStatus(item.sourceId, status);
    const text = status === "published" ? `"${item.title}" is now published.` : status === "draft" ? `"${item.title}" was unpublished and is a draft again.` : `"${item.title}" was archived.`;
    return { ok: true, tone: "success", text };
  } catch (e) {
    return failure(e);
  }
}

export interface ScheduleInput { action: ScheduleAction; localTime: string; timezone: string; fold?: "earlier" | "later" }

/** `idempotencyKey` must stay the same if the user retries the same submission, so the server never creates two jobs. */
export async function runCreateSchedule(item: StudioItem, input: ScheduleInput, idempotencyKey: string, api: StudioActionsApi = realApi): Promise<ActionOutcome> {
  try {
    const r = await api.createSchedule(item.sourceId, input, idempotencyKey);
    return {
      ok: true, tone: "success",
      text: r.replayed
        ? `This ${ACTION_LABELS[input.action].toLowerCase()} was already scheduled (no duplicate created).`
        : `${ACTION_LABELS[input.action]} scheduled for ${input.localTime.replace("T", " ")} ${input.timezone}.`,
    };
  } catch (e) {
    return failure(e);
  }
}

export async function runCancelSchedule(schedule: StudioSchedule, api: StudioActionsApi = realApi): Promise<ActionOutcome> {
  try {
    const r = await api.cancelSchedule(schedule.id);
    return { ok: true, tone: "success", text: r.alreadyCancelled ? "That schedule was already cancelled." : `Scheduled ${ACTION_LABELS[schedule.action].toLowerCase()} cancelled.` };
  } catch (e) {
    return failure(e, "Could not cancel:");
  }
}

/**
 * Reschedule = cancel the live job, then create the new one. If the second
 * step fails, the user is told plainly that nothing is scheduled any more.
 */
export async function runReschedule(item: StudioItem, existing: StudioSchedule, input: ScheduleInput, idempotencyKey: string, api: StudioActionsApi = realApi): Promise<ActionOutcome> {
  const c = await runCancelSchedule(existing, api);
  if (!c.ok) return c;
  const n = await runCreateSchedule(item, input, idempotencyKey, api);
  if (n.ok) return { ...n, text: `Rescheduled: ${n.text}` };
  return { ...n, text: `The previous schedule was cancelled, but the new one was not created: ${n.text} Nothing is scheduled for this action now.` };
}
