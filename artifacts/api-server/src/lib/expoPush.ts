// Expo push sending — pure, dependency-injected, no database or logger
// imports, so every failure mode can be tested against a mocked endpoint.
// lib/pushDispatch.ts decides WHAT to send and what to record; this module
// decides HOW a list of messages reaches Expo and what happened to each one.
//
// Guarantees:
//   - never more than EXPO_MAX_PER_REQUEST (100, Expo's documented limit)
//     messages in one request; every chunk is attempted independently;
//   - the result has exactly one outcome per input message, in input order;
//   - tickets are only trusted when Expo returns one per message (its
//     documented contract); anything else is treated as ambiguous;
//   - messages are only split by project when Expo itself says which token
//     belongs to which project (PUSH_TOO_MANY_EXPERIENCE_IDS details) — never
//     guessed; a token Expo does not place in a project fails visibly;
//   - transient failures (429, 5xx, connection never established) are retried
//     a bounded number of times with exponential backoff and jitter;
//   - an ambiguous failure (timeout or connection reset after the request may
//     have reached Expo) is NOT re-sent, to avoid duplicate notifications;
//   - logs never contain a full push token or the message body.

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_MAX_PER_REQUEST = 100;

export type ExpoMessage = { to: string } & Record<string, unknown>;

export type MessageOutcome =
  | { kind: "accepted"; ticketId?: string }
  /** The token is no longer valid (DeviceNotRegistered): deactivate it. */
  | { kind: "token_invalid"; code: string }
  /** Will not succeed by retrying (bad credentials, message too big, unknown project…). */
  | { kind: "permanent"; code: string }
  /** May succeed later (rate limited, provider unavailable, retries exhausted). */
  | { kind: "transient"; code: string }
  /** Unknown whether Expo accepted it — not re-sent, to avoid duplicates. */
  | { kind: "ambiguous"; code: string };

export interface ExpoLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ExpoSendDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
    ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
  }>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  logger: ExpoLogger;
  /** Optional Expo access token (enhanced push security). Never logged. */
  accessToken?: string;
}

export interface ExpoSendOptions {
  maxAttempts?: number;   // per chunk, including the first try
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  label?: string;         // for logs, e.g. "cron" / "incoming_call"
}

const SAFE_TO_RETRY_NETWORK = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const TOKEN_RE = /(Expo(nent)?PushToken\[)[^\]]*\]/g;

/** Short, non-reversible label for a token in logs. */
export function maskToken(token: string): string {
  const inner = /\[([^\]]*)\]/.exec(token)?.[1] ?? token;
  return `…${inner.slice(-4)}`;
}

/** Provider text with any push token removed and length bounded. */
export function sanitizeProviderText(text: unknown): string {
  return String(text ?? "").replace(TOKEN_RE, "$1…]").slice(0, 300);
}

function networkCode(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "TIMEOUT";
  return e?.cause?.code ?? e?.code ?? e?.cause?.name ?? e?.name ?? "NETWORK_ERROR";
}

function ticketOutcome(ticket: unknown): MessageOutcome {
  const t = ticket as { status?: string; id?: string; message?: string; details?: { error?: string } } | null;
  if (t?.status === "ok") return { kind: "accepted", ticketId: t.id };
  const code = t?.details?.error ?? "TICKET_ERROR";
  if (code === "DeviceNotRegistered") return { kind: "token_invalid", code };
  if (code === "MessageRateExceeded") return { kind: "transient", code };
  return { kind: "permanent", code };
}

type ChunkResult = MessageOutcome[];

export async function sendExpoMessages(
  messages: ExpoMessage[],
  deps: ExpoSendDeps,
  opts: ExpoSendOptions = {},
): Promise<MessageOutcome[]> {
  const o = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000, timeoutMs: 15000, label: "push", ...opts };
  const out: MessageOutcome[] = new Array(messages.length);
  for (let start = 0; start < messages.length; start += EXPO_MAX_PER_REQUEST) {
    const chunk = messages.slice(start, start + EXPO_MAX_PER_REQUEST);
    const results = await sendChunk(chunk, deps, o, 0);
    results.forEach((r, i) => { out[start + i] = r; });
  }
  return out;
}

async function sendChunk(chunk: ExpoMessage[], deps: ExpoSendDeps, o: Required<ExpoSendOptions>, depth: number): Promise<ChunkResult> {
  const all = (outcome: MessageOutcome): ChunkResult => chunk.map(() => outcome);
  const log = (level: "info" | "warn" | "error", fields: Record<string, unknown>, msg: string) =>
    deps.logger[level]({ provider: "expo", label: o.label, batchSize: chunk.length, ...fields }, msg);

  for (let attempt = 1; ; attempt++) {
    let res: Awaited<ReturnType<ExpoSendDeps["fetch"]>>;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (deps.accessToken) headers.Authorization = `Bearer ${deps.accessToken}`;
      res = await deps.fetch(EXPO_PUSH_URL, {
        method: "POST", headers, body: JSON.stringify(chunk),
        signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(o.timeoutMs) : undefined,
      });
    } catch (err) {
      const code = networkCode(err);
      if (SAFE_TO_RETRY_NETWORK.has(code)) {
        if (attempt < o.maxAttempts) { await backoff(attempt, null); continue; }
        log("error", { code, attempt, decision: "give_up_transient" }, "expoPush: network error, retries exhausted");
        return all({ kind: "transient", code });
      }
      // Timeout / reset: the request may already have been accepted.
      log("error", { code, attempt, decision: "no_resend_ambiguous" }, "expoPush: ambiguous network failure, not re-sending");
      return all({ kind: "ambiguous", code });
    }

    const text = await res.text().catch(() => "");
    let json: { data?: unknown; errors?: { code?: string; message?: string; details?: unknown }[] } | null = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (res.ok) {
      const data = json?.data;
      if (!Array.isArray(data) || data.length !== chunk.length) {
        log("error", { status: res.status, attempt, decision: "no_resend_ambiguous", tickets: Array.isArray(data) ? data.length : null },
          "expoPush: ticket count does not match the messages sent; outcome unknown");
        return all({ kind: "ambiguous", code: "TICKET_COUNT_MISMATCH" });
      }
      const outcomes = data.map(ticketOutcome);
      const counts = outcomes.reduce((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {} as Record<string, number>);
      const codes = Array.from(new Set(outcomes.filter((x) => x.kind !== "accepted").map((x) => (x as { code: string }).code)));
      log(codes.length ? "warn" : "info", { status: res.status, attempt, outcomes: counts, ticketErrors: codes }, "expoPush: request accepted");
      return outcomes;
    }

    const err0 = json?.errors?.[0];
    const code = err0?.code ?? `HTTP_${res.status}`;
    const message = sanitizeProviderText(err0?.message ?? text);

    // Several Expo projects in one request: Expo names which token belongs to
    // which project — use exactly that, never a guess.
    if (code === "PUSH_TOO_MANY_EXPERIENCE_IDS" && depth < 2) {
      const details = (err0?.details ?? {}) as Record<string, unknown>;
      const projectOf = new Map<string, string>();
      for (const [project, tokens] of Object.entries(details)) {
        if (Array.isArray(tokens)) for (const t of tokens) if (typeof t === "string") projectOf.set(t, project);
      }
      const groups = new Map<string, number[]>();
      const unknown: number[] = [];
      chunk.forEach((m, i) => {
        const p = projectOf.get(m.to);
        if (!p) unknown.push(i); else groups.set(p, [...(groups.get(p) ?? []), i]);
      });
      log("warn", { status: res.status, code, projects: Array.from(groups.keys()), perProject: Array.from(groups.values()).map((g) => g.length), unknownProject: unknown.length, decision: "split_by_project" },
        "expoPush: request mixed several Expo projects; re-sending one request per project");
      const results: ChunkResult = new Array(chunk.length);
      for (const i of unknown) results[i] = { kind: "permanent", code: "UNKNOWN_EXPO_PROJECT" };
      if (unknown.length) log("error", { code: "UNKNOWN_EXPO_PROJECT", count: unknown.length, tokens: unknown.map((i) => maskToken(chunk[i].to)) },
        "expoPush: Expo did not assign these tokens to a project; not sent");
      if (groups.size <= 1 && unknown.length === 0) {
        // Expo says "several projects" but lists one: refuse to loop.
        log("error", { code, decision: "give_up_permanent" }, "expoPush: project split did not separate the request");
        return all({ kind: "permanent", code });
      }
      for (const idx of groups.values()) {
        const sub = await sendChunk(idx.map((i) => chunk[i]), deps, o, depth + 1);
        sub.forEach((r, k) => { results[idx[k]] = r; });
      }
      return results;
    }

    // More messages than Expo accepts in one request: halve and retry.
    if (code === "PUSH_TOO_MANY_NOTIFICATIONS" && chunk.length > 1 && depth < 7) {
      log("warn", { status: res.status, code, decision: "split_in_half" }, "expoPush: too many messages in one request; splitting");
      const mid = Math.ceil(chunk.length / 2);
      const a = await sendChunk(chunk.slice(0, mid), deps, o, depth + 1);
      const b = await sendChunk(chunk.slice(mid), deps, o, depth + 1);
      return [...a, ...b];
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < o.maxAttempts) {
      log("warn", { status: res.status, code, message, attempt, decision: "retry" }, "expoPush: transient provider error, retrying");
      await backoff(attempt, res.headers.get("retry-after"));
      continue;
    }
    if (retryable) {
      log("error", { status: res.status, code, message, attempt, decision: "give_up_transient" }, "expoPush: transient provider error, retries exhausted");
      return all({ kind: "transient", code });
    }
    log("error", { status: res.status, code, message, attempt, decision: "give_up_permanent" }, "expoPush: request rejected");
    return all({ kind: "permanent", code });
  }

  async function backoff(attempt: number, retryAfter: string | null) {
    const ra = retryAfter ? Number(retryAfter) : NaN;
    const exp = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** (attempt - 1));
    const delay = Number.isFinite(ra) && ra > 0 ? Math.min(o.maxDelayMs, ra * 1000) : Math.round(exp * (0.5 + deps.random()));
    await deps.sleep(delay);
  }
}

/** What a notification's push attempt amounts to, and whether it is finished. */
export type NotificationVerdict =
  | "accepted"         // Expo accepted it for every device (not proof of display)
  | "partial"          // accepted for some devices; others failed (logged)
  | "no_devices"       // nothing to send to
  | "retry"            // only transient failures: try again on a later run
  | "abandoned"        // transient failures past the retry window
  | "permanent_failure"// cannot succeed by retrying (invalid tokens / rejected)
  | "ambiguous"        // may have been accepted; not re-sent to avoid duplicates
  | "expired";         // an incoming-call ring past its ring window, not sent

export function decideNotification(
  outcomes: MessageOutcome[],
  ctx: { ageMs: number; maxRetryAgeMs: number },
): { verdict: NotificationVerdict; finished: boolean } {
  if (outcomes.length === 0) return { verdict: "no_devices", finished: true };
  const accepted = outcomes.filter((x) => x.kind === "accepted").length;
  if (accepted === outcomes.length) return { verdict: "accepted", finished: true };
  // Re-sending would duplicate it on the devices that already accepted it.
  if (accepted > 0) return { verdict: "partial", finished: true };
  if (outcomes.some((x) => x.kind === "ambiguous")) return { verdict: "ambiguous", finished: true };
  if (outcomes.some((x) => x.kind === "transient")) {
    return ctx.ageMs > ctx.maxRetryAgeMs ? { verdict: "abandoned", finished: true } : { verdict: "retry", finished: false };
  }
  return { verdict: "permanent_failure", finished: true };
}
