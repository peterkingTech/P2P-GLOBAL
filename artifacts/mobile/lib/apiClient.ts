import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// The app's one way to call the P2P API server. Every feature's *Api.ts file
// used to carry its own copy of this (token lookup, headers, JSON parsing,
// error shape); they now pass their differences as options instead.
//   • The signed-in person's Supabase token goes in `Authorization: Bearer`
//     (omitted when signed out — the server answers 401, as before).
//   • JSON bodies get `Content-Type: application/json`; FormData is left to
//     fetch so the multipart boundary is set correctly.
//   • A failed response throws an Error whose message is the server's own
//     `error` text, with `status` attached (0 = no connection).
//   • AbortError (a cancelled request) is always passed through untouched.

/** The signed-in person's access token, or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** fetch() against the API with the sign-in token added; the raw Response, for callers that read it themselves. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((init.headers as Record<string, string>) ?? {}) },
  });
}

export interface ApiRequestOptions {
  /** Prefix added before `path` (e.g. "/study-together"). */
  base?: string;
  /** Message when the server gives no `error` text. Default "Request failed". */
  fallbackError?: string;
  /** When set, a network failure throws this message with status 0 instead of fetch's own error. */
  offlineError?: string;
  /** Builds the thrown error (a feature's own error class, or extra fields from the body). */
  makeError?: (message: string, status: number, body: Record<string, unknown>) => Error;
}

const defaultError = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Calls the API and returns the parsed JSON body; throws on a failed response (see the header). */
export async function apiRequest<T = any>(path: string, init: RequestInit = {}, opts: ApiRequestOptions = {}): Promise<T> {
  const token = await accessToken();
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const makeError = opts.makeError ?? defaultError;
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${opts.base ?? ""}${path}`, {
      ...init,
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
  } catch (e: any) {
    if (e?.name === "AbortError" || !opts.offlineError) throw e;
    throw makeError(opts.offlineError, 0, {});
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = (body ?? {}) as Record<string, unknown>;
    throw makeError(typeof b.error === "string" && b.error ? b.error : opts.fallbackError ?? "Request failed", res.status, b);
  }
  return body as T;
}
