// Imported FIRST by src/index.ts, so it runs before any module creates a
// Supabase client. Production (P2P_ENV unset/"production") is a no-op. A
// staging server that is not explicitly configured for a non-production
// project stops here instead of falling back to production; a correctly
// configured staging server additionally refuses, at the network layer, any
// request to the production project or production API (the server talks to
// the outside world only through fetch — no direct Postgres or WebSocket
// clients). Never logs keys.
import { PRODUCTION_REF, checkServerEnv, isProductionUrl } from "./serverEnv";

const result = checkServerEnv(process.env);
if (result.errors.length) {
  // eslint-disable-next-line no-console
  console.error(`[envGuard] refusing to start (P2P_ENV=${process.env.P2P_ENV ?? "production"}):\n - ${result.errors.join("\n - ")}`);
  process.exit(1);
}

if (result.target === "staging") {
  const realFetch = globalThis.fetch;
  const urlOf = (input: unknown): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : String((input as { url?: string })?.url ?? "");
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (isProductionUrl(urlOf(input))) {
      return Promise.reject(new Error("[envGuard] blocked: a staging API never contacts production"));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const RealWebSocket = (globalThis as { WebSocket?: new (...a: unknown[]) => unknown }).WebSocket;
  if (RealWebSocket) {
    (globalThis as { WebSocket?: unknown }).WebSocket = new Proxy(RealWebSocket, {
      construct(target, args): object {
        if (isProductionUrl(String(args[0]))) throw new Error("[envGuard] blocked: a staging API never contacts production");
        return Reflect.construct(target, args) as object;
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log("[envGuard] STAGING API: non-production project only; production hosts blocked at the network layer");

  if (process.env.P2P_STAGING_CHECK_ONLY === "1") {
    // Configuration check: prove the block is active (the request must be
    // refused locally, before any network I/O), then exit without listening.
    let blocked = false;
    try { await globalThis.fetch(`https://${PRODUCTION_REF}.supabase.co/rest/v1/`); }
    catch (e) { blocked = /\[envGuard\] blocked/.test(String((e as Error)?.message)); }
    // eslint-disable-next-line no-console
    console.log(`[envGuard] check-only: configuration valid; production request ${blocked ? "BLOCKED" : "NOT BLOCKED"}`);
    process.exit(blocked ? 0 : 1);
  }
}

export {};
