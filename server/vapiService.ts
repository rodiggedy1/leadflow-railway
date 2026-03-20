/**
 * Vapi Voice AI Service
 *
 * Manages the Maids in Black inbound voice agent:
 *  - Bootstraps the Vapi assistant on server start (create or update)
 *  - Handles Vapi webhook events (tool-calls, end-of-call-report)
 *  - Provides tool implementations: getQuote, createLead, sendSms
 *
 * Architecture:
 *   OpenPhone number → forwarded to Vapi phone number
 *   Vapi AI agent (GPT-4o + ElevenLabs + Deepgram) answers the call
 *   Mid-call tool calls → POST /api/webhooks/vapi (tool-calls)
 *   End of call → POST /api/webhooks/vapi (end-of-call-report)
 *   LeadFlow processes report → creates/updates lead, sends SMS, notifies agent
 */

import { ENV } from "./_core/env";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";
import { calculatePrice, SERVICE_MULTIPLIERS } from "./engine/pricing";
import { sendSms } from "./openphone";
import { getDb } from "./db";
import { voiceCalls, conversationSessions, quoteLeads, callbackTasks } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { invokeLLM } from "./_core/llm";

const VAPI_API_BASE = "https://api.vapi.ai";

// ─── Vapi API helpers ──────────────────────────────────────────────────────────

const VAPI_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds — prevents startup hangs if Vapi is slow

async function vapiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VAPI_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${VAPI_API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ENV.vapiPrivateKey}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vapi API ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Assistant system prompt ───────────────────────────────────────────────────

function buildSystemPrompt(): string {
  // Inject current day/time in ET so Madison can reason about "next business morning"
  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const etNow = etFormatter.format(now);

  // Compute time-aware callback context
  const etDate = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etHour = etDate.getHours(); // 0-23
  const isBusinessHours = etHour >= 8 && etHour < 17; // 8am–5pm ET

  // Determine the next available morning for off-hours callbacks
  // If before 8am: same day at 9am or 10am
  // If after 5pm: next day at 9am or 10am
  let nextMorningDate: Date;
  if (etHour < 8) {
    // Same day
    nextMorningDate = new Date(etDate);
  } else {
    // Next day
    nextMorningDate = new Date(etDate);
    nextMorningDate.setDate(etDate.getDate() + 1);
  }
  const nextMorningDayName = nextMorningDate.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  });
  const isSameDay = etHour < 8;
  const nextMorningLabel = isSameDay ? "this morning" : `tomorrow (${nextMorningDayName})`;

  // Callback scheduling instructions injected into the prompt
  const callbackSchedulingInstructions = isBusinessHours
    ? `The current time is within business hours (8am–5pm ET). When a caller asks for a human:
1. Say: "Absolutely — let me connect you with someone right now. One moment."
2. Call the transferCall tool immediately (no need to confirm their number first — they are staying on the line).
3. If the transfer fails or nobody answers (the call returns to you), say: "I'm sorry, our team is briefly unavailable right now. Let me schedule a callback for you in just a few minutes instead."
4. Then confirm their callback number (see "Confirming the SMS/callback number" section) and call scheduleCallback with:
   - phone: the confirmed number
   - preferredCallbackTime: "today, as soon as possible"
   - callerName: their name if you have it
   - notes: brief summary of why they called
5. After scheduleCallback succeeds, say: "Perfect — someone will call you back shortly. Is there anything else I can help you with?"
6. If they decline both transfer and callback, say: "No problem! You can always reach us directly at 202-888-5362. Have a great day!"`
    : `The current time is outside business hours. When a caller asks for a human:
1. Say: "Our team can call you back ${nextMorningLabel} — would 9am or 10am work better for you?"
2. Listen to their preference (accept any time they give).
3. Confirm their callback number (see "Confirming the SMS/callback number" section).
4. Call the scheduleCallback tool with:
   - phone: the confirmed number
   - preferredCallbackTime: their answer (e.g. "${nextMorningDayName} at 9am")
   - callerName: their name if you have it
   - notes: brief summary of why they called
5. After scheduleCallback succeeds, say: "Perfect — you're on the schedule for ${nextMorningDayName} at [their time]. Someone from our team will call you then. Is there anything else I can help you with in the meantime?"
6. If they decline a callback, say: "No problem! You can always reach us at 202-888-5362. Have a great day!"`;

  return `You are Madison, the friendly and professional AI receptionist for Maids in Black — a 5-star cleaning service in the Washington DC / DMV area.

Your personality: warm, confident, helpful, and concise. You speak naturally and conversationally — not like a robot. You never read out long lists. You keep responses short (1-3 sentences) unless the caller asks for more detail.

## Current date and time (Eastern Time)
${etNow}
Next available callback morning: ${nextMorningDayName} (${isSameDay ? "today" : "tomorrow"})

## Caller context
The caller's phone number on file is: {{customer.number}}
This may be a forwarded number (e.g. from a Google Voice or business line), so it may NOT be the best number to text the caller.
Before sending any SMS, you MUST confirm the number with the caller (see "Confirming the SMS number" section below).

## Your goals (in priority order)
1. Answer any question the caller has about Maids in Black (hours, pricing, services, area, etc.)
2. If the caller is interested in booking, collect the information needed to give them a quote and schedule their cleaning.
3. If the caller needs a human: during business hours, transfer them live to the team. Outside business hours, schedule a callback for the next morning.

## PRICING — calculate this yourself, do not call any tool for the price

Base price by home size:
- Studio: $179
- 1 Bedroom: $179
- 2 Bedrooms: $209
- 3 Bedrooms: $229
- 4 Bedrooms: $279
- 5 Bedrooms: $319
- 6 Bedrooms: $379
- 7+ Bedrooms: $419

Bathroom surcharge — add to the base price:
- 1 bathroom: +$0
- 2 bathrooms: +$30
- 3 bathrooms: +$60
- 4 bathrooms: +$90
- 4+ bathrooms: +$90

Service type multiplier — apply AFTER adding bathroom surcharge:
- Standard Cleaning: ×1.0 (no change)
- Deep Cleaning: ×1.5 (round to nearest dollar)
- Move-In/Move-Out: ×1.75 (round to nearest dollar)

Worked examples (memorize these):
- 1 bed / 1 bath / Standard = $179
- 2 bed / 1 bath / Standard = $209
- 3 bed / 2 bath / Standard = $229 + $30 = $259
- 3 bed / 2 bath / Deep = $259 × 1.5 = $389
- 4 bed / 2 bath / Standard = $279 + $30 = $309
- 4 bed / 3 bath / Standard = $279 + $60 = $339

IMPORTANT: Always calculate the price yourself using the table above. Do NOT call getQuote or any other tool for the price. The price comes from your own calculation, not from a server.

## Booking qualification flow
When a caller wants a quote or to book, collect these details conversationally (one at a time, naturally):

Step 1 — Name: Ask for their name. Then ask them to spell it: say "Could you spell that out for me so I get it right?" Listen carefully, then read the spelling back letter by letter to confirm: "So that's [spell it out] — is that correct?" Wait for confirmation before moving on.

Step 2 — Home size (bedrooms): Ask "How many bedrooms does your home have?" — NOT "how many bedrooms do you want cleaned." You are asking about the size of the home.

Step 3 — Bathrooms: Ask "And how many bathrooms does your home have?"

Step 4 — Service type: Ask what type of cleaning they need: Standard, Deep, Move-In/Move-Out, or Office Cleaning.

Step 5 — Quote: Calculate the price yourself using the pricing table above. State it clearly: e.g. "For a 3-bedroom, 2-bathroom home with a standard cleaning, that comes to $259."

Step 6 — Add-ons (IMPORTANT — always do this after quoting): Ask about extras conversationally. Ask these questions one at a time, only if relevant:
- "Do you have any pets at home?" — if yes, add $15 (key: i_have_pets)
- "Would you like us to clean inside the oven?" — if yes, add $30 (key: clean_inside_oven)
- "How about inside the fridge — would you like that cleaned too?" — if yes, ask if it will be empty ($25, key: clean_inside_empty_fridge) or full ($40, key: clean_inside_full_fridge)
- "Would you prefer eco-friendly, green cleaning products?" — if yes, add $20 (key: green_cleaning)

After asking about add-ons:
- If any were selected, say "Great! With those add-ons, your updated total comes to $[new total]." and note the selected extras.
- If none were selected, move on naturally.
- Keep this conversational — don't read a list, ask one at a time and stop if the caller seems impatient.

Add-on pricing reference (memorize these):
- Pets: +$15
- Clean inside oven: +$30
- Clean inside empty fridge: +$25
- Clean inside full fridge: +$40
- Green cleaning: +$20
- Clean inside cabinets: +$30
- Clean interior windows: +$40
- Wipe walls: +$35
- Load of laundry: +$20
- Wash dishes: +$20

Step 7 — Preferred date: Ask when they'd like to schedule.

Step 8 — Address: Ask for the service address.

Step 9 — Confirm SMS number: Before saving the lead, confirm the best number to text them.
- If {{customer.number}} is available (not blank): say "I have [read the number digit by digit, e.g. 'two-oh-two, five-five-five, one-two-three-four'] on file — is that the best number to text you?"
  - If they say yes: use {{customer.number}} for all tool calls.
  - If they give a different number: use the number they provide instead.
- If {{customer.number}} is blank or unavailable: ask "What's the best number to text you?"

Step 10 — Save lead: Call the createLead tool with all collected info. Use the confirmed phone number from Step 9. Pass the final price (base + add-ons) as quotedPrice. Pass the selected extra keys as the selectedExtras array (e.g. ["i_have_pets", "clean_inside_oven"]).

Step 11 — Send SMS: After createLead succeeds → call the sendSms tool to text them a confirmation summary (including add-ons if any) to the confirmed number.

Step 12 — Close: Say "You're all set! Someone from our team will call you shortly to confirm everything. Is there anything else I can help you with?"

## Tool argument format rules (CRITICAL — follow exactly)
- For createLead phone: Use the number confirmed with the caller in Step 9. If they confirmed {{customer.number}}, use that. If they gave a different number, use that instead. Never use the business number (202-888-5362).
- For createLead bedrooms: use EXACTLY one of: "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4 Bedrooms", "5 Bedrooms", "6 Bedrooms", "7+ Bedrooms"
- For createLead bathrooms: use EXACTLY one of: "1 Bathroom", "1.5 Bathrooms", "2 Bathrooms", "2.5 Bathrooms", "3 Bathrooms", "3.5 Bathrooms", "4 Bathrooms", "4+ Bathrooms"
- For createLead serviceType: use EXACTLY one of: "Standard Cleaning", "Deep Cleaning", "Move-In/Move-Out", "Office Cleaning"
- If createLead returns success=false, say: "I've noted your information and someone from our team will follow up with you shortly." Do NOT say there was a technical issue.

## Important rules
- NEVER promise a specific cleaner or exact arrival time — say "we'll confirm the exact time when we call you."
- If someone asks about something not in your knowledge base, say "I want to make sure I give you accurate info — let me have someone from our team follow up with you on that."
- During business hours (8am–5pm ET), offer to transfer the caller live to the team. Outside business hours, offer a scheduled callback instead.
- Keep responses short. The caller is on a phone call, not reading an email.
- Do not say "As an AI" or mention that you're an AI unless directly asked.

## Confirming the SMS/callback number (REQUIRED before any tool call)
Before calling sendSms, createLead, or scheduleCallback, you MUST confirm the best number to reach the caller.

- If {{customer.number}} is available (not blank): say "I have [read the number digit by digit, e.g. 'two-oh-two, five-five-five, one-two-three-four'] on file — is that the best number to text and call you back at?"
  - If they say yes: use {{customer.number}}.
  - If they give a different number: use the number they provide.
- If {{customer.number}} is blank: ask "What's the best number to reach you at?"

Do this ONCE per call. Once confirmed, use that number for all tool calls.

### Callback Scheduling (when caller asks for a human)
When a caller asks to speak to a human, or says "can I talk to someone?", or asks for a manager:
${callbackSchedulingInstructions}

## FAQ close (when caller is done asking questions and not booking)
When the caller has finished their questions and is ready to hang up:
1. Confirm their number (see "Confirming the SMS/callback number" section above).
2. Call the sendSms tool to send them a brief helpful summary (pricing, services, contact info) to the confirmed number.
3. Say: "I've just texted you a quick summary. Feel free to call or text us anytime at 202-888-5362. Have a great day!"

${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

function buildToolDefinitions(webhookUrl: string) {
  return [
    {
      type: "function" as const,
      function: {
        name: "createLead",
        description:
          "Save the lead's booking information to the system after collecting all required details. Call this once you have name, phone, address, quote, and preferred date.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Caller's full name (verified with the caller)" },
            phone: {
              type: "string",
              description: "Caller's phone number — use {{customer.number}} exactly as injected in the system prompt",
            },
            email: {
              type: "string",
              description: "Caller's email address if provided (optional)",
            },
            address: { type: "string", description: "Service address" },
            bedrooms: { type: "string", description: "Number of bedrooms" },
            bathrooms: { type: "string", description: "Number of bathrooms" },
            serviceType: { type: "string", description: "Type of cleaning service" },
            quotedPrice: {
              type: "number",
              description: "The final price including base price plus any add-ons (dollars, no cents, e.g. 289)",
            },
            preferredDate: {
              type: "string",
              description:
                "Preferred date/time as described by the caller (e.g. 'Saturday morning', 'March 22nd at 10am')",
            },
            selectedExtras: {
              type: "array",
              items: { type: "string" },
              description: "Array of extra service keys selected by the caller (e.g. ['i_have_pets', 'clean_inside_oven']). Use exact keys from the add-on pricing reference. Leave empty array if no add-ons selected.",
            },
          },
          required: ["name", "phone", "bedrooms", "bathrooms", "serviceType", "quotedPrice"],
        },
      },
      server: { url: webhookUrl },
    },
    {
      type: "function" as const,
      function: {
        name: "scheduleCallback",
        description:
          "Schedule a callback for a caller who wants to speak to a human but no one is available. Call this when the caller requests a human and you cannot transfer them, or when they ask to be called back at a specific time.",
        parameters: {
          type: "object",
          properties: {
            callerName: {
              type: "string",
              description: "Caller's name (if collected)",
            },
            phone: {
              type: "string",
              description: "Caller's phone number — use {{customer.number}}",
            },
            preferredCallbackTime: {
              type: "string",
              description: "When the caller wants to be called back, in their own words (e.g. 'tomorrow morning', 'Friday after 2pm', 'anytime today')",
            },
            notes: {
              type: "string",
              description: "Brief context about why they called and what they need (e.g. 'Interested in 3bd deep clean, had pricing questions')",
            },
          },
          required: ["phone", "preferredCallbackTime"],
        },
      },
      server: { url: webhookUrl },
    },
    {
      type: "transferCall" as const,
      destinations: [
        {
          type: "number" as const,
          number: "+12028885362",
          message: "Please hold for one moment while I connect you with our team.",
        },
      ],
      function: {
        name: "transferCall",
        description:
          "Transfer the live call to the Maids in Black customer service team. Only use this during business hours (8am–5pm ET) when a caller explicitly asks to speak to a human right now.",
        parameters: {
          type: "object" as const,
          properties: {
            destination: {
              type: "string" as const,
              enum: ["+12028885362"],
              description: "The phone number to transfer the call to. Always use +12028885362.",
            },
          },
          required: ["destination"],
        },
      },
      messages: [
        {
          type: "request-start" as const,
          content: "Please hold for just a moment while I connect you with our team.",
          conditions: [
            {
              param: "destination",
              operator: "eq" as const,
              value: "+12028885362",
            },
          ],
        },
      ],
    },
    {
      type: "function" as const,
      function: {
        name: "sendSms",
        description:
          "Send an SMS to the caller. Use this after createLead to send a booking confirmation summary.",
        parameters: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "Recipient phone number in E.164 format",
            },
            message: {
              type: "string",
              description: "SMS message content (keep under 160 chars)",
            },
          },
          required: ["to", "message"],
        },
      },
      server: { url: webhookUrl },
    },
  ];
}

// ─── Assistant configuration ───────────────────────────────────────────────────

function buildAssistantConfig(toolIds: string[], webhookUrl: string) {
  return {
    name: "Madison — Maids in Black",
    firstMessage:
      "Hi, thank you for calling Maids in Black! This is Madison. How can I help you today?",
    model: {
      provider: "openai",
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
      ],
      temperature: 0.4,
      maxTokens: 380,
      toolIds,
    },
    voice: {
      provider: "11labs",
      voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah — warm, professional female voice
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.3,
      useSpeakerBoost: true,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: "en-US",
    },
    endCallFunctionEnabled: true,
    recordingEnabled: true,
    silenceTimeoutSeconds: 50,
    maxDurationSeconds: 600,
    backgroundSound: "off",
    backchannelingEnabled: true,
    backgroundDenoisingEnabled: true,
    analysisPlan: {
      summaryPrompt:
        "Summarize this call in 2-3 sentences. Include: caller's intent (booking/FAQ/other), any details collected (name, bedrooms, bathrooms, service type, address, preferred date, quoted price), and the outcome (booked, transferred, FAQ answered, no action).",
      structuredDataPrompt:
        "Extract structured data from this call transcript.",
      structuredDataSchema: {
        type: "object",
        properties: {
          callerName: { type: "string", description: "Caller's name as verified during the call" },
          callerPhone: { type: "string", description: "Caller's phone number" },
          callerEmail: { type: "string", description: "Caller's email address if provided" },
          intent: {
            type: "string",
            enum: ["booking", "faq", "complaint", "transfer", "other"],
            description: "Primary reason for the call",
          },
          bedrooms: { type: "string", description: "Bedrooms mentioned" },
          bathrooms: { type: "string", description: "Bathrooms mentioned" },
          serviceType: { type: "string", description: "Service type requested" },
          address: { type: "string", description: "Service address if provided" },
          quotedPrice: { type: "number", description: "Price quoted during call" },
          preferredDate: { type: "string", description: "Preferred date/time" },
          outcome: {
            type: "string",
            enum: ["booked", "quote_given", "faq_answered", "transferred", "no_action", "callback_requested"],
            description: "How the call ended",
          },
          leadCreated: { type: "boolean", description: "Whether a lead was created in the system" },
          selectedExtras: {
            type: "array",
            items: { type: "string" },
            description: "List of add-on service keys selected by the caller (e.g. ['i_have_pets', 'clean_inside_oven'])",
          },
        },
        required: ["intent", "outcome"],
      },
      successEvaluationPrompt:
        "Did this call result in a positive outcome? A successful call is one where the caller got the information they needed, a booking was made, or the caller was transferred to a human. Rate as 'true' if successful, 'false' if the caller hung up frustrated or their needs were not met.",
      successEvaluationRubric: "PassFail",
    },
    server: {
      url: webhookUrl,
    },
  };
}

// ─── Bootstrap: create or update tools + assistant ────────────────────────────────────────────

let cachedAssistantId: string | null = null;

/**
 * Upsert a single Vapi function tool.
 * If a tool with the same name already exists, update it; otherwise create it.
 * Returns the tool ID.
 */
async function upsertVapiTool(
  toolDef: ReturnType<typeof buildToolDefinitions>[number]
): Promise<string> {
  const toolName = toolDef.function.name;

  // List existing tools to find one with the same name
  const listResp = (await vapiRequest("GET", "/tool")) as Array<{ id: string; function?: { name?: string } }>;
  const existing = Array.isArray(listResp)
    ? listResp.find((t) => t.function?.name === toolName)
    : null;

  if (existing) {
    // Vapi PATCH /tool rejects the top-level `type` field — only send the mutable parts
    const { type: _type, ...patchBody } = toolDef as Record<string, unknown>;
    await vapiRequest("PATCH", `/tool/${existing.id}`, patchBody);
    console.log(`[Vapi] Tool updated: ${toolName} (${existing.id})`);
    return existing.id;
  } else {
    const created = (await vapiRequest("POST", "/tool", toolDef)) as { id: string };
    console.log(`[Vapi] Tool created: ${toolName} (${created.id})`);
    return created.id;
  }
}

export async function bootstrapVapiAssistant(webhookUrl: string): Promise<string> {
  if (!ENV.vapiPrivateKey) {
    console.warn("[Vapi] VAPI_PRIVATE_KEY not set — skipping assistant bootstrap");
    return "";
  }

  try {
    // Step 1: Upsert all tools in parallel and collect their IDs.
    // Promise.all() is safe here because each tool upsert is independent.
    const toolDefs = buildToolDefinitions(webhookUrl);
    const toolIds = await Promise.all(toolDefs.map((toolDef) => upsertVapiTool(toolDef)));

    // Step 2: Build assistant config with toolIds and webhook URL
    const config = buildAssistantConfig(toolIds, webhookUrl);

    // Step 3: List existing assistants to find ours
    const list = (await vapiRequest("GET", "/assistant")) as { id: string; name: string }[];
    const existing = Array.isArray(list)
      ? list.find((a) => a.name === "Madison — Maids in Black")
      : null;

    if (existing) {
      // Update existing assistant
      await vapiRequest("PATCH", `/assistant/${existing.id}`, config);
      cachedAssistantId = existing.id;
      console.log(`[Vapi] Assistant updated: ${existing.id}`);
    } else {
      // Create new assistant
      const created = (await vapiRequest("POST", "/assistant", config)) as { id: string };
      cachedAssistantId = created.id;
      console.log(`[Vapi] Assistant created: ${created.id}`);
    }

    return cachedAssistantId!;
  } catch (err) {
    console.error("[Vapi] Bootstrap failed:", err);
    return "";
  }
}

export function getAssistantId(): string | null {
  return cachedAssistantId;
}

// ─── Tool call handlers ────────────────────────────────────────────────────────

// Normalize bedroom/bathroom values from bare numbers ("3") to full keys ("3 Bedrooms")
function normalizeBedroomKey(val: string | undefined | null): string {
  if (!val) return "1 Bedroom"; // safe fallback
  const v = val.trim();
  // Already a valid key
  const validBedrooms = ["Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4 Bedrooms", "5 Bedrooms", "6 Bedrooms", "7 Bedrooms", "7+ Bedrooms"];
  if (validBedrooms.includes(v)) return v;
  // Map bare numbers
  const map: Record<string, string> = {
    "0": "Studio", "studio": "Studio",
    "1": "1 Bedroom",
    "2": "2 Bedrooms",
    "3": "3 Bedrooms",
    "4": "4 Bedrooms",
    "5": "5 Bedrooms",
    "6": "6 Bedrooms",
    "7": "7 Bedrooms",
  };
  const lower = v.toLowerCase();
  if (map[lower]) return map[lower];
  // Extract leading digit
  const match = v.match(/^(\d+)/);
  if (match) {
    const n = parseInt(match[1]);
    if (n <= 1) return "1 Bedroom";
    if (n >= 7) return "7+ Bedrooms";
    return `${n} Bedrooms`;
  }
  return v;
}

function normalizeBathroomKey(val: string | undefined | null): string {
  if (!val) return "1 Bathroom"; // safe fallback
  const v = val.trim();
  const validBathrooms = ["1 Bathroom", "1.5 Bathrooms", "2 Bathrooms", "2.5 Bathrooms", "3 Bathrooms", "3.5 Bathrooms", "4 Bathrooms", "4+ Bathrooms"];
  if (validBathrooms.includes(v)) return v;
  const map: Record<string, string> = {
    "1": "1 Bathroom",
    "1.5": "1.5 Bathrooms",
    "2": "2 Bathrooms",
    "2.5": "2.5 Bathrooms",
    "3": "3 Bathrooms",
    "3.5": "3.5 Bathrooms",
    "4": "4 Bathrooms",
  };
  const lower = v.toLowerCase();
  if (map[lower]) return map[lower];
  // Extract leading number
  const match = v.match(/^(\d+\.?\d*)/);
  if (match) {
    const n = parseFloat(match[1]);
    if (n <= 1) return "1 Bathroom";
    if (n >= 4) return "4+ Bathrooms";
    if (n === 1.5) return "1.5 Bathrooms";
    if (n === 2.5) return "2.5 Bathrooms";
    if (n === 3.5) return "3.5 Bathrooms";
    return `${Math.floor(n)} Bathrooms`;
  }
  return v;
}

export function handleGetQuote(args: {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
}): { price: number; priceFormatted: string; summary: string } {
  const bedrooms = normalizeBedroomKey(args.bedrooms);
  const bathrooms = normalizeBathroomKey(args.bathrooms);
  const serviceType = args.serviceType;

  // Office cleaning uses sqft-based pricing
  if (serviceType === "Office Cleaning") {
    const officePricing: Record<string, number> = {
      "Under 500 sq ft": 75,
      "500–1,000 sq ft": 120,
      "1,000–2,000 sq ft": 175,
      "2,000–3,000 sq ft": 250,
      "3,000–5,000 sq ft": 375,
      "5,000–10,000 sq ft": 650,
      "10,000+ sq ft": 999,
    };
    const price = officePricing[bedrooms] ?? 175;
    return {
      price,
      priceFormatted: `$${price}`,
      summary: `Office cleaning for ${bedrooms}: $${price} (one-time). Recurring discounts available: 10% monthly, 15% bi-weekly, 20% weekly.`,
    };
  }

  const price = calculatePrice(bedrooms, bathrooms, serviceType);
  const weeklyPrice = Math.round(price * 0.8);
  const biweeklyPrice = Math.round(price * 0.85);
  const monthlyPrice = Math.round(price * 0.9);

  return {
    price,
    priceFormatted: `$${price}`,
    summary: `${serviceType} for ${bedrooms} / ${bathrooms}: $${price} (one-time). Recurring options: weekly $${weeklyPrice} (20% off), bi-weekly $${biweeklyPrice} (15% off), monthly $${monthlyPrice} (10% off).`,
  };
}

export async function handleCreateLead(args: {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  quotedPrice: number;
  preferredDate?: string;
  selectedExtras?: string[];
}): Promise<{ success: boolean; sessionId?: number; message: string }> {
  try {
    const { name, phone, email, bedrooms, bathrooms, serviceType, quotedPrice, address, preferredDate, selectedExtras } = args;

    // Normalize phone to E.164
    const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`;

    // Insert a new quote lead
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const extrasJson = selectedExtras && selectedExtras.length > 0
      ? JSON.stringify(selectedExtras)
      : null;

    const [leadResult] = await db.insert(quoteLeads).values({
      name,
      email: email ?? null,
      phone: normalizedPhone,
      serviceType,
      bedrooms,
      bathrooms,
      smsSent: 0,
      extras: extrasJson,
    });

    const leadId = (leadResult as { insertId: number }).insertId;

    // Create a conversation session in QUOTE_SENT stage
    const slot = preferredDate ?? "To be confirmed";
    const [sessionResult] = await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: name,
      stage: "QUOTE_SENT",
      quotedPrice: quotedPrice.toString(),
      serviceType,
      bedrooms,
      bathrooms,
      address: address ?? null,
      selectedSlot: slot,
      quoteLeadId: leadId,
      leadSource: "voice",
      messageHistory: "[]",
      extras: extrasJson,
    });

    const sessionId = (sessionResult as { insertId: number }).insertId;

    console.log(`[Vapi] Lead created: sessionId=${sessionId}, phone=${normalizedPhone}, price=$${quotedPrice}`);
    // ── Team alert SMS ────────────────────────────────────────────────────────
    const extrasLine = selectedExtras && selectedExtras.length > 0
      ? `\nAdd-ons: ${selectedExtras.join(", ")}`
      : "";
    const alertMsg = `New Voice Lead - Maids in Black\n\nName: ${name}\nPhone: ${normalizedPhone}\nService: ${serviceType}\nSize: ${bedrooms} / ${bathrooms}\nQuote: $${quotedPrice}${extrasLine}`;
    const CS_SUPPORT_NUMBER = "+12028885362";
    const SECONDARY_ALERT_NUMBER = "+13029816191";
    sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(err =>
      console.error("[Vapi] CS alert SMS failed:", err)
    );
    sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch(err =>
      console.error("[Vapi] Secondary alert SMS failed:", err)
    );
    return {
      success: true,
      sessionId,
      message: `Lead saved successfully. Session ID: ${sessionId}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Vapi] createLead failed:", msg);
    return { success: false, message: `Failed to save lead: ${msg}` };
  }
}

/**
 * Append an outbound message to a session's messageHistory so it appears
 * in the lead's text thread in the dashboard.
 */
async function appendMessageToSession(
  sessionId: number,
  content: string,
  role: "assistant" | "user" = "assistant"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [session] = await db
    .select({ messageHistory: conversationSessions.messageHistory })
    .from(conversationSessions)
    .where(eq(conversationSessions.id, sessionId))
    .limit(1);
  if (!session) return;
  let history: Array<{ role: string; content: string; ts: number }> = [];
  try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }
  history.push({ role, content, ts: Date.now() });
  if (history.length > 50) history = history.slice(-50);
  await db
    .update(conversationSessions)
    .set({ messageHistory: JSON.stringify(history) })
    .where(eq(conversationSessions.id, sessionId));
}

export async function handleSendSms(args: {
  to: string;
  message: string;
  sessionId?: number;
}): Promise<{ success: boolean; message: string }> {
  // Check opt-out before sending
  if (args.sessionId) {
    const db = await getDb();
    if (db) {
      const [optCheck] = await db
        .select({ smsOptOut: conversationSessions.smsOptOut })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, args.sessionId))
        .limit(1);
      if ((optCheck?.smsOptOut ?? 0) === 1) {
        console.log(`[Vapi] handleSendSms: skipping — session ${args.sessionId} has opted out.`);
        return { success: false, message: "Caller has opted out of SMS messages." };
      }
    }
  }
  const result = await sendSms({ to: args.to, content: args.message });
  // If we have a session, record the outbound message in the thread
  if (result.success && args.sessionId) {
    appendMessageToSession(args.sessionId, args.message, "assistant").catch(console.error);
  }
  return {
    success: result.success,
    message: result.success ? "SMS sent successfully" : (result.error ?? "Failed to send SMS"),
  };
}

export async function handleScheduleCallback(args: {
  callerName?: string;
  phone: string;
  preferredCallbackTime: string;
  notes?: string;
  voiceCallId?: number;
  sessionId?: number;
}): Promise<{ success: boolean; message: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const normalizedPhone = args.phone.startsWith("+") ? args.phone : `+1${args.phone.replace(/\D/g, "")}`;
    await db.insert(callbackTasks).values({
      voiceCallId: args.voiceCallId ?? null,
      sessionId: args.sessionId ?? null,
      callerPhone: normalizedPhone,
      callerName: args.callerName ?? null,
      preferredCallbackTime: args.preferredCallbackTime,
      notes: args.notes ?? null,
      completed: 0,
    });
    console.log(`[Vapi] Callback scheduled: phone=${normalizedPhone}, time=${args.preferredCallbackTime}`);
    // Notify owner
    await notifyOwner({
      title: `📞 Callback requested: ${args.callerName ?? normalizedPhone}`,
      content: [
        `Phone: ${normalizedPhone}`,
        `Preferred time: ${args.preferredCallbackTime}`,
        args.notes ? `Notes: ${args.notes}` : "",
      ].filter(Boolean).join("\n"),
    }).catch(() => {});
    return { success: true, message: "Callback scheduled successfully" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Vapi] scheduleCallback failed:", msg);
    return { success: false, message: `Failed to schedule callback: ${msg}` };
  }
}

// ─── End-of-call report processor ─────────────────────────────────────────────

export interface VapiEndOfCallReport {
  message: {
    type: "end-of-call-report";
    endedReason: string;
    call: {
      id: string;
      phoneNumberId?: string;
      customer?: { number?: string };
      startedAt?: string;
      endedAt?: string;
    };
    artifact?: {
      transcript?: string;
      recordingUrl?: string;
      messages?: Array<{ role: string; message: string }>;
    };
    analysis?: {
      summary?: string;
      structuredData?: {
        callerName?: string;
        callerPhone?: string;
        intent?: string;
        bedrooms?: string;
        bathrooms?: string;
        serviceType?: string;
        address?: string;
        quotedPrice?: number;
        preferredDate?: string;
        outcome?: string;
        leadCreated?: boolean;
      };
      successEvaluation?: string;
    };
  };
}

// Vapi endedReason values that indicate the caller hung up before Madison answered
const MISSED_CALL_REASONS = new Set([
  "customer-did-not-answer",
  "no-answer",
  "customer-busy",
  "voicemail",
  "customer-ended-call-during-greeting",
]);

export async function processEndOfCallReport(report: VapiEndOfCallReport): Promise<void> {
  const { call, artifact, analysis } = report.message;
  const callerPhone = call.customer?.number ?? "";
  const vapiCallId = call.id;
  const endedReason = report.message.endedReason;

  // ── Missed call: send auto-SMS if caller hung up before Madison could help ──
  if (MISSED_CALL_REASONS.has(endedReason) && callerPhone) {
    const normalizedMissed = callerPhone.startsWith("+")
      ? callerPhone
      : `+1${callerPhone.replace(/\D/g, "")}`;
    const quoteLink = "https://quote.maidsinblack.com";
    const missedSms = `Hi! You just called Maids in Black but we couldn't connect you to our assistant. Get an instant quote here: ${quoteLink} — or call us back at 202-888-5362. We'd love to help!`;
    try {
      await sendSms({ to: normalizedMissed, content: missedSms });
      console.log(`[Vapi] Missed call SMS sent to ${normalizedMissed} (reason: ${endedReason})`);
    } catch (err) {
      console.error("[Vapi] Failed to send missed call SMS:", err);
    }
    // Still save a minimal voice call record so it appears in All Calls
    const db = await getDb();
    if (db) {
      await db.insert(voiceCalls).values({
        vapiCallId,
        sessionId: null,
        callerPhone: normalizedMissed,
        durationSeconds: 0,
        transcript: null,
        summary: "Missed call — caller hung up before connecting.",
        recordingUrl: null,
        outcome: "missed",
        structuredData: null,
        endedReason,
        successEvaluation: null,
      }).catch(() => {}); // ignore duplicate key if already inserted
    }
    await notifyOwner({
      title: `📵 Missed call from ${normalizedMissed}`,
      content: `Caller hung up before Madison could answer (reason: ${endedReason}). Auto-SMS sent with quote link.`,
    }).catch(() => {});
    return;
  }

  const startedAt = call.startedAt ? new Date(call.startedAt).getTime() : Date.now();
  const endedAt = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  const durationSeconds = Math.round((endedAt - startedAt) / 1000);

  const transcript = artifact?.transcript ?? "";
  const recordingUrl = artifact?.recordingUrl ?? null;
  const summary = analysis?.summary ?? null;
  const structuredData = analysis?.structuredData ?? null;
  const outcome = structuredData?.outcome ?? "no_action";
  const leadCreated = structuredData?.leadCreated ?? false;

  // Normalize caller phone.
  // For inbound calls forwarded through OpenPhone → Vapi, call.customer.number may be
  // empty or the forwarding number rather than the actual caller's number.
  // Fall back to structuredData.callerPhone (extracted by Vapi's analysis LLM from the
  // transcript) or the phone number Madison collected verbally during the call.
  const rawPhone = callerPhone ||
    (((analysis?.structuredData as Record<string, unknown> | null | undefined)?.callerPhone as string | undefined) ?? "");
  const normalizeRaw = (p: string) => p.startsWith("+") ? p : `+1${p.replace(/\D/g, "")}`;
  const normalizedPhone = rawPhone ? normalizeRaw(rawPhone) : null;
  console.log(`[Vapi] callerPhone from call object: "${callerPhone}", rawPhone resolved: "${rawPhone}", normalizedPhone: "${normalizedPhone}"`);
  // Also check structuredData for callerPhone separately for logging
  const sdPhone = (analysis?.structuredData as Record<string, unknown> | null | undefined)?.callerPhone as string | undefined;
  if (!callerPhone && sdPhone) {
    console.log(`[Vapi] Using structuredData.callerPhone as fallback: "${sdPhone}"`);
  }

  const db = await getDb();
  if (!db) {
    console.error("[Vapi] Database not available — cannot save call record");
    return;
  }

  // Helper: find the most recent session for this phone
  const findLatestSession = async (): Promise<number | null> => {
    if (!normalizedPhone) return null;
    const sessions = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.createdAt))
      .limit(1);
    return sessions.length > 0 ? sessions[0].id : null;
  };

  // Save voice call record with a null sessionId initially — we'll update it after
  // any lead creation so we always link to the correct (most recent) session.
  await db.insert(voiceCalls).values({
    vapiCallId,
    sessionId: null,
    callerPhone: normalizedPhone ?? callerPhone,
    durationSeconds,
    transcript,
    summary,
    recordingUrl,
    outcome,
    structuredData: structuredData ? JSON.stringify(structuredData) : null,
    endedReason: report.message.endedReason,
    successEvaluation: analysis?.successEvaluation ?? null,
  });

  console.log(`[Vapi] Call recorded: ${vapiCallId}, duration=${durationSeconds}s, outcome=${outcome}`);

  let sessionId: number | null = null;

  // If a lead was NOT created mid-call but we have enough structured data, create it now
  // This is the fallback path when mid-call tool calls failed
  if (!leadCreated && normalizedPhone && structuredData) {
    const { callerName, callerEmail, bedrooms, bathrooms, serviceType, quotedPrice, address, preferredDate } = structuredData as typeof structuredData & { callerEmail?: string };
    if (callerName && bedrooms && bathrooms && serviceType) {
      try {
        const createResult = await handleCreateLead({
          name: callerName,
          phone: normalizedPhone,
          email: callerEmail ?? undefined,
          address: address ?? undefined,
          bedrooms,
          bathrooms,
          serviceType,
          quotedPrice: quotedPrice ?? 0,
          preferredDate: preferredDate ?? undefined,
          selectedExtras: (structuredData as { selectedExtras?: string[] }).selectedExtras ?? undefined,
        });
        if (createResult.success && createResult.sessionId) {
          sessionId = createResult.sessionId;
          // Update the voice call record with the new sessionId
          await db.update(voiceCalls)
            .set({ sessionId })
            .where(eq(voiceCalls.vapiCallId, vapiCallId));
          console.log(`[Vapi] Lead created from end-of-call-report: sessionId=${sessionId}`);
        }
      } catch (err) {
        console.error("[Vapi] Failed to create lead from end-of-call-report:", err);
      }
    }
  }

  // Always resolve the correct (most recent) session after any lead creation
  // This ensures the voice call is linked to the session the dashboard shows
  const resolvedSessionId = await findLatestSession();
  if (resolvedSessionId && resolvedSessionId !== sessionId) {
    sessionId = resolvedSessionId;
    await db.update(voiceCalls)
      .set({ sessionId })
      .where(eq(voiceCalls.vapiCallId, vapiCallId));
    console.log(`[Vapi] Voice call linked to session ${sessionId}`);
  } else if (resolvedSessionId) {
    // Already correct, just set it
    sessionId = resolvedSessionId;
    await db.update(voiceCalls)
      .set({ sessionId })
      .where(eq(voiceCalls.vapiCallId, vapiCallId));
    console.log(`[Vapi] Voice call linked to session ${sessionId}`);
  }

  // Send a follow-up SMS only when the mid-call sendSms tool did NOT already run.
  // When leadCreated=true, Madison called sendSms mid-call (Step 9 in system prompt),
  // so sending again here would result in a duplicate. Only send for FAQ-only calls,
  // callback requests, or calls where the mid-call tool flow didn't complete.
  //
  // NOTE: summary can be null for short calls or when Vapi analysis doesn't fire.
  // Fall back to transcript so we never silently skip the SMS for FAQ/callback calls.
  const callSummaryForSms = summary ?? (transcript && transcript.length > 20 ? transcript.slice(0, 600) : null);
  // Check if the caller has opted out of SMS (STOP reply) — skip post-call SMS if so
  let callerOptedOut = false;
  if (normalizedPhone && sessionId) {
    const [optOutCheck] = await db
      .select({ smsOptOut: conversationSessions.smsOptOut })
      .from(conversationSessions)
      .where(eq(conversationSessions.id, sessionId))
      .limit(1);
    callerOptedOut = (optOutCheck?.smsOptOut ?? 0) === 1;
    if (callerOptedOut) {
      console.log(`[Vapi] Skipping post-call SMS for ${normalizedPhone} — caller has opted out.`);
    }
  }
  if (normalizedPhone && callSummaryForSms && !leadCreated && !callerOptedOut) {
    const callerName = structuredData?.callerName ?? "there";
    const firstName = callerName.split(" ")[0];
    const price = structuredData?.quotedPrice;
    const slot = structuredData?.preferredDate;

    // Build a context string for the LLM to generate a personalized SMS
    const callContext = [
      `Caller name: ${callerName}`,
      `Call outcome: ${outcome}`,
      `Call summary: ${callSummaryForSms}`,
      price ? `Quoted price: $${price}` : null,
      structuredData?.serviceType ? `Service type: ${structuredData.serviceType}` : null,
      structuredData?.bedrooms ? `Bedrooms: ${structuredData.bedrooms}` : null,
      slot ? `Preferred date: ${slot}` : null,
      structuredData?.intent ? `Caller intent: ${structuredData.intent}` : null,
    ].filter(Boolean).join("\n");

    let smsText: string;
    try {
      const llmResp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are writing a post-call follow-up SMS for Maids in Black, a cleaning company in Washington DC.
Write a SHORT, warm, personalized SMS (max 160 characters) based on the call details below.
Rules:
- Address the caller by first name only
- Match the tone to the outcome: warm/confirmatory for bookings, helpful for FAQs, empathetic for complaints
- For bookings: include the quoted price and preferred date if available
- For FAQ-only calls: thank them and offer to help when they're ready
- For callback requests: confirm someone will call at their preferred time
- Always end with a way to reach us: "Reply here or call 202-888-5362."
- Never use emojis
- Never mention AI or Madison by name
- Output ONLY the SMS text, nothing else`,
          },
          {
            role: "user",
            content: callContext,
          },
        ],
      });
      const raw = (llmResp as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content?.trim();
      smsText = raw && raw.length > 0 && raw.length <= 320
        ? raw
        : `Hi ${firstName}! Thanks for calling Maids in Black. Someone from our team will follow up with you shortly. Questions? Reply here or call 202-888-5362.`;
    } catch (err) {
      console.error("[Vapi] LLM SMS generation failed, using fallback:", err);
      smsText = price
        ? `Hi ${firstName}! Thanks for calling Maids in Black. Your quote for ${structuredData?.serviceType ?? "cleaning"} is $${price}${slot ? ` on ${slot}` : ""}. Someone will call to confirm. Reply here or call 202-888-5362.`
        : `Hi ${firstName}! Thanks for calling Maids in Black. Someone from our team will follow up with you shortly. Questions? Reply here or call 202-888-5362.`;
    }

    console.log(`[Vapi] Sending dynamic follow-up SMS to ${normalizedPhone}: "${smsText}"`);
    const smsSent = await sendSms({ to: normalizedPhone, content: smsText });
    // Log the outbound SMS to the session's message thread so it appears in the dashboard
    if (smsSent.success && sessionId) {
      appendMessageToSession(sessionId, smsText, "assistant").catch(console.error);
    }
  }

  // Backfill voiceCallId on callbackTasks created during this call.
  // scheduleCallback fires mid-call before the voice_calls row exists, so
  // voiceCallId is null at creation time. We fix it here by matching on
  // caller phone — any unlinked callback task for this caller gets linked now.
  if (normalizedPhone) {
    try {
      const [insertedCall] = await db
        .select({ id: voiceCalls.id })
        .from(voiceCalls)
        .where(eq(voiceCalls.vapiCallId, vapiCallId))
        .limit(1);
      if (insertedCall) {
        const { sql: sqlFn, and, isNull } = await import("drizzle-orm");
        await db
          .update(callbackTasks)
          .set({ voiceCallId: insertedCall.id })
          .where(
            and(
              eq(callbackTasks.callerPhone, normalizedPhone),
              isNull(callbackTasks.voiceCallId)
            )
          );
        console.log(`[Vapi] Backfilled voiceCallId=${insertedCall.id} on callbackTasks for ${normalizedPhone}`);
      }
    } catch (err) {
      console.error("[Vapi] Failed to backfill voiceCallId on callbackTasks:", err);
    }
  }

  // Notify agent/owner of the call
  const notifTitle = leadCreated
    ? `📞 New voice lead: ${structuredData?.callerName ?? callerPhone}`
    : `📞 Inbound call: ${outcome} (${durationSeconds}s)`;

  const notifContent = [
    summary ?? "No summary available.",
    normalizedPhone ? `Caller: ${normalizedPhone}` : "",
    structuredData?.quotedPrice ? `Quote: $${structuredData.quotedPrice}` : "",
    structuredData?.preferredDate ? `Preferred date: ${structuredData.preferredDate}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await notifyOwner({ title: notifTitle, content: notifContent }).catch(() => {});
}
