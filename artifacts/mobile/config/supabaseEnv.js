// Build-time and run-time selection of the backend the app talks to.
//
// Used by BOTH app.config.js (evaluated by Expo/EAS while building — a thrown
// error fails the build) and contexts/AuthContext.tsx (run time), so the two
// can never disagree. Plain CommonJS so app.config.js can require it.
//
//   EXPO_PUBLIC_P2P_ENV            "production" (default when unset) | "staging"
//   EXPO_PUBLIC_SUPABASE_URL       staging: required; production: optional, must be production
//   EXPO_PUBLIC_SUPABASE_ANON_KEY  staging: required; production: optional, must be production's
//   EXPO_PUBLIC_API_URL            staging: required — a non-production API, or "disabled"
//
// Rules: production stays the default; a staging build can never point at the
// production project or production API; a production build can never point at
// another project; only an anon (public) key may ever ship in the app — a
// service_role key is rejected outright.

const PRODUCTION_REF = "omkqkasniakcnmfcwrvs";
const PRODUCTION_API_HOSTS = ["workspaceapi-server-production-6d56.up.railway.app"];
const SUPABASE_URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function refFromUrl(url) {
  const m = SUPABASE_URL_RE.exec(String(url || "").trim());
  return m ? m[1] : null;
}

/** Returns an error message, or null if the key is an anon key for `ref`. */
function checkAnonKey(key, ref) {
  const p = decodeJwtPayload(key);
  if (!p) return "Supabase key is not a valid Supabase JWT";
  if (p.role !== "anon") return `Supabase key role is "${p.role}" — only the anon (public) key may ship in the app, never a service_role key`;
  if (p.ref && p.ref !== ref) return "Supabase anon key belongs to a different project than the Supabase URL";
  return null;
}

function apiHost(url) {
  const m = /^https?:\/\/([^/:]+)/i.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : null;
}

function isPrivateHttpHost(host) {
  return host === "localhost" || host === "127.0.0.1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/**
 * @param env        object with the EXPO_PUBLIC_* values (pass them explicitly at run time:
 *                   Expo only inlines `process.env.EXPO_PUBLIC_X` written out literally)
 * @param production { url, anonKey } compiled into the app (run time) or nulls (build time)
 * @returns { ok: true, config } | { ok: false, errors: string[] }
 */
function resolveSupabaseConfig(env, production) {
  const e = env || {};
  const errors = [];
  const target = String(e.EXPO_PUBLIC_P2P_ENV || "production").trim();
  if (target !== "production" && target !== "staging") {
    return { ok: false, errors: [`EXPO_PUBLIC_P2P_ENV must be "production" or "staging" (got "${target}")`] };
  }
  const url = (e.EXPO_PUBLIC_SUPABASE_URL || "").trim() || null;
  const key = (e.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim() || null;
  const api = (e.EXPO_PUBLIC_API_URL || "").trim() || null;

  if (target === "production") {
    if (url && refFromUrl(url) !== PRODUCTION_REF) errors.push("production build is pointed at a non-production Supabase URL");
    const effectiveKey = key || (production && production.anonKey) || null;
    if (effectiveKey) { const k = checkAnonKey(effectiveKey, PRODUCTION_REF); if (k) errors.push(k); }
    const effectiveUrl = url || (production && production.url) || `https://${PRODUCTION_REF}.supabase.co`;
    if (refFromUrl(effectiveUrl) !== PRODUCTION_REF) errors.push("compiled-in production Supabase URL is not the production project");
    if (errors.length) return { ok: false, errors };
    return { ok: true, config: { target, ref: PRODUCTION_REF, url: effectiveUrl.replace(/\/$/, ""), anonKey: effectiveKey, apiUrl: api } };
  }

  // staging
  if (!url) errors.push("staging build needs EXPO_PUBLIC_SUPABASE_URL");
  const ref = url ? refFromUrl(url) : null;
  if (url && !ref) errors.push("EXPO_PUBLIC_SUPABASE_URL must look like https://<project-ref>.supabase.co");
  if (ref && ref === PRODUCTION_REF) errors.push("staging build is pointed at the PRODUCTION Supabase project");
  if (!key) errors.push("staging build needs EXPO_PUBLIC_SUPABASE_ANON_KEY (the staging anon key)");
  if (key && ref) { const k = checkAnonKey(key, ref); if (k) errors.push(k); }
  if (key && ref !== PRODUCTION_REF) { const p = decodeJwtPayload(key); if (p && p.ref === PRODUCTION_REF) errors.push("staging build is using the PRODUCTION anon key"); }
  if (!api) errors.push('staging build needs EXPO_PUBLIC_API_URL (a non-production API server, or "disabled")');
  if (api && api !== "disabled") {
    const host = apiHost(api);
    if (!host) errors.push("EXPO_PUBLIC_API_URL is not an http(s) URL");
    else if (PRODUCTION_API_HOSTS.includes(host)) errors.push("staging build is pointed at the PRODUCTION API server");
    else if (/^http:\/\//i.test(api) && !isPrivateHttpHost(host)) errors.push("plain http API URLs are only allowed for a local/LAN test server");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { target, ref, url: url.replace(/\/$/, ""), anonKey: key, apiUrl: api } };
}

/** Extra build-time rules tied to the EAS build profile name. */
function validateBuildProfile(profile, env) {
  const e = env || {};
  const target = String(e.EXPO_PUBLIC_P2P_ENV || "production").trim();
  const errors = [];
  if (profile === "production") {
    if (target !== "production") errors.push(`EAS profile "production" must build EXPO_PUBLIC_P2P_ENV=production (got "${target}")`);
    const host = apiHost(e.EXPO_PUBLIC_API_URL);
    if (!host || !PRODUCTION_API_HOSTS.includes(host)) errors.push("EAS profile \"production\" must use the production API server");
  }
  if (profile === "staging" && target !== "staging") errors.push(`EAS profile "staging" must build EXPO_PUBLIC_P2P_ENV=staging (got "${target}")`);
  return errors;
}

module.exports = {
  PRODUCTION_REF,
  PRODUCTION_API_HOSTS,
  decodeJwtPayload,
  refFromUrl,
  checkAnonKey,
  resolveSupabaseConfig,
  validateBuildProfile,
};
