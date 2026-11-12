import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { agents, cardAuthTokens, cashAppPaymentTokens } from "../drizzle/schema";
import { agentProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { formatBookingArrivalPreference, bookingArrivalPreferenceSchema } from "../shared/bookingArrival";
import { assertHandoffCapability, assertUnclaimedHandoffVisit, findHandoffRequestReplay, getHandoffTarget, lookupHandoffToken, targetHandoffScope, validateHandoffToken, type HandoffDb } from "./internalBookingHandoffContext";
import { handoffConflict, issueHandoffToken } from "./internalBookingHandoffToken";
import type { SendSmsParams, SendSmsResult } from "./openphone";

const bookingInput = z.object({ bookingId: z.number().int().positive() }).strict();
const methodSchema = z.enum(["apple_pay", "cashapp", "card"]);
export const handoffCreateInput = bookingInput.extend({ method: methodSchema, requestId: z.string().uuid(), expectedAmountCents: z.number().int().min(0).max(10_000_000), confirmed: z.literal(true) }).strict();
export const handoffSendInput = bookingInput.extend({ method: methodSchema, token: z.string().min(1).max(256), message: z.string().trim().min(1).max(1600), confirmed: z.literal(true) }).strict();
const TTL = 7 * 24 * 60 * 60 * 1000;
// Verbatim existing concierge/Command Chat card-link text; no AI generation or
// legacy customer lookup. The parity test keeps this literal in sync with it.
const PAYMENT_LINK_SMS_TEMPLATE = `Hi {first_name}! 👋
Everything's all set for your service, we just need a card on file before the day of service via our secure Stripe link (Keeps things super simple and it's so our crew doesn't have to travel around the DC area with loads of cash): {link}

🔒 100% secure – no one on our team sees your card info
✅ Pre-auth only – you're NOT charged until after service.
💳 Your card is not saved on our servers and is processed by Stripe.

Reply if you have any questions! Look forward to seeing you soon and it has been lovely chatting with you.  🧹✨`;
export function buildExistingCardLinkSms(firstName: string, linkUrl: string) {
  return PAYMENT_LINK_SMS_TEMPLATE.replace("{first_name}", firstName).replace("{link}", linkUrl);
}
function handoffOrigin() {
  // The native /pay route belongs to this app, not ENV.quoteAppUrl.
  const domain = ENV.isPreviewMode ? process.env.RAILWAY_PUBLIC_DOMAIN : undefined;
  const value = domain ? `https://${domain}` : "https://quote.maidinblack.com";
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The secure card-link URL is not configured correctly." }); }
  if (parsed.origin !== value || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The secure card-link URL is not configured correctly." });
  return value;
}
const handoffUrl = (method: z.infer<typeof methodSchema>, token: string) => `${handoffOrigin()}/${method === "cashapp" ? "cashapp-pay" : "pay"}/${token}${method === "apple_pay" ? "?wallet=apple_pay" : ""}`;
async function requireDb() { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." }); return db; }
async function requireActiveHandoffAgent(agentId: number) {
  const db = await requireDb();
  const [agent] = await db.select({ id: agents.id, isActive: agents.isActive }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || agent.isActive !== 1) throw new TRPCError({ code: "UNAUTHORIZED", message: "An active staff session is required." });
  return db;
}
export async function getInternalHandoffOverview(db: HandoffDb, bookingId: number) {
  const { booking, profile } = await getHandoffTarget(db, bookingId);
  const snapshot = booking.priceSnapshot as { input?: { arrivalPreference?: unknown } };
  const arrival = bookingArrivalPreferenceSchema.safeParse(snapshot.input?.arrivalPreference);
  if (!arrival.success) handoffConflict("The saved arrival window could not be verified.");
  return { bookingId: booking.id, publicBookingNumber: booking.publicBookingNumber, customerName: booking.customerName, customerPhone: booking.customerPhone, customerEmail: booking.customerEmail || null, address: booking.address, requestedLocalDate: booking.requestedLocalDate, arrivalLabel: formatBookingArrivalPreference(arrival.data), serviceName: booking.serviceName, firstCleaningTotalCents: booking.firstCleaningTotalCents, paymentStatus: profile.paymentStatus, cardLabel: profile.stripePaymentMethodId && profile.cardLast4 ? `${profile.cardBrand ?? "Card"} ending ${profile.cardLast4}` : null };
}
export async function createInternalHandoffLink(db: HandoffDb, input: z.infer<typeof handoffCreateInput>) {
  const initial = await getHandoffTarget(db, input.bookingId);
  if (initial.booking.firstCleaningTotalCents !== input.expectedAmountCents) handoffConflict("The first-cleaning amount changed. Refresh and review the saved booking.");
  // Wallet is presentation only: both card choices authorize the same SetupIntent.
  const kind = input.method === "cashapp" ? "cashapp" : "card";
  const link = await db.transaction(async tx => {
      const target = await getHandoffTarget(tx, input.bookingId, true);
      if (target.booking.firstCleaningTotalCents !== input.expectedAmountCents) handoffConflict();
      const replay = await findHandoffRequestReplay(tx, kind, target, input.requestId);
      if (replay) {
        const cap = await lookupHandoffToken(tx, kind, replay);
        assertHandoffCapability(cap, target); // stale/used UUID replay never mints a new link
        return { token: replay, url: handoffUrl(input.method, replay), expiresAt: new Date(cap.row.expiresAt).toISOString(), amountCents: target.booking.firstCleaningTotalCents };
      }
      if (kind === "card") {
        if (target.profile.stripePaymentMethodId || target.profile.stripeSetupIntentId || [target.profile.paymentStatus, target.booking.paymentStatus].some(status => ["charge_pending", "authorization_pending", "capture_pending", "action_required"].includes(status))) handoffConflict("The current card or payment entry needs review before issuing another card link.");
      } else {
        if (target.booking.firstCleaningTotalCents < 50) handoffConflict("Cash App requires a verified first-cleaning amount of at least $0.50.");
        await assertUnclaimedHandoffVisit(tx, target);
        if (target.profile.paymentStatus === "charge_pending" || target.profile.paymentStatus === "setup_pending" || (target.profile.stripeSetupIntentId && !target.profile.stripePaymentMethodId)) handoffConflict("An existing payment or card entry needs review first.");
      }
      const token = issueHandoffToken(kind, targetHandoffScope(target), input.requestId);
      const expiresAt = Date.now() + TTL;
      if (kind === "card") await tx.insert(cardAuthTokens).values({ token, customerName: target.booking.customerName, customerPhone: target.booking.customerPhone, jobDate: target.booking.requestedLocalDate, jobAddress: target.booking.address, used: 0, expiresAt });
      else await tx.insert(cashAppPaymentTokens).values({ token, customerName: target.booking.customerName, customerPhone: target.booking.customerPhone, amountCents: target.booking.firstCleaningTotalCents, description: `Maids in Black first cleaning ${target.booking.publicBookingNumber}`.slice(0, 255), status: "open", expiresAt });
      return { token, url: handoffUrl(input.method, token), expiresAt: new Date(expiresAt).toISOString(), amountCents: target.booking.firstCleaningTotalCents };
  });
  const current = await getHandoffTarget(db, input.bookingId);
  if (current.booking.customerPhone !== initial.booking.customerPhone || current.booking.customerName !== initial.booking.customerName || current.booking.firstCleaningTotalCents !== link.amountCents) handoffConflict();
  const purpose = input.method === "card" ? "save a card securely (no charge through this link)" : input.method === "cashapp" ? "pay for your first cleaning with Cash App" : "save a card securely with Apple Pay (no charge through this link; requires a compatible device)";
  const message = input.method === "cashapp"
    ? `Hi ${current.booking.customerName}, Maids in Black booking ${current.booking.publicBookingNumber}: please ${purpose}: ${link.url}`
    : buildExistingCardLinkSms(current.booking.customerName.split(" ")[0], link.url);
  return { bookingId: input.bookingId, method: input.method, ...link, customerName: current.booking.customerName, customerPhone: current.booking.customerPhone, message };
}
export function assertReviewedHandoffMessage(message: string, knownUrl: string) {
  if (!message.trim() || message.length > 1600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) handoffConflict("Review a message of 1–1600 characters.");
  // Every URL/domain-like item must be exactly the validated server-returned URL;
  // reject shortened, scheme-less, alternate-origin and extra capability links.
  const urls = message.match(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi) ?? [];
  if (!urls.length || urls.some(value => value !== knownUrl)) handoffConflict("The reviewed message must include only the exact generated payment URL, with no other links.");
}
export async function submitReviewedHandoffSms(to: string, content: string, send: (input: SendSmsParams) => Promise<SendSmsResult>, fromNumberId = ENV.openPhoneCsNumberId) {
  const digits = to.replace(/[^\d]/g, "");
  const recipient = /^\+[1-9]\d{7,14}$/.test(to) ? to : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  if (!recipient) handoffConflict("The saved booking recipient phone needs review.");
  const warning = "SMS acceptance could not be confirmed. Check the customer-service inbox before manually retrying: another send may produce a duplicate SMS, not a second payment.";
  try {
    const result = await send({ to: recipient, content, fromNumberId });
    return result.success === true ? { success: true, submitted: true, delivered: false as const, message: "The SMS provider accepted this message. Delivery is not yet confirmed." } : { success: false, submitted: false, delivered: false as const, message: warning };
  } catch { return { success: false, submitted: false, delivered: false as const, message: warning }; }
}
export async function sendInternalHandoffLink(db: HandoffDb, input: z.infer<typeof handoffSendInput>) {
  const target = await getHandoffTarget(db, input.bookingId);
  const kind = input.method === "cashapp" ? "cashapp" : "card";
  const verified = await validateHandoffToken(db, kind, input.token);
  if (verified.target.booking.id !== input.bookingId) handoffConflict();
  if (kind === "cashapp") await db.transaction(async tx => {
      const locked = await getHandoffTarget(tx, input.bookingId, true);
      const cap = await lookupHandoffToken(tx, "cashapp", input.token, true);
      assertHandoffCapability(cap, locked);
      await assertUnclaimedHandoffVisit(tx, locked, input.token);
      if (locked.profile.paymentStatus === "charge_pending" && (cap.kind !== "cashapp" || cap.row.status !== "payment_started")) handoffConflict();
  });
  const knownUrl = handoffUrl(input.method, input.token);
  assertReviewedHandoffMessage(input.message, knownUrl);
  const current = await getHandoffTarget(db, input.bookingId);
  if (current.booking.customerPhone !== target.booking.customerPhone || current.booking.customerName !== target.booking.customerName || current.profile.id !== target.profile.id || current.profile.version !== target.profile.version || current.booking.requestedLocalDate !== target.booking.requestedLocalDate || current.booking.firstCleaningTotalCents !== target.booking.firstCleaningTotalCents) handoffConflict();
  const { sendSms } = await import("./openphone");
  return submitReviewedHandoffSms(current.booking.customerPhone, input.message, sendSms);
}
export const internalBookingHandoffRouter = router({
  overview: agentProcedure.input(bookingInput).query(async ({ input, ctx }) => getInternalHandoffOverview(await requireActiveHandoffAgent(ctx.agent.agentId), input.bookingId)),
  create: agentProcedure.input(handoffCreateInput).mutation(async ({ input, ctx }) => createInternalHandoffLink(await requireActiveHandoffAgent(ctx.agent.agentId), input)),
  send: agentProcedure.input(handoffSendInput).mutation(async ({ input, ctx }) => sendInternalHandoffLink(await requireActiveHandoffAgent(ctx.agent.agentId), input)),
});
