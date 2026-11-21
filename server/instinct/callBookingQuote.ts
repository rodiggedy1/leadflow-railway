import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import {
  createCustomerBookingLinkInputSchema,
  customerBookingLinkPricingSchema,
} from "../../shared/bookingFunnel";
import {
  createPublicBookingPriceSnapshot,
  PUBLIC_BOOKING_PRICED_EXTRAS,
  type PublicBookingPriceSnapshot,
} from "../../shared/publicBookingPricing";

const publicExtraIds = Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS) as [string, ...string[]];
const callBookingExtraSchema = customerBookingLinkPricingSchema.shape.extras.element
  .pick({ id: true, quantity: true })
  .extend({
    id: customerBookingLinkPricingSchema.shape.extras.element.shape.id.pipe(z.enum(publicExtraIds)),
  })
  .strict();

/** All canonical fields remain required in both modes; a model cannot set a price. */
export const callBookingQuotePricingSchema = customerBookingLinkPricingSchema
  .pick({
    pricingMode: true,
    serviceId: true,
    bedrooms: true,
    bathrooms: true,
    homeType: true,
    condition: true,
    maidCount: true,
    hourCount: true,
    extras: true,
    recurrence: true,
  })
  .extend({
    // Validate strict selections before the canonical parser can strip unknown fields.
    extras: z.array(callBookingExtraSchema).pipe(customerBookingLinkPricingSchema.shape.extras),
  })
  .strict()
  .superRefine((pricing, context) => {
    const seen = new Set<string>();
    pricing.extras.forEach((extra, index) => {
      if (seen.has(extra.id)) {
        context.addIssue({ code: "custom", path: ["extras", index, "id"], message: `Duplicate extra: ${extra.id}` });
      }
      seen.add(extra.id);
    });
  });

const callBookingQuoteInputSchema = z.object({
  pricing: callBookingQuotePricingSchema,
  extrasConfirmed: z.literal(true),
}).strict();

const identityWords = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const identityPlaceholders = new Set(["valued customer", "customer", "unknown", "n a", "na", "not provided", "not available", "tbd", "anonymous", "no name"]);

/** Call-only identity/address/calendar validation; shared booking inputs remain unchanged. */
export const callBookingQuoteSendInputSchema = createCustomerBookingLinkInputSchema
  .pick({
    customerName: true,
    customerPhone: true,
    customerEmail: true,
    address: true,
    requestedLocalDate: true,
    requestedLocalTime: true,
    pricing: true,
    notes: true,
  })
  .extend({
    customerName: createCustomerBookingLinkInputSchema.shape.customerName.refine(value => !identityPlaceholders.has(identityWords(value)),
      "Ask for the caller's real name; do not use a placeholder."),
    customerNameConfirmed: z.literal(true),
    city: z.string().trim().min(1).max(500).refine(value => /\p{L}/u.test(value) && !identityPlaceholders.has(identityWords(value)),
      "Ask the caller for the service city; do not guess it."),
    addressConfirmed: z.literal(true),
    requestedLocalDate: createCustomerBookingLinkInputSchema.shape.requestedLocalDate.refine(value => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Enter a valid calendar date in YYYY-MM-DD format."),
    pricing: callBookingQuotePricingSchema,
    address: createCustomerBookingLinkInputSchema.shape.address.unwrap(),
    extrasConfirmed: z.literal(true),
    smsNumberConfirmed: z.literal(true),
  })
  .strict()
  .superRefine((input, context) => {
    const city = identityWords(input.city);
    const [street, ...components] = input.address.split(",");
    // A city word in the street name is not a city component of the saved address.
    if (city && /\p{L}/u.test(input.city) && !identityPlaceholders.has(city)
      && (!identityWords(street) || !components.some(component => identityWords(component) === city))) {
      context.addIssue({ code: "custom", path: ["address"], message: "Include a street and the caller-confirmed city as a separate comma-delimited address component after it." });
    }
  });

export type CallBookingQuotePricing = z.infer<typeof callBookingQuotePricingSchema>;
export type CallBookingQuoteSendInput = z.infer<typeof callBookingQuoteSendInputSchema>;
export type CallBookingQuoteFailure = {
  success: false;
  code: "INCOMPLETE_QUOTE" | "INVALID_QUOTE";
  missing: string[];
  message: string;
};
export type CallBookingQuotePreview = CallBookingQuoteFailure | {
  success: true;
  priceSnapshot: PublicBookingPriceSnapshot;
  firstCleaningTotalCents: number;
  futureVisitTotalCents: number | null;
  priceFormatted: string;
  futureVisitPriceFormatted: string | null;
  pricingMode: CallBookingQuotePricing["pricingMode"];
  serviceId: CallBookingQuotePricing["serviceId"];
  serviceName: string;
  bedrooms: number;
  bathrooms: number;
  homeType: CallBookingQuotePricing["homeType"];
  condition: number;
  maidCount: number;
  hourCount: number;
  extras: PublicBookingPriceSnapshot["breakdown"]["extras"];
  extrasConfirmed: true;
  recurrence: CallBookingQuotePricing["recurrence"];
  discountPercent: number;
  bookingConfirmed: false;
  reservationConfirmed: false;
  currentLocalDate: string;
  currentLocalTime: string;
};

function valueAtPath(raw: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>((value, key) =>
    value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined, raw);
}

/** Decode only the quote tools' transport envelope; strict schemas still validate every value. */
export function parseCallBookingQuoteToolArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Pure validation and the same authoritative engine used by customer booking links. */
export function previewCallBookingQuote(raw: unknown): CallBookingQuotePreview {
  const parsed = callBookingQuoteInputSchema.safeParse(raw);
  if (!parsed.success) {
    const missingIssues = parsed.error.issues.filter(issue => {
      const value = valueAtPath(raw, issue.path);
      return issue.code !== "unrecognized_keys" &&
        (value === undefined || (issue.path.join(".") === "extrasConfirmed" && value === false));
    });
    const missing = Array.from(new Set(missingIssues.map(issue => issue.path.join("."))));
    const incomplete = missingIssues.length === parsed.error.issues.length;
    return {
      success: false,
      code: incomplete ? "INCOMPLETE_QUOTE" : "INVALID_QUOTE",
      missing,
      message: incomplete
        ? `Ask the caller for or confirm: ${missing.join(", ")}. Do not guess missing quote facts.`
        : parsed.error.issues.map(issue => `${issue.path.join(".") || "quote"}: ${issue.message}`).join("; "),
    };
  }

  const priceSnapshot = createPublicBookingPriceSnapshot(parsed.data.pricing);
  const { firstCleaningTotalCents, futureVisitTotalCents, extras, discountPercent } = priceSnapshot.breakdown;
  const currency = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  return {
    success: true,
    priceSnapshot,
    firstCleaningTotalCents,
    futureVisitTotalCents,
    priceFormatted: currency.format(firstCleaningTotalCents / 100),
    futureVisitPriceFormatted: futureVisitTotalCents === null ? null : currency.format(futureVisitTotalCents / 100),
    ...parsed.data.pricing,
    serviceName: priceSnapshot.serviceName,
    extras,
    extrasConfirmed: true,
    discountPercent,
    bookingConfirmed: false,
    reservationConfirmed: false,
    currentLocalDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    currentLocalTime: new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()),
  };
}

/** A scoped derivative, never the provider private key itself. */
export function callBookingQuoteServerToken(privateKey: string): string {
  return privateKey ? createHmac("sha256", privateKey).update("instinct-call-booking-quote:v1").digest("hex") : "";
}

export function verifyCallBookingQuoteServerToken(value: unknown, privateKey: string): boolean {
  const expected = callBookingQuoteServerToken(privateKey);
  if (!expected || typeof value !== "string" || value.length !== expected.length) return false;
  const actualBytes = Buffer.from(value, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function schemaObject(schema: JSONSchema._JSONSchema | undefined): JSONSchema.JSONSchema {
  if (!schema || typeof schema !== "object") throw new Error("Expected a generated object schema.");
  return schema;
}

/** Vapi's native parameter DTO accepts only these documented JSON Schema
 * fields. The complete strict Zod schema remains authoritative at the webhook. */
function nativeToolSchema(raw: JSONSchema.JSONSchema): JSONSchema.JSONSchema {
  const result: JSONSchema.JSONSchema = {};
  for (const key of ["type", "description", "pattern", "format", "required", "enum", "title"] as const) {
    if (raw[key] !== undefined) (result as Record<string, unknown>)[key] = raw[key];
  }
  if (raw.const !== undefined) result.description = [raw.description, `Must be ${JSON.stringify(raw.const)}.`].filter(Boolean).join(" ");
  if (raw.properties) result.properties = Object.fromEntries(Object.entries(raw.properties).map(([key, value]) => [key, nativeToolSchema(schemaObject(value))]));
  if (raw.items) result.items = nativeToolSchema(schemaObject(raw.items as JSONSchema._JSONSchema));
  return result;
}

/** Native Vapi function tools only; no invocation, sender, model-price or URL arguments. */
export function buildCallBookingQuoteToolDefinitions(webhookUrl: string, authorizationToken: string) {
  // Input-side conversion retains canonical defaults/bounds through the validation pipes.
  const pricingJson = z.toJSONSchema(callBookingQuotePricingSchema, { io: "input" });
  const extraJson = z.toJSONSchema(callBookingExtraSchema, { io: "input" });
  pricingJson.properties!.condition = {
    ...schemaObject(pricingJson.properties!.condition),
    description: "Existing home cleaning workload scale: 1 = already clean; 5 = light / normal; 10 = severe buildup / needs a serious reset. Higher scores mean more cleaning work, not a cleaner home.",
  };
  // Pipes validate public IDs after canonical string validation; expose that same enum to the model.
  extraJson.properties!.id = { ...schemaObject(extraJson.properties!.id), enum: publicExtraIds };
  const canonicalExtrasJson = z.toJSONSchema(customerBookingLinkPricingSchema.shape.extras, { io: "input" });
  pricingJson.properties!.extras = { ...canonicalExtrasJson, items: extraJson };
  const previewJson = z.toJSONSchema(callBookingQuoteInputSchema, { io: "input" });
  const sendJson = z.toJSONSchema(callBookingQuoteSendInputSchema, { io: "input" });
  previewJson.properties!.pricing = pricingJson;
  sendJson.properties!.pricing = pricingJson;
  sendJson.properties!.customerName = {
    ...schemaObject(sendJson.properties!.customerName),
    description: "Actual name supplied or confirmed by the caller. Never invent a name or use Valued Customer, Customer, Unknown or another placeholder.",
  };
  sendJson.properties!.customerNameConfirmed = {
    ...schemaObject(sendJson.properties!.customerNameConfirmed),
    description: "True only after the caller confirms the name read back to them. Ask for spelling when collecting it; never assert confirmation without their answer.",
  };
  sendJson.properties!.city = {
    ...schemaObject(sendJson.properties!.city),
    description: "Service city explicitly supplied or confirmed by the caller; ask if only a street was provided. Must also appear as its own comma-delimited component after the street in address. Never infer it from phone number or street name.",
  };
  sendJson.properties!.address = {
    ...schemaObject(sendJson.properties!.address),
    description: "Complete caller-confirmed service address, formatted as street, city, followed by any caller-provided state/ZIP/unit. Keep city as its own comma-delimited component after the street. Never invent missing address details.",
  };
  sendJson.properties!.addressConfirmed = {
    ...schemaObject(sendJson.properties!.addressConfirmed),
    description: "True only after reading back the full service address including city and receiving the caller's confirmation. Reconfirm if the caller changes the address.",
  };
  sendJson.properties!.customerPhone = {
    ...schemaObject(sendJson.properties!.customerPhone),
    description: "Best text number explicitly confirmed by the caller. May be a different number from forwarded caller ID. The application must reject its own business line and verify the provider artifact downstream.",
  };
  sendJson.properties!.requestedLocalDate = {
    ...schemaObject(sendJson.properties!.requestedLocalDate),
    format: "date",
    description: "Caller-requested valid calendar date, YYYY-MM-DD, resolved from current call context, never a boot-time date or invented tomorrow. Past-time validation happens at workflow runtime.",
  };
  sendJson.properties!.requestedLocalTime = {
    ...schemaObject(sendJson.properties!.requestedLocalTime),
    description: "Caller-requested local time, HH:mm (24-hour). Ask if missing; never default to noon or claim availability.",
  };
  return [
    {
      type: "function" as const,
      function: {
        name: "getBookingQuote",
        description: "Return the authoritative canonical cleaning quote before stating any price. Requires all pricing facts and explicit extras confirmation, including confirmed none. Does not book, reserve, create a quote link, or text anything. Ask for returned missing fields rather than guessing.",
        parameters: nativeToolSchema(previewJson),
      },
      server: { url: webhookUrl, headers: { "X-Instinct-Call-Quote-Token": authorizationToken } },
    },
    {
      type: "function" as const,
      function: {
        name: "textBookingQuote",
        description: "Only when the customer requests a NEW cleaning quote by text: persist the personalized canonical quote and send its server-created /book/<token> link to their explicitly confirmed best text number. Collect their preferred date and time, real confirmed name and complete confirmed address including city first. Not for rescheduling, cancellation, or confirming a booking/reservation. Never supply a price, sender, SMS body, token, or URL. Downstream application must verify the provider artifact before reporting sent. Do not also call createLead or sendSms for this quote.",
        parameters: nativeToolSchema(sendJson),
      },
      server: { url: webhookUrl, headers: { "X-Instinct-Call-Quote-Token": authorizationToken } },
    },
  ];
}

const callQuoteInstructions = [
  "## PRICING — authoritative call booking quote tools",
  "Instruction priority: this replacement governs NEW cleaning quotes and pricing FAQ answers and overrides conflicting old knowledge-base price tables, worked examples, manual-price instructions and quote-specific FAQ-close texting instructions. The canonical booking engine is authoritative; never use getQuote or calculate a price yourself.",
  "Call getBookingQuote BEFORE stating any price, including a revised price. State only its successful priceFormatted and, when applicable, futureVisitPriceFormatted; keep first-cleaning and future-visit prices distinct. Never do price math or invent prices, add-ons, fees, discounts, links, tokens, customer facts or dates. Neither quote tool confirms availability, a reservation or a booking; never say the customer is booked, reserved or all set.",
  "For FAQ-only callers, answer naturally and use getBookingQuote when all pricing facts are available. If facts are missing, ask for those facts rather than inventing a numerical quote. Do not text unless the caller explicitly requests it. Preserve existing customer lookup, reschedule/cancel/complaint/ETA, transfer and callback behavior; textBookingQuote is not an existing-booking modification tool.",
  "For Office Cleaning, use pricingMode hourly only when the caller supplies the maid count and hour count and all other canonical fields are known. Do not invent office pricing, hours, maids, room counts or home type to force a quote. If the canonical contract cannot represent the request, explain that the team must advise using the existing human-help flow.",
  "",
  "## Booking qualification flow",
  '1. Collect the caller\'s real name conversationally. Ask "Could you spell that out for me so I get it right?" Read the spelling back and ask "is that correct?" Wait for confirmation. Set customerNameConfirmed: true only after the caller confirms it. If an existing customer name is available, confirm that name with the caller rather than inventing a new one. Never substitute Valued Customer, Customer, Unknown or another placeholder, and do not skip name collection when lookupCustomer finds no match. Reconfirm if the caller corrects the name.',
  "2. Collect the actual home bedroom and bathroom counts, service (standard/deep/moveout), homeType (House/Apartment/Townhome/Condo), condition (1–10: 1 = already clean; 5 = light / normal; 10 = severe buildup / needs a serious reset) and pricingMode (home/hourly). Explain that higher condition scores mean more cleaning work, not a cleaner home. For a home quote, use the existing Command Chat structural values maidCount: 1 and hourCount: 1; they are ignored by home pricing and are not customer facts or staffing promises. Ask for maidCount and hourCount only for hourly pricing. Never guess the actual price-affecting customer facts.",
  `3. Ask about extras conversationally before quoting. Only these public extras are supported: ${Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS).map(([id, extra]) => `${id} (${extra.label}${extra.quantityUnit ? `; quantity in ${extra.quantityUnit}s` : ""})`).join(", ")}. Collect the explicit quantity for each selected extra. Confirm the complete extras selection; use extras: [] only after the caller confirms none, and extrasConfirmed: true only after confirmation. No guessed pets/green-product fees or legacy add-on keys.`,
  "4. Ask their recurrence preference (one-time, weekly, biweekly or monthly). Do not assume one-time or a recurring frequency. Call getBookingQuote with {pricing, extrasConfirmed: true}; if it reports missing/invalid fields, ask the caller for those exact facts. Do not state a complete quote while extras are unconfirmed. Re-run getBookingQuote if any pricing fact changes before stating the revised price.",
  "5. If the caller requests a NEW cleaning quote by text, collect their preferred local calendar date AND time and complete service address including city before texting. If they give only a street, ask for the city; never infer it from the phone number, street or another customer's record. Read back the full address including city and wait for confirmation. Set addressConfirmed: true only after the caller confirms it; reconfirm if they change the address. Set city to that caller-confirmed city and format address with the city as its own comma-delimited component after the street, preserving any caller-provided state/ZIP/unit. Resolve spoken relative dates from the latest getBookingQuote currentLocalDate/currentLocalTime and confirm ambiguity with the caller, not the assistant boot-time date/callback morning. Ask if date or time is missing; no arbitrary tomorrow or 12pm. These are requested preferences, not confirmed availability. The workflow validates against the current time; do not reject a same-day future preference just because it is today.",
  "6. Before textBookingQuote, explicitly confirm the best text number just as in the existing voice flow. If {{customer.number}} is present, read it digit by digit and ask if it is the best number to text. It may be forwarded. If the caller provides an alternate number, confirm and use that number, not caller ID. If blank, ask for the best number and confirm it. Set customerPhone to that confirmed number and smsNumberConfirmed: true only after confirmation. Never use the Maids in Black business line (202-888-5362); the application owner must enforce that recipient check. Do not re-ask an already confirmed number unless the caller changes it.",
  "7. Before textBookingQuote, ensure the caller's real name and full address including city have been collected and confirmed. Call textBookingQuote with customerName, customerNameConfirmed: true, customerPhone, smsNumberConfirmed: true, requestedLocalDate, requestedLocalTime, pricing, extrasConfirmed: true, address, city, addressConfirmed: true and any caller-provided notes. Email is optional only if volunteered. The new tool owns persistence and the personalized /book/<token> quote-link text. Do NOT call createLead or sendSms for this new quote flow or duplicate it afterward; never pass quotedPrice, customPriceCents, an SMS body, sender, URL or token.",
  "8. Say the quote was texted only when textBookingQuote returns successful downstream provider-artifact verification. Missing inputs mean ask the caller; failures do not mean it was sent, saved, booked or reserved. Do not invent a fallback quote, link or successful follow-up. Keep the close conversational and explain that the requested cleaning is not a confirmed booking or reservation.",
  "",
  "",
];

/** Replace only the legacy pricing/qualification block and its conflicting createLead argument bullets. */
export function withCallBookingQuoteInstructions(originalPrompt: string): string {
  const pricing = /^## PRICING[^\r\n]*(?:\r?\n|$)/m.exec(originalPrompt);
  const qualification = /^## Booking qualification flow[^\r\n]*(?:\r?\n|$)/m.exec(originalPrompt);
  const argumentsHeader = /^## Tool argument format rules[^\r\n]*(?:\r?\n|$)/m.exec(originalPrompt);
  if (!pricing || !qualification || !argumentsHeader ||
      pricing.index >= qualification.index || qualification.index >= argumentsHeader.index) {
    throw new Error("Cannot replace call quote instructions: expected legacy pricing, booking qualification and tool argument sections in order.");
  }
  const newline = originalPrompt.includes("\r\n") ? "\r\n" : "\n";
  const argumentStart = argumentsHeader.index + argumentsHeader[0].length;
  const afterArguments = originalPrompt.slice(argumentStart);
  const nextSection = /^## /m.exec(afterArguments);
  const argumentEnd = nextSection ? argumentStart + nextSection.index : originalPrompt.length;
  const preservedRules = originalPrompt.slice(argumentStart, argumentEnd).replace(
    /^- (?:For createLead (?:phone|bedrooms|bathrooms|serviceType):|If createLead returns success=false,)[^\r\n]*(?:\r?\n|$)/gm,
    "",
  );
  return originalPrompt.slice(0, pricing.index) + callQuoteInstructions.join(newline) +
    originalPrompt.slice(argumentsHeader.index, argumentStart) +
    "- For this NEW quote flow only: use the strict getBookingQuote/textBookingQuote fields above; legacy createLead argument rules do not apply. Existing tools and their unrelated argument rules remain unchanged." + newline +
    preservedRules + originalPrompt.slice(argumentEnd);
}
