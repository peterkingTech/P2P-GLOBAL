import http2 from "node:http2";
import crypto from "node:crypto";
import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";

// iOS PushKit VoIP pushes, sent straight to Apple. Expo's push service can't
// send these, and they are the only way iOS will wake a closed app to ring
// an incoming call through CallKit (the app reports the call to CallKit the
// moment the push lands — modules/call-system's iOS code).
//
// Needs an APNs auth key from the Apple Developer account (Keys → "Apple
// Push Notifications service"). Until these env vars are set this is
// switched off and incoming calls keep using the ordinary Expo push:
//   APNS_KEY_ID      the key's 10-character Key ID
//   APNS_TEAM_ID     the Apple team ID (6GP65JWS3J)
//   APNS_AUTH_KEY    the .p8 file's contents ("\n" escapes are accepted)
//   APNS_BUNDLE_ID   optional, defaults to the app's bundle id
//   APNS_SANDBOX     "true" only for development (Xcode) builds;
//                    TestFlight/App Store builds use production APNs

const KEY_ID = process.env.APNS_KEY_ID ?? "";
const TEAM_ID = process.env.APNS_TEAM_ID ?? "";
const AUTH_KEY = normalizeAuthKey(process.env.APNS_AUTH_KEY ?? "");

// Accepts the .p8 contents however they were pasted into the env var: the
// full PEM file, with "\n" escapes instead of newlines, or just the base64
// body without the BEGIN/END lines (wrapped back into PEM here).
function normalizeAuthKey(raw: string): string {
  const text = raw.replace(/\\n/g, "\n").trim();
  if (!text || text.includes("-----BEGIN")) return text;
  const body = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) return text;
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}
const BUNDLE_ID = process.env.APNS_BUNDLE_ID ?? "com.amentech.p2pglobaldiscipleshipnetwork";
const HOST = process.env.APNS_SANDBOX === "true" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";

export function voipConfigured(): boolean {
  // NATIVE_CALLS_IOS=false (see GET /calls/config) switches CallKit off.
  return !!(KEY_ID && TEAM_ID && AUTH_KEY) && process.env.NATIVE_CALLS_IOS !== "false";
}

// APNs accepts a provider token for up to an hour; refresh well before.
let cachedJwt: { token: string; issuedAt: number } | null = null;
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 40 * 60) return cachedJwt.token;
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid: KEY_ID })}.${b64({ iss: TEAM_ID, iat: now })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: AUTH_KEY, dsaEncoding: "ieee-p1363" });
  cachedJwt = { token: `${unsigned}.${signature.toString("base64url")}`, issuedAt: now };
  return cachedJwt.token;
}

function sendOne(client: http2.ClientHttp2Session, deviceToken: string, body: string): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": `${BUNDLE_ID}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      // A ring that can't be delivered within the ring window is dropped.
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 30),
    });
    let status = 0, data = "";
    req.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      let reason: string | undefined;
      try { reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined; } catch { /* empty body */ }
      resolve({ status, reason });
    });
    req.on("error", (e) => resolve({ status: 0, reason: e.message }));
    req.setTimeout(10000, () => { req.close(); resolve({ status: 0, reason: "timeout" }); });
    req.end(body);
  });
}

/**
 * Rings every iOS device of `userId` that registered a VoIP token. Returns
 * the device_ids that were reached, so the caller can skip the ordinary
 * Expo push for those same devices (CallKit is ringing them instead).
 */
export async function sendIncomingCallVoip(userId: string, payload: Record<string, unknown>): Promise<Set<string>> {
  const reached = new Set<string>();
  if (!voipConfigured()) return reached;
  const { data: rows } = await db.from("p2p_push_tokens")
    .select("token, device_id").eq("user_id", userId).eq("platform", "ios_voip").eq("is_active", true);
  if (!rows?.length) return reached;

  const client = http2.connect(HOST);
  client.on("error", (e) => logger.error({ err: e }, "apnsVoip: connection error"));
  try {
    const body = JSON.stringify({ aps: {}, ...payload });
    const stale: string[] = [];
    await Promise.all(rows.map(async (r) => {
      const result = await sendOne(client, r.token as string, body);
      if (result.status === 200) {
        if (r.device_id) reached.add(r.device_id as string);
      } else {
        logger.warn({ status: result.status, reason: result.reason }, "apnsVoip: push not accepted");
        if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered") stale.push(r.token as string);
      }
    }));
    if (stale.length) await db.from("p2p_push_tokens").update({ is_active: false }).in("token", stale);
  } catch (e) {
    logger.error({ err: e }, "apnsVoip: send failed");
  } finally {
    client.close();
  }
  return reached;
}
