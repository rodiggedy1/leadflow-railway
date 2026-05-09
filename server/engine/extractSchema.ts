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
  hasTiming: boolean;
  questions: string[];
  wantsFutureBooking: boolean;
  isExistingCustomer: boolean;
  serviceType: string | null;
  quotedPrice: string | null;
  isPositiveReply: boolean;
  isUrgent: boolean;
  isComplaint: boolean;
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
      hasTiming:          { type: "boolean", description: "true if the message contains ANY timing-related content whatsoever — a specific date, a day of the week, a relative expression (this week, next week, this weekend, tomorrow, soon, in a few days), a time of day, urgency (ASAP), or flexibility (whenever, anytime). false only if the message has zero scheduling or timing content." },
      questions:          { type: "array", items: { type: "string" }, description: "Questions the lead asked. Empty array if none." },
      wantsFutureBooking: { type: "boolean", description: "true if the lead wants to book weeks in the future." },
      isExistingCustomer: { type: "boolean", description: "true if this is an existing customer needing support." },
      serviceType:        { type: ["string", "null"], description: "Service type if mentioned. null if not mentioned." },
      quotedPrice:        { type: ["string", "null"], description: "Price quoted if mentioned (numeric string). null if not mentioned." },
      isPositiveReply:    { type: "boolean", description: "true if the lead expressed general agreement or interest (yes, sure, sounds good, let's do it, great, ok, definitely, absolutely, etc.)" },
      isUrgent:           { type: "boolean", description: "true if the lead wants service as soon as possible (ASAP, as soon as you can, right away, urgent, etc.)" },
      isComplaint:        { type: "boolean", description: "true if the message is a complaint, grievance, or service issue — e.g. cleaner didn't show up, bad cleaning, damage, late arrival, wrong date, overcharge, or any expression of dissatisfaction with a past or current service." },
    },
    required: [
      "bedrooms", "bathrooms", "timeSlot", "dayPreference", "address",
      "callPreference", "specialScope", "optOut", "isFlexible", "hasTiming", "questions",
      "wantsFutureBooking", "isExistingCustomer", "serviceType", "quotedPrice",
      "isPositiveReply", "isUrgent", "isComplaint",
    ],
    additionalProperties: false,
  },
} as const;

export function buildExtractionPrompt(todayDate: string): string {
  return `You are a data extraction assistant. Your ONLY job is to read a customer's SMS message and extract structured signals from it. Do NOT generate a reply. Do NOT make decisions. Just extract.

Today's date is ${todayDate} (Eastern Time). Use this to resolve relative dates:
- "tomorrow" → resolve to the actual next calendar day with full date (e.g. "Wednesday, April 30")
- "Thursday" / "Friday" / any named day → resolve to the next upcoming occurrence with full date
- "this weekend" → resolve to the upcoming Saturday with full date (e.g. "Saturday, May 10")
- "next weekend" → resolve to the Saturday of next weekend with full date
- "this week" → resolve to the upcoming Friday with full date
- "next week" → resolve to the Monday of next week with full date
- "in a few days" / "in a couple days" / "soon" → resolve to 3 days from today with full date
- "whenever" / "anytime" / "flexible" / "doesn't matter" / "you pick" / "no preference" → leave dayPreference as null, set isFlexible = true, set hasTiming = true
- "as soon as possible" / "ASAP" / "right away" / "urgent" → leave dayPreference as null, set isUrgent = true, set hasTiming = true

EXTRACTION RULES:
- bedrooms/bathrooms: extract if the lead mentions room counts (e.g. "3 bed 2 bath" → "3 Bedrooms", "2 Bathrooms")
- timeSlot: "9am" / "1pm" / "morning" / "afternoon" if mentioned. "any" if they say "any time", "either works", "you pick", "doesn't matter", "whatever". null otherwise.
- dayPreference: resolve ALL relative date references to actual calendar dates as described above. null ONLY if the message contains absolutely zero timing information.
- address: extract if a street address is present.
- callPreference: "now" if call now/right away. "few_minutes" if in a few minutes/later.
- specialScope: extract if they describe a partial scope instead of giving room counts.
- optOut: true only for clear opt-out signals (STOP, unsubscribe, don't text me).
- isFlexible: true if they express openness about timing ("whenever", "flexible", "anytime", "doesn't matter", "you pick", "either works", "no preference").
- hasTiming: true if the message contains ANY timing content — a date, day, relative expression, time of day, urgency, or flexibility signal. false only if there is zero scheduling content.
- questions: list any questions the lead asked.
- wantsFutureBooking: true if they want to book weeks away.
- isExistingCustomer: true if they mention an existing booking or need support.
- isPositiveReply: true if the lead said yes, sure, sounds good, ok, great, let's do it, definitely, absolutely, or any general agreement.
- isUrgent: true if the lead said ASAP, as soon as possible, as soon as you can, right away, urgent, or similar urgency signals.
- isComplaint: true if the message is a complaint or service issue — cleaner didn't show up, bad cleaning, damage, late arrival, wrong date, overcharge, or any dissatisfaction with a past or current service. Also true for messages that are clearly not about booking a new service.

Return ONLY valid JSON. No explanation, no markdown.`;
}
