// Which Supabase project this API server talks to — pure checks (no I/O).
//
// P2P_ENV unset or "production": nothing changes (the existing per-module
// fallbacks keep working exactly as before).
// P2P_ENV="staging": the server must be configured EXPLICITLY for a
// non-production project. Many modules fall back to the production URL and
// anon key when variables are missing, so a staging server that is missing a
// variable would otherwise talk to production. lib/envGuard.ts runs this
// before any other module loads and stops the process if it fails.

export const PRODUCTION_REF = "omkqkasniakcnmfcwrvs";
export const PRODUCTION_API_HOSTS = ["workspaceapi-server-production-6d56.up.railway.app"];

/** True for any URL that reaches the production Supabase project or production API. */
export function isProductionUrl(url: string | undefined | null): boolean {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host === `${PRODUCTION_REF}.supabase.co` || host.endsWith(`.${PRODUCTION_REF}.supabase.co`)
      || PRODUCTION_API_HOSTS.includes(host);
  } catch {
    return false;
  }
}
const URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;

type Env = Record<string, string | undefined>;

function jwtPayload(token: string | undefined): Record<string, unknown> | null {
  try {
    const part = String(token ?? "").split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const p = JSON.parse(json);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

/** The URL the modules actually use (they prefer an https SUPABASE_DB_URL). */
export function effectiveSupabaseUrl(env: Env): string | null {
  if (env.SUPABASE_DB_URL?.startsWith("https://")) return env.SUPABASE_DB_URL;
  return env.SUPABASE_URL?.trim() || null;
}

export function checkServerEnv(env: Env): { target: "production" | "staging"; ref: string | null; errors: string[] } {
  const target = (env.P2P_ENV ?? "production").trim();
  if (target !== "production" && target !== "staging") {
    return { target: "production", ref: null, errors: [`P2P_ENV must be "production" or "staging" (got "${target}")`] };
  }
  if (target === "production") return { target, ref: null, errors: [] };

  const errors: string[] = [];
  const url = effectiveSupabaseUrl(env);
  const ref = url ? URL_RE.exec(url)?.[1] ?? null : null;
  if (!url) errors.push("staging API needs SUPABASE_URL (the staging project URL)");
  else if (!ref) errors.push("SUPABASE_URL must look like https://<project-ref>.supabase.co");
  else if (ref === PRODUCTION_REF) errors.push("staging API is pointed at the PRODUCTION Supabase project");

  const service = jwtPayload(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push("staging API needs SUPABASE_SERVICE_ROLE_KEY (staging)");
  else if (!service || service.role !== "service_role") errors.push("SUPABASE_SERVICE_ROLE_KEY is not a service_role key");
  else if (service.ref === PRODUCTION_REF) errors.push("staging API is using the PRODUCTION service_role key");
  else if (ref && service.ref && service.ref !== ref) errors.push("SUPABASE_SERVICE_ROLE_KEY belongs to a different project than SUPABASE_URL");

  const anon = jwtPayload(env.SUPABASE_ANON_KEY);
  if (!env.SUPABASE_ANON_KEY) errors.push("staging API needs SUPABASE_ANON_KEY (staging)");
  else if (!anon || anon.role !== "anon") errors.push("SUPABASE_ANON_KEY is not an anon key");
  else if (anon.ref === PRODUCTION_REF) errors.push("staging API is using the PRODUCTION anon key");
  else if (ref && anon.ref && anon.ref !== ref) errors.push("SUPABASE_ANON_KEY belongs to a different project than SUPABASE_URL");

  return { target, ref, errors };
}
