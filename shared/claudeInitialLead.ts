import { z } from "zod";

/** Explicit projection of the authenticated staff's existing selected lead card.
 * All builder fields are required; nullability matches the current UI type. */
export const claudeInitialLeadFactsSchema = z.object({
  name: z.string(),
  serviceType: z.string().nullable(),
  category: z.string().nullable(),
  address: z.string().nullable(),
  location: z.string().nullable(),
  requestedDates: z.string().nullable(),
  bedrooms: z.string().nullable(),
  bathrooms: z.string().nullable(),
  homeSize: z.string().nullable(),
  rooms: z.string().nullable(),
  propertyType: z.string().nullable(),
  frequency: z.string().nullable(),
  extras: z.array(z.string()),
  pets: z.string().nullable(),
  description: z.string().nullable(),
  summary: z.string().nullable(),
  travelPreferences: z.array(z.string()),
  proposedTimes: z.array(z.object({ start: z.string().optional(), end: z.string().optional() }).strict()),
  nativeDetails: z.array(z.object({ question: z.string().optional(), answer: z.string().optional() }).strict()),
}).strict();
export type ClaudeInitialLeadFacts = z.infer<typeof claudeInitialLeadFactsSchema>;

// Preserve complete finite JSON, including historical/outgoing/undated metadata.
export type InitialLeadJson = null | boolean | number | string | InitialLeadJson[] | { [key: string]: InitialLeadJson };
export const initialLeadJsonSchema: z.ZodType<InitialLeadJson> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(initialLeadJsonSchema), z.record(z.string(), initialLeadJsonSchema),
]));
const sessionId = z.number().int().nonnegative().refine(Number.isSafeInteger);
/** The same four fields sent by the existing CS draft button. They remain user
 * context; the complete system instructions are assembled only on the server. */
export const initialLeadDraftRequestSchema = z.object({
  conversationContext: z.string(),
  customerName: z.string(),
  jobContext: z.string(),
  scenario: z.string(),
}).strict();
export const claudeInitialLeadInputSchema = z.object({
  sessionId,
  customerPhone: z.string().min(1),
  requestId: z.uuid(),
  leadDetails: claudeInitialLeadFactsSchema,
  originalConversation: z.array(initialLeadJsonSchema),
  draftRequest: initialLeadDraftRequestSchema.optional(),
}).strict();
export const claudeInitialLeadResultSchema = z.object({
  kind: z.literal("initial_lead"),
  requestId: z.uuid(),
  sessionId,
  customerPhone: z.string().regex(/^\+1[2-9]\d{2}[2-9]\d{6}$/),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  replyText: z.string().min(1),
  mode: z.literal("review_only"),
  smsSent: z.literal(false),
  actionsExecuted: z.literal(false),
  agentId: z.string().min(1),
  agentSessionId: z.string().min(1),
}).strict();
export type ClaudeInitialLeadInput = z.infer<typeof claudeInitialLeadInputSchema>;
export type ClaudeInitialLeadResult = z.infer<typeof claudeInitialLeadResultSchema>;

// Prompt bytes and builder body moved verbatim from the approved UI baseline.
export const THUMBTACK_FIRST_RESPONSE_PROMPT = `You write first-response texts for inbound cleaning leads (Thumbtack and similar) for Maids in Black, a house cleaning business serving the DMV. I will paste a lead. Reply with ONLY the copy-paste message, with no notes, commentary, or explanations before or after it.

Voice: warm, upbeat, friendly. Sign as Madison from Maids in Black. No em dashes.

Structure:

1. Greeting: "Hey [first name]! 👋 Madison from Maids in Black here. Happy to help [get/keep] your [X]bd/[X]ba [home type] [fresh/fully refreshed/spotless]!" Match the line to the cleaning type (move out: spotless for your move out; move in: spotless before you move in; post-construction: fresh after the construction; recurring: keep fresh).
2. Middle paragraph, in this order:
   - Name the cleaning type and list ONLY the extras they selected (fridge, oven, interior windows, baseboards, cabinets, laundry, basement).
   - Address anything specific in their message (skipped rooms, special requests, organizing, builder restrictions). If something is unusual or unclear, say we'll confirm it when we send pricing.
   - If the frequency is recurring: "[Weekly/Every 2 weeks/Monthly] is a great routine for keeping the home consistently fresh, and recurring clients get our best rate."
   - "We've cleaned hundreds of homes in [city], and our whole team is background checked and insured, so you can feel completely comfortable having us in your space."
   - If pets: "Pets are no problem at all."
3. Close: ask them to send their phone number so we can text a quote and time options (Thumbtack's routing number can be unreliable). Otherwise ask: "Want me to check our team's availability [for their dates] and text you a couple of time options, or send pricing first?"

Rules:

- Never offer to call the customer. No one is available to call.
- If their dates are today or this week, acknowledge the timing ("Since you're looking at this week..."). If they have a deadline, say we'll do our best to get them on the schedule before it.
- We price by the home, not by the hour. Say so if they ask about hourly rates.
- Never include time estimates or how long the clean will take.
- If their form details conflict with their message (for example, different bedroom counts), ask them to confirm instead of guessing.
- Keep it short: a greeting, a concise middle section, and a one-line close.
- Look through the customer's notes, request details, home information, and selected extras for opportunities to make the message clearer with a short emoji-bullet list. Prefer emoji bullets whenever there is a natural opportunity to clearly present two or more concrete details, requested tasks, special requests, or included services, such as 2 bedrooms and 2 bathrooms, inside cabinets, fridge and oven cleaning, laundry, interior windows, baseboards, skipped rooms, organizing, or builder restrictions. You may combine related home facts and requested services in one concise list when that makes the lead easier to scan. Do not force bullets into every message, do not create an awkward list, and do not invent requests the customer did not make. If bullets would not improve clarity, write the information naturally in the paragraph.
- When a bullet list is appropriate, put each concrete detail or task on its own line and use a specific, relevant emoji such as 🛏️ for bedrooms, 🛁 for bathrooms, 🍳 for fridge/oven, 🧺 for laundry, 🪟 for windows, ✨ for baseboards or cabinets, and 🧹 for cleaning tasks. Keep the bullets together as one clean list, then follow them with the personalized details and reassurance paragraph. Do not compress a multi-item request into a comma-separated sentence.

Example target style:

Hey Peter! 👋 Madison from Maids in Black here. Happy to help get your new 5bd/4ba Frederick home spotless before the furniture comes in!

Here’s what your move in deep clean would include:

🗄️ Cabinets and drawers, inside and out
🍳 Fridge, oven, dishwasher, and microwave
🪟 Window sills and tracks
✨ Baseboards and light fixtures
🧹 Vacuuming and mopping on all three levels

We price by the home instead of by the hour, so you get one clear total, and we’ll size the team to your 4,300 sq ft. Our whole team is background checked and insured, and we’ve cleaned hundreds of homes in Frederick.

Could you send over your phone number? We’ll text you a quote and availability for Oct 30 or 31 right away.`;

export function buildThumbtackLeadDraftContext(lead: ClaudeInitialLeadFacts): string {
  const details = lead.nativeDetails
    .map((detail) => `${detail.question ?? "Request detail"}: ${detail.answer ?? ""}`)
    .filter((detail) => !detail.endsWith(": "))
    .join("\n");
  return [
    `Lead name: ${lead.name}`,
    `Cleaning type: ${lead.serviceType ?? lead.category ?? "House cleaning"}`,
    `Location: ${lead.address ?? lead.location ?? "Not provided"}`,
    `Requested dates/times: ${lead.requestedDates ?? "Not provided"}`,
    `Bedrooms: ${lead.bedrooms ?? "Not provided"}`,
    `Bathrooms: ${lead.bathrooms ?? "Not provided"}`,
    `Home information: ${lead.homeSize ?? lead.rooms ?? lead.propertyType ?? "Not provided"}`,
    `Frequency: ${lead.frequency ?? "Not provided"}`,
    `Selected extras: ${lead.extras.length ? lead.extras.join(", ") : "None listed"}`,
    `Pets: ${lead.pets ?? "Not provided"}`,
    `Customer request/description: ${lead.description ?? lead.summary ?? "Not provided"}`,
    `Travel preferences: ${lead.travelPreferences.length ? lead.travelPreferences.join(", ") : "None listed"}`,
    `Proposed times: ${lead.proposedTimes.length ? JSON.stringify(lead.proposedTimes) : "None listed"}`,
    details ? `All retained Thumbtack request fields:\n${details}` : "",
  ].filter(Boolean).join("\n");
}
