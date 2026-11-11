import { and, eq, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookingFunnelRecords, bookingPaymentProfiles, bookings, bookingSeries, cardAuthTokens, cashAppPaymentTokens, leadflowJobs, paymentAuthorizations, bookingCashAppPayments } from "../drizzle/schema";
import { assertInternalExactBinding } from "./internalExactBookingMarker";
import { decodePersistedHandoffToken, handoffConflict, handoffPrefix, matchesHandoffRequest, type HandoffKind, type HandoffScope } from "./internalBookingHandoffToken";

export type HandoffDb = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
export type HandoffTx = Parameters<Parameters<HandoffDb["transaction"]>[0]>[0];
export type HandoffTarget = { booking: typeof bookings.$inferSelect; profile: typeof bookingPaymentProfiles.$inferSelect; funnel: typeof bookingFunnelRecords.$inferSelect };
export function affectedHandoffRows(value: unknown): number { const result = value as any; return Number(result?.affectedRows ?? result?.[0]?.affectedRows ?? 0); }

export async function getHandoffTarget(db: HandoffDb | HandoffTx, bookingId: number, lock = false): Promise<HandoffTarget> {
  let query = db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const [booking] = await (lock ? query.for("update") : query);
  if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Internal booking not found." });
  let profiles = db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
  const [profile] = await (lock ? profiles.for("update") : profiles);
  let funnels = db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.bookingId, bookingId)).limit(1);
  const [funnel] = await (lock ? funnels.for("update") : funnels);
  assertInternalExactBinding(booking, profile, funnel);
  if (!profile || !funnel || funnel.stage !== "booked" || !["needs_attention", "confirmed", "completed"].includes(booking.status)) handoffConflict("Only the verified already-booked internal record can receive this handoff.");
  const seriesQuery = db.select().from(bookingSeries).where(eq(bookingSeries.bookingId, bookingId)).limit(1);
  const [series] = await (lock ? seriesQuery.for("update") : seriesQuery);
  if (booking.recurrence === "one-time" ? !!series : !series || series.frequency !== booking.recurrence || series.firstCleaningTotalCents !== booking.firstCleaningTotalCents || series.anchorLocalDate !== booking.requestedLocalDate || series.anchorLocalTime !== booking.requestedLocalTime || series.timeZone !== booking.requestedTimeZone) handoffConflict();
  if (!Number.isSafeInteger(booking.firstCleaningTotalCents) || booking.firstCleaningTotalCents < 0) handoffConflict();
  return { booking, profile, funnel };
}
export const targetHandoffScope = ({ booking, profile }: HandoffTarget): HandoffScope => ({ bookingId: booking.id, profileId: profile.id, version: profile.version, date: booking.requestedLocalDate });

export async function lookupHandoffToken(db: HandoffDb | HandoffTx, kind: HandoffKind, token: string, lock = false) {
  if (kind === "card") {
    const query = db.select().from(cardAuthTokens).where(eq(cardAuthTokens.token, token)).limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.token !== token) handoffConflict("Invalid payment link.");
    return { kind, row, scope: decodePersistedHandoffToken(token, row.token, kind) } as const;
  }
  const query = db.select().from(cashAppPaymentTokens).where(eq(cashAppPaymentTokens.token, token)).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row || row.token !== token) handoffConflict("Invalid payment link.");
  return { kind, row, scope: decodePersistedHandoffToken(token, row.token, kind) } as const;
}
export type HandoffCapability = Awaited<ReturnType<typeof lookupHandoffToken>>;
export function assertHandoffCapability(cap: HandoffCapability, target: HandoffTarget, options: { allowExpired?: boolean; allowUsed?: boolean; allowUsedPreviousVersion?: boolean } = {}) {
  const { booking, profile } = target;
  const used = cap.kind === "card" ? !!cap.row.used : cap.row.status === "paid" || cap.row.status === "cancelled";
  if (cap.scope.bookingId !== booking.id || cap.scope.profileId !== profile.id || cap.scope.date !== booking.requestedLocalDate || (cap.scope.version !== profile.version && !(used && options.allowUsedPreviousVersion && profile.version === cap.scope.version + 1)) || cap.row.customerPhone !== booking.customerPhone || cap.row.customerName !== booking.customerName) handoffConflict("The booking, customer or payment version changed. Review the link.");
  if (cap.kind === "card" ? cap.row.jobDate !== booking.requestedLocalDate || cap.row.jobAddress !== booking.address : cap.row.amountCents !== booking.firstCleaningTotalCents) handoffConflict();
  if (!options.allowExpired && cap.row.expiresAt <= Date.now()) throw new TRPCError({ code: "FORBIDDEN", message: "This link has expired. Review the existing payment before creating another link." });
  if (!options.allowUsed && used) handoffConflict("This payment link has already been completed or closed.");
}
export async function validateHandoffToken(db: HandoffDb, kind: HandoffKind, token: string, options: Parameters<typeof assertHandoffCapability>[2] = {}) {
  // Lookup and byte equality precede decoding or any decoded-ID lookup.
  const cap = await lookupHandoffToken(db, kind, token);
  const target = await getHandoffTarget(db, cap.scope.bookingId);
  assertHandoffCapability(cap, target, options);
  return { cap, target };
}
/** Only persisted exact-scope candidates can reproduce a caller's reviewed UUID.
 * This includes older versions after setup/completion; stale retries fail closed.
 * No request UUID is stored in a presentation, provider or unrelated column. */
export async function findHandoffRequestReplay(db: HandoffDb | HandoffTx, kind: HandoffKind, target: HandoffTarget, requestId: string) {
  const table = kind === "card" ? cardAuthTokens : cashAppPaymentTokens;
  const rows = await db.select({ token: table.token }).from(table).where(and(eq(table.customerPhone, target.booking.customerPhone), like(table.token, `${handoffPrefix(kind)}%`))).limit(1001);
  if (rows.length > 1000) handoffConflict("Payment-link history requires manual review.");
  for (const row of rows) {
    let scope: HandoffScope;
    try { scope = decodePersistedHandoffToken(row.token, row.token, kind); } catch { continue; }
    if (scope.bookingId === target.booking.id && scope.profileId === target.profile.id && scope.date === target.booking.requestedLocalDate && matchesHandoffRequest(row.token, kind, scope, requestId)) return row.token;
  }
  return null;
}

async function assertNoOptionalCollectionClaims(tx: HandoffTx, key: string) {
  // Preview may not have invoice storage. Check only the two optional tables in
  // this database (the migration runner's information_schema pattern), never
  // treat a query failure or malformed result as proof of absence. No cache:
  // installed owners must be observed on every collection transaction.
  const names = ["payable_invoice_lines", "payable_invoice_manual_payments"];
  const [tables] = await tx.execute(sql`SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${names[0]}, ${names[1]}) LIMIT 3`);
  if (!Array.isArray(tables) || tables.length > 2) handoffConflict("Collection storage could not be verified.");
  const installed = tables.map(row => (row as { tableName?: unknown }).tableName);
  if (installed.some(name => typeof name !== "string" || !names.includes(name)) || new Set(installed).size !== installed.length) handoffConflict("Collection storage could not be verified.");
  if (installed.includes(names[0])) {
    const [claims] = await tx.execute(sql`SELECT id, invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ${key} LIMIT 1 FOR UPDATE`);
    if (!Array.isArray(claims)) handoffConflict("Collection ownership could not be verified.");
    if (claims.length) handoffConflict("This first cleaning already belongs to an invoice. Review that owner instead.");
  }
  if (installed.includes(names[1])) {
    const [manual] = await tx.execute(sql`SELECT occurrenceKey FROM payable_invoice_manual_payments WHERE occurrenceKey = ${key} LIMIT 1 FOR UPDATE`);
    if (!Array.isArray(manual)) handoffConflict("Collection ownership could not be verified.");
    if (manual.length) handoffConflict("This first cleaning already belongs to a staff-recorded payment. Review that owner instead.");
  }
}

export async function assertUnclaimedHandoffVisit(tx: HandoffTx, target: HandoffTarget, ownCashToken?: string) {
  // getHandoffTarget(lock=true) already holds the SAME native booking row as
  // native collectors. Retain their exact first-visit occurrence identity and
  // CURRENT claim reads, without importing an invoice-specific card guard.
  const key = `booking:${target.booking.id}:first:${target.booking.requestedLocalDate}`;
  await assertNoOptionalCollectionClaims(tx, key);
  const authorizations = await tx.select().from(paymentAuthorizations).where(eq(paymentAuthorizations.bookingPaymentProfileId, target.profile.id)).for("update");
  if (authorizations.some(row => row.capturedAt != null || ["captured", "authorized", "pending_card"].includes(row.status) || (row.stripePaymentIntentId && !["cancelled", "canceled"].includes(row.status)))) handoffConflict("An existing card hold or unresolved charge owns this cleaning.");
  const payments = await tx.select().from(bookingCashAppPayments).where(eq(bookingCashAppPayments.bookingId, target.booking.id)).for("update");
  const ownKey = ownCashToken ? `leadflow:internal-handoff:cash:${ownCashToken}` : null;
  if (payments.some(row => row.idempotencyKey !== ownKey && (row.status !== "cancelled" || row.paidAt != null))) handoffConflict("An existing Cash App attempt owns this cleaning.");
  const { profile, booking } = target;
  if ([profile.paymentStatus, booking.paymentStatus].some(status => ["captured", "paid", "authorized", "authorization_pending", "capture_pending", "action_required"].includes(status)) || profile.capturedAt != null || profile.authorizedAt != null) handoffConflict("Payment or a pending hold is already recorded. Review it before collecting again.");
  if (profile.stripePaymentIntentId && !payments.some(row => row.idempotencyKey === ownKey && row.stripePaymentIntentId === profile.stripePaymentIntentId)) handoffConflict("An unresolved payment intent needs review.");
}

/** Cash never infers a reusable card from captured. Only card proof changes jobs. */
export async function updateHandoffPaymentOnly(tx: HandoffTx, target: HandoffTarget, paymentStatus: string, card?: { brand: string; last4: string }) {
  await tx.update(bookings).set({ paymentStatus, updatedAt: new Date() }).where(eq(bookings.id, target.booking.id));
  if (card) await tx.update(leadflowJobs).set({ hasStripeCard: 1, paymentBrand: card.brand, paymentLast4: card.last4, updatedAt: new Date() }).where(eq(leadflowJobs.bookingId, target.booking.id));
}
