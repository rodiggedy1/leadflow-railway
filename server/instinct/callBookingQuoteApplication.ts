import { sql } from "drizzle-orm";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { getAssistantId } from "../vapiService";
import { sendSms, type SendSmsParams, type SendSmsResult } from "../openphone";
import { normalizePhone } from "../utils/phone";
import { broadcastOpsUpdate } from "../sseBroadcast";
import { callBookingQuoteSendInputSchema, previewCallBookingQuote } from "./callBookingQuote";
import { createCallBookingQuoteStore, type CallBookingQuoteReceipt } from "./callBookingQuoteStore";
import { createPublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";

const object = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const internalPhones = new Set(["+12028885362", "+19347898077"]);
export const CALL_QUOTE_BOOKING_ORIGIN = "https://quote.maidinblack.com";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export function buildCallBookingQuoteSms(input: CreateCustomerBookingLinkInput, link: CallBookingQuoteReceipt["link"], origin: string): string {
  const snapshot = createPublicBookingPriceSnapshot(input.pricing);
  const url = new URL(link.urlPath, origin);
  if (url.origin !== new URL(origin).origin || !/^\/book\/mib-[a-z0-9-]+$/.test(url.pathname) || url.search || url.hash) throw new Error("CALL_QUOTE_LINK_INVALID");
  if (link.firstCleaningTotalCents !== snapshot.breakdown.firstCleaningTotalCents) throw new Error("CALL_QUOTE_PRICE_CHANGED");
  const firstName = input.customerName.split(/\s+/)[0];
  const extras = snapshot.breakdown.extras.length
    ? snapshot.breakdown.extras.map(extra => `${extra.quantity > 1 ? `${extra.quantity} × ` : ""}${extra.label}`).join("\n")
    : "No add-ons selected";
  const frequency = input.pricing.recurrence !== "one-time" && snapshot.breakdown.futureVisitTotalCents !== null
    ? `\nYour ${input.pricing.recurrence} follow-up cleaning price is ${money(snapshot.breakdown.futureVisitTotalCents)}.` : "";
  return `Hi ${firstName}! Madison from Maids in Black here. Thanks for chatting with me!\n\nHere’s your ${snapshot.serviceName.toLowerCase()} quote for your ${input.pricing.bedrooms === 0 ? "studio" : `${input.pricing.bedrooms}-bedroom`} ${input.pricing.homeType.toLowerCase()}:\n${extras}\n\nYour first-cleaning quote is ${money(link.firstCleaningTotalCents)}.${frequency}\nYou can review the details, choose your time and complete your booking here:\n${url.href}`;
}

type Store = ReturnType<typeof createCallBookingQuoteStore>;
export interface CallBookingQuoteDependencies {
  assistantId: string;
  readCall: (callId: string) => Promise<unknown>;
  isFieldManagementCall: (callId: string) => Promise<boolean>;
  store: Store;
  send: (input: SendSmsParams) => Promise<SendSmsResult>;
  senderNumberId: string;
  publicOrigin: string;
  nowMs: () => number;
  onLinkCreated: () => void;
}
const rejected = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ success: false, code, message, bookingConfirmed: false, reservationConfirmed: false, ...extra });
function replay(receipt: CallBookingQuoteReceipt) {
  if (receipt.phase === "sent") return { success: true, alreadySent: true, deliveryStatus: "submitted", providerMessageId: receipt.providerMessageId,
    firstCleaningTotalCents: receipt.link.firstCleaningTotalCents, bookingConfirmed: false, reservationConfirmed: false, message: "The same quote link was already submitted to the SMS provider. Do not send it again or say delivery was confirmed." };
  return rejected(receipt.phase === "sending" || receipt.phase === "unknown" ? "SMS_OUTCOME_UNCONFIRMED" : "SMS_SEND_FAILED",
    "This quote already has a send attempt. Do not send it again or claim it arrived. Staff can review the recorded outcome.", { deliveryStatus: receipt.phase });
}

/** In-call only. The factories are passive and can run with fully synthetic storage/transport. */
export function createCallBookingQuoteHandler(deps: CallBookingQuoteDependencies) {
  return async (request: { callId: string; toolCallId: string; name: string; args: unknown }): Promise<Record<string, any>> => {
    if (request.name !== "textBookingQuote" && request.name !== "getBookingQuote") return rejected("UNKNOWN_QUOTE_TOOL", "Unknown quote action.");
    if (!request.callId || !request.toolCallId || !deps.assistantId || request.name === "textBookingQuote" && !deps.senderNumberId) return rejected("CALL_QUOTE_CONTEXT_UNAVAILABLE", "The call or SMS sender could not be verified. Do not claim the quote was sent.");
    try {
      const full = object(await deps.readCall(request.callId));
      if (!full || full.id !== request.callId || full.type !== "inboundPhoneCall" || full.assistantId !== deps.assistantId
        || !["in-progress", "ended"].includes(full.status) || await deps.isFieldManagementCall(request.callId)) {
        return rejected("UNVERIFIED_CUSTOMER_CALL", "This is not a verified customer-service phone call. Do not create or send a quote.");
      }
      if (full.status === "in-progress") await deps.store.markAttempt(request.callId);
      if (request.name === "getBookingQuote") return previewCallBookingQuote(request.args);
      const parsed = callBookingQuoteSendInputSchema.safeParse(request.args);
      if (!parsed.success) return rejected("INCOMPLETE_QUOTE", "Ask the caller for the missing or invalid quote details before creating or texting a link.", { missing: parsed.error.issues.map(issue => issue.path.join(".")) });
      const { extrasConfirmed: _extras, smsNumberConfirmed: _confirmed, ...raw } = parsed.data;
      const phone = normalizePhone(raw.customerPhone);
      if (!phone || internalPhones.has(phone)) return rejected("INVALID_SMS_RECIPIENT", "Confirm the customer's personal SMS number; do not text an internal business number.");
      const input: CreateCustomerBookingLinkInput = { ...raw, customerName: raw.customerName.trim().replace(/\s+/g, " "), customerPhone: phone,
        ...(raw.customerEmail ? { customerEmail: raw.customerEmail.trim().toLowerCase() } : {}),
        ...(raw.address ? { address: raw.address.trim() } : {}),
        pricing: { ...raw.pricing, extras: [...raw.pricing.extras].sort((a, b) => a.id.localeCompare(b.id)) },
        notes: raw.notes.map(note => note.trim()),
      };
      createPublicBookingPriceSnapshot(input.pricing);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(deps.nowMs()));
      if (input.requestedLocalDate < today) return rejected("PAST_REQUESTED_DATE", "Ask for the requested future cleaning date, not a past service date.");
      const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(deps.nowMs()));
      if (input.requestedLocalDate === today && input.requestedLocalTime < currentTime) return rejected("PAST_REQUESTED_TIME", "Ask for a future requested time; this preference is earlier than the current local time.");
      if (full.status === "ended") {
        const existing = await deps.store.get(request.callId, input, deps.senderNumberId);
        return existing ? replay(existing) : rejected("CALL_ENDED", "The call has ended. No new quote link or SMS was created.");
      }
      if (await deps.store.isOptedOut(phone)) return rejected("SMS_OPTED_OUT", "The customer is opted out of SMS. Do not send a text or claim one was sent.");
      const prepared = await deps.store.prepare(request.callId, input, deps.senderNumberId);
      if (prepared.created) deps.onLinkCreated();
      if (prepared.receipt.phase !== "prepared") return replay(prepared.receipt);
      const message = buildCallBookingQuoteSms(input, prepared.receipt.link, deps.publicOrigin);
      // Recheck STOP immediately before reserving the single transport attempt.
      if (await deps.store.isOptedOut(phone)) return rejected("SMS_OPTED_OUT", "The customer opted out before sending. No SMS was submitted.");
      const claimed = await deps.store.claimSend(prepared.receipt, message);
      if (!claimed) return rejected("QUOTE_SEND_ALREADY_CLAIMED", "The quote text is already being handled. Do not submit another SMS.");
      let result: SendSmsResult;
      try { result = await deps.send({ to: phone, content: message, fromNumberId: claimed.senderNumberId }); }
      catch {
        await deps.store.finish(claimed, "unknown", null, "TRANSPORT_OUTCOME_UNKNOWN");
        return rejected("SMS_OUTCOME_UNCONFIRMED", "The SMS outcome is unconfirmed. Do not claim it was sent or automatically retry it.");
      }
      const accepted = result.success && typeof result.messageId === "string" && result.messageId.length > 0;
      const phase = accepted ? "sent" : result.success ? "unknown" : "failed";
      const code = accepted ? null : result.success ? "MISSING_PROVIDER_MESSAGE_ID" : "SMS_SEND_FAILED";
      const finished = await deps.store.finish(claimed, phase, accepted ? result.messageId! : null, code);
      if (!accepted) return rejected(code!, "The booking-link text was not verified as submitted. Do not tell the customer it was sent.", { deliveryStatus: finished.phase });
      return { success: true, alreadySent: false, providerMessageId: finished.providerMessageId, deliveryStatus: "submitted",
        firstCleaningTotalCents: finished.link.firstCleaningTotalCents, bookingConfirmed: false, reservationConfirmed: false,
        message: "The quote link was submitted to the SMS provider. Tell the customer to review it and complete their booking; do not say the booking, time slot or SMS delivery is confirmed." };
    } catch (error) {
      console.error("[Vapi Quote Link] Local quote processing failed:", error instanceof Error ? error.message : "Unknown error");
      return rejected("CALL_QUOTE_PROCESSING_FAILED", "The quote text could not be verified. Do not claim it was sent or retry automatically.");
    }
  };
}

/** Called only by the existing webhook's authenticated new-quote branches; never at module import. */
export async function executeCallBookingQuoteTool(request: { callId: string; toolCallId: string; name: string; args: unknown }): Promise<Record<string, any>> {
  if (process.env.PREVIEW_MODE === "true") return rejected("PREVIEW_CALL_EXECUTION_DISABLED", "Live call quote sending is disabled in Preview.");
  const key = ENV.vapiPrivateKey, assistantId = getAssistantId();
  if (!key || !assistantId || !ENV.openPhoneNumberId) return rejected("CALL_QUOTE_CONTEXT_UNAVAILABLE", "Call or SMS configuration is unavailable.");
  const db = await getDb();
  if (!db) return rejected("CALL_QUOTE_DATABASE_UNAVAILABLE", "Quote storage is unavailable. No SMS was sent.");
  return createCallBookingQuoteHandler({ assistantId, store: createCallBookingQuoteStore(db), senderNumberId: ENV.openPhoneNumberId,
    publicOrigin: CALL_QUOTE_BOOKING_ORIGIN, nowMs: Date.now, send: sendSms, onLinkCreated: () => broadcastOpsUpdate("booking_funnel_update"),
    isFieldManagementCall: async callId => (await db.execute(sql`SELECT id FROM field_mgmt_calls WHERE vapiCallId = ${callId}`) as any)[0].length > 0,
    readCall: async callId => {
      const response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!response.ok) throw new Error("CALL_QUOTE_SOURCE_UNAVAILABLE");
      return response.json();
    },
  })(request);
}
