import { z } from "zod";
import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { PUBLIC_BOOKING_PRICED_EXTRAS } from "../../shared/publicBookingPricing";
import { normalizePhone } from "../utils/phone";
import {
  callBookingQuotePricingSchema,
  callBookingQuoteSendInputSchema,
  previewCallBookingQuote,
  type CallBookingQuotePreview,
} from "./callBookingQuote";

const pricingShape = callBookingQuotePricingSchema.shape;
const sendShape = callBookingQuoteSendInputSchema.shape;
const nonemptyQuote = z.string().min(1).refine(value => value.trim().length > 0, "Evidence must not be blank.");

/** No transport, execution, sender, price, token or URL fields are model-owned. */
export const smsBookingQuoteFieldsSchema = z.object({
  customerName: sendShape.customerName,
  customerEmail: sendShape.customerEmail.nullable(),
  address: sendShape.address,
  requestedLocalDate: sendShape.requestedLocalDate,
  requestedLocalTime: sendShape.requestedLocalTime,
  // Remove the full-input default: an absent patch must never erase old notes.
  notes: sendShape.notes.removeDefault(),
  ...pricingShape,
  extras: pricingShape.extras.refine(extras => new Set(extras.map(extra => extra.id)).size === extras.length, "Duplicate extras are not allowed."),
  extrasConfirmed: z.boolean(),
}).partial().strict();

export type SmsBookingQuoteFields = z.infer<typeof smsBookingQuoteFieldsSchema>;
const fieldNames = Object.keys(smsBookingQuoteFieldsSchema.shape) as [keyof SmsBookingQuoteFields, ...(keyof SmsBookingQuoteFields)[]];
const evidenceItemSchema = z.object({ turnIndex: z.number().int().nonnegative(), quote: nonemptyQuote }).strict();
const evidenceSchema = z.partialRecord(z.enum(fieldNames), evidenceItemSchema);
export type SmsBookingQuoteEvidence = z.infer<typeof evidenceSchema>;

/** A null bookingQuote belongs to the surrounding CS plan, not this update schema. */
export const smsBookingQuoteUpdateSchema = z.object({
  action: z.enum(["collect", "quote", "link"]),
  restart: z.boolean().optional(),
  intentEvidenceQuote: nonemptyQuote,
  fields: smsBookingQuoteFieldsSchema,
  evidence: evidenceSchema,
}).strict().superRefine((update, context) => {
  for (const key of Object.keys(update.fields) as (keyof SmsBookingQuoteFields)[]) {
    if (update.fields[key] === undefined || !update.evidence[key]) {
      context.addIssue({ code: "custom", path: ["evidence", key], message: "Every supplied field requires its own customer evidence and a defined value." });
    }
  }
  for (const key of Object.keys(update.evidence) as (keyof SmsBookingQuoteFields)[]) {
    if (!Object.prototype.hasOwnProperty.call(update.fields, key) || !update.evidence[key]) {
      context.addIssue({ code: "custom", path: ["evidence", key], message: "Orphan evidence is not allowed." });
    }
  }
});
export type SmsBookingQuoteUpdate = z.infer<typeof smsBookingQuoteUpdateSchema>;

export const smsBookingQuoteStateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  sessionId: z.number().int().positive(),
  customerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  receivingPhoneNumberId: z.string().min(1),
  quoteId: z.string().min(1),
  fields: smsBookingQuoteFieldsSchema,
  evidence: evidenceSchema,
  // Created and fingerprinted only by the application's durable store.
  link: z.object({
    fingerprint: z.string().min(1), token: z.string().min(1), urlPath: z.string().min(1),
    firstCleaningTotalCents: z.number().int().nonnegative(),
  }).strict().nullable(),
}).strict().superRefine((state, context) => {
  for (const key of Object.keys(state.evidence) as (keyof SmsBookingQuoteFields)[]) {
    if (state.fields[key] === undefined || !state.evidence[key]) {
      context.addIssue({ code: "custom", path: ["evidence", key], message: "Stored evidence must describe a stored field." });
    }
  }
});
export type SmsBookingQuoteState = z.infer<typeof smsBookingQuoteStateSchema>;

export interface SmsBookingQuoteContext {
  binding: {
    sessionId: number;
    fromPhone: string;
    receivingPhoneNumberId: string;
    providerMessageId: string;
    inboundText: string;
    receivedAt: number;
    customerName: string | null;
  };
  /** The COMPLETE original conversation, preserving original zero-based indices. */
  originalConversation: any[];
  nowMs?: number;
}
export interface SmsBookingQuoteAdvanceResult {
  state: SmsBookingQuoteState;
  preview: CallBookingQuotePreview | null;
  input: CreateCustomerBookingLinkInput | null;
  /** Flat field names, suitable for selecting the next natural question. */
  missing: string[];
}

const bindingSchema = z.object({
  sessionId: z.number().int().positive(), fromPhone: z.string().min(1),
  receivingPhoneNumberId: z.string().min(1), providerMessageId: z.string().min(1),
  inboundText: nonemptyQuote, receivedAt: z.number().finite(), customerName: z.string().nullable(),
});
const fail = (code: string): never => { throw new Error(code); };
function object(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
function envelopes(turn: Record<string, any>): Record<string, any>[] {
  let metadata: unknown = turn.metadata;
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { return fail("SMS_QUOTE_INVALID_TURN_METADATA"); }
  }
  if (metadata != null && !object(metadata)) return fail("SMS_QUOTE_INVALID_TURN_METADATA");
  return metadata == null ? [turn] : [turn, metadata as Record<string, any>];
}
function messageIds(turn: Record<string, any>): string[] {
  return Array.from(new Set(envelopes(turn).flatMap(part =>
    [part.opMsgId, part.openPhoneId, part.openPhoneMessageId, part.providerMessageId])
    .filter((value): value is string => typeof value === "string" && value.length > 0)));
}
function validateCustomerTurn(turn: unknown, binding: SmsBookingQuoteContext["binding"]): asserts turn is Record<string, any> {
  const value = object(turn);
  if (!value || !["user", "customer"].includes(value.role) || typeof value.content !== "string") return fail("SMS_QUOTE_EVIDENCE_NOT_CUSTOMER");
  for (const part of envelopes(value)) {
    if (part.sessionId != null && String(part.sessionId) !== String(binding.sessionId)) return fail("SMS_QUOTE_TURN_IDENTITY_MISMATCH");
    if (part.direction != null && part.direction !== "incoming") return fail("SMS_QUOTE_EVIDENCE_NOT_CUSTOMER");
    for (const key of ["phoneNumberId", "receivingPhoneNumberId"]) {
      if (part[key] != null && part[key] !== binding.receivingPhoneNumberId) return fail("SMS_QUOTE_TURN_IDENTITY_MISMATCH");
    }
    for (const key of ["from", "fromPhone", "customerPhone"]) {
      if (part[key] != null && (typeof part[key] !== "string" || normalizePhone(part[key]) !== binding.fromPhone)) return fail("SMS_QUOTE_TURN_IDENTITY_MISMATCH");
    }
  }
}
function validateConversation(context: SmsBookingQuoteContext): void {
  const { binding, originalConversation: turns } = context;
  bindingSchema.parse(binding);
  if (normalizePhone(binding.fromPhone) !== binding.fromPhone) return fail("SMS_QUOTE_BINDING_MISMATCH");
  if (!Array.isArray(turns) || turns.some(turn => !object(turn) || typeof turn.role !== "string" || typeof turn.content !== "string")) return fail("SMS_QUOTE_INVALID_HISTORY");
  const matches = turns.filter(turn => messageIds(turn).includes(binding.providerMessageId));
  const latestCustomer = turns.filter(turn => ["user", "customer"].includes(turn.role)).at(-1);
  if (matches.length !== 1 || matches[0] !== latestCustomer || latestCustomer.content !== binding.inboundText
    || messageIds(latestCustomer).length !== 1) return fail("SMS_QUOTE_CURRENT_INBOUND_MISMATCH");
  validateCustomerTurn(latestCustomer, binding);
  if (turns.slice(turns.indexOf(latestCustomer) + 1).some(turn => ["assistant", "agent", "office"].includes(turn.role))) return fail("SMS_QUOTE_CURRENT_INBOUND_ALREADY_ANSWERED");
}
function usableSavedName(value: string | null): value is string {
  if (value === null) return false;
  const parsed = sendShape.customerName.safeParse(value);
  return parsed.success && parsed.data === value && new RegExp(String.raw`\p{L}`, "u").test(value)
    && new RegExp(String.raw`^[\p{L}\p{M} .,'’\-]+$`, "u").test(value)
    && !/\b(?:test|testing|demo|synthetic|unknown|unnamed|anonymous|undefined|null)\b/i.test(value)
    && !/^(?:(?:new|sms|phone|web)\s+)?(?:customer|client|contact|lead|user)$|^n\/?a$|^(?:PN|OP|ID)[- ]/i.test(value);
}
function localClock(nowMs: number): { currentLocalDate: string; currentLocalTime: string } {
  if (!Number.isFinite(nowMs) || Number.isNaN(new Date(nowMs).getTime())) return fail("SMS_QUOTE_INVALID_CLOCK");
  const instant = new Date(nowMs);
  return {
    currentLocalDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant),
    currentLocalTime: new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant),
  };
}
function selections(extras: NonNullable<SmsBookingQuoteFields["extras"]>) {
  return [...extras].sort((left, right) => left.id.localeCompare(right.id));
}
function comparableFields(fields: SmsBookingQuoteFields): string {
  return JSON.stringify([
    ...fieldNames.filter(key => key !== "extrasConfirmed").map(key => [key,
      key === "extras" && fields.extras ? selections(fields.extras)
        : key === "notes" ? fields.notes ?? []
          : fields[key] ?? null,
    ]),
    ["extrasConfirmed", fields.extrasConfirmed === true],
  ]);
}

/** Pure qualification only. No persistence, lookup, link creation, model or send. */
export function advanceSmsBookingQuote(
  state: SmsBookingQuoteState | null,
  update: SmsBookingQuoteUpdate,
  context: SmsBookingQuoteContext,
): SmsBookingQuoteAdvanceResult {
  const patch = smsBookingQuoteUpdateSchema.parse(update);
  validateConversation(context);
  const { binding, originalConversation } = context;
  if (!binding.inboundText.includes(patch.intentEvidenceQuote)) return fail("SMS_QUOTE_INTENT_NOT_CURRENT_INBOUND");
  for (const source of Object.values(patch.evidence)) {
    if (!source) return fail("SMS_QUOTE_INVALID_EVIDENCE");
    const turn = originalConversation[source.turnIndex];
    validateCustomerTurn(turn, binding);
    if (!turn.content.includes(source.quote)) return fail("SMS_QUOTE_EVIDENCE_NOT_LITERAL");
  }
  const previous = state === null ? null : smsBookingQuoteStateSchema.parse(state);
  if (previous && (previous.sessionId !== binding.sessionId || previous.customerPhone !== binding.fromPhone
    || previous.receivingPhoneNumberId !== binding.receivingPhoneNumberId)) return fail("SMS_QUOTE_STATE_IDENTITY_MISMATCH");

  const continuing = previous !== null && patch.restart !== true;
  const fields: SmsBookingQuoteFields = { ...(continuing ? previous.fields : {}), ...patch.fields };
  const evidence: SmsBookingQuoteEvidence = { ...(continuing ? previous.evidence : {}), ...patch.evidence };
  if (fields.customerName === undefined && usableSavedName(binding.customerName)) fields.customerName = binding.customerName;

  // Explicitly approved SMS defaults, not customer statements or invented evidence.
  fields.pricingMode ??= "home";
  fields.homeType ??= "House";

  // Home staffing fields are structural, never a staffing promise or hourly evidence.
  if (fields.pricingMode === "home") {
    fields.maidCount = 1;
    fields.hourCount = 1;
    delete evidence.maidCount;
    delete evidence.hourCount;
  } else if (continuing && previous.fields.pricingMode === "home") {
    for (const key of ["maidCount", "hourCount"] as const) {
      if (patch.fields[key] === undefined) { delete fields[key]; delete evidence[key]; }
    }
  }

  const changedExtras = patch.fields.extras !== undefined && (!continuing || previous.fields.extras === undefined
    || JSON.stringify(selections(previous.fields.extras)) !== JSON.stringify(selections(patch.fields.extras)));
  const confirmationIsFresh = patch.fields.extrasConfirmed === true && !!patch.evidence.extrasConfirmed
    && (!evidence.extras || patch.evidence.extrasConfirmed.turnIndex >= evidence.extras.turnIndex);
  if ((changedExtras && !confirmationIsFresh) || (fields.extrasConfirmed === true && evidence.extras
    && (!evidence.extrasConfirmed || evidence.extrasConfirmed.turnIndex < evidence.extras.turnIndex))) {
    delete fields.extrasConfirmed;
    delete evidence.extrasConfirmed;
  }

  const next: SmsBookingQuoteState = {
    version: 1, revision: (previous?.revision ?? 0) + 1,
    sessionId: binding.sessionId, customerPhone: binding.fromPhone,
    receivingPhoneNumberId: binding.receivingPhoneNumberId,
    quoteId: continuing ? previous.quoteId : binding.providerMessageId,
    fields, evidence,
    link: continuing && comparableFields(previous.fields) === comparableFields(fields) ? previous.link : null,
  };
  smsBookingQuoteStateSchema.parse(next);

  const pricingKeys = Object.keys(pricingShape) as (keyof typeof pricingShape)[];
  const missing: string[] = pricingKeys.filter(key => fields[key] === undefined);
  if (fields.extrasConfirmed !== true) missing.push("extrasConfirmed");
  const clock = localClock(context.nowMs ?? Date.now());
  let preview: CallBookingQuotePreview | null = null;
  let pricing: z.infer<typeof callBookingQuotePricingSchema> | null = null;
  if (missing.length === 0) {
    pricing = callBookingQuotePricingSchema.parse(Object.fromEntries(pricingKeys.map(key => [key, fields[key]])));
    const result = previewCallBookingQuote({ pricing, extrasConfirmed: true });
    preview = result.success ? { ...result, ...clock } : result;
  }

  for (const key of ["customerName", "address", "requestedLocalDate", "requestedLocalTime"] as const) {
    if (fields[key] === undefined) missing.push(key);
  }
  if (fields.requestedLocalDate !== undefined && fields.requestedLocalDate < clock.currentLocalDate) {
    missing.push("requestedLocalDate");
  } else if (fields.requestedLocalDate === clock.currentLocalDate && fields.requestedLocalTime !== undefined
    && fields.requestedLocalTime < clock.currentLocalTime) {
    missing.push("requestedLocalTime");
  }

  let input: CreateCustomerBookingLinkInput | null = null;
  if (patch.action === "link" && missing.length === 0 && pricing !== null && preview?.success) {
    const parsed = callBookingQuoteSendInputSchema.parse({
      customerName: fields.customerName, customerPhone: binding.fromPhone,
      ...(fields.customerEmail != null ? { customerEmail: fields.customerEmail } : {}),
      address: fields.address, requestedLocalDate: fields.requestedLocalDate,
      requestedLocalTime: fields.requestedLocalTime,
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      pricing, extrasConfirmed: true, smsNumberConfirmed: true,
    });
    const { extrasConfirmed: _extras, smsNumberConfirmed: _confirmed, ...canonicalInput } = parsed;
    input = canonicalInput;
  }
  return { state: next, preview, input, missing: Array.from(new Set(missing)) };
}

/** One text contract for generation AND durable preparation. Email addresses are
 * customer contact facts, not generated booking URLs; grounded numbers are valid. */
export function assertSmsBookingQuoteModelText(text: string): void {
  // Currency words alone can be customer names (for example, Maya Pounds).
  // Reject monetary amounts, not those ordinary words without an amount.
  const numberWord = "(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|mil)";
  const currency = String.raw`(?:(?:US|U\.S\.|American|Canadian|Australian|British|Mexican)\s+)?(?:dollars?|euros?|pounds?|pesos?|cents?|dólares?|libras?)`;
  const amountWithCurrency = new RegExp(String.raw`\b(?:(?:\d[\d.,]*\s*|${numberWord}\s+)${currency}|${currency}\s+(?:\d[\d.,]*|${numberWord}))\b`, "i");
  if (new RegExp(String.raw`\p{Sc}|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF|CNY|INR|MXN)\b`, "iu").test(text)
    || amountWithCurrency.test(text)
    || /(?:\b(?:price|quote|cost|total|fee|discount|precio|costo|tarifa|descuento|prix|coût)\s*(?:(?:is|of|at|will be|would be|es|de|será|est)\s*|[:=]\s*)?\d|\b(?:(?:first|initial|future|weekly|biweekly|monthly)\s+(?:cleanings?|cleans?|visits?)|primera\s+limpieza|visitas?\s+futuras?)\s*(?:(?:is|for|at|costs?|es|será)\s*|[:=]\s*)\d|\b(?:price|cost|total|fee|precio|costo|tarifa)\s+(?:is|will be|would be|es|será)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|cien|ciento|doscientos|trescientos)\b|\d[\d.,]*\s*%)/i.test(text)) return fail("SMS_QUOTE_MODEL_PRICE");
  if (new RegExp(String.raw`(?:\b[a-z][a-z\d+.-]*:\/\/|\bwww\.|(?<![\p{L}\d@.\-])(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}\b|\/book\/)`, "iu").test(text)) return fail("SMS_QUOTE_MODEL_URL");
}

/** Additive overlay for the SMS generator ONLY. Existing call/email prompts stay untouched. */
export const SMS_BOOKING_QUOTE_INSTRUCTIONS = `SMS-ONLY NEW CLEANING BOOKING QUALIFICATION (additive highest-priority overlay):
Prioritize a customer's NEW cleaning quote or booking inquiry with a natural multi-turn conversation, not a generic staff-follow-up response. Read the complete originalConversation and previous durable booking quote state, plus current incomingMessage and current New York date/time. Preserve the customer's language and approved personal SMS style. Ask only one or two related missing questions at a time; never repeat known usable fields or ask for the already verified SMS phone number. Use an exact usable saved contact name if available; a customer-supplied name takes precedence. Email is optional, only if volunteered, and customerEmail:null explicitly clears it.
User-approved SMS defaults: the application uses home pricing unless the customer explicitly requests hourly or an existing durable quote is already hourly. Never ask home versus hourly. The application uses House only when property type is unknown; retain any customer-supplied House/Apartment/Townhome/Condo, but never ask for property type. Omit these defaulted fields and their evidence from the model patch unless the customer actually supplied or corrected them. Never fabricate evidence for a default or describe the property as a house merely because of that default. All other price-affecting facts, extras confirmation and requested date/time still require the existing customer evidence. Explicit hourly requests still require actual maid and hour counts. These defaults apply to all supported cleaning services.
This overlay extends the existing strict JSON output to {"replyText":"the SMS reply","task":existing task or null,"bookingQuote":update or null}. For unrelated ordinary customer service, FAQ, existing-booking reschedule/cancel, complaint or ETA requests, use bookingQuote:null and preserve ALL existing reply/task/checklist behavior. A NEW quote must not trigger duplicate legacy lead/task work solely for qualification. Mixed unrelated operational work still uses the existing task rules and current-inbound evidence. The link action is only for a requested NEW cleaning quote/booking, NEVER reschedule or cancellation.
For an active NEW quote, bookingQuote is {"action":"collect"|"quote"|"link","restart":optional boolean,"intentEvidenceQuote":"exact nonempty literal quote from CURRENT incomingMessage","fields":{only supplied or corrected flat fields},"evidence":{each supplied field:{"turnIndex":zero-based originalConversation index,"quote":"exact nonempty literal substring of that customer message"}}}. Use collect during qualification, quote when ready for canonical pricing, and link only when the customer requested a NEW quote/booking link and all needed inputs are known. Preserve the quote across turns; restart:true only when the customer explicitly requests starting a distinct NEW quote, never automatically. Cite every changed field, including extrasConfirmed and notes, from an actual inbound user/customer message in the same session, customer phone and receiving line. Assistant/staff statements are not customer evidence. No orphan evidence and no evidence for unchanged omitted fields. Historical customer facts are allowed, current intent must be literal CURRENT incomingMessage. Do not infer completion from any history.
Allowed flat fields ONLY: customerName, customerEmail, address, requestedLocalDate, requestedLocalTime, notes (array of strings), pricingMode (home/hourly), serviceId (standard/deep/moveout), bedrooms (0-7), bathrooms (1-5), homeType (House/Apartment/Townhome/Condo), condition (1-10), maidCount (1-4), hourCount (1-8), extras (array of {id,quantity}), recurrence (one-time/weekly/biweekly/monthly), extrasConfirmed (boolean). Every numeric value is a whole number. Never provide customerPhone, sender, recipient, price, customPriceCents, fees, URL, token, booking execution or extra fields. For home mode the server supplies structural maidCount:1/hourCount:1, ignored by pricing, not a staffing promise; do not ask home customers for staffing. Preserve supported hourly requests only with actual customer-provided maid and hour counts and all other canonical facts; never carry structural home counts into hourly or invent unsupported office facts.
Condition scale meaning remains: 1 = already clean; 5 = light / normal; 10 = severe buildup / needs a serious reset. Higher means more work, not a cleaner home. Ask succinctly on two lines, in the customer's language. English example: "How much cleaning does it need (1 to 10)?" then "1 = already clean, 5 = normal, 10 = heavy buildup." Do not add a second paragraph repeating the scale explanation.
Do not guess ANY price-affecting facts, service, recurrence or extras. Ask whether the customer wants one-time, weekly, biweekly or monthly cleaning rather than defaulting. Supported public extras ONLY: ${Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS).map(([id, extra]) => `${id} (${extra.label}${extra.quantityUnit ? `; quantity in ${extra.quantityUnit}s` : ""})`).join(", ")}. Quantities must be explicit positive whole numbers (1-50), no duplicate IDs, custom prices, pet/green fees, legacy IDs or post-booking upsells. extras:[] requires explicit customer confirmation of none. Confirm the complete selected extras, setting extrasConfirmed:true with customer evidence not predating the latest extras change. Never silently assume no extras.
When offering extras, use a short heading and put each listed extra on its own line, starting with a relevant emoji as the bullet. Use plain SMS text, not Markdown, asterisks or dash bullets. Use only the supported catalog above, preserve its labels and quantity units, and ask how many where a quantity is needed. End with a short option to choose no extras. Separate the condition question and extras list with a blank line, not one long paragraph. Do not re-offer the full extras menu after the customer has already selected or declined; briefly confirm the actual selections and quantities instead. Apply this layout to every supported service and both pricing modes.
Collect a preferred local calendar date AND time and the actual address before link. Resolve relative customer wording (today/tomorrow/Friday) into a real YYYY-MM-DD using current New York context and source turn timing; cite the original relative wording as evidence, never require a literal ISO date from the customer. Resolve time into HH:mm, ask about ambiguity; never default tomorrow/noon. Do not re-resolve an already durable absolute date when the calendar day changes. Ask for a replacement date/time if the requested preference is past, but allow a same-day future time. These are requested preferences, never verified availability.
For ANY active bookingQuote, replyText MUST NOT contain ANY dollar price, quoted amount in another notation, or booking URL. Never do price arithmetic, use legacy price tables, fabricate fees, discounts, availability or a link. The server appends only verified canonical price text for action quote, and a verified personalized canonical price/link for action link when complete. If facts are missing, ask for the returned missing facts naturally. Never claim anything was saved, sent, booked, reserved, confirmed or completed by generation. A link is only a quote; the customer must review and complete booking on the page. Existing task acknowledgement means pending human work, not completed business action. No tools, network, sends or booking execution by the model.`;
