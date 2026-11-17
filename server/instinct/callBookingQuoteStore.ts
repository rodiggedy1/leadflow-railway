import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { opsChatMessages } from "../../drizzle/schema";
import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import type { getDb } from "../db";
import { createCustomerBookingLink } from "../customerBookingLinkService";
import { isDuplicateBookingFunnelEntry } from "../bookingFunnelService";

export const CALL_BOOKING_QUOTE_ACTION = "call_booking_quote_receipt";
export const CALL_BOOKING_QUOTE_CHANNEL = "instinct_call";
export const CALL_BOOKING_QUOTE_FLOW_ACTION = "call_booking_quote_flow";
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const receiptSchema = z.object({
  version: z.literal(1), callId: z.string().min(1), recipient: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(["prepared", "sending", "sent", "failed", "unknown"]),
  link: z.object({ token: z.string(), urlPath: z.string(), firstCleaningTotalCents: z.number().int().positive() }).strict(),
  message: z.string().nullable(), senderNumberId: z.string().min(1), providerMessageId: z.string().nullable(), code: z.string().nullable(),
}).strict();
export type CallBookingQuoteReceipt = z.infer<typeof receiptSchema> & { id: number; key: string };
const rows = (result: unknown): Record<string, any>[] => (result as any)[0];
const affected = (result: unknown): number => Number((result as any)[0]?.affectedRows ?? 0);
const metadata = (receipt: CallBookingQuoteReceipt) => { const { id: _id, key: _key, ...data } = receipt; return receiptSchema.parse(data); };
const fingerprint = (input: CreateCustomerBookingLinkInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const receiptKey = (callId: string, input: CreateCustomerBookingLinkInput) => `call-quote:v1:${createHash("sha256").update(callId).digest("hex").slice(0, 32)}:${fingerprint(input)}`;
const flowKey = (callId: string) => `call-quote-flow:v1:${createHash("sha256").update(callId).digest("hex")}`;
function parse(row: Record<string, any>, key: string): CallBookingQuoteReceipt {
  if (row.quickAction !== CALL_BOOKING_QUOTE_ACTION || row.channel !== CALL_BOOKING_QUOTE_CHANNEL || row.activeDedupKey !== key || row.sessionId !== null) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
  const value = receiptSchema.parse(typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata);
  if (!/^mib-[a-z0-9-]+$/.test(value.link.token) || value.link.urlPath !== `/book/${value.link.token}`
    || value.phase === "sent" && !value.providerMessageId) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
  return { ...value, id: Number(row.id), key };
}
function verifyInput(receipt: CallBookingQuoteReceipt, input: CreateCustomerBookingLinkInput, callId: string, senderNumberId: string) {
  if (receipt.callId !== callId || receipt.recipient !== input.customerPhone || receipt.fingerprint !== fingerprint(input)
    || receipt.senderNumberId !== senderNumberId
    || receipt.link.firstCleaningTotalCents !== createPublicBookingPriceSnapshot(input.pricing).breakdown.firstCleaningTotalCents) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
}

/** No DB acquisition, model/provider invocation, customer session creation or booking execution. */
export function createCallBookingQuoteStore(db: Db) {
  async function byKey(tx: Tx, key: string) {
    const [row] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${key} FOR UPDATE`));
    return row ? parse(row, key) : null;
  }
  async function save(tx: Tx, current: CallBookingQuoteReceipt, phase: CallBookingQuoteReceipt["phase"], patch: Partial<Pick<CallBookingQuoteReceipt, "message" | "providerMessageId" | "code">> = {}) {
    const { id, key, ...data } = current;
    const encoded = JSON.stringify(receiptSchema.parse({ ...data, ...patch, phase }));
    const result = await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${encoded}, lastActivityAt = ${Date.now()} WHERE id = ${id} AND quickAction = ${CALL_BOOKING_QUOTE_ACTION}`);
    if (affected(result) !== 1) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
    const read = await byKey(tx, key);
    if (!read || JSON.stringify(metadata(read)) !== encoded) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
    return read;
  }
  return {
    async markAttempt(callId: string): Promise<void> {
      try {
        await db.insert(opsChatMessages).values({ channel: CALL_BOOKING_QUOTE_CHANNEL, quickAction: CALL_BOOKING_QUOTE_FLOW_ACTION,
          authorName: "Instinct", authorRole: "system", body: "Private AI-call quote flow receipt", sessionId: null,
          activeDedupKey: flowKey(callId), cardStatus: "active", metadata: JSON.stringify({ version: 1, callId }), lastActivityAt: Date.now() });
      } catch (error) { if (!isDuplicateBookingFunnelEntry(error)) throw error; }
    },
    get: (callId: string, input: CreateCustomerBookingLinkInput, senderNumberId: string): Promise<CallBookingQuoteReceipt | null> => db.transaction(async tx => {
      const receipt = await byKey(tx, receiptKey(callId, input));
      if (receipt) verifyInput(receipt, input, callId, senderNumberId);
      return receipt;
    }),
    async isOptedOut(phone: string): Promise<boolean> {
      const permanent = rows(await db.execute(sql`SELECT id FROM sms_opt_outs WHERE phone = ${phone}`));
      const sessions = rows(await db.execute(sql`SELECT id FROM conversation_sessions WHERE leadPhone = ${phone} AND smsOptOut = 1`));
      return permanent.length > 0 || sessions.length > 0;
    },
    async prepare(callId: string, input: CreateCustomerBookingLinkInput, senderNumberId: string): Promise<{ receipt: CallBookingQuoteReceipt; created: boolean }> {
      const key = receiptKey(callId, input);
      const existingResult = async () => db.transaction(async tx => {
        const existing = await byKey(tx, key);
        if (!existing) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
        verifyInput(existing, input, callId, senderNumberId);
        return { receipt: existing, created: false };
      });
      try {
        return await db.transaction(async tx => {
          const existing = await byKey(tx, key);
          if (existing) {
            verifyInput(existing, input, callId, senderNumberId);
            return { receipt: existing, created: false };
          }
          // The receipt and the unchanged canonical funnel insertion commit together.
          const link = await createCustomerBookingLink(tx, input, { agentId: null, agentName: "Instinct · AI Call" }, () => {});
          const state = receiptSchema.parse({ version: 1, callId, recipient: input.customerPhone, fingerprint: fingerprint(input),
            phase: "prepared", link, message: null, senderNumberId, providerMessageId: null, code: null });
          const inserted = await tx.insert(opsChatMessages).values({
            channel: CALL_BOOKING_QUOTE_CHANNEL, quickAction: CALL_BOOKING_QUOTE_ACTION,
            authorName: "Instinct", authorRole: "system", body: "Private AI-call quote receipt", sessionId: null,
            activeDedupKey: key, cardStatus: "active", metadata: JSON.stringify(state), lastActivityAt: Date.now(),
          });
          const id = Number((inserted as any)[0]?.insertId);
          const receipt = await byKey(tx, key);
          if (!Number.isSafeInteger(id) || id <= 0 || !receipt || receipt.id !== id || JSON.stringify(metadata(receipt)) !== JSON.stringify(state)) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
          return { receipt, created: true };
        });
      } catch (error) {
        if (!isDuplicateBookingFunnelEntry(error)) throw error;
        // The unique receipt key rolls back the losing transaction's funnel insert.
        return existingResult();
      }
    },
    claimSend: (receipt: CallBookingQuoteReceipt, message: string): Promise<CallBookingQuoteReceipt | null> => db.transaction(async tx => {
      const current = await byKey(tx, receipt.key);
      if (!current || current.id !== receipt.id || current.fingerprint !== receipt.fingerprint) throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
      if (current.phase !== "prepared") return null;
      return save(tx, current, "sending", { message });
    }),
    finish: (receipt: CallBookingQuoteReceipt, phase: "sent" | "failed" | "unknown", providerMessageId: string | null, code: string | null): Promise<CallBookingQuoteReceipt> => db.transaction(async tx => {
      const current = await byKey(tx, receipt.key);
      if (!current || current.id !== receipt.id || current.phase !== "sending") throw new Error("CALL_QUOTE_RECEIPT_CONFLICT");
      return save(tx, current, phase, { providerMessageId, code });
    }),
  };
}

/** Only call-specific receipts suppress the old fallback; unrelated calls stay unchanged. */
export async function hasCallBookingQuoteAttempt(db: Db, callId: string): Promise<boolean> {
  const flow = rows(await db.execute(sql`SELECT metadata FROM ops_chat_messages WHERE quickAction = ${CALL_BOOKING_QUOTE_FLOW_ACTION} AND channel = ${CALL_BOOKING_QUOTE_CHANNEL} AND activeDedupKey = ${flowKey(callId)}`));
  if (flow.some(row => {
    const value = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
    return value?.version === 1 && value?.callId === callId;
  })) return true;
  const prefix = `call-quote:v1:${createHash("sha256").update(callId).digest("hex").slice(0, 32)}:%`;
  const matches = rows(await db.execute(sql`SELECT * FROM ops_chat_messages WHERE quickAction = ${CALL_BOOKING_QUOTE_ACTION} AND channel = ${CALL_BOOKING_QUOTE_CHANNEL} AND activeDedupKey LIKE ${prefix}`));
  return matches.some(row => parse(row, row.activeDedupKey).callId === callId);
}

/** Read-only linkage to the same call's saved personalized quote, not an attempt marker. */
export async function hasSavedCallBookingQuote(db: Db, callId: string): Promise<boolean> {
  const prefix = `call-quote:v1:${createHash("sha256").update(callId).digest("hex").slice(0, 32)}:%`;
  const matches = rows(await db.execute(sql`SELECT * FROM ops_chat_messages WHERE quickAction = ${CALL_BOOKING_QUOTE_ACTION} AND channel = ${CALL_BOOKING_QUOTE_CHANNEL} AND activeDedupKey LIKE ${prefix}`));
  return matches.some(row => parse(row, row.activeDedupKey).callId === callId);
}
