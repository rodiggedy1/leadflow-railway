import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { opsChatMessages } from "../../drizzle/schema";
import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { claudeSmsAlternativeReplySchema } from "../../shared/claudeSmsAlternative";
import { createPublicBookingPriceSnapshot, type PublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import { createCustomerBookingLink } from "../customerBookingLinkService";
import type { getDb } from "../db";
import { normalizePhone } from "../utils/phone";
import { callBookingQuoteSendInputSchema } from "./callBookingQuote";
import { createSmsBookingQuotePresentation, renderSmsBookingQuoteText } from "./bookingQuotePresentation";
import { createSmsBookingQuoteMissingQuestion } from "./smsBookingQuoteMissingQuestion";
import type { CustomerSmsBinding } from "./claudeCustomerTasksStore";
import {
  advanceSmsBookingQuote, assertSmsBookingQuoteModelText, smsBookingQuoteStateSchema, smsBookingQuoteUpdateSchema,
  type SmsBookingQuoteState, type SmsBookingQuoteUpdate,
} from "./smsBookingQuote";

export { smsBookingQuoteStateSchema } from "./smsBookingQuote";
export type { SmsBookingQuoteState, SmsBookingQuoteUpdate } from "./smsBookingQuote";
export const SMS_BOOKING_QUOTE_ACTION = "sms_booking_quote_state";
export const SMS_BOOKING_QUOTE_CHANNEL = "instinct_sms";
export const SMS_QUOTE_BOOKING_ORIGIN = "https://quote.maidinblack.com";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Identity = { account: "openphone"; sessionId: number; customerPhone: string; receivingPhoneNumberId: string };
const body = "Private SMS booking quote state";
const conflict = (): never => { throw new Error("SMS_QUOTE_STATE_CONFLICT"); };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const rows = (result: unknown): Record<string, any>[] => {
  const value = (result as any)?.[0];
  if (!Array.isArray(value)) return conflict();
  return value;
};
const header = (result: unknown): { insertId?: number; affectedRows?: number } => (result as any)?.[0] ?? {};
const positiveId = z.number().int().positive().refine(Number.isSafeInteger);
const savedQuoteSchema = z.object({
  quoteId: z.string().min(1),
  input: callBookingQuoteSendInputSchema.omit({ extrasConfirmed: true, smsNumberConfirmed: true }),
  link: smsBookingQuoteStateSchema.shape.link.unwrap(),
}).strict();
const envelopeSchema = z.object({
  version: z.literal(1), id: positiveId, key: z.string().min(1), account: z.literal("openphone"),
  state: smsBookingQuoteStateSchema,
  // Optional for compatibility with already-saved v1 states. Never model-owned.
  quotes: z.array(savedQuoteSchema).optional(),
}).strict();
type Envelope = z.infer<typeof envelopeSchema>;
type SavedQuote = z.infer<typeof savedQuoteSchema>;

export interface SmsBookingQuotePrepareInput {
  binding: CustomerSmsBinding;
  previous: SmsBookingQuoteState | null;
  update: SmsBookingQuoteUpdate;
  originalConversation: any[];
  nowMs?: number;
  replyText: string;
  quoteTextTemplate?: string | null;
  missingQuestionLanguage?: "en" | "es";
}
export interface SmsBookingQuotePrepared {
  planReplyText: string;
  state: SmsBookingQuoteState;
  linkCreated: boolean;
  linkIncluded: boolean;
}
export interface SmsBookingQuoteStore {
  read(binding: CustomerSmsBinding): Promise<SmsBookingQuoteState | null>;
  prepare(tx: Tx, input: SmsBookingQuotePrepareInput): Promise<SmsBookingQuotePrepared>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return conflict();
  return encoded;
}
function identityFor(binding: CustomerSmsBinding): Identity {
  const customerPhone = normalizePhone(binding.fromPhone);
  if ((binding.account ?? "openphone") !== "openphone" || !customerPhone
    || !Number.isSafeInteger(binding.sessionId) || binding.sessionId <= 0
    || typeof binding.receivingPhoneNumberId !== "string" || !binding.receivingPhoneNumberId.trim()) return conflict();
  return { account: "openphone", sessionId: binding.sessionId, customerPhone, receivingPhoneNumberId: binding.receivingPhoneNumberId };
}
function stateKey(identity: Identity): string {
  return `sms-quote:v1:${hash(JSON.stringify([identity.account, identity.sessionId, identity.customerPhone, identity.receivingPhoneNumberId]))}`;
}
function verifyIdentity(state: SmsBookingQuoteState, identity: Identity): void {
  if (!Number.isSafeInteger(state.revision) || state.revision < 1 || state.sessionId !== identity.sessionId
    || state.customerPhone !== identity.customerPhone || state.receivingPhoneNumberId !== identity.receivingPhoneNumberId) return conflict();
}
function normalizeInput(input: CreateCustomerBookingLinkInput): CreateCustomerBookingLinkInput {
  const phone = normalizePhone(input.customerPhone);
  if (!phone) return conflict();
  return {
    customerName: input.customerName.trim().replace(/\s+/g, " "), customerPhone: phone,
    ...(input.customerEmail ? { customerEmail: input.customerEmail.trim().toLowerCase() } : {}),
    ...(input.address ? { address: input.address.trim() } : {}),
    requestedLocalDate: input.requestedLocalDate, requestedLocalTime: input.requestedLocalTime,
    pricing: {
      pricingMode: input.pricing.pricingMode, serviceId: input.pricing.serviceId,
      bedrooms: input.pricing.bedrooms, bathrooms: input.pricing.bathrooms, homeType: input.pricing.homeType,
      condition: input.pricing.condition, maidCount: input.pricing.maidCount, hourCount: input.pricing.hourCount,
      extras: input.pricing.extras.map(extra => ({ id: extra.id, quantity: extra.quantity })).sort((a, b) => a.id.localeCompare(b.id)),
      recurrence: input.pricing.recurrence,
    },
    notes: input.notes.map(note => note.trim()),
  };
}
/** Rebuild only the validated canonical quote-link input represented by metadata. */
function inputForState(state: SmsBookingQuoteState): CreateCustomerBookingLinkInput | null {
  const fields = state.fields;
  const parsed = callBookingQuoteSendInputSchema.safeParse({
    customerName: fields.customerName, customerPhone: state.customerPhone,
    ...(fields.customerEmail != null ? { customerEmail: fields.customerEmail } : {}),
    address: fields.address, requestedLocalDate: fields.requestedLocalDate, requestedLocalTime: fields.requestedLocalTime,
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    pricing: {
      pricingMode: fields.pricingMode, serviceId: fields.serviceId, bedrooms: fields.bedrooms, bathrooms: fields.bathrooms,
      homeType: fields.homeType, condition: fields.condition, maidCount: fields.maidCount, hourCount: fields.hourCount,
      extras: fields.extras, recurrence: fields.recurrence,
    },
    extrasConfirmed: fields.extrasConfirmed, smsNumberConfirmed: true,
  });
  if (!parsed.success) return null;
  const { extrasConfirmed: _extras, smsNumberConfirmed: _confirmed, ...input } = parsed.data;
  return normalizeInput(input);
}
function fingerprint(identity: Identity, state: Pick<SmsBookingQuoteState, "quoteId">, input: CreateCustomerBookingLinkInput): string {
  return hash(canonicalJson({ identity, quoteId: state.quoteId, input: normalizeInput(input) }));
}
function verifiedLinkUrl(link: NonNullable<SmsBookingQuoteState["link"]>, snapshot: PublicBookingPriceSnapshot): string {
  if (!/^[a-f0-9]{64}$/.test(link.fingerprint) || !/^mib-[a-z0-9-]+$/.test(link.token)
    || link.token.length < 8 || link.token.length > 40 || link.urlPath !== `/book/${link.token}`
    || link.firstCleaningTotalCents !== snapshot.breakdown.firstCleaningTotalCents) return conflict();
  const url = new URL(link.urlPath, SMS_QUOTE_BOOKING_ORIGIN);
  if (url.origin !== SMS_QUOTE_BOOKING_ORIGIN || url.pathname !== link.urlPath || url.search || url.hash
    || url.href !== `${SMS_QUOTE_BOOKING_ORIGIN}${link.urlPath}`) return conflict();
  return url.href;
}
function verifyState(state: SmsBookingQuoteState, identity: Identity): void {
  verifyIdentity(state, identity);
  if (state.link) {
    const input = inputForState(state);
    if (!input || state.link.fingerprint !== fingerprint(identity, state, input)) return conflict();
    verifiedLinkUrl(state.link, createPublicBookingPriceSnapshot(input.pricing));
  }
}
function verifySavedQuote(saved: SavedQuote, identity: Identity): void {
  const input = normalizeInput(saved.input);
  if (input.customerPhone !== identity.customerPhone || canonicalJson(input) !== canonicalJson(saved.input)
    || saved.link.fingerprint !== fingerprint(identity, saved, input)) return conflict();
  verifiedLinkUrl(saved.link, createPublicBookingPriceSnapshot(input.pricing));
}
function decodeRow(row: Record<string, any>, identity: Identity): Envelope {
  const key = stateKey(identity);
  try {
    const envelope = envelopeSchema.parse(typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata);
    if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || envelope.id !== Number(row.id)
      || envelope.key !== key || row.activeDedupKey !== key || row.channel !== SMS_BOOKING_QUOTE_CHANNEL
      || row.quickAction !== SMS_BOOKING_QUOTE_ACTION || row.sessionId == null || Number(row.sessionId) !== identity.sessionId
      || row.authorName !== "Instinct" || row.authorRole !== "system" || row.body !== body || row.cardStatus !== "active") return conflict();
    verifyState(envelope.state, identity);
    const fingerprints = new Set<string>();
    for (const saved of envelope.quotes ?? []) {
      verifySavedQuote(saved, identity);
      if (fingerprints.has(saved.link.fingerprint)) return conflict();
      fingerprints.add(saved.link.fingerprint);
    }
    return envelope;
  } catch { return conflict(); }
}

const hasModelPriceOrUrl = (text: string) => {
  try { assertSmsBookingQuoteModelText(text); return false; } catch { return true; }
};
function baseReply(text: string): string {
  const reply = claudeSmsAlternativeReplySchema.parse({ replyText: text }).replyText;
  if (hasModelPriceOrUrl(reply) || /[{}]/.test(reply)) throw new Error("SMS_QUOTE_UNSAFE_BASE_REPLY");
  return reply;
}
function renderQuoteText(base: string, template: string | null | undefined, snapshot: PublicBookingPriceSnapshot,
  link: SmsBookingQuoteState["link"]): string {
  const bookingLink = link ? verifiedLinkUrl(link, snapshot) : null;
  const reply = claudeSmsAlternativeReplySchema.parse({ replyText: renderSmsBookingQuoteText(base, template, snapshot, bookingLink) }).replyText;
  if (/[{}]/.test(reply) || (bookingLink && reply.split(bookingLink).length - 1 !== 1)) throw new Error("SMS_QUOTE_INVALID_RENDERED_TEXT");
  return reply;
}

/** Passive metadata and quote-link adapter; the caller owns the transaction. */
export function createSmsBookingQuoteStore(db: Db): SmsBookingQuoteStore {
  async function locked(tx: Tx, identity: Identity): Promise<Envelope | null> {
    const found = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${stateKey(identity)} FOR UPDATE`));
    if (found.length > 1) return conflict();
    return found.length ? decodeRow(found[0], identity) : null;
  }
  return {
    async read(binding) {
      const identity = identityFor(binding);
      const found = rows(await db.execute(sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${stateKey(identity)}`));
      if (found.length > 1) return conflict();
      return found.length ? decodeRow(found[0], identity).state : null;
    },
    async prepare(tx, options) {
      const identity = identityFor(options.binding), key = stateKey(identity);
      const current = await locked(tx, identity);
      const previous = options.previous === null ? null : smsBookingQuoteStateSchema.parse(options.previous);
      if (previous) verifyState(previous, identity);
      if ((current === null) !== (previous === null) || (current && previous
        && (current.state.revision !== previous.revision || canonicalJson(current.state) !== canonicalJson(previous)))) return conflict();
      const quotes: SavedQuote[] = [...(current?.quotes ?? [])];
      // Preserve a legacy current receipt before a correction clears its link.
      if (current?.state.link && !quotes.some(saved => saved.link.fingerprint === current.state.link!.fingerprint)) {
        const input = inputForState(current.state);
        if (!input) return conflict();
        quotes.push(savedQuoteSchema.parse({ quoteId: current.state.quoteId, input, link: current.state.link }));
      }
      const update = smsBookingQuoteUpdateSchema.parse(options.update);
      const advanced = advanceSmsBookingQuote(previous, update, {
        binding: { ...options.binding, fromPhone: identity.customerPhone }, originalConversation: options.originalConversation,
        ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      });
      let state = smsBookingQuoteStateSchema.parse(advanced.state);
      if (state.revision !== (current?.state.revision ?? 0) + 1) return conflict();
      const base = baseReply(options.replyText);
      const now = options.nowMs ?? Date.now();
      if (!Number.isFinite(now) || Number.isNaN(new Date(now).getTime())) return conflict();
      let id = current?.id;
      if (id === undefined) {
        // The unique private metadata key makes a fresh-state race fail in the caller's transaction.
        const inserted = header(await tx.insert(opsChatMessages).values({
          channel: SMS_BOOKING_QUOTE_CHANNEL, quickAction: SMS_BOOKING_QUOTE_ACTION,
          authorName: "Instinct", authorRole: "system", body, sessionId: identity.sessionId,
          activeDedupKey: key, cardStatus: "active", lastActivityAt: now,
        }));
        id = Number(inserted.insertId);
        if (!Number.isSafeInteger(id) || id <= 0 || Number(inserted.affectedRows) !== 1) return conflict();
      }
      // Exact prior inputs in this quote identity reuse the original link, even A → B → A.
      const representedInput = inputForState(state);
      if (!state.link && representedInput) {
        const representedFingerprint = fingerprint(identity, state, representedInput);
        const saved = quotes.find(quote => quote.link.fingerprint === representedFingerprint);
        if (saved) state = { ...state, link: saved.link };
      }
      let linkCreated = false;
      let linkIncluded = false;
      // A preference can become past between generation and this transaction.
      // Reuse only the exact server-owned presentation's locale, never model prose.
      const missingQuestionLanguage = options.missingQuestionLanguage ?? (advanced.preview?.success
        && options.quoteTextTemplate === createSmsBookingQuotePresentation(advanced.preview.priceSnapshot, update.action === "link", "es") ? "es" : "en");
      let planReplyText = createSmsBookingQuoteMissingQuestion(advanced, update.action, missingQuestionLanguage) ?? base;
      if (update.action === "link" && advanced.input && advanced.preview?.success) {
        const input = normalizeInput(advanced.input);
        if (!representedInput || canonicalJson(input) !== canonicalJson(representedInput)
          || input.customerPhone !== identity.customerPhone) return conflict();
        const expectedFingerprint = fingerprint(identity, state, input);
        if (!state.link || state.link.fingerprint !== expectedFingerprint) {
          const link = await createCustomerBookingLink(tx, input, { agentId: null, agentName: "Instinct · AI SMS" }, () => {});
          state = { ...state, link: { fingerprint: expectedFingerprint, ...link } };
          const saved = savedQuoteSchema.parse({ quoteId: state.quoteId, input, link: state.link });
          verifySavedQuote(saved, identity);
          quotes.push(saved);
          linkCreated = true;
        }
        const snapshot = createPublicBookingPriceSnapshot(input.pricing);
        if (advanced.preview.firstCleaningTotalCents !== snapshot.breakdown.firstCleaningTotalCents
          || advanced.preview.futureVisitTotalCents !== snapshot.breakdown.futureVisitTotalCents) return conflict();
        planReplyText = renderQuoteText(base, options.quoteTextTemplate, snapshot, state.link);
        linkIncluded = true;
      } else if (update.action === "quote" && advanced.preview?.success) {
        const snapshot = createPublicBookingPriceSnapshot(advanced.preview.priceSnapshot.input);
        if (advanced.preview.firstCleaningTotalCents !== snapshot.breakdown.firstCleaningTotalCents
          || advanced.preview.futureVisitTotalCents !== snapshot.breakdown.futureVisitTotalCents) return conflict();
        planReplyText = renderQuoteText(base, options.quoteTextTemplate, snapshot, null);
      }
      state = smsBookingQuoteStateSchema.parse(state);
      verifyState(state, identity);
      const envelope = envelopeSchema.parse({ version: 1, id, key, account: identity.account, state, quotes });
      const encoded = JSON.stringify(envelope);
      const changed = header(await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${encoded}, lastActivityAt = ${now}
        WHERE id = ${id} AND activeDedupKey = ${key} AND quickAction = ${SMS_BOOKING_QUOTE_ACTION}
          AND channel = ${SMS_BOOKING_QUOTE_CHANNEL} AND sessionId = ${identity.sessionId}`));
      if (Number(changed.affectedRows) !== 1) return conflict();
      const saved = await locked(tx, identity);
      if (!saved || saved.id !== id || canonicalJson(saved) !== canonicalJson(envelope)) return conflict();
      return { planReplyText, state: saved.state, linkCreated, linkIncluded };
    },
  };
}
