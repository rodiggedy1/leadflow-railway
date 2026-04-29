/**
 * LeadSignals — structured extraction schema for Step 1 of the two-step engine.
 *
 * The LLM's ONLY job in Step 1 is to read the lead's message and extract
 * every useful signal from it. No decisions, no replies — just extraction.
 *
 * Step 2 (advanceStage.ts) then uses these signals to deterministically
 * decide what stage to advance to. The LLM never decides stage transitions.
 */

export interface LeadSignals {
  bedrooms: string | null;
  bathrooms: string | null;
  timeSlot: "9am" | "1pm" | "morning" | "afternoon" | "any" | null;
  dayPreference: string | null;
  address: string | null;
  callPreference: "now" | "few_minutes" | null;
  specialScope: string | null;
  optOut: boolean;
  isFlexible: boolean;
  questions: string[];
  wantsFutureBooking: boolean;
  isExistingCustomer: boolean;
  serviceType: string | null;
  quotedPrice: string | null;
}

export const LEAD_SIGNALS_JSON_SCHEMA = {
  name: "lead_signals",
  strict: true,
  schema: {
    type: "object",
    properties: {
      bedrooms:           { type: ["string", "null"], description: "Number of bedrooms if mentioned (e.g. '2 Bedrooms'). null if not mentioned." },
      bathrooms:          { type: ["string", "null"], description: "Number of bathrooms if mentioned (e.g. '2 Bathrooms'). null if not mentioned." },
      timeSlot:           { type: ["string", "null"], enum: ["9am", "1pm", "morning", "afternoon", "any", null], description: "Time slot preference. 'any' if flexible. null if not mentioned." },
      dayPreference:      { type: ["string", "null"], description: "Specific day/date mentioned. Resolve relative dates to actual calendar dates. null if not mentioned." },
      address:            { type: ["string", "null"], description: "Street address if provided. null if not provided." },
      callPreference:     { type: ["string", "null"], enum: ["now", "few_minutes", null], description: "'now' or 'few_minutes' or null." },
      specialScope:       { type: ["string", "null"], description: "Special or partial cleaning scope instead of room counts. null if not mentioned." },
      optOut:             { type: "boolean", description: "true if the lead wants to stop receiving messages." },
      isFlexible:         { type: "boolean", description: "true if the lead expressed flexibility about timing." },
      questions:          { type: "array", items: { type: "string" }, description: "Questions the lead asked. Empty array if none." },
      wantsFutureBooking: { type: "boolean", description: "true if the lead wants to book weeks in the future." },
      isExistingCustomer: { type: "boolean", description: "true if this is an existing customer needing support." },
      serviceType:        { type: ["string", "null"], description: "Service type if mentioned. null if not mentioned." },
      quotedPrice:        { type: ["string", "null"], description: "Price quoted if mentioned (numeric string). null if not mentioned." },
    },
    required: [
      "bedrooms", "bathrooms", "timeSlot", "dayPreference", "address",
      "callPreference", "specialScope", "optOut", "isFlexible", "questions",
      "wantsFutureBooking", "isExistingCustomer", "serviceType", "quotedPrice",
    ],
    additionalProperties: false,
  },
} as const;

export function buildExtractionPrompt(todayDate: string): string {
  return `You are a data extraction assistant. Your ONLY job is to read a customer's SMS message and extract structured signals from it. Do NOT generate a reply. Do NOT make decisions. Just extract.

Today's date is ${todayDate} (Eastern Time). Use this to resolve relative dates:
- "tomorrow" → resolve to the actual next calendar day with full date (e.g. "Wednesday, April 30")
- "Thursday" → resolve to the next upcoming Thursday with full date
- "this week" / "as soon as possible" / "whenever" → leave dayPreference as null
- "next week" → leave dayPreference as null

EXTRACTION RULES:
- bedrooms/bathrooms: extract if the lead mentions room counts (e.g. "3 bed 2 bath" → "3 Bedrooms", "2 Bathrooms")
- timeSlot: "9am" / "1pm" / "morning" / "afternoon" if mentioned. "any" if they say "any time", "either works", "you pick", "doesn't matter", "whatever". null otherwise.
- dayPreference: specific day/date if mentioned. Resolve relative dates. null if vague.
- address: extract if a street address is present.
- callPreference: "now" if call now/right away. "few_minutes" if in a few minutes/later.
- specialScope: extract if they describe a partial scope instead of giving room counts.
- optOut: true only for clear opt-out signals (STOP, unsubscribe, don't text me).
- isFlexible: true if they express openness about timing.
- questions: list any questions the lead asked.
- wantsFutureBooking: true if they want to book weeks away.
- isExistingCustomer: true if they mention an existing booking or need support.

Return ONLY valid JSON. No explanation, no markdown.`;
}
