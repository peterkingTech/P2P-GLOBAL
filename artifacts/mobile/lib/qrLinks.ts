// QR codes: what goes into a code we show, and what we accept from a code we
// scan. One place for both, so the generator and the scanner can't drift.
//
// What a code contains: only a public URL. Profile codes carry the public
// @username, Circle codes the Circle's id. No names, private details, tokens
// or credentials. The URL is the same HTTPS share-landing form that shared
// links already use (lib/sharing.ts), so a phone's own camera app opens it
// too, once that page is deployed (web/share-landing.html; until then the
// in-app scanner still works because it reads the app link out of the URL).
//
// What a scan may do: open one of a fixed list of app screens. Each of those
// screens loads its data from the server, which applies the real permission
// checks. Scanning never joins, connects, messages or follows anyone. Anything
// else — other websites, other apps' codes, malformed links — is refused and
// never opened. Scanned text is untrusted: it is never logged or shown back.

import { APP_SCHEME, WEB_APP_URL } from "./sharing";

export type QrKind = "profile" | "circle" | "family" | "app";
export interface QrSpec {
  kind: QrKind;
  /** Exactly what is encoded in the QR. */
  url: string;
  title: string;
  /** Short line shown under the code. */
  caption: string;
  /** What scanning does (and does not do). */
  note: string;
  shareMessage: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Looser than signup validation (lib/username.ts) on purpose: older accounts
// may predate today's rules. The profile screen handles unknown usernames.
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const SLUG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Room invitation tokens are 24 random bytes in base64url (routes/roomInvitations.ts).
const ROOM_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
// Family invite-link tokens: 24 random bytes in base64url (routes/family.ts, migration 192).
const FAMILY_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
// Church invite codes: slugified name + random suffix (routes/churches.ts).
const CHURCH_CODE_RE = /^[a-z0-9-]{1,100}$/;
export const MAX_SCAN_LENGTH = 2048;

function landingUrl(params: Record<string, string>): string {
  const q = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${WEB_APP_URL}/share-landing.html?${q}`;
}

export function profileQr(username: string | null | undefined): QrSpec | null {
  const u = (username ?? "").trim().replace(/^@/, "");
  if (!USERNAME_RE.test(u)) return null;
  const url = landingUrl({ type: "profile", title: `@${u}`, link: `${APP_SCHEME}://profile/${u}` });
  return {
    kind: "profile", url, title: "My QR code", caption: "Scan to view my profile",
    note: "Shows your public profile only. Scanning doesn't connect you or share private details.",
    shareMessage: `Connect with @${u} on P2P Global:\n${url}`,
  };
}

export function circleQr(circle: { id: string; name: string }): QrSpec | null {
  if (!UUID_RE.test(circle.id)) return null;
  // The Circle's name is shown on screen and in the share message the member
  // chooses to send, but not encoded in the QR: the id is all a scan needs.
  const url = landingUrl({ type: "circle", link: `${APP_SCHEME}://circles/${circle.id.toLowerCase()}` });
  return {
    kind: "circle", url, title: circle.name, caption: "Scan to open this Circle",
    note: "Opening the Circle doesn't join it. People can send a request, and the leader approves.",
    shareMessage: `Take a look at the "${circle.name}" Circle on P2P Global:\n${url}`,
  };
}

/**
 * Family Circle invite link. The token is the only thing in the code (no
 * family name or id); it expires, can be revoked, and only lets someone ASK
 * to join — a Shepherd or Co-Shepherd approves (routes/family.ts).
 */
export function familyInviteQr(invite: { token: string; familyName: string; expiresAt: string }): QrSpec | null {
  if (!FAMILY_TOKEN_RE.test(invite.token)) return null;
  const url = landingUrl({ type: "family", link: `${APP_SCHEME}://family/join/${invite.token}` });
  const until = new Date(invite.expiresAt);
  const expiry = Number.isNaN(until.getTime()) ? "" : ` It expires on ${until.toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`;
  return {
    kind: "family", url, title: invite.familyName, caption: "Scan to ask to join this Family Circle",
    note: `Scanning doesn't add anyone: you approve each request.${expiry} Only share it with people you know.`,
    shareMessage: `You're invited to ask to join ${invite.familyName} on P2P Global:\n${url}`,
  };
}

export function appQr(): QrSpec {
  return {
    kind: "app", url: WEB_APP_URL, title: "Share P2P Global", caption: "Scan to get P2P Global",
    note: "Opens the official P2P Global website. This shares the app, not your profile.",
    shareMessage: `🌳 P2P Global — a peer-to-peer Bible discipleship network.\n\nGet it free: ${WEB_APP_URL}`,
  };
}

// ── Scanning ────────────────────────────────────────────────────────────────
export type ScanKind = "profile" | "circle" | "family" | "room" | "lesson" | "plan" | "category" | "church" | "app";
export type ScanResult =
  | { ok: true; kind: ScanKind; path: string }
  | { ok: false; reason: "empty" | "not_p2p" | "unsupported" };

const UNSUPPORTED = { ok: false, reason: "unsupported" } as const;

/** An app link path (after "scheme://") → the in-app route, or null. */
function routeFromAppPath(p: string): ScanResult {
  const clean = p.replace(/[?#].*$/, "").replace(/\/+$/, "");
  let m: RegExpMatchArray | null;
  if ((m = clean.match(/^profile\/@?([^/]+)$/)) && USERNAME_RE.test(m[1])) return { ok: true, kind: "profile", path: `/profile/${m[1]}` };
  if ((m = clean.match(/^circles\/([^/]+)$/)) && UUID_RE.test(m[1])) return { ok: true, kind: "circle", path: `/circles/${m[1].toLowerCase()}` };
  if ((m = clean.match(/^rooms\/join\/([^/]+)$/)) && ROOM_TOKEN_RE.test(m[1])) return { ok: true, kind: "room", path: `/rooms/join/${m[1]}` };
  if ((m = clean.match(/^family\/join\/([^/]+)$/)) && FAMILY_TOKEN_RE.test(m[1])) return { ok: true, kind: "family", path: `/family/join/${m[1]}` };
  if ((m = clean.match(/^lesson\/([^/]+)$/)) && SLUG_ID_RE.test(m[1])) return { ok: true, kind: "lesson", path: `/lesson/${m[1]}` };
  if ((m = clean.match(/^plan\/([^/]+)$/)) && SLUG_ID_RE.test(m[1])) return { ok: true, kind: "plan", path: `/plan/${m[1]}` };
  if ((m = clean.match(/^plans\/category\/([^/]+)$/)) && SLUG_ID_RE.test(m[1])) return { ok: true, kind: "category", path: `/plans/category/${m[1]}` };
  return UNSUPPORTED;
}

function queryParam(query: string, name: string): string | null {
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")); } catch { return null; }
  }
  return null;
}

const SITE_RE = new RegExp(`^${WEB_APP_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(/[^?#]*)?(?:\\?([^#]*))?(?:#.*)?$`, "i");
const SCHEME_PREFIX = `${APP_SCHEME}://`;

/** Decide what a scanned or pasted code opens. Never throws. */
export function parseP2PCode(raw: unknown): ScanResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const text = raw.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_SCAN_LENGTH) return { ok: false, reason: "not_p2p" };

  if (text.toLowerCase().startsWith(SCHEME_PREFIX)) return routeFromAppPath(text.slice(SCHEME_PREFIX.length));

  const site = text.match(SITE_RE);
  if (!site) return { ok: false, reason: "not_p2p" };
  const pathname = (site[1] ?? "").replace(/\/+$/, "");
  const query = site[2] ?? "";

  if (pathname === "") return { ok: true, kind: "app", path: "/" };
  if (pathname.toLowerCase() === "/share-landing.html") {
    const link = queryParam(query, "link");
    if (link && link.toLowerCase().startsWith(SCHEME_PREFIX)) return routeFromAppPath(link.slice(SCHEME_PREFIX.length));
    return UNSUPPORTED;
  }
  let m: RegExpMatchArray | null;
  if ((m = pathname.match(/^\/join\/church\/([^/]+)$/))) {
    let code: string;
    try { code = decodeURIComponent(m[1]); } catch { return UNSUPPORTED; }
    // Opens the existing join screen with the code filled in; the person
    // still confirms, and the server validates the code.
    return CHURCH_CODE_RE.test(code) ? { ok: true, kind: "church", path: `/church/join?code=${encodeURIComponent(code)}` } : UNSUPPORTED;
  }
  // Personal invite links (/join/@username): for someone already signed in,
  // the useful destination is that person's public profile.
  if ((m = pathname.match(/^\/join\/@?([^/]+)$/)) && USERNAME_RE.test(m[1])) return { ok: true, kind: "profile", path: `/profile/${m[1]}` };
  return UNSUPPORTED;
}

export function scanErrorMessage(reason: "empty" | "not_p2p" | "unsupported"): string {
  if (reason === "empty") return "No code found. Try again.";
  if (reason === "not_p2p") return "This isn't a P2P Global code, so it wasn't opened.";
  return "This P2P Global code can't be opened in the app. It may be from a newer version or no longer valid.";
}

/** One scan per code: the camera reports the same code many times a second. */
export function createScanHandler(opts: { open(path: string): void; onInvalid(message: string): void }) {
  let locked = false;
  return {
    handle(data: unknown): boolean {
      if (locked) return false;
      locked = true;
      const r = parseP2PCode(data);
      if (r.ok) opts.open(r.path); else opts.onInvalid(scanErrorMessage(r.reason));
      return r.ok;
    },
    /** Allow the next scan (after an invalid code, or "Scan again"). */
    reset() { locked = false; },
    get locked() { return locked; },
  };
}

// ── Camera permission ──────────────────────────────────────────────────────
export type ScannerGate = "checking" | "explain" | "blocked" | "ready";
/**
 * What the scanner screen shows. Permission is only requested when the person
 * taps "Allow camera" on the explain step — never on screen open.
 */
export function scannerGate(perm: { granted: boolean; canAskAgain: boolean } | null): ScannerGate {
  if (!perm) return "checking";
  if (perm.granted) return "ready";
  return perm.canAskAgain ? "explain" : "blocked";
}
