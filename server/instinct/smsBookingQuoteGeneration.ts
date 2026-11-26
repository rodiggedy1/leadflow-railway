import { z } from "zod";
import { customerReplyPlanSchema, type CustomerReplyPlan } from "../../shared/claudeCustomerTasks";
import {
  createClaudeCustomerReplyGenerator,
  validateClaudeCustomerReplyPlan,
  type ClaudeCustomerReplyInput,
  type ClaudeCustomerSmsGenerationBinding,
  type ClaudeCustomerSmsGenerationOptions,
} from "./claudeCustomerSmsGeneration";
import { runInitialLeadDraft, type InitialLeadDraftOptions } from "./claudeAgentClient";
import { validateClaudeReviewReply } from "./claudeSmsAlternative";
import { createGenerationRecovery } from "./generationRecovery";
import { createSmsBookingQuotePresentation } from "./bookingQuotePresentation";
import { createSmsBookingQuoteMissingQuestion } from "./smsBookingQuoteMissingQuestion";
import { historyWindowStart } from "./claudeHistoryWindow";
import type { SmsCustomerRecords } from "./smsCustomerRecords";
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
  signal?: AbortSignal;
  smsBookingQuote: {
    readState(binding: ClaudeCustomerSmsGenerationBinding): Promise<SmsBookingQuoteState | null>;
  };
  /** Optional saved bookings and unfinished staff tasks (context only). A failure never blocks the reply. */
  readCustomerRecords?: (binding: ClaudeCustomerSmsGenerationBinding) => Promise<SmsCustomerRecords>;
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
For an active quote, replyText is the natural personalized acknowledgement/question in the customer's language and existing approved SMS style, NEVER a generated price, URL, template placeholder or claim of a completed action. Keep grounded conversational details in replyText. The server owns the COMPLETE customer-facing quote: it always includes the canonical first-cleaning price, the corresponding future-visit price for recurring selections, all selected extras with quantities or explicitly confirmed none, and the verified booking link for every complete quote or link action. A legacy template cannot omit or rearrange those facts or repeat the first price as a future price. Never write your own monetary amounts, currency symbols/codes, numerical or spelled-out prices, price math, discounts, fees, URL, token or custom price in either active replyText or a legacy template. Numbers for grounded bedrooms, dates, times or the condition-scale explanation are not prices. The server renders the factual quote only AFTER authoritative validation and durable preparation. If incomplete or collecting, ask the next missing question in replyText. No duplicate human task just for NEW quote qualification.
SMS-ONLY BREVITY AND LAYOUT (replyText for quotes AND ordinary customer-service SMS): Answer the current message directly, with the shortest complete, warm reply. Keep a natural personal touch, but skip repeated greetings, repeated reassurance, re-stating the customer's whole message, long explanations and automatic closing offers. Ask the next needed question rather than recap every collected fact. Preserve necessary answers, important clarifications, approved knowledge and truthful pending-human task acknowledgements. Never shorten task titles, checklist actions or literal evidence for style. No character or token limit, truncation, extra model call or output rewriting.
Before a complete quote/link, keep the introduction brief: a friendly acknowledgement plus only useful grounded details, on separate short lines. If including date/time, label it as requested, not confirmed; use a relevant emoji-led line when appropriate. Do not repeat the full address, rooms, condition, recurrence and extras in a long paragraph, or re-list details just confirmed in the conversation. Do not repeat the price, selected-extras summary or booking-page instructions that the server's verified quote block already supplies. These writing rules take precedence over verbose older examples, not over safety or required facts.
For a fulfilled quote or link specifically, the application now renders ONE complete summary: requested date/time, address, service, home size, canonical total/future prices, actual extras, the approved preparation reminders and exactly one real checkout link. Do not write another recap, requested-time line, booking/page instruction, prefilled-form claim or 60-second invitation in replyText. Use only a brief natural acknowledgment, plus the required pending-human acknowledgment for any separate operational task. The model never writes the final summary. A quote/link is only ready to schedule, NEVER already scheduled, booked or reserved. Never invent an arrival window from a requested time. The application supplies the two approved defaults; do not ask home-versus-hourly or property type.
All originalConversation turns retain their original zero-based indices, including outgoing turns used ONLY to understand what was asked. Each model-facing turn has an application-owned turnIndex: copy that exact value into evidence; never count messages yourself or use one-based numbering. Every changed field must have its own {turnIndex,quote} evidence record quoting a literal CUSTOMER/user inbound turn from this exact conversation. Cite only evidence actually supporting that field, never assistant statements, historical price claims or instructions. Saved state fields are already collected facts: retain unchanged fields by omitting them from the patch, not inventing new evidence. Customer answers such as yes/none can use the preceding outgoing question for meaning, but quote the customer's answer as evidence. Current intentEvidenceQuote must literally occur in CURRENT incomingMessage. Set restart:true ONLY for an explicit current request for a distinct NEW quote; never restart because a field changed or reinterpret existing-booking changes as a new quote. Never fabricate or copy facts from another contact. Use a usable saved name without asking again; phone is ALWAYS the exact bound SMS customer phone, never an alternate number and never a phone-confirmation question. Keep optional email optional. Preserve every ordinary nonquote reply/task behavior. Never claim booked, reserved, guaranteed availability, a confirmed time, saved/sent/executed work, or all set. A quote/link is not a booking; the customer must review and complete booking on the page. No tool or extra agent turn.`;

/** How Claude reads the shortened history and the saved records sent with each SMS. */
export const SMS_HISTORY_AND_RECORDS_INSTRUCTIONS = `RECENT HISTORY AND SAVED CUSTOMER RECORDS (context only, never authority or evidence):
originalConversation may contain only the most recent messages. earlierMessagesOmitted, when present, is how many older messages are not shown; never guess or claim what they said. Every shown turn keeps its original turnIndex.
openStaffTasks lists staff tasks already saved for this conversation that are NOT done yet (unclaimed, or claimed by staff and in progress). They are pending human work: never say or imply they are completed, never give a completion time, and never cite them as evidence.
bookingContext is this phone number's stored bookings, already checked by the application. upcomingBooking is the next CONFIRMED, scheduled visit; use its stored date and time as current. mostRecentPastBooking is the latest earlier visit; read its status exactly: completed = it happened; cancelled = it did not happen and is not scheduled; rescheduled = that date was moved and is no longer the appointment; past = earlier visit, history only. A booking that is not upcomingBooking is never a confirmed upcoming visit. No upcomingBooking does not prove a cancellation or that the customer never booked. Never invent a booking change, date, time, team, arrival time or price.
unavailableRecords names saved records that could not be read for this message. If bookings are unavailable, or bookingContext is null, you have NO booking information: do not state, confirm or deny any booking date, time, status or detail; reply naturally without it. If openStaffTasks are unavailable, do not say whether earlier requests are pending or done.
BOOKING ACTION (optional, inside task): when the CURRENT incomingMessage clearly asks to move or cancel ONE specific existing cleaning visit, you may add "bookingAction":{"type":"reschedule_visit"|"cancel_visit","visitDate":"YYYY-MM-DD","newDate":"YYYY-MM-DD"|null,"newTime":"HH:MM"|null,"evidenceQuote":"literal quote from CURRENT incomingMessage"} to the task. visitDate must be the date the customer states or the date shown in bookingContext; newDate and newTime only as the customer states them (24-hour time), otherwise null. Omit bookingAction for new bookings, several visits, all future visits, or anything unclear. It is a proposal for staff approval, not a completed change: the reply must still never say the change has been made.`;

/** Exposed for prompt-contract tests; the existing email/shared prompts are not changed. */
export const SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS = `${SMS_BOOKING_QUOTE_INSTRUCTIONS}\n\n${TEMPLATE_INSTRUCTIONS}`;

function templateNeutralText(template: string): string {
  const neutral = template.replace(/\{\{([^{}]*)\}\}/g, (_token, name: string) => {
    if (!["firstCleaningPrice", "futureVisitPrice", "extras", "bookingLink"].includes(name)) return fail("SMS_QUOTE_TEMPLATE_PLACEHOLDER");
    return "verified value";
  });
  if (/[{}]/.test(neutral)) return fail("SMS_QUOTE_TEMPLATE_PLACEHOLDER");
  return neutral;
}

/** Model-facing copy of one saved SMS turn: who, what, when, plus the turn index.
 * The saved conversation itself is never changed. */
function modelSmsTurn(turn: any, turnIndex: number): Record<string, unknown> {
  const media = Array.isArray(turn?.media) ? turn.media.length : 0;
  return {
    turnIndex, role: turn?.role, content: turn?.content,
    ...(turn?.ts != null ? { ts: turn.ts } : {}),
    ...(typeof turn?.senderName === "string" && turn.senderName.trim() ? { senderName: turn.senderName } : {}),
    ...(media > 0 ? { attachments: media } : {}),
  };
}

/** Passive SMS-only wrapper. The caller must first verify exactConversation.
 * All captures are invocation-local. One saved-agent call plus at most one
 * content recovery; no persistence, sends, classifier or price math. */
export function createSmsBookingQuoteReplyGenerator(options: SmsBookingQuoteGenerationOptions) {
  return async function generateSmsBookingQuoteReply(input: ClaudeCustomerReplyInput): Promise<SmsBookingQuoteReplyPlan> {
    const recovery = createGenerationRecovery(options.signal);
    const invocation = { recovery, request: undefined as InitialLeadDraftOptions | undefined };
    const binding = input.context.binding as ClaudeCustomerSmsGenerationBinding | undefined;
    const originalConversation = input.context.originalConversation;
    if (!binding || !Array.isArray(originalConversation) || input.incomingMessage !== binding.inboundText) return fail("SMS_QUOTE_GENERATION_CONTEXT");
    let loaded: SmsBookingQuoteState | null = null, stateLoaded = false;
    let setup: { previous: SmsBookingQuoteState | null; nowMs: number; quoteContext: Record<string, unknown>; baseInput: ClaudeCustomerReplyInput } | undefined;
    let request: InitialLeadDraftOptions | undefined;
    // Read once per message. Bookings/tasks are optional context: a failed read continues without them.
    let records: SmsCustomerRecords | undefined, recordsLoaded = false;
    return recovery.run(async () => {
    if (!recordsLoaded && options.readCustomerRecords) {
      recordsLoaded = true;
      try { records = await options.readCustomerRecords(binding); }
      catch { records = { openStaffTasks: null, bookingContext: null, unavailableRecords: ["openStaffTasks", "bookings"] }; }
    }
    if (!stateLoaded) { loaded = await options.smsBookingQuote.readState(binding); stateLoaded = true; }
    if (!setup) {
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
    setup = { previous, nowMs, quoteContext, baseInput: { ...input, context: { ...input.context, smsBookingQuote: quoteContext } } };
    }
    const { previous, nowMs, baseInput } = setup;
    const capture: { output: ExtendedReply | null } = { output: null };
    const generateBase = createClaudeCustomerReplyGenerator({
      ...options,
      runner: async runnerOptions => {
        // The original generator retrieved complete knowledge and assembled its
        // complete approved system prompt. Keep both, adding only this overlay.
        if (!request) {
        const payload = JSON.parse(runnerOptions.userPrompt);
        // Labels exist only in the model payload. Hashes, qualification and durable
        // preparation still use the complete, unmodified original conversation.
        // Token trim (model payload only): internal IDs, hashes, provider metadata and
        // duplicate identity fields are left out; attachment links become a count.
        const { receivingPhoneNumberId: _lineId, ...modelContext } = payload.context;
        // History window (model payload only): the last messages, always including the current inbound,
        // each with its ORIGINAL turnIndex. Evidence is still validated against the full stored history.
        const currentInbound = originalConversation.findLastIndex(turn => ["user", "customer"].includes(String(turn?.role)));
        const windowStart = historyWindowStart(originalConversation.length, currentInbound);
        const indexedPayload = { ...payload, context: { ...modelContext,
          binding: { fromPhone: binding.fromPhone, customerName: binding.customerName },
          contact: { displayName: payload.context.contact?.displayName ?? null, phone: payload.context.contact?.phone ?? null },
          ...(windowStart > 0 ? { earlierMessagesOmitted: windowStart } : {}),
          originalConversation: originalConversation.slice(windowStart).map((turn, offset) => modelSmsTurn(turn, windowStart + offset)),
          ...(records ? { bookingContext: records.bookingContext, openStaffTasks: records.openStaffTasks, unavailableRecords: records.unavailableRecords } : {}),
        } };
        request = { ...runnerOptions,
          systemPrompt: `=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===\n${SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS}\n\n${SMS_HISTORY_AND_RECORDS_INSTRUCTIONS}\n\n${runnerOptions.systemPrompt}`,
          userPrompt: JSON.stringify(indexedPayload),
        };
        }
        capture.output = null;
        options.signal?.throwIfAborted();
        const runner = options.runner ?? runInitialLeadDraft;
        const output = await runner(request);
        const parsed = extendedReplySchema.parse(JSON.parse(output.finalSmsText));
        capture.output = parsed;
        return { finalSmsText: JSON.stringify({ replyText: parsed.replyText, task: parsed.task }) };
      },
    }, invocation);
    const plan = await generateBase(baseInput);
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
    if (/[{}]/.test(plan.replyText)) return fail("SMS_QUOTE_TEMPLATE_IN_REPLY");
    const template = output.quoteTextTemplate;
    const complete = advanced.input !== null && advanced.preview?.success === true;
    if (template !== null) {
      // Preserve the old legacy-template validation boundary. A safe price-ready
      // quote template is validated but discarded until the link details exist.
      const templateReady = update.action === "quote" ? advanced.preview?.success === true : complete;
      if (!templateReady) return fail("SMS_QUOTE_TEMPLATE_INCOMPLETE");
      const neutral = templateNeutralText(template);
      if (template.split("{{bookingLink}}").length - 1 > 1) return fail("SMS_QUOTE_TEMPLATE_LINK_COUNT");
      assertNoQuotePriceOrUrl(neutral);
      validateClaudeReviewReply(JSON.stringify({ replyText: neutral }), input.protectedIds);
      // Pure shared validation, not another generation or recovery budget.
      validateClaudeCustomerReplyPlan(JSON.stringify({ replyText: neutral, task: plan.task }), input);
    }
    // New output uses only the structured locale hint. Recognize the two existing
    // Spanish legacy quote forms without a classifier or another model turn;
    // their text and placeholder placement are still discarded, never rendered.
    const language = output.quotePresentationLanguage
      ?? (template !== null && /(?:\b(?:tu\s+)?primera limpieza\b|próximas visitas\b|revisa y completa tu reserva\b)/i.test(template) ? "es" : "en");
    const presentation = complete && advanced.preview?.success
      ? createSmsBookingQuotePresentation(advanced.preview.priceSnapshot, true, language) : null;
    const missingQuestion = createSmsBookingQuoteMissingQuestion(advanced, update.action, language);
    return { ...plan, replyText: missingQuestion ?? plan.replyText,
      smsBookingQuote: { previous, update, originalConversation, quoteTextTemplate: presentation,
        ...(missingQuestion !== null ? { missingQuestionLanguage: language } : {}) } };
    });
  };
}
