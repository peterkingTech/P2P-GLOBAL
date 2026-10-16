import crypto from "node:crypto";

// Short-lived, message-specific preview tokens for iPhone long-press previews
// (preview approach B: secure fetch). A push for a recipient who chose "Name
// and message" carries one of these instead of any content; the iOS
// Notification Service Extension sends it back to POST /notifications/preview
// to fetch the text / voice link. Nothing private ever travels through
// Expo or APNs.
//
// Format: v1.<payload>.<signature>, both base64url.
//   payload   = JSON { n: notificationId, u: recipientId, m: messageId,
//                      c: conversationId, e: expiry (unix seconds) }
//   signature = HMAC-SHA256(secret, "v1." + payload)
// Verified with a timing-safe comparison. The token only proves "this
// recipient may look at this one message's preview until e"; the endpoint
// re-checks membership, deletion and the recipient's current preference on
// every fetch, so a token can never outlive a change of mind.
//
// Secret: NOTIFICATION_PREVIEW_SECRET (server env only, >= 32 chars). Absent
// or too short → no tokens are issued and every fetch fails: full previews
// fail closed. Never log tokens.

export const PREVIEW_TOKEN_TTL_SECONDS = 10 * 60;
const VERSION = "v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOKEN_LENGTH = 1024;

export interface PreviewClaims { notificationId: string; recipientId: string; messageId: string; conversationId: string; expiresAt: number }

export function previewSecret(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const s = env.NOTIFICATION_PREVIEW_SECRET;
  return typeof s === "string" && s.length >= 32 ? Buffer.from(s, "utf8") : null;
}

const b64 = (b: Buffer) => b.toString("base64url");
const sign = (secret: Buffer, data: string) => crypto.createHmac("sha256", secret).update(data).digest();

export function issuePreviewToken(
  claims: Omit<PreviewClaims, "expiresAt">,
  opts: { secret?: Buffer | null; now?: number; ttlSeconds?: number } = {},
): string | null {
  const secret = opts.secret === undefined ? previewSecret() : opts.secret;
  if (!secret) return null;
  if (![claims.notificationId, claims.recipientId, claims.messageId, claims.conversationId].every((x) => UUID_RE.test(x ?? ""))) return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const payload = b64(Buffer.from(JSON.stringify({
    n: claims.notificationId, u: claims.recipientId, m: claims.messageId, c: claims.conversationId, e: now + (opts.ttlSeconds ?? PREVIEW_TOKEN_TTL_SECONDS),
  })));
  return `${VERSION}.${payload}.${b64(sign(secret, `${VERSION}.${payload}`))}`;
}

/** Claims of a valid, unexpired token signed with our secret — otherwise null. Never throws. */
export function verifyPreviewToken(token: unknown, opts: { secret?: Buffer | null; now?: number } = {}): PreviewClaims | null {
  const secret = opts.secret === undefined ? previewSecret() : opts.secret;
  if (!secret || typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
  const expected = sign(secret, `${VERSION}.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let p: Record<string, unknown>;
  try { p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
  const ids = [p.n, p.u, p.m, p.c];
  if (!ids.every((x) => typeof x === "string" && UUID_RE.test(x)) || typeof p.e !== "number" || !Number.isFinite(p.e)) return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (p.e <= now || p.e > now + PREVIEW_TOKEN_TTL_SECONDS + 60) return null;
  return { notificationId: p.n as string, recipientId: p.u as string, messageId: p.m as string, conversationId: p.c as string, expiresAt: p.e };
}
