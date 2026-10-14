import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chunkIds,
  receiptFromRow,
  type ConversationMember,
  type MessageReceipt,
} from "@/lib/messageReceipts";

// Thin I/O layer over the migration-179 functions/table. The server is the
// authority: recipient = auth.uid(), timestamps = server time, eligibility
// (membership, own message, joined-after, deleted, call summary) enforced in
// p2p_acknowledge_messages. Nothing here sends a recipient id or a timestamp.

// Until migration 179 is applied the functions/table don't exist. Detect
// that once and stop calling, so the app degrades to Sending/Sent/Failed
// (never fake Delivered/Read) instead of erroring on every message.
let receiptsUnavailable = false;
export function receiptsAvailable(): boolean { return !receiptsUnavailable; }
/** Test hook. */
export function __resetReceiptsAvailability() { receiptsUnavailable = false; }

type PgError = { code?: string; message?: string } | null | undefined;
export function isMissingReceiptsSchema(error: PgError): boolean {
  if (!error) return false;
  // PGRST202: function not in schema cache; PGRST205: table not found;
  // 42883: undefined function; 42P01: undefined table.
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code ?? "");
}
function noteError(error: PgError) {
  if (isMissingReceiptsSchema(error)) receiptsUnavailable = true;
}

/**
 * Acknowledge messages as delivered (read=false) or read (read=true).
 * Returns the receipts the server now holds for the caller, or null on
 * failure (the caller keeps the ids pending and retries later).
 */
export async function acknowledgeMessages(
  supabase: SupabaseClient,
  messageIds: string[],
  read: boolean,
): Promise<MessageReceipt[] | null> {
  if (receiptsUnavailable || messageIds.length === 0) return [];
  const out: MessageReceipt[] = [];
  for (const batch of chunkIds(Array.from(new Set(messageIds)))) {
    const { data, error } = await supabase.rpc("p2p_acknowledge_messages", { p_message_ids: batch, p_read: read });
    if (error) { noteError(error); return receiptsUnavailable ? [] : null; }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const r = receiptFromRow(row, "__self__");
      if (r) out.push(r);
    }
  }
  return out;
}

/** Receipts visible to the caller in one conversation (RLS: own + on own messages). */
export async function fetchConversationReceipts(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<MessageReceipt[] | null> {
  if (receiptsUnavailable) return [];
  const { data, error } = await supabase
    .from("p2p_message_receipts")
    .select("message_id, user_id, delivered_at, read_at")
    .eq("conversation_id", conversationId);
  if (error) { noteError(error); return receiptsUnavailable ? [] : null; }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => receiptFromRow(r)).filter((r): r is MessageReceipt => !!r);
}

/** Conversation members with join times (existing members SELECT policy). */
export async function fetchConversationMembers(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationMember[] | null> {
  const { data, error } = await supabase
    .from("p2p_conversation_members")
    .select("user_id, joined_at")
    .eq("conversation_id", conversationId);
  if (error) return null;
  return ((data ?? []) as { user_id: string; joined_at: string }[]).map((m) => ({ userId: m.user_id, joinedAt: m.joined_at }));
}

export interface ReceiptDetailRow {
  userId: string;
  fullName: string | null;
  username: string | null;
  photoUrl: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  isCurrentMember: boolean;
}

/** Message info — sender only (the server rejects anyone else). */
export async function fetchReceiptDetails(
  supabase: SupabaseClient,
  messageId: string,
): Promise<{ rows: ReceiptDetailRow[] } | { error: string }> {
  if (receiptsUnavailable) return { error: "Message info isn't available yet." };
  const { data, error } = await supabase.rpc("p2p_message_receipt_details", { p_message_id: messageId });
  if (error) {
    noteError(error);
    return { error: receiptsUnavailable ? "Message info isn't available yet." : "Couldn't load message info." };
  }
  return {
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      userId: r.user_id as string,
      fullName: (r.full_name as string | null) ?? null,
      username: (r.username as string | null) ?? null,
      photoUrl: (r.photo_url as string | null) ?? null,
      deliveredAt: (r.delivered_at as string | null) ?? null,
      readAt: (r.read_at as string | null) ?? null,
      isCurrentMember: r.is_current_member !== false,
    })),
  };
}

/** Own read-receipt preference; null if unknown (e.g. not migrated / offline). */
export async function getReadReceiptsEnabled(supabase: SupabaseClient): Promise<boolean | null> {
  if (receiptsUnavailable) return null;
  const { data, error } = await supabase.rpc("p2p_get_my_read_receipts");
  if (error) { noteError(error); return null; }
  return data !== false;
}

/** Returns an error message, or null on success. */
export async function setReadReceiptsEnabled(supabase: SupabaseClient, enabled: boolean): Promise<string | null> {
  if (receiptsUnavailable) return "Read receipts aren't available yet.";
  const { error } = await supabase.rpc("p2p_set_my_read_receipts", { p_enabled: enabled });
  if (error) { noteError(error); return error.message ?? "Couldn't save this setting."; }
  return null;
}

/**
 * Session-wide delivery acknowledger (inbox + threads). Ids are remembered
 * only after the server accepted them, so a failed (offline) attempt is
 * retried automatically with backoff (and on the next flush/reconnect);
 * duplicates are skipped client-side and are no-ops server-side anyway.
 * reset() (sign-out) also discards any result still in flight, so nothing
 * from the previous session leaks into the next one.
 */
export function createDeliveryAcker(
  getClient: () => SupabaseClient | null,
  delayMs = 400,
  retryBaseMs = 5_000,
  retryMaxMs = 60_000,
) {
  const acked = new Set<string>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let generation = 0;
  let failures = 0;

  function schedule(ms: number) {
    if (!timer) timer = setTimeout(() => { void flush(); }, ms);
  }

  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    const client = getClient();
    if (!client || pending.size === 0) return;
    if (inFlight) { await inFlight; return flush(); }
    const gen = generation;
    const ids = Array.from(pending);
    pending.clear();
    inFlight = (async () => {
      const result = await acknowledgeMessages(client, ids, false);
      if (gen !== generation) return; // signed out meanwhile: drop
      if (result === null) {
        ids.forEach((id) => pending.add(id)); // retry later
        failures += 1;
        schedule(Math.min(retryBaseMs * 2 ** (failures - 1), retryMaxMs));
      } else {
        failures = 0;
        ids.forEach((id) => acked.add(id));
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }

  return {
    enqueue(ids: string[]) {
      for (const id of ids) if (!acked.has(id)) pending.add(id);
      if (pending.size) schedule(delayMs);
    },
    flushNow: flush,
    has: (id: string) => acked.has(id),
    acknowledged: acked,
    reset() {
      generation += 1;
      failures = 0;
      acked.clear();
      pending.clear();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
