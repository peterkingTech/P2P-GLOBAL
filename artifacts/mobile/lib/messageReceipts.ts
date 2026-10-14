// Message receipts — pure engine (no I/O). Mirrors the authoritative model in
// migrations/179_message_receipts.sql:
//   no receipt row       -> Sent (persisted, not yet acknowledged)
//   row (delivered_at)   -> Delivered to that recipient's device
//   row with read_at     -> Read by that recipient
// The server sets each timestamp once and never clears it; everything here
// only ever merges forward, so duplicate, retried or out-of-order events
// (realtime, refetch after reconnect, RPC results) can never regress a state.

export type OutgoingStatus = "sending" | "failed" | "sent" | "delivered" | "read";

export interface MessageReceipt {
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
}

/** messageId -> recipient userId -> receipt */
export type ReceiptIndex = Record<string, Record<string, MessageReceipt>>;

export interface ConversationMember {
  userId: string;
  joinedAt: string;
}

/** Minimal message shape the engine needs. */
export interface ReceiptMessage {
  id: string;
  sender_id: string | null;
  created_at: string;
  message_type?: string | null;
  deletedAt?: string | null;
  /** Client-only: set while an outgoing message is not yet persisted. */
  localStatus?: "sending" | "failed";
}

const earlier = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
};

/**
 * Monotonic merge of two observations of the same (message, recipient)
 * receipt. A timestamp, once known, is never removed; if two different
 * values are ever seen, the earlier one wins (the server writes each exactly
 * once, so this only matters for stale copies).
 */
export function mergeReceipt(existing: MessageReceipt | undefined, incoming: MessageReceipt): MessageReceipt {
  if (!existing) return { ...incoming, deliveredAt: incoming.deliveredAt ?? incoming.readAt };
  const readAt = earlier(existing.readAt, incoming.readAt);
  // A read receipt implies delivery even if a stale copy lacks delivered_at.
  const deliveredAt = earlier(existing.deliveredAt, incoming.deliveredAt) ?? readAt;
  if (readAt === existing.readAt && deliveredAt === existing.deliveredAt) return existing;
  return { ...existing, deliveredAt, readAt };
}

/** Returns a new index with the rows merged in (same object if nothing changed). */
export function applyReceipts(index: ReceiptIndex, rows: MessageReceipt[]): ReceiptIndex {
  let next = index;
  for (const row of rows) {
    if (!row.messageId || !row.userId) continue;
    const forMessage = next[row.messageId] ?? {};
    const merged = mergeReceipt(forMessage[row.userId], row);
    if (merged === forMessage[row.userId]) continue;
    if (next === index) next = { ...index };
    next[row.messageId] = { ...forMessage, [row.userId]: merged };
  }
  return next;
}

/** Normalizes a p2p_message_receipts row / RPC row / realtime payload. */
export function receiptFromRow(row: Record<string, unknown> | null | undefined, fallbackUserId?: string): MessageReceipt | null {
  if (!row) return null;
  const messageId = (row.message_id ?? row.messageId) as string | undefined;
  const userId = (row.user_id ?? row.userId ?? fallbackUserId) as string | undefined;
  if (!messageId || !userId) return null;
  return {
    messageId,
    userId,
    deliveredAt: ((row.delivered_at ?? row.deliveredAt) as string | null | undefined) ?? null,
    readAt: ((row.read_at ?? row.readAt) as string | null | undefined) ?? null,
  };
}

/**
 * Recipients of a message: every member except the sender whose membership
 * began at or before the message was sent (same rule as the server).
 */
export function recipientsFor(message: ReceiptMessage, members: ConversationMember[]): string[] {
  const sent = Date.parse(message.created_at);
  return members
    .filter((m) => m.userId !== message.sender_id && Date.parse(m.joinedAt) <= sent)
    .map((m) => m.userId);
}

/** Messages that never carry ticks: call summaries and system rows. */
export function isReceiptEligible(message: ReceiptMessage): boolean {
  return !!message.sender_id && message.message_type !== "call_summary";
}

/**
 * Status shown on the sender's own message.
 *  - sending/failed come only from the local send state;
 *  - delivered/read require a receipt from EVERY recipient (one reader in a
 *    group never implies everyone has read);
 *  - with receipts unavailable (e.g. server not migrated) a persisted
 *    message is only ever "sent".
 */
export function deriveOutgoingStatus(
  message: ReceiptMessage,
  members: ConversationMember[],
  receipts: Record<string, MessageReceipt> | undefined,
  receiptsAvailable = true,
): OutgoingStatus {
  if (message.localStatus === "sending") return "sending";
  if (message.localStatus === "failed") return "failed";
  if (!receiptsAvailable) return "sent";
  const recipients = recipientsFor(message, members);
  if (recipients.length === 0) return "sent";
  let allDelivered = true;
  let allRead = true;
  for (const userId of recipients) {
    const r = receipts?.[userId];
    if (!r?.readAt) allRead = false;
    if (!r?.deliveredAt && !r?.readAt) { allDelivered = false; allRead = false; break; }
  }
  if (allRead) return "read";
  if (allDelivered) return "delivered";
  return "sent";
}

/**
 * Incoming messages that may be acknowledged as READ now: only messages that
 * are currently viewable, in the active (focused, foreground) conversation,
 * from someone else, persisted, not deleted, not a call summary, and not
 * already acknowledged as read in this session.
 */
export function selectReadCandidates(params: {
  viewableIds: Iterable<string>;
  messagesById: Map<string, ReceiptMessage>;
  currentUserId: string | null | undefined;
  alreadyRead: Set<string>;
  isActive: boolean;
}): string[] {
  const { viewableIds, messagesById, currentUserId, alreadyRead, isActive } = params;
  if (!isActive || !currentUserId) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of viewableIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = messagesById.get(id);
    if (!m || !isIncomingAckable(m, currentUserId)) continue;
    if (alreadyRead.has(id)) continue;
    out.push(id);
  }
  return out;
}

/** Incoming messages that may be acknowledged as DELIVERED (received by this device). */
export function selectDeliveryCandidates(
  messages: Iterable<ReceiptMessage>,
  currentUserId: string | null | undefined,
  alreadyDelivered: Set<string>,
): string[] {
  if (!currentUserId) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (seen.has(m.id) || alreadyDelivered.has(m.id)) continue;
    seen.add(m.id);
    if (isIncomingAckable(m, currentUserId)) out.push(m.id);
  }
  return out;
}

function isIncomingAckable(m: ReceiptMessage, currentUserId: string): boolean {
  return isReceiptEligible(m)
    && m.sender_id !== currentUserId
    && !m.localStatus
    && !m.deletedAt;
}

/** Splits ids into server-sized batches (the RPC accepts at most 200). */
export function chunkIds(ids: string[], size = 200): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Screen-reader text for a status (never colour alone). */
export function statusAccessibilityLabel(status: OutgoingStatus): string {
  switch (status) {
    case "sending": return "Sending";
    case "failed": return "Not sent. Tap to retry";
    case "sent": return "Sent";
    case "delivered": return "Delivered";
    case "read": return "Read";
  }
}

/** Per-recipient state for the message-info list. */
export type RecipientState = "sent" | "delivered" | "read";
export function recipientState(r: { deliveredAt: string | null; readAt: string | null }): RecipientState {
  if (r.readAt) return "read";
  if (r.deliveredAt) return "delivered";
  return "sent";
}

/** RFC 4122 v4 id for a new outgoing message (retry-safe client id). */
export function newMessageId(random: (bytes: Uint8Array) => void = defaultRandom): string {
  const b = new Uint8Array(16);
  random(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultRandom(bytes: Uint8Array) {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) { c.getRandomValues(bytes); return; }
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
}
