import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";
import { notificationActorId } from "./notificationActors";

// Message-preview privacy (migration 193, p2p_profiles.notify_show_sender_name).
//
// Message notifications never contain message content (migration 104/191):
// the push says "<sender> sent you a message". Some people don't want even
// the sender's name on a lock screen. When a recipient turns the setting
// off, their message PUSHES read "P2P Global — New message" instead. The
// in-app Notification Center is unchanged (it is behind the app's own
// sign-in), and calls still show the caller so they can be answered.
//
// Fails open to today's behaviour: if the column doesn't exist yet (API
// deployed before the migration) or the lookup fails, names are shown as
// they always were — never a crash, never a dropped push.

const HIDEABLE_TYPES = new Set(["new_message"]);

export async function getHiddenSenderUserIds(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  try {
    const { data, error } = await db.from("p2p_profiles").select("id").in("id", userIds).eq("notify_show_sender_name", false);
    if (error) {
      if (error.code !== "42703" && error.code !== "PGRST204") logger.warn({ err: error }, "notificationPrivacy: preference lookup failed; showing names");
      return new Set();
    }
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  } catch (err) {
    logger.warn({ err }, "notificationPrivacy: preference lookup failed; showing names");
    return new Set();
  }
}

// ── Sender photo on the push (item 10) ─────────────────────────────────────
// For notifications from a person (sender id verified per type in
// notificationActors.ts), the push carries that person's public profile photo
// as Expo `richContent.image` with `mutableContent`. Android shows it as the
// notification image; iOS shows it only once the app ships a Notification
// Service Extension (not yet built) — until then iOS displays the push
// exactly as before. Never for calls (ringing is untouched), never when the
// recipient hides sender names, only https photos. Fails open: no photo.
const NO_PHOTO_TYPES = new Set(["incoming_call"]);

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

/** Title/body for a push, after the recipient's preview setting. */
export function lockScreenText(
  n: { notification_type: string | null; title: string | null; message: string | null },
  hideSender: boolean,
): { title: string; body: string } {
  if (hideSender && HIDEABLE_TYPES.has(n.notification_type ?? "")) {
    const voice = /voice message/.test(n.message ?? "");
    return { title: "P2P Global", body: voice ? "New voice message" : "New message" };
  }
  return { title: n.title ?? "P2P Global", body: n.message ?? "" };
}
