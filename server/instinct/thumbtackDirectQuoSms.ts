import { normalizeThumbtackSmsPhone } from "../../shared/thumbtackSmsPhone";

export const THUMBTACK_QUO_SMS_TIMEOUT_MS = 30_000;

interface QuoSmsMetadata {
  httpStatus?: number;
  providerStatus?: string;
  providerReason?: string;
  providerCode?: string;
  traceId?: string;
}

/** Acceptance is a submission receipt, not a claim of carrier delivery. */
export type ThumbtackQuoSmsResult = QuoSmsMetadata & (
  | { kind: "accepted"; success: true; messageId: string; code: string }
  | { kind: "rejected" | "uncertain"; success: false; code: string; messageId?: string }
);

type SendInput = { to: string; content: string; fromNumberId: string };
type SendOptions = {
  apiKey: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  fetch?: typeof globalThis.fetch;
  random?: () => number;
};

const DEFINITIVE_REJECTIONS = new Set([400, 401, 402, 403, 404, 422, 429]);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

function safeText(value: unknown, limit: number, secrets: readonly string[] = [], numericIdentifier = false): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  let text = String(value);
  // Redact before bounding, including credentials echoed by a provider. Never
  // serialize bodies, unknown fields, validation values, or thrown exceptions.
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[redacted]");
  }
  text = text
    .replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, "[redacted details]")
    .replace(/\b(?:authorization|api[-_ ]?key|token|password|credential)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted credential]")
    .replace(/\bbearer\s+[^\s,;]+/gi, "[redacted credential]")
    .replace(/\b(?:content|values?|recipient|phone|from|to)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\n;]+)/gi, "[redacted value]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]");
  if (!numericIdentifier) text = text.replace(/\+?\d[\d ().-]{7,}\d/g, "[redacted phone]");
  text = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, limit).join("") || undefined;
}

function safeIdentifier(value: unknown, secrets: readonly string[] = []): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (secrets.some(secret => !!secret && value.includes(secret))) return undefined;
  return value;
}

function sanitizeResult(result: ThumbtackQuoSmsResult, secrets: readonly string[] = [], humanSecrets = secrets): ThumbtackQuoSmsResult {
  const clean = { kind: result.kind, success: result.success, code: safeText(result.code, 128, secrets) ?? "QUO_RESULT" } as ThumbtackQuoSmsResult;
  const messageId = safeIdentifier(result.messageId, secrets);
  if (messageId !== undefined) clean.messageId = messageId;
  else if (result.kind === "accepted") return sanitizeResult({ ...result, kind: "uncertain", success: false, code: "INVALID_ACCEPTANCE_RECEIPT", messageId: undefined }, secrets, humanSecrets);
  if (result.httpStatus !== undefined) clean.httpStatus = result.httpStatus;
  for (const field of ["providerStatus", "providerCode", "traceId"] as const) {
    const value = safeText(result[field], 128, field === "providerStatus" ? secrets : humanSecrets, field === "traceId");
    if (value !== undefined) clean[field] = value;
  }
  const reason = safeText(result.providerReason, 512, humanSecrets);
  if (reason !== undefined) clean.providerReason = reason;
  return clean;
}

/** Bounded reporting metadata; the sender additionally redacts its actual key/text. */
export function sanitizeThumbtackQuoSmsResult(result: ThumbtackQuoSmsResult): ThumbtackQuoSmsResult {
  return sanitizeResult(result);
}

function metadata(body: unknown, response: Response, secrets: readonly string[], humanSecrets: readonly string[]): QuoSmsMetadata {
  const root = record(body), data = record(root?.data);
  const sources = [root, record(root?.error), data, record(data?.error)].filter((item): item is Record<string, unknown> => !!item);
  const first = (field: string): unknown => sources.map(item => item[field]).find(value => typeof value === "string" || typeof value === "number");
  const reasons = sources.flatMap(item => [item.providerReason, item.reason, item.title, item.message, item.detail])
    .map(value => safeText(value, 512, humanSecrets)).filter((value): value is string => !!value);
  return {
    httpStatus: response.status,
    providerStatus: safeText(data?.status ?? first("providerStatus"), 128, secrets),
    providerReason: safeText(Array.from(new Set(reasons)).join(" — "), 512, humanSecrets),
    providerCode: safeText(first("providerCode") ?? first("code"), 128, humanSecrets),
    traceId: safeText(first("trace") ?? first("traceId") ?? response.headers.get("x-trace-id") ?? response.headers.get("x-request-id"), 128, humanSecrets, true),
  };
}

function usableMessageId(value: unknown, apiKey: string): value is string {
  // Opaque provider IDs are preserved exactly, without a guessed cap/prefix.
  // Require an actual ID and never treat an echoed credential as a message ID.
  return safeIdentifier(value, [apiKey]) !== undefined;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(header)) {
    const delay = Number(header) * 1_000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  // Retry-After's other documented form is an HTTP date, not a negative number.
  if (!/^[A-Za-z]/.test(header)) return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/**
 * Dedicated transport only: no runtime service, persistence, eligibility, or
 * delivery retries. Only a completed explicit 429 is safe to POST again.
 */
export async function sendThumbtackDirectQuoSms(input: SendInput, options: SendOptions): Promise<ThumbtackQuoSmsResult> {
  const controller = new AbortController();
  const deadlineAt = options?.deadlineAt ?? Date.now() + THUMBTACK_QUO_SMS_TIMEOUT_MS;
  let abortCause: "deadline" | "parent" = "deadline";
  let dispatched = false;
  let knownOutcome: ThumbtackQuoSmsResult | undefined;
  let backoffTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveAbort!: (value: ThumbtackQuoSmsResult) => void;
  const aborted = new Promise<ThumbtackQuoSmsResult>(resolve => { resolveAbort = resolve; });
  const cancellationOutcome = (): ThumbtackQuoSmsResult => {
    // A rejection remains definitive while its body or retry delay is pending.
    // This is cleared synchronously immediately before every replacement POST.
    if (knownOutcome?.kind === "rejected") return knownOutcome;
    return {
      ...knownOutcome,
      kind: dispatched ? "uncertain" : "rejected",
      success: false,
      code: `SUBMISSION_${abortCause === "deadline" ? "TIMEOUT" : "CANCELLED"}${dispatched ? "" : "_BEFORE_DISPATCH"}`,
    };
  };
  const onAbort = () => { resolveAbort(cancellationOutcome()); };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const abort = (cause: "deadline" | "parent") => {
    if (!controller.signal.aborted) { abortCause = cause; controller.abort(); }
  };
  // Register the single root timer synchronously BEFORE the first fetch/await,
  // so the caller's fallback timer cannot win the same-deadline registration.
  const rootTimer = setTimeout(() => abort("deadline"), Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - Date.now()) : 0);
  const onParentAbort = () => abort("parent");
  options?.signal?.addEventListener("abort", onParentAbort, { once: true });
  const stopped = () => {
    if (Date.now() >= deadlineAt) abort("deadline");
    return controller.signal.aborted;
  };
  const key = typeof options?.apiKey === "string" ? options.apiKey : "";
  const secrets = [key];
  const humanSecrets = [key, input?.content, input?.to, input?.fromNumberId].filter((value): value is string => typeof value === "string" && !!value);
  const finish = (result: ThumbtackQuoSmsResult) => sanitizeResult(result, secrets, humanSecrets);
  const rejected = (code: string): ThumbtackQuoSmsResult => ({ kind: "rejected", success: false, code });

  try {
    if (options?.signal?.aborted) abort("parent");
    if (!Number.isFinite(deadlineAt)) return rejected("INVALID_DEADLINE");
    if (stopped()) return finish(cancellationOutcome());
    if (!key.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(key)) return rejected("INVALID_API_KEY");
    if (typeof input?.to !== "string") return rejected("INVALID_DESTINATION");
    const to = normalizeThumbtackSmsPhone(input.to);
    if (!to) return rejected("INVALID_DESTINATION");
    humanSecrets.push(to);
    if (typeof input?.fromNumberId !== "string" || !/^PN(.*)$/.test(input.fromNumberId)) return rejected("INVALID_FROM_NUMBER_ID");
    if (typeof input?.content !== "string" || Array.from(input.content).length < 1 || Array.from(input.content).length > 1_600) return rejected("INVALID_CONTENT");
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") return rejected("INVALID_FETCH");
    const body = JSON.stringify({ content: input.content, from: input.fromNumberId, to: [to] });

    const operation = async (): Promise<ThumbtackQuoSmsResult> => {
      let retryIndex = 0;
      for (;;) {
        if (stopped()) return cancellationOutcome();
        knownOutcome = undefined;
        dispatched = true;
        let response: Response;
        try {
          response = await fetcher("https://api.quo.com/messages", {
            method: "POST",
            headers: { Authorization: key, "Quo-Api-Version": "2026-03-30", "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
        } catch {
          return stopped() ? cancellationOutcome() : { kind: "uncertain", success: false, code: "TRANSPORT_ERROR" };
        }
        // A noncooperative late response must not parse, retry, or mutate state.
        if (stopped()) return cancellationOutcome();
        const definitive = DEFINITIVE_REJECTIONS.has(response.status);
        knownOutcome = {
          kind: definitive ? "rejected" : "uncertain",
          success: false,
          code: definitive ? `QUO_HTTP_${response.status}` : "AMBIGUOUS_PROVIDER_RESPONSE",
          httpStatus: response.status,
        };
        const headerTrace = safeText(response.headers.get("x-trace-id") ?? response.headers.get("x-request-id"), 128, humanSecrets, true);
        if (headerTrace) knownOutcome.traceId = headerTrace;
        let parsed: unknown;
        try { parsed = await response.json(); } catch { /* HTTP rejection is still explicit even with an unusable body. */ }
        if (stopped()) return cancellationOutcome();
        knownOutcome = { ...knownOutcome, ...metadata(parsed, response, secrets, humanSecrets) };
        if (response.status >= 200 && response.status < 300) {
          const id = record(record(parsed)?.data)?.id;
          if (usableMessageId(id, key)) {
            return { ...knownOutcome, kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: id };
          }
          return { ...knownOutcome, kind: "uncertain", success: false, code: "INVALID_ACCEPTANCE_RECEIPT" };
        }
        if (response.status !== 429) return knownOutcome;

        const remaining = deadlineAt - Date.now();
        const base = 500 * 2 ** retryIndex++;
        let random = 0;
        try { random = (options.random ?? Math.random)(); } catch { /* An unusable injected jitter source adds no jitter. */ }
        const jitter = base * 0.25 * (Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0);
        const delay = Math.max(base + jitter, retryAfterMs(response) ?? 0);
        if (stopped()) return cancellationOutcome();
        if (delay >= remaining) {
          // Keep the known rejection until the ORIGINAL budget expires. No
          // oversized sleep, new deadline, max-attempt rule, or replacement POST.
          return await aborted;
        }
        try {
          await Promise.race([
            new Promise<void>(resolve => { backoffTimer = setTimeout(resolve, delay); }),
            aborted,
          ]);
        } finally {
          if (backoffTimer !== undefined) clearTimeout(backoffTimer);
          backoffTimer = undefined;
        }
        if (stopped()) return cancellationOutcome();
      }
    };
    // Racing the ENTIRE operation also bounds fetch/json mocks that ignore the
    // signal. Promise.race observes late rejections; every await continuation is
    // guarded before it can perform further work or change the outcome.
    const work = operation().catch((): ThumbtackQuoSmsResult => stopped() ? cancellationOutcome() : {
      ...knownOutcome,
      kind: knownOutcome?.kind === "rejected" ? "rejected" : "uncertain",
      success: false,
      code: knownOutcome?.kind === "rejected" ? knownOutcome.code : "PROVIDER_RESPONSE_ERROR",
    });
    return finish(await Promise.race([work, aborted]));
  } finally {
    clearTimeout(rootTimer);
    if (backoffTimer !== undefined) clearTimeout(backoffTimer);
    options?.signal?.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
