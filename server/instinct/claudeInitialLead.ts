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
import { runInitialLeadDraft, type InitialLeadDraftOptions } from "./claudeAgentClient";
import { validateClaudeReviewReply, type OpsCaller } from "./claudeSmsAlternative";
import { createGenerationRecovery } from "./generationRecovery";
export { claudeInitialLeadInputSchema, claudeInitialLeadResultSchema } from "../../shared/claudeInitialLead";

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

/** Shared generation body. Only the human wrapper supplies staff reauthorization;
 * the application dispatcher must enforce its own durable first-response claim. */
async function generateContent(input: ClaudeInitialLeadInput, options: ClaudeInitialLeadContentOptions,
  reauthorize: () => Promise<unknown>, allowFutureSendPromises = false): Promise<ClaudeInitialLeadResult> {
  const customerPhone = normalizePhone(input.customerPhone);
  if (!customerPhone) return fail("INVALID_CUSTOMER_PHONE");
  const request = input.draftRequest ?? legacyDraftRequest(input);
  const messages = await (options.prepareMessages ?? prepareCsReplyMessages)(request);
  if (messages.length !== 2 || messages[0].role !== "system" || messages[1].role !== "user"
    || !messages[0].content.trim() || !messages[1].content.trim()) return fail("INVALID_PREPARED_MESSAGES");
  const contextHash = createHash("sha256").update(canonical({ sessionId: input.sessionId, customerPhone,
    leadDetails: input.leadDetails, originalConversation: input.originalConversation, request, messages })).digest("hex");
  const runnerRequest: InitialLeadDraftOptions = { systemPrompt: messages[0].content, userPrompt: messages[1].content };
  const recovery = createGenerationRecovery();
  const result = await recovery.run(async () => {
    const output = await (options.runner ?? runInitialLeadDraft)(runnerRequest);
    // The model returns exactly the plain SMS requested by the primary prompt.
    // JSON is constructed locally for the unchanged non-sendable reply validator.
    const replyText = validateClaudeReviewReply(JSON.stringify({ replyText: output.finalSmsText }), [input.requestId], { allowFutureSendPromises });
    return claudeInitialLeadResultSchema.parse({ kind: "initial_lead", requestId: input.requestId,
      sessionId: input.sessionId, customerPhone, contextHash, replyText,
      mode: "review_only", smsSent: false, actionsExecuted: false, agentId: output.agentId, agentSessionId: output.sessionId });
  }, reauthorize);
  await reauthorize();
  return result;
}

/** Internal content-only entrypoint, not an API or permission bypass. No staff
 * identity is fabricated, no send is performed, and the result stays non-sendable.
 * A trusted native dispatcher owns eligibility, source reads and send authority. */
export async function generateClaudeInitialLeadContent(raw: unknown,
  options: ClaudeInitialLeadContentOptions = {}): Promise<ClaudeInitialLeadResult> {
  return generateContent(claudeInitialLeadInputSchema.parse(raw), options, async () => undefined, true);
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
    if (error instanceof ClaudeInitialLeadError && error.code === "UNAUTHORIZED") {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Staff login required." });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Claude could not produce a safe review-only initial lead draft. No SMS was sent and no actions were executed." });
  }
}
