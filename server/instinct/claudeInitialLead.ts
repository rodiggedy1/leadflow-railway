import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext,
  claudeInitialLeadInputSchema, claudeInitialLeadResultSchema,
  type ClaudeInitialLeadInput, type ClaudeInitialLeadResult,
} from "../../shared/claudeInitialLead";
import { normalizePhone } from "../utils/phone";
import { prepareCsReplyMessages } from "../csReplyStream";
import { ManagedAgentDemoError, runInitialLeadDraft, type InitialLeadDraftOptions, type TraceEntry } from "./claudeAgentClient";
import { ClaudeSmsAlternativeError, validateClaudeReviewReply, type OpsCaller } from "./claudeSmsAlternative";
export { claudeInitialLeadInputSchema, claudeInitialLeadResultSchema } from "../../shared/claudeInitialLead";

// Caller-owned total budget; other saved-agent capabilities keep their defaults.
export const CLAUDE_INITIAL_LEAD_TIMEOUT_MS = 120_000;
export class ClaudeInitialLeadError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ClaudeInitialLeadError"; }
}
const fail = (code: string): never => { throw new ClaudeInitialLeadError(code); };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return fail("INVALID_JSON");
  return encoded;
}
const callerSchema = z.object({ id: z.string().min(1), name: z.string(), isOwner: z.boolean(), email: z.string().optional() }).strict();
export type InitialLeadRunner = (options: InitialLeadDraftOptions) => Promise<{ finalSmsText: string; agentId: string; sessionId: string }>;
export interface ClaudeInitialLeadOptions {
  authorizeCaller(caller: OpsCaller): Promise<boolean>;
  /** The same complete message preparation as the primary CS drafting route. */
  prepareMessages?: typeof prepareCsReplyMessages;
  runner?: InitialLeadRunner;
}

/** Compatibility for a browser loaded before draftRequest was added. Current
 * drawers supply their exact primary request directly; no identity lookup occurs. */
function legacyDraftRequest(input: ClaudeInitialLeadInput) {
  const leadContext = buildThumbtackLeadDraftContext(input.leadDetails);
  const turns = input.originalConversation.filter((turn): turn is { [key: string]: import("../../shared/claudeInitialLead").InitialLeadJson } =>
    turn !== null && typeof turn === "object" && !Array.isArray(turn) && typeof turn.content === "string" && Boolean(turn.content.trim()));
  const conversationContext = turns.sort((a, b) => (typeof a.ts === "number" ? a.ts : 0) - (typeof b.ts === "number" ? b.ts : 0))
    .slice(-5).map(turn => `${turn.role === "user" ? "Customer" : "Agent"}: ${turn.content}`).join("\n");
  return { conversationContext, customerName: input.leadDetails.name, jobContext: leadContext,
    scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${leadContext}` };
}

export type ClaudeInitialLeadContentOptions = Pick<ClaudeInitialLeadOptions, "prepareMessages" | "runner">;

const safeCodes = new Set([
  "INVALID_JSON", "INVALID_CUSTOMER_PHONE", "INVALID_PREPARED_MESSAGES", "UNAUTHORIZED", "TIMEOUT",
  "UNSAFE_REPLY_CLAIM", "UNSAFE_REPLY_PRESENTATION", "MISSING_API_KEY", "INVALID_BACKEND",
  "INVALID_PAYLOAD", "AGENT_MISMATCH", "UNSAFE_AGENT", "ENVIRONMENT_MISMATCH", "SESSION_MISMATCH",
  "PROVIDER_HTTP_ERROR", "PROVIDER_TRANSPORT_ERROR", "UNKNOWN_POST_OUTCOME", "INVALID_RESPONSE",
  "INVALID_EVENT", "PROVIDER_SESSION_ERROR", "UNSAFE_TOOL", "TOOL_OUTCOME_UNKNOWN", "REPLAY_CONFLICT",
  "INCOMPLETE_TURN", "CANCELLED", "HOOK_FAILED",
]);
const safeTraceStages = new Set<TraceEntry["stage"]>([
  "http_response", "configuration_verified", "session_created", "session_verified", "tool_started",
  "tool_result_acknowledged", "tool_replay_suppressed", "completed", "failed",
]);
function safeSessionId(value: unknown): string | undefined {
  return typeof value === "string" && /^sesn_[A-Za-z0-9]{1,128}$/.test(value) ? value : undefined;
}
function safeStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
function failureMetadata(error: unknown) {
  const known = error instanceof ClaudeInitialLeadError || error instanceof ClaudeSmsAlternativeError || error instanceof ManagedAgentDemoError;
  return {
    code: known && safeCodes.has(error.code) ? error.code : error instanceof z.ZodError ? "VALIDATION_ERROR" : "INITIAL_LEAD_FAILED",
    ...(error instanceof ManagedAgentDemoError && safeStatus(error.status) !== undefined ? { status: safeStatus(error.status) } : {}),
    ...(error instanceof ManagedAgentDemoError && safeSessionId(error.sessionId) ? { agentSessionId: safeSessionId(error.sessionId) } : {}),
  };
}
/** Fixed metadata only. Logging must never change the draft/auth outcome. */
function logMetadata(level: "info" | "error", metadata: Record<string, unknown>): void {
  try { console[level]("[ClaudeInitialLead]", metadata); } catch { /* best-effort */ }
}

/** Shared generation body. Only the human wrapper supplies staff reauthorization;
 * the application dispatcher must enforce its own durable first-response claim. */
async function generateContent(input: ClaudeInitialLeadInput, options: ClaudeInitialLeadContentOptions,
  reauthorize: () => Promise<unknown>): Promise<ClaudeInitialLeadResult> {
  const controller = new AbortController();
  const deadline = Date.now() + CLAUDE_INITIAL_LEAD_TIMEOUT_MS;
  let stage = "validate_input", timedOut = false, finished = false;
  let agentSessionId: string | undefined, status: number | undefined;
  const checkDeadline = () => {
    if (timedOut || Date.now() >= deadline) { timedOut = true; controller.abort(); return fail("TIMEOUT"); }
  };
  const enterStage = (next: string) => {
    checkDeadline(); stage = next;
    logMetadata("info", { stage, sessionId: input.sessionId });
  };
  const onTrace: NonNullable<InitialLeadDraftOptions["onTrace"]> = entry => {
    if (finished) return;
    if (!safeTraceStages.has(entry.stage)) return;
    agentSessionId = safeSessionId(entry.sessionId) ?? agentSessionId;
    status = safeStatus(entry.status) ?? status;
    logMetadata("info", { stage: "managed_agent", traceStage: entry.stage, sessionId: input.sessionId,
      ...(agentSessionId ? { agentSessionId } : {}), ...(safeStatus(entry.status) !== undefined ? { status: safeStatus(entry.status) } : {}),
      ...(entry.code && safeCodes.has(entry.code) ? { code: entry.code } : {}) });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    // Reject the caller even if preparation or an injected runner ignores abort.
    // Promise.race observes detached work; stage guards forbid late progression.
    const stop = () => { timedOut = true; reject(new ClaudeInitialLeadError("TIMEOUT")); controller.abort(); };
    timer = setTimeout(stop, CLAUDE_INITIAL_LEAD_TIMEOUT_MS);
  });
  let work: Promise<ClaudeInitialLeadResult>;
  try {
    work = (async () => {
      checkDeadline();
      const customerPhone = normalizePhone(input.customerPhone);
      if (!customerPhone) return fail("INVALID_CUSTOMER_PHONE");
      const request = input.draftRequest ?? legacyDraftRequest(input);
      enterStage("prepare_messages");
      // The shared preparer has no signal seam. Bound waiting here, not its internals.
      const messages = await (options.prepareMessages ?? prepareCsReplyMessages)(request);
      checkDeadline();
      if (messages.length !== 2 || messages[0].role !== "system" || messages[1].role !== "user"
        || !messages[0].content.trim() || !messages[1].content.trim()) return fail("INVALID_PREPARED_MESSAGES");
      const contextHash = createHash("sha256").update(canonical({ sessionId: input.sessionId, customerPhone,
        leadDetails: input.leadDetails, originalConversation: input.originalConversation, request, messages })).digest("hex");
      enterStage("reauthorize_before_run");
      await reauthorize();
      enterStage("managed_agent");
      const output = await (options.runner ?? runInitialLeadDraft)({ systemPrompt: messages[0].content, userPrompt: messages[1].content,
        signal: controller.signal, onTrace });
      agentSessionId = safeSessionId(output.sessionId) ?? agentSessionId;
      enterStage("validate_reply");
      // The model returns exactly the plain SMS requested by the primary prompt.
      // JSON is constructed locally for the unchanged non-sendable reply validator.
      const replyText = validateClaudeReviewReply(JSON.stringify({ replyText: output.finalSmsText }), [input.requestId]);
      if (/\b(?:quote|pricing|message|SMS|text|link)\s+(?:has been|was|is)\s+(?:sent|texted|created|generated|processed)\b/i.test(replyText)) return fail("UNSAFE_REPLY_CLAIM");
      if (/\bquote\s+(?:id|code|number|reference)\s*[:#]/i.test(replyText)) return fail("UNSAFE_REPLY_PRESENTATION");
      enterStage("reauthorize_before_return");
      await reauthorize();
      checkDeadline();
      const result = claudeInitialLeadResultSchema.parse({ kind: "initial_lead", requestId: input.requestId,
        sessionId: input.sessionId, customerPhone, contextHash, replyText,
        mode: "review_only", smsSent: false, actionsExecuted: false, agentId: output.agentId, agentSessionId: output.sessionId });
      enterStage("completed");
      return result;
    })();
    return await Promise.race([work, timeout]);
  } catch (error) {
    const safe = timedOut ? new ClaudeInitialLeadError("TIMEOUT") : error;
    logMetadata("error", { stage, sessionId: input.sessionId, ...(agentSessionId ? { agentSessionId } : {}),
      ...(status !== undefined ? { status } : {}), ...failureMetadata(safe) });
    throw safe;
  } finally {
    finished = true; clearTimeout(timer); controller.abort();
  }
}

/** Internal content-only entrypoint, not an API or permission bypass. No staff
 * identity is fabricated, no send is performed, and the result stays non-sendable.
 * A trusted native dispatcher owns eligibility, source reads and send authority. */
export async function generateClaudeInitialLeadContent(raw: unknown,
  options: ClaudeInitialLeadContentOptions = {}): Promise<ClaudeInitialLeadResult> {
  return generateContent(claudeInitialLeadInputSchema.parse(raw), options, async () => undefined);
}

/** Human-requested alternative only. Same primary instructions/context; no
 * Claude-specific business prompt, JSON-output framing, source writes or tools. */
export function createClaudeInitialLeadService(options: ClaudeInitialLeadOptions) {
  const inFlight = new Map<string, Promise<ClaudeInitialLeadResult>>();
  async function authorize(raw: unknown): Promise<OpsCaller> {
    const parsed = callerSchema.safeParse(raw);
    if (!parsed.success || !await options.authorizeCaller(parsed.data)) return fail("UNAUTHORIZED");
    return parsed.data;
  }
  async function run(input: ClaudeInitialLeadInput, caller: OpsCaller): Promise<ClaudeInitialLeadResult> {
    await authorize(caller);
    return generateContent(input, options, () => authorize(caller));
  }
  return {
    async generate(raw: unknown, rawCaller: unknown): Promise<ClaudeInitialLeadResult> {
      const caller = await authorize(rawCaller);
      const input = claudeInitialLeadInputSchema.parse(raw);
      const key = canonical({ caller, input });
      const prior = inFlight.get(key);
      if (prior) return prior.then(copy);
      const promise = run(input, caller).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise.then(copy);
    },
  };
}

// Existing opsChatProcedure supplies application staff authority. Import is passive.
const applicationService = createClaudeInitialLeadService({ authorizeCaller: async () => true });
export async function generateClaudeInitialLead(input: ClaudeInitialLeadInput, opsCaller: OpsCaller): Promise<ClaudeInitialLeadResult> {
  try { return await applicationService.generate(input, opsCaller); }
  catch (error) {
    logMetadata("error", { stage: "manual_wrapper", ...failureMetadata(error) });
    if (error instanceof ClaudeInitialLeadError && error.code === "UNAUTHORIZED") {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Staff login required." });
    }
    if (error instanceof ClaudeInitialLeadError && error.code === "TIMEOUT") {
      throw new TRPCError({ code: "TIMEOUT", message: "Claude initial lead drafting timed out. No SMS was sent and no actions were executed." });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Claude could not produce a safe review-only initial lead draft. No SMS was sent and no actions were executed." });
  }
}
