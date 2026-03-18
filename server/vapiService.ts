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
import { voiceCalls, conversationSessions, quoteLeads } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

const VAPI_API_BASE = "https://api.vapi.ai";

// ─── Vapi API helpers ──────────────────────────────────────────────────────────

async function vapiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${VAPI_API_BASE}${path}`, {
    method,
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
}

// ─── Assistant system prompt ───────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are Madison, the friendly and professional AI receptionist for Maids in Black — a 5-star cleaning service in the Washington DC / DMV area.

Your personality: warm, confident, helpful, and concise. You speak naturally and conversationally — not like a robot. You never read out long lists. You keep responses short (1-3 sentences) unless the caller asks for more detail.

## Your goals (in priority order)
1. Answer any question the caller has about Maids in Black (hours, pricing, services, area, etc.)
2. If the caller is interested in booking, collect the information needed to give them a quote and schedule their cleaning.
3. If the caller needs a human, offer to transfer them.

## Booking qualification flow
When a caller wants a quote or to book, collect these details conversationally (one at a time, naturally):
1. Their name
2. Number of bedrooms (or square footage if it's an office)
3. Number of bathrooms
4. Type of service: Standard Cleaning, Deep Cleaning, Move-In/Move-Out, or Office Cleaning
5. Preferred date and time
6. Their address (for the quote confirmation)

Once you have bedrooms, bathrooms, and service type → call the \`getQuote\` tool to get the exact price.
Once you have all 6 pieces → call the \`createLead\` tool to save the booking.
After saving → call the \`sendSms\` tool to text them a confirmation summary.
Then say: "You're all set! Someone from our team will call you shortly to confirm everything. Is there anything else I can help you with?"

## Important rules
- NEVER make up prices. Always use the \`getQuote\` tool to get the real price.
- NEVER promise a specific cleaner or exact arrival time — say "we'll confirm the exact time when we call you."
- If someone asks about something not in your knowledge base, say "I want to make sure I give you accurate info — let me have someone from our team follow up with you on that."
- If the caller is clearly upset or needs urgent help, offer to transfer them immediately.
- Keep responses short. The caller is on a phone call, not reading an email.
- Do not say "As an AI" or mention that you're an AI unless directly asked.

## Transfer
If the caller wants to speak to a human, use the transfer tool to connect them to the main office line.

${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

function buildToolDefinitions(webhookUrl: string) {
  return [
    {
      type: "function" as const,
      function: {
        name: "getQuote",
        description:
          "Get the exact price for a cleaning job based on bedrooms, bathrooms, and service type. Call this as soon as you have those three pieces of information.",
        parameters: {
          type: "object",
          properties: {
            bedrooms: {
              type: "string",
              description:
                "Number of bedrooms. One of: Studio, 1 Bedroom, 2 Bedrooms, 3 Bedrooms, 4 Bedrooms, 5 Bedrooms, 6 Bedrooms, 7+ Bedrooms. For office cleaning use square footage range.",
            },
            bathrooms: {
              type: "string",
              description:
                "Number of bathrooms. One of: 1 Bathroom, 1.5 Bathrooms, 2 Bathrooms, 2.5 Bathrooms, 3 Bathrooms, 3.5 Bathrooms, 4 Bathrooms, 4+ Bathrooms.",
            },
            serviceType: {
              type: "string",
              enum: Object.keys(SERVICE_MULTIPLIERS).concat(["Office Cleaning"]),
              description: "Type of cleaning service requested.",
            },
          },
          required: ["bedrooms", "bathrooms", "serviceType"],
        },
      },
      server: { url: webhookUrl },
    },
    {
      type: "function" as const,
      function: {
        name: "createLead",
        description:
          "Save the lead's booking information to the system after collecting all required details. Call this once you have name, phone, address, quote, and preferred date.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Caller's full name" },
            phone: {
              type: "string",
              description: "Caller's phone number in E.164 format (e.g. +12025551234)",
            },
            address: { type: "string", description: "Service address" },
            bedrooms: { type: "string", description: "Number of bedrooms" },
            bathrooms: { type: "string", description: "Number of bathrooms" },
            serviceType: { type: "string", description: "Type of cleaning service" },
            quotedPrice: {
              type: "number",
              description: "The price returned by getQuote (dollars, no cents)",
            },
            preferredDate: {
              type: "string",
              description:
                "Preferred date/time as described by the caller (e.g. 'Saturday morning', 'March 22nd at 10am')",
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
      maxTokens: 250,
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
    silenceTimeoutSeconds: 30,
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
          callerName: { type: "string", description: "Caller's name if provided" },
          callerPhone: { type: "string", description: "Caller's phone number" },
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
    // Step 1: Upsert all tools and collect their IDs
    const toolDefs = buildToolDefinitions(webhookUrl);
    const toolIds: string[] = [];
    for (const toolDef of toolDefs) {
      const id = await upsertVapiTool(toolDef);
      toolIds.push(id);
    }

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

export function handleGetQuote(args: {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
}): { price: number; priceFormatted: string; summary: string } {
  const { bedrooms, bathrooms, serviceType } = args;

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
  address?: string;
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  quotedPrice: number;
  preferredDate?: string;
}): Promise<{ success: boolean; sessionId?: number; message: string }> {
  try {
    const { name, phone, bedrooms, bathrooms, serviceType, quotedPrice, address, preferredDate } = args;

    // Normalize phone to E.164
    const normalizedPhone = phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`;

    // Insert a new quote lead
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const [leadResult] = await db.insert(quoteLeads).values({
      name,
      email: "",
      phone: normalizedPhone,
      serviceType,
      bedrooms,
      bathrooms,
      smsSent: 0,
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
    });

    const sessionId = (sessionResult as { insertId: number }).insertId;

    console.log(`[Vapi] Lead created: sessionId=${sessionId}, phone=${normalizedPhone}, price=$${quotedPrice}`);

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

export async function handleSendSms(args: {
  to: string;
  message: string;
}): Promise<{ success: boolean; message: string }> {
  const result = await sendSms({ to: args.to, content: args.message });
  return {
    success: result.success,
    message: result.success ? "SMS sent successfully" : (result.error ?? "Failed to send SMS"),
  };
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

export async function processEndOfCallReport(report: VapiEndOfCallReport): Promise<void> {
  const { call, artifact, analysis } = report.message;
  const callerPhone = call.customer?.number ?? "";
  const vapiCallId = call.id;

  const startedAt = call.startedAt ? new Date(call.startedAt).getTime() : Date.now();
  const endedAt = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  const durationSeconds = Math.round((endedAt - startedAt) / 1000);

  const transcript = artifact?.transcript ?? "";
  const recordingUrl = artifact?.recordingUrl ?? null;
  const summary = analysis?.summary ?? null;
  const structuredData = analysis?.structuredData ?? null;
  const outcome = structuredData?.outcome ?? "no_action";
  const leadCreated = structuredData?.leadCreated ?? false;

  // Normalize caller phone
  const normalizedPhone = callerPhone.startsWith("+")
    ? callerPhone
    : callerPhone ? `+1${callerPhone.replace(/\D/g, "")}` : null;

  // Find the most recent session for this phone (if a lead was created mid-call)
  let sessionId: number | null = null;
  const db = await getDb();
  if (db && normalizedPhone) {
    const sessions = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.createdAt))
      .limit(1);
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
  }

  // Save voice call record
  if (!db) {
    console.error("[Vapi] Database not available — cannot save call record");
    return;
  }
  await db.insert(voiceCalls).values({
    vapiCallId,
    sessionId,
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

  // If a lead was created mid-call and we have their phone, send a follow-up SMS
  if (leadCreated && normalizedPhone && summary) {
    const callerName = structuredData?.callerName ?? "there";
    const firstName = callerName.split(" ")[0];
    const price = structuredData?.quotedPrice;
    const slot = structuredData?.preferredDate ?? "your preferred time";

    const smsText = price
      ? `Hi ${firstName}! Thanks for calling Maids in Black. Here's your booking summary: ${structuredData?.serviceType ?? "Cleaning"} for $${price}, scheduled for ${slot}. Someone from our team will call you shortly to confirm. Questions? Reply here or call 202-888-5362.`
      : `Hi ${firstName}! Thanks for calling Maids in Black. Someone from our team will follow up with you shortly. Questions? Reply here or call 202-888-5362.`;

    await sendSms({ to: normalizedPhone, content: smsText });
    console.log(`[Vapi] Follow-up SMS sent to ${normalizedPhone}`);
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
