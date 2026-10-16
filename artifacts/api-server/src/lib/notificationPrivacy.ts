import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";
import { notificationActorId } from "./notificationActors";

// Message-preview privacy — the server is the authority for what a push may
// show (migration 194, p2p_profiles.notify_message_preview; 193's
// notify_show_sender_name is the fallback while 194 isn't applied):
//
//   'full' Name and message — sender name + photo; message pushes also carry
//          a short-lived preview token (lib/previewToken.ts) that the iPhone
//          extension exchanges for the text / voice preview. The push itself
//          never contains message content.
//   'hold' Name, reveal message on hold (migration 195) — like 'full', but
//          the banner keeps the generic wording; on iPhone the text / voice
//          note appears only when the notification is pressed and held.
//   'name' Name only (default) — sender name + photo, generic wording.
//   'none' Nothing — message pushes read "P2P Global — New message"; no
//          name, no photo, no preview token, no preview category.
//
// Applies to message pushes; other person notifications only lose the photo
// under 'none' (as before). Calls are never touched. The in-app Notification
// Center is unchanged (behind the app's own sign-in).
//
// Lookup failures: a missing column (API deployed before the migration) means
// today's default ('name'); any other failure is treated as 'none' for that
// batch — most private, never a crash, never a dropped push, never 'full'.

export type PreviewLevel = "full" | "hold" | "name" | "none";
/** Levels that may fetch message content through a preview token. */
export const PREVIEW_CONTENT_LEVELS: ReadonlySet<PreviewLevel> = new Set<PreviewLevel>(["full", "hold"]);
export const MESSAGE_CATEGORY = "p2p_message";
const MESSAGE_TYPES = new Set(["new_message"]);
const CALL_TYPES = new Set(["incoming_call"]);
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

export async function getPreviewLevels(userIds: string[]): Promise<Map<string, PreviewLevel>> {
  const out = new Map<string, PreviewLevel>();
  if (!userIds.length) return out;
  const all = (level: PreviewLevel) => { for (const id of userIds) out.set(id, level); return out; };
  try {
    const { data, error } = await db.from("p2p_profiles").select("id, notify_message_preview").in("id", userIds);
    if (!error) {
      for (const id of userIds) out.set(id, "name");
      for (const r of (data ?? []) as { id: string; notify_message_preview: string | null }[]) {
        const v = r.notify_message_preview;
        out.set(r.id, v === "full" || v === "hold" || v === "none" ? v : "name");
      }
      return out;
    }
    if (!MISSING_COLUMN.has(error.code ?? "")) { logger.warn({ err: error }, "notificationPrivacy: preference lookup failed; sending generic pushes"); return all("none"); }
    // Before migration 194: 193's switch (false = hide name and photo).
    const old = await db.from("p2p_profiles").select("id").in("id", userIds).eq("notify_show_sender_name", false);
    if (old.error) {
      if (MISSING_COLUMN.has(old.error.code ?? "")) return all("name");
      logger.warn({ err: old.error }, "notificationPrivacy: preference lookup failed; sending generic pushes");
      return all("none");
    }
    all("name");
    for (const r of (old.data ?? []) as { id: string }[]) out.set(r.id, "none");
    return out;
  } catch (err) {
    logger.warn({ err }, "notificationPrivacy: preference lookup failed; sending generic pushes");
    return all("none");
  }
}

// ── Sender photo on the push ───────────────────────────────────────────────
// For notifications from a person (sender id verified per type in
// notificationActors.ts), the push may carry that person's public profile
// photo as Expo `richContent.image` with `mutableContent`. Android shows it as
// the notification image; iOS through the Notification Service Extension.
// Never for calls, never under 'none', only https photos. Fails open: no photo.
const NO_PHOTO_TYPES = CALL_TYPES;

export async function getSenderPhotos(
  ns: { id: string; notification_type: string | null; data: Record<string, unknown> | null }[],
): Promise<Map<string, string>> {
  const actorByNote = new Map<string, string>();
  for (const n of ns) {
    if (NO_PHOTO_TYPES.has(n.notification_type ?? "")) continue;
    const actor = notificationActorId(n.notification_type, n.data);
    if (actor) actorByNote.set(n.id, actor);
  }
  const ids = Array.from(new Set(actorByNote.values()));
  if (!ids.length) return new Map();
  try {
    const { data, error } = await db.from("p2p_profiles").select("id, photo_url").in("id", ids);
    if (error) { logger.warn({ err: error }, "notificationPrivacy: sender photo lookup failed; sending without photos"); return new Map(); }
    const photoById = new Map(((data ?? []) as { id: string; photo_url: string | null }[])
      .filter((p) => typeof p.photo_url === "string" && /^https:\/\/\S+$/.test(p.photo_url))
      .map((p) => [p.id, p.photo_url as string]));
    const out = new Map<string, string>();
    for (const [noteId, actor] of actorByNote) { const url = photoById.get(actor); if (url) out.set(noteId, url); }
    return out;
  } catch (err) {
    logger.warn({ err }, "notificationPrivacy: sender photo lookup failed; sending without photos");
    return new Map();
  }
}

/** Title/body for a push at the recipient's level. */
export function lockScreenText(
  n: { notification_type: string | null; title: string | null; message: string | null },
  level: PreviewLevel,
): { title: string; body: string } {
  if (level === "none" && MESSAGE_TYPES.has(n.notification_type ?? "")) {
    const voice = /voice message/.test(n.message ?? "");
    return { title: "P2P Global", body: voice ? "New voice message" : "New message" };
  }
  return { title: n.title ?? "P2P Global", body: n.message ?? "" };
}

export interface PushPresentation {
  title: string;
  body: string;
  image?: string;          // sender photo (Expo richContent.image)
  categoryId?: string;     // iOS long-press view (Notification Content Extension)
  previewToken?: string;   // only for 'full' / 'hold' message pushes
  mutableContent: boolean; // only when the iOS service extension has work to do
}

/**
 * Everything a push may show, decided in one place for every notification
 * type. Calls are returned untouched. No message content is ever added here.
 */
export function pushPresentation(
  n: { notification_type: string | null; title: string | null; message: string | null },
  level: PreviewLevel,
  extras: { senderPhoto?: string; previewToken?: string | null } = {},
): PushPresentation {
  const type = n.notification_type ?? "";
  if (CALL_TYPES.has(type)) return { title: n.title ?? "P2P Global", body: n.message ?? "", mutableContent: false };
  const { title, body } = lockScreenText(n, level);
  const image = level !== "none" ? extras.senderPhoto : undefined;
  const isMessage = MESSAGE_TYPES.has(type);
  const categoryId = isMessage && level !== "none" ? MESSAGE_CATEGORY : undefined;
  const previewToken = isMessage && PREVIEW_CONTENT_LEVELS.has(level) && extras.previewToken ? extras.previewToken : undefined;
  return {
    title, body,
    ...(image ? { image } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(previewToken ? { previewToken } : {}),
    mutableContent: !!image || !!previewToken,
  };
}
