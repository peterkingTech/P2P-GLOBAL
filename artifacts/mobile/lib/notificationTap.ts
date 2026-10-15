// Push-notification taps (app/_layout.tsx PushNotificationHost).
//
// Root cause of "tapping a push opens P2P but the notification stays
// unread": the tap handler navigated but never marked that notification
// read, even though every push carries its notificationId (pushDispatch.ts).
// It also deduplicated by the OS identifier (not the notification) and never
// cleared the cold-start response, so a JS reload could replay the last tap.
//
// This handler, for every tap (cold start, background, foreground):
//   • navigates once per notification (duplicate OS events are ignored);
//   • marks ONLY that notification read, through the existing
//     /notifications/me/:id/read route — never "all";
//   • waits for a signed-in session before marking, and retries a failed
//     mark later (on the next foreground) instead of losing it;
//   • clears the cold-start response so it can't be handled again.

export type MarkReadResult = "marked" | "already_read" | "not_found" | "failed";

export interface TapInput {
  /** The OS notification request identifier. */
  osIdentifier: string;
  data: Record<string, unknown> | undefined;
  actionIdentifier?: string;
}

export interface TapDeps {
  route(input: TapInput): { path: string; replace: boolean };
  navigate(path: string, replace: boolean): void;
  markRead(notificationId: string): Promise<MarkReadResult>;
  /** True once there is a signed-in session to mark with. */
  canSync(): boolean;
  clearLaunchResponse(): void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The P2P notification id carried in a push's data, if valid. */
export function notificationIdOf(data: Record<string, unknown> | undefined): string | null {
  const v = data?.notificationId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

const MAX_REMEMBERED = 500;

export function createNotificationTapHandler(deps: TapDeps) {
  const seen = new Set<string>();
  const pending = new Set<string>();

  async function sync(id: string): Promise<MarkReadResult | "deferred"> {
    if (!deps.canSync()) { pending.add(id); return "deferred"; }
    const r = await deps.markRead(id).catch((): MarkReadResult => "failed");
    if (r === "failed") pending.add(id); else pending.delete(id);
    return r;
  }

  return {
    async handle(input: TapInput): Promise<{ outcome: "duplicate" | "handled"; read?: MarkReadResult | "deferred" | "none" }> {
      const id = notificationIdOf(input.data);
      const key = id ?? `os:${input.osIdentifier}`;
      if (seen.has(key)) return { outcome: "duplicate" };
      if (seen.size >= MAX_REMEMBERED) seen.clear();
      seen.add(key);
      const { path, replace } = deps.route(input);
      deps.navigate(path, replace);
      deps.clearLaunchResponse();
      return { outcome: "handled", read: id ? await sync(id) : "none" };
    },
    /** Mark any taps that happened before sign-in, or whose mark failed. */
    async flushPending(): Promise<void> {
      if (!deps.canSync()) return;
      for (const id of [...pending]) await sync(id);
    },
    pendingIds: () => [...pending],
  };
}
