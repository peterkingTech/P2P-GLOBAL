import http2 from "node:http2";
import crypto from "node:crypto";
import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";
import { classifyApnsResult, voipConfigStatus } from "./apnsVoipStatus";

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

// Reported once at start-up (variable NAMES only, never values), so a missing
// setting is visible in the logs instead of silently disabling VoIP ringing.
{
  const s = voipConfigStatus(process.env);
  if (s.configured) {
    logger.info({ provider: "apns-voip", topic: s.topic, environment: s.sandbox ? "sandbox" : "production" }, "apnsVoip: VoIP ringing configured");
  } else {
    logger.warn({ provider: "apns-voip", missing: s.missing, disabledByFlag: s.disabledByFlag },
      "apnsVoip: VoIP ringing NOT configured — closed iPhones only get the ordinary Expo push for calls");
  }
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
  if (!voipConfigured()) {
    const s = voipConfigStatus(process.env);
    logger.warn({ provider: "apns-voip", reason: "not_configured", missing: s.missing, disabledByFlag: s.disabledByFlag },
      "apnsVoip: VoIP push not attempted");
    return reached;
  }
  const { data: rows } = await db.from("p2p_push_tokens")
    .select("token, device_id").eq("user_id", userId).eq("platform", "ios_voip").eq("is_active", true);
  if (!rows?.length) {
    logger.info({ provider: "apns-voip", devices: 0 }, "apnsVoip: recipient has no VoIP devices");
    return reached;
  }

  const client = http2.connect(HOST);
  client.on("error", (e) => logger.error({ err: e }, "apnsVoip: connection error"));
  try {
    const body = JSON.stringify({ aps: {}, ...payload });
    const stale: string[] = [];
    const summary: Record<string, number> = {};
    await Promise.all(rows.map(async (r) => {
      const result = await sendOne(client, r.token as string, body);
      const kind = classifyApnsResult(result.status, result.reason);
      summary[kind] = (summary[kind] ?? 0) + 1;
      if (kind === "accepted") {
        if (r.device_id) reached.add(r.device_id as string);
      } else {
        logger.warn({ provider: "apns-voip", status: result.status, reason: result.reason, kind }, "apnsVoip: push not accepted");
        if (kind === "token_invalid") stale.push(r.token as string);
      }
    }));
    // Apple accepting a VoIP push (200) is not proof the phone rang; the
    // device-side CallKit report is what rings it.
    logger.info({ provider: "apns-voip", devices: rows.length, outcomes: summary, reached: reached.size }, "apnsVoip: incoming-call push outcome");
    if (stale.length) await db.from("p2p_push_tokens").update({ is_active: false }).in("token", stale);
  } catch (e) {
    logger.error({ err: e }, "apnsVoip: send failed");
  } finally {
    client.close();
  }
  return reached;
}
