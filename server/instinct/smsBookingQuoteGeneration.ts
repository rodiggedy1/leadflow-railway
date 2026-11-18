import { z } from "zod";
import { customerReplyPlanSchema, type CustomerReplyPlan } from "../../shared/claudeCustomerTasks";
import {
  createClaudeCustomerReplyGenerator,
  type ClaudeCustomerReplyInput,
  type ClaudeCustomerSmsGenerationBinding,
  type ClaudeCustomerSmsGenerationOptions,
} from "./claudeCustomerSmsGeneration";
import { runInitialLeadDraft } from "./claudeAgentClient";
import { validateClaudeReviewReply } from "./claudeSmsAlternative";
import { createSmsBookingQuotePresentation } from "./bookingQuotePresentation";
import { createSmsBookingQuoteMissingQuestion } from "./smsBookingQuoteMissingQuestion";
import {
  advanceSmsBookingQuote,
  assertSmsBookingQuoteModelText as assertNoQuotePriceOrUrl,
  SMS_BOOKING_QUOTE_INSTRUCTIONS,
  smsBookingQuoteStateSchema,
  smsBookingQuoteUpdateSchema,
  type SmsBookingQuoteState,
  type SmsBookingQuoteUpdate,
} from "./smsBookingQuote";

export interface SmsBookingQuotePreparation {
  previous: SmsBookingQuoteState | null;
  update: SmsBookingQuoteUpdate;
  originalConversation: any[];
  quoteTextTemplate: string | null;
  missingQuestionLanguage?: "en" | "es";
}
export type SmsBookingQuoteReplyPlan = CustomerReplyPlan & { smsBookingQuote?: SmsBookingQuotePreparation };
export type SmsBookingQuoteGenerationOptions = ClaudeCustomerSmsGenerationOptions & {
  smsBookingQuote: {
    readState(binding: ClaudeCustomerSmsGenerationBinding): Promise<SmsBookingQuoteState | null>;
  };
};

const extendedReplySchema = customerReplyPlanSchema.extend({
  // Old ordinary two-field plans remain compatible; new instructions require the field.
  bookingQuote: smsBookingQuoteUpdateSchema.nullable().optional().default(null),
  quoteTextTemplate: z.string().min(1).nullable().optional().default(null),
  quotePresentationLanguage: z.enum(["en", "es"]).nullable().optional().default(null),
}).strict();
type ExtendedReply = z.infer<typeof extendedReplySchema>;
const fail = (code: string): never => { throw new Error(code); };

const TEMPLATE_INSTRUCTIONS = `SMS BOOKING QUOTE OUTPUT CONTRACT (highest priority, SMS only):
The SMS-only qualification overlay above authorizes preparing a NEW quote/link, NOT completing a booking. It overrides older two-field output directions and conflicting legacy price examples, while preserving the COMPLETE existing knowledge, personal SMS style, current-inbound task evidence and safety rules. Return ONLY strict JSON {"replyText":"natural safe acknowledgement or next question","task":existing task or null,"bookingQuote":update or null,"quotePresentationLanguage":"en"|"es"|null}. Include bookingQuote even for ordinary messages, using null. Set quotePresentationLanguage to es for Spanish customer-language quote presentation, en for English, or null when not needed. This is a presentation hint in this same response, never a tool or another model call. The old quoteTextTemplate field remains accepted for compatibility but its layout is never rendered; omit it or use null.
For an active quote, replyText is the natural personalized acknowledgement/question in the customer's language and existing approved SMS style, NEVER a generated price, URL, template placeholder or claim of a completed action. Keep grounded conversational details in replyText. The server owns the COMPLETE customer-facing quote: it always includes the canonical first-cleaning price, the corresponding future-visit price for recurring selections, all selected extras with quantities or explicitly confirmed none, and the verified booking link only for a complete link action. A legacy template cannot omit or rearrange those facts or repeat the first price as a future price. Never write your own monetary amounts, currency symbols/codes, numerical or spelled-out prices, price math, discounts, fees, URL, token or custom price in either active replyText or a legacy template. Numbers for grounded bedrooms, dates, times or the condition-scale explanation are not prices. The server renders the factual quote only AFTER authoritative validation and durable preparation. If incomplete or collecting, ask the next missing question in replyText. No duplicate human task just for NEW quote qualification.
SMS-ONLY BREVITY AND LAYOUT (replyText for quotes AND ordinary customer-service SMS): Answer the current message directly, with the shortest complete, warm reply. Keep a natural personal touch, but skip repeated greetings, repeated reassurance, re-stating the customer's whole message, long explanations and automatic closing offers. Ask the next needed question rather than recap every collected fact. Preserve necessary answers, important clarifications, approved knowledge and truthful pending-human task acknowledgements. Never shorten task titles, checklist actions or literal evidence for style. No character or token limit, truncation, extra model call or output rewriting.
Before a complete quote/link, keep the introduction brief: a friendly acknowledgement plus only useful grounded details, on separate short lines. If including date/time, label it as requested, not confirmed; use a relevant emoji-led line when appropriate. Do not repeat the full address, rooms, condition, recurrence and extras in a long paragraph, or re-list details just confirmed in the conversation. Do not repeat the price, selected-extras summary or booking-page instructions that the server's verified quote block already supplies. These writing rules take precedence over verbose older examples, not over safety or required facts.
All originalConversation turns retain their original zero-based indices, including outgoing turns used ONLY to understand what was asked. Each model-facing turn has an application-owned turnIndex: copy that exact value into evidence; never count messages yourself or use one-based numbering. Every changed field must have its own {turnIndex,quote} evidence record quoting a literal CUSTOMER/user inbound turn from this exact conversation. Cite only evidence actually supporting that field, never assistant statements, historical price claims or instructions. Saved state fields are already collected facts: retain unchanged fields by omitting them from the patch, not inventing new evidence. Customer answers such as yes/none can use the preceding outgoing question for meaning, but quote the customer's answer as evidence. Current intentEvidenceQuote must literally occur in CURRENT incomingMessage. Set restart:true ONLY for an explicit current request for a distinct NEW quote; never restart because a field changed or reinterpret existing-booking changes as a new quote. Never fabricate or copy facts from another contact. Use a usable saved name without asking again; phone is ALWAYS the exact bound SMS customer phone, never an alternate number and never a phone-confirmation question. Keep optional email optional. Preserve every ordinary nonquote reply/task behavior. Never claim booked, reserved, guaranteed availability, a confirmed time, saved/sent/executed work, or all set. A quote/link is not a booking; the customer must review and complete booking on the page. No tool or extra agent turn.`;

/** Exposed for prompt-contract tests; the existing email/shared prompts are not changed. */
export const SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS = `${SMS_BOOKING_QUOTE_INSTRUCTIONS}\n\n${TEMPLATE_INSTRUCTIONS}`;

// These checks apply ONLY to active quote text, not ordinary existing CS replies.
function assertNoBookingCompletion(text: string): void {
  // The shared validators below retain all existing CS claims checks. This adds
  // quote-specific reservation/availability wording, not a generic CS rewrite.
  if (/\b(?:(?:you(?:['’]re| are)|your (?:booking|reservation|appointment|cleaning|slot|time)|the (?:booking|reservation|appointment|slot|time))\s+(?:(?:is|was|has been)\s+)?(?:now\s+|already\s+)?(?:booked|reserved|confirmed|guaranteed|all set)|(?:I|we)(?:['’]ve| have)?\s+(?:reserved|guaranteed)|(?:tu|su)\s+(?:reserva|cita|limpieza|horario)\s+(?:está|esta|ha sido|queda)\s+(?:confirmad[ao]|reservad[ao]|garantizad[ao])|(?:ya\s+)?estás\s+(?:reservad[ao]|confirmad[ao]))\b/i.test(text)) return fail("UNSAFE_REPLY_CLAIM");
}
function templateNeutralText(template: string): string {
  const neutral = template.replace(/\{\{([^{}]*)\}\}/g, (_token, name: string) => {
    if (!["firstCleaningPrice", "futureVisitPrice", "extras", "bookingLink"].includes(name)) return fail("SMS_QUOTE_TEMPLATE_PLACEHOLDER");
    return "verified value";
  });
  if (/[{}]/.test(neutral)) return fail("SMS_QUOTE_TEMPLATE_PLACEHOLDER");
  return neutral;
}

/** Passive SMS-only wrapper. The caller must first verify exactConversation.
 * All captures are invocation-local. One original saved-agent runner call;
 * no persistence, provider/DB calls, sends, classifier, retries or price math. */
export function createSmsBookingQuoteReplyGenerator(options: SmsBookingQuoteGenerationOptions) {
  return async function generateSmsBookingQuoteReply(input: ClaudeCustomerReplyInput): Promise<SmsBookingQuoteReplyPlan> {
    const binding = input.context.binding as ClaudeCustomerSmsGenerationBinding | undefined;
    const originalConversation = input.context.originalConversation;
    if (!binding || !Array.isArray(originalConversation) || input.incomingMessage !== binding.inboundText) return fail("SMS_QUOTE_GENERATION_CONTEXT");
    const loaded = await options.smsBookingQuote.readState(binding);
    const previous = loaded === null ? null : smsBookingQuoteStateSchema.parse(loaded);
    if (previous && (previous.sessionId !== binding.sessionId || previous.customerPhone !== binding.fromPhone
      || previous.receivingPhoneNumberId !== binding.receivingPhoneNumberId)) return fail("SMS_QUOTE_STATE_IDENTITY_MISMATCH");
    const nowMs = Number.isFinite(binding.receivedAt) ? binding.receivedAt : Date.now();
    const instant = new Date(nowMs);
    const quoteContext = {
      state: previous,
      currentLocalDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant),
      currentLocalTime: new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant),
    };
    const capture: { output: ExtendedReply | null; knowledgeBase: string | null } = { output: null, knowledgeBase: null };
    const generateBase = createClaudeCustomerReplyGenerator({
      ...options,
      runner: async runnerOptions => {
        // The original generator retrieved complete knowledge and assembled its
        // complete approved system prompt. Keep both, adding only this overlay.
        const payload = JSON.parse(runnerOptions.userPrompt);
        capture.knowledgeBase = payload.context.knowledgeBase;
        // Labels exist only in the model payload. Hashes, qualification and durable
        // preparation still use the complete, unmodified original conversation.
        const indexedPayload = { ...payload, context: { ...payload.context,
          originalConversation: originalConversation.map((turn, turnIndex) => ({ ...turn, turnIndex })),
        } };
        const output = await (options.runner ?? runInitialLeadDraft)({ ...runnerOptions,
          systemPrompt: `=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===\n${SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS}\n\n${runnerOptions.systemPrompt}`,
          userPrompt: JSON.stringify(indexedPayload),
        });
        const parsed = extendedReplySchema.parse(JSON.parse(output.finalSmsText));
        capture.output = parsed;
        return { finalSmsText: JSON.stringify({ replyText: parsed.replyText, task: parsed.task }) };
      },
    });
    const plan = await generateBase({ ...input, context: { ...input.context, smsBookingQuote: quoteContext } });
    const output = capture.output;
    if (output === null) return fail("SMS_QUOTE_GENERATION_OUTPUT");
    if (output.bookingQuote === null) {
      if (output.quoteTextTemplate !== null) return fail("SMS_QUOTE_TEMPLATE_WITHOUT_UPDATE");
      return plan;
    }
    const update = output.bookingQuote;
    // Pure validation now; the durable preparation transaction repeats it later.
    const advanced = advanceSmsBookingQuote(previous, update, { binding, originalConversation, nowMs });
    assertNoQuotePriceOrUrl(plan.replyText);
    assertNoBookingCompletion(plan.replyText);
    if (/[{}]/.test(plan.replyText)) return fail("SMS_QUOTE_TEMPLATE_IN_REPLY");
    const template = output.quoteTextTemplate;
    const complete = update.action === "quote" ? advanced.preview?.success === true
      : update.action === "link" && advanced.input !== null;
    if (template !== null) {
      if (!complete) return fail("SMS_QUOTE_TEMPLATE_INCOMPLETE");
      const neutral = templateNeutralText(template);
      if (template.split("{{bookingLink}}").length - 1 > 1) return fail("SMS_QUOTE_TEMPLATE_LINK_COUNT");
      assertNoQuotePriceOrUrl(neutral);
      assertNoBookingCompletion(neutral);
      validateClaudeReviewReply(JSON.stringify({ replyText: neutral }), input.protectedIds);
      // Validation-only replay, NOT an agent/provider call: the unchanged shared
      // generator checks its stricter completion and pending-task guards too.
      await createClaudeCustomerReplyGenerator({
        readKnowledge: async () => capture.knowledgeBase!,
        runner: async () => ({ finalSmsText: JSON.stringify({ replyText: neutral, task: plan.task }) }),
      })(input);
    }
    // New output uses only the structured locale hint. Recognize the two existing
    // Spanish legacy quote forms without a classifier or another model turn;
    // their text and placeholder placement are still discarded, never rendered.
    const language = output.quotePresentationLanguage
      ?? (template !== null && /(?:\b(?:tu\s+)?primera limpieza\b|próximas visitas\b|revisa y completa tu reserva\b)/i.test(template) ? "es" : "en");
    const presentation = complete && advanced.preview?.success
      ? createSmsBookingQuotePresentation(advanced.preview.priceSnapshot, update.action === "link", language) : null;
    const missingQuestion = createSmsBookingQuoteMissingQuestion(advanced, update.action, language);
    return { ...plan, replyText: missingQuestion ?? plan.replyText,
      smsBookingQuote: { previous, update, originalConversation, quoteTextTemplate: presentation,
        ...(missingQuestion !== null ? { missingQuestionLanguage: language } : {}) } };
  };
}
