import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InvoiceError, invoiceDate, invoiceBalance, invoiceIssueSchema, invoicePeriodSchema, safeSum, selectedBalance, type InvoiceAttempt, type InvoiceClient, type InvoiceService, type PayableInvoice } from "../shared/payableInvoice";
import type { InvoiceIssueInput, InvoiceRepository } from "./payableInvoiceService";
import { extractUSDigits, normalizePhone } from "./utils/phone";
import { invoiceReviewHash } from "./payableInvoiceReview";
import { invoiceOccurrence, observedCollectionReason, PRIOR_PAYMENT_REVIEW_REASON, validServiceStatus } from "./payableInvoiceCollectionPolicy";

/** Existing accounts and stable owned visit IDs are the only source identities.
 * Native first-date projections alias only when a single verified projection exists.
 * Invoice-line occurrence uniqueness is the durable new-invoice collection claim.
 * Native booking locks coordinate with collectors using the same booking lock/claim.
 * External/manual payments without an exact source binding require human review,
 * not fabricated unpaid status. No source writes or provider calls occur here.
 */
type SqlClient = Pool | PoolConnection;
type Row = RowDataPacket & Record<string, unknown>;
const MAX_ROWS = 1000;
const INVOICE_COLUMNS = "id, number, accountId, clientName, clientPhone, clientEmail, periodFrom, periodTo, dueDate, currency, status, activeAttemptId, requestId, payloadHash, reviewHash, tokenHash, tokenExpiresAt";
const ATTEMPT_COLUMNS = "id, invoiceId, requestId, selectedLineIds, amountCents, currency, state, sessionId, sessionUrl, paymentId, createdAtMs, paidAtMs, refundedCents";
const normalizedEmail = (value: unknown): string => typeof value === "string" ? value.trim().toLowerCase() : "";
const fail = (code: string, message: string, status = 409): never => { throw new InvoiceError(code, status, message); };
function integer(value: unknown): number {
  if (value == null || (typeof value !== "number" && typeof value !== "string") || value === "") return fail("CORRUPT_SNAPSHOT", "Invoice storage needs review.");
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) return fail("CORRUPT_SNAPSHOT", "Invoice storage needs review.");
  return n;
}
function text(value: unknown): string { return value == null ? "" : String(value); }
function idsJson(value: unknown): number[] {
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { return fail("CORRUPT_SNAPSHOT", "Payment selection needs review."); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_ROWS || parsed.some(v => typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) || new Set(parsed).size !== parsed.length) return fail("CORRUPT_SNAPSHOT", "Payment selection needs review.");
  return parsed as number[];
}
function canonicalIds(ids: number[]): number[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ROWS || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) return fail("INVALID_SELECTION", "Select each service only once.", 400);
  return ids.slice().sort((a, b) => a - b);
}
function uuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail("INVALID_REQUEST", "A valid request UUID is required.", 400);
}
async function rows(db: SqlClient, sql: string, values: (string | number | null)[] = []): Promise<Row[]> {
  const [result] = await db.execute<RowDataPacket[]>(sql, values);
  return result as Row[];
}
async function change(db: SqlClient, sql: string, values: (string | number | null)[]): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, values);
  return result;
}
function bounded<T>(result: T[]): T[] {
  if (result.length > MAX_ROWS) fail("PERIOD_TOO_LARGE", "More than 1,000 records require review. Use a smaller service period.");
  return result;
}
function clientFrom(row: Row): InvoiceClient {
  const phone = normalizePhone(text(row.customerPhone));
  if (!phone || integer(row.id) <= 0) return fail("CLIENT_IDENTITY_MISMATCH", "Customer identity needs review.");
  return { id: integer(row.id), name: text(row.customerName), phone, email: normalizedEmail(row.customerEmail) || null };
}
function attemptFrom(row: Row): InvoiceAttempt {
  if (!["pending", "session_open", "paid", "expired"].includes(text(row.state)) || row.currency !== "usd") return fail("CORRUPT_SNAPSHOT", "Payment storage needs review.");
  const amountCents = integer(row.amountCents);
  if (amountCents < 50 || (row.state === "paid" && (!row.paymentId || !row.sessionId || row.paidAtMs == null))) return fail("CORRUPT_SNAPSHOT", "Payment storage needs review.");
  safeSum([amountCents]);
  return { id: text(row.id), invoiceId: integer(row.invoiceId), requestId: text(row.requestId), lineIds: idsJson(row.selectedLineIds), amountCents, currency: "usd", state: row.state as InvoiceAttempt["state"], sessionId: row.sessionId == null ? null : text(row.sessionId), sessionUrl: row.sessionUrl == null ? null : text(row.sessionUrl), createdAt: integer(row.createdAtMs) };
}

export class MysqlInvoiceRepository implements InvoiceRepository {
  constructor(private readonly pool: () => Promise<Pool>) {}

  private async transaction<T>(fn: (tx: PoolConnection) => Promise<T>): Promise<T> {
    const tx = await (await this.pool()).getConnection();
    try { await tx.beginTransaction(); const result = await fn(tx); await tx.commit(); return result; }
    catch (error) { await tx.rollback(); throw error; }
    finally { tx.release(); }
  }

  async lookup(phoneInput: string, emailInput: string, from: string, to: string) {
    const phone = normalizePhone(phoneInput);
    const email = normalizedEmail(emailInput);
    if (!phone || !email) return fail("INVALID_CUSTOMER", "An exact valid US phone and email are required.", 400);
    const db = await this.pool();
    const accounts = await rows(db, "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE customerPhone = ? LIMIT 2", [phone]);
    if (accounts.length !== 1) return fail("CLIENT_NOT_FOUND", accounts.length === 0 ? "No existing customer account matches this phone. An account must already exist before invoice lookup." : "Multiple customer accounts match this phone; identity needs review.", 404);
    const client = clientFrom(accounts[0]);
    if (client.phone !== phone || client.email !== email) return fail("CLIENT_IDENTITY_MISMATCH", "The exact email and phone do not identify the same customer.");
    const emailAccounts = await rows(db, "SELECT id, customerEmail FROM customer_portal_accounts WHERE customerEmail = ? LIMIT 2", [email]);
    if (emailAccounts.some(row => normalizedEmail(row.customerEmail) !== email || integer(row.id) !== client.id)) return fail("CLIENT_IDENTITY_MISMATCH", "This email is shared or ambiguously matched across customer accounts and needs review.");
    return { client, services: await this.readServices(db, client, from, to) };
  }

  async services(clientId: number, from: string, to: string) {
    const db = await this.pool();
    const accounts = await rows(db, "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1", [clientId]);
    if (accounts.length !== 1) return fail("CLIENT_NOT_FOUND", "Customer account unavailable.", 404);
    const client = clientFrom(accounts[0]);
    if (!client.email) return fail("CLIENT_IDENTITY_MISMATCH", "Customer email must be reviewed before billing.");
    const conflicts = await rows(db, "SELECT id, customerEmail FROM customer_portal_accounts WHERE customerEmail = ? LIMIT 2", [client.email]);
    if (conflicts.some(row => normalizedEmail(row.customerEmail) !== client.email || integer(row.id) !== client.id)) return fail("CLIENT_IDENTITY_MISMATCH", "Customer email is shared or ambiguously matched across accounts.");
    return { client, services: await this.readServices(db, client, from, to) };
  }

  private async readServices(db: SqlClient, client: InvoiceClient, from: string, to: string, current = false): Promise<InvoiceService[]> {
    if (!invoicePeriodSchema.safeParse({ from, to }).success) return fail("INVALID_PERIOD", "Choose a valid service period.", 400);
    const local = extractUSDigits(client.phone);
    if (!local) return fail("CLIENT_IDENTITY_MISMATCH", "Customer phone needs review.");
    // Exact full US digit strings, never suffix matching. Date index bounds the
    // imported-job scan. Retain all real source rows; never silently truncate visits.
    const loadJobs = () => rows(db, `SELECT j.id, j.bookingId, j.jobDate, j.customerPhone, j.customerEmail,
      j.serviceName, j.jobAddress, j.jobTotalCents, j.bookingStatus, j.missingFromLaunch27At,
      b.id AS nativeId, b.requestedLocalDate AS nativeDate, b.customerPhone AS nativePhone,
      b.customerEmail AS nativeEmail, b.status AS nativeStatus, b.firstCleaningTotalCents AS nativeAmount,
      (SELECT COUNT(*) FROM leadflow_jobs c WHERE c.jobDate = b.requestedLocalDate AND c.bookingId = b.id) AS firstProjectionCount,
      (SELECT MIN(p.id) FROM leadflow_jobs p FORCE INDEX (idx_leadflow_jobs_job_date)
        WHERE p.jobDate = b.requestedLocalDate AND p.bookingId = b.id) AS firstProjectionId
      FROM leadflow_jobs j FORCE INDEX (idx_leadflow_jobs_job_date)
      LEFT JOIN bookings b ON b.id = j.bookingId
      WHERE j.jobDate >= ? AND j.jobDate <= ?
        AND REGEXP_REPLACE(j.customerPhone, '[^0-9]', '') IN (?, ?)
      ORDER BY j.id LIMIT 1001${current ? " FOR UPDATE" : ""}`, [from, to, local, `1${local}`]);
    const loadBookings = () => rows(db, `SELECT b.id, b.requestedLocalDate, b.customerPhone, b.customerEmail,
      b.serviceName, b.address, b.firstCleaningTotalCents, b.status,
      (SELECT COUNT(*) FROM leadflow_jobs c WHERE c.jobDate = b.requestedLocalDate AND c.bookingId = b.id) AS firstProjectionCount,
      p.id AS firstProjectionId, p.jobTotalCents AS projectionAmount, p.customerPhone AS projectionPhone,
      p.customerEmail AS projectionEmail, p.bookingStatus AS projectionStatus,
      p.missingFromLaunch27At AS projectionMissing
      FROM bookings b FORCE INDEX (idx_bookings_customer_phone)
      LEFT JOIN leadflow_jobs p ON p.bookingId = b.id AND p.jobDate = b.requestedLocalDate
      WHERE b.customerPhone = ? AND b.requestedLocalDate >= ? AND b.requestedLocalDate <= ?
        AND (p.id IS NULL OR p.id = (SELECT MIN(j.id) FROM leadflow_jobs j FORCE INDEX (idx_leadflow_jobs_job_date)
          WHERE j.jobDate = b.requestedLocalDate AND j.bookingId = b.id))
      ORDER BY b.id LIMIT 1001${current ? " FOR UPDATE" : ""}`, [client.phone, from, to]);
    // Issue locks native rows in stable primary-key order BEFORE locking jobs or
    // reading profile/hold state, matching the cross-collector booking lock.
    let jobs: Row[], bookings: Row[];
    if (current) { bookings = bounded(await loadBookings()); jobs = bounded(await loadJobs()); }
    else { jobs = bounded(await loadJobs()); bookings = bounded(await loadBookings()); }
    const matches = (phone: unknown, email: unknown) => normalizePhone(text(phone)) === client.phone && (!normalizedEmail(email) || normalizedEmail(email) === client.email);
    const blockedStatus = (status: unknown) => !validServiceStatus(status);
    const result: InvoiceService[] = [];
    const seen = new Set<string>();
    const append = (id: string, occurrenceKey: string, date: string, description: string, address: string, amountRaw: unknown, status: string, identityOK: boolean, unavailable: boolean, ambiguity: boolean = false) => {
      const amount = amountRaw == null || amountRaw === "" ? NaN : Number(amountRaw);
      const amountOK = invoiceDate.safeParse(date).success && Number.isSafeInteger(amount) && amount > 0 && amount <= 99_999_999;
      const eligible = identityOK && !unavailable && !ambiguity && amountOK;
      if (seen.has(occurrenceKey)) return fail("AMBIGUOUS_SERVICE", "Multiple source rows claim the same service identity.");
      seen.add(occurrenceKey);
      result.push({ id, occurrenceKey, date, description, address, paidCents: 0, paymentSource: null, amountCents: amountOK ? amount : 0, status, eligible,
        reason: ambiguity ? "Multiple or conflicting native first-service projections require review." : !identityOK ? "Customer email/phone conflict: review required." : unavailable ? "Cancelled, unavailable, or missing source visit." : !amountOK ? "A positive verified service amount is required." : PRIOR_PAYMENT_REVIEW_REASON });
    };
    // Native row is the canonical first-visit snapshot, even without a projection.
    for (const b of bookings) {
      const key = `booking:${integer(b.id)}:first:${text(b.requestedLocalDate)}`;
      const projection = b.firstProjectionId != null;
      append(key, key, text(b.requestedLocalDate), text(b.serviceName), text(b.address), b.firstCleaningTotalCents, text(b.status), matches(b.customerPhone, b.customerEmail) && (!projection || matches(b.projectionPhone, b.projectionEmail)), blockedStatus(b.status) || (projection && (blockedStatus(b.projectionStatus) || b.projectionMissing != null)), Number(b.firstProjectionCount) > 1 || (projection && Number(b.projectionAmount) !== Number(b.firstCleaningTotalCents)));
    }
    for (const j of jobs) {
      const first = j.nativeId != null && j.jobDate === j.nativeDate && j.firstProjectionId != null && integer(j.id) === integer(j.firstProjectionId);
      if (first && Number(j.firstProjectionCount) === 1 && Number(j.jobTotalCents) === Number(j.nativeAmount) && matches(j.customerPhone, j.customerEmail) && matches(j.nativePhone, j.nativeEmail) && validServiceStatus(j.bookingStatus) && j.missingFromLaunch27At == null && result.some(s => s.occurrenceKey === `booking:${integer(j.nativeId)}:first:${text(j.jobDate)}`)) continue;
      const key = `job:${integer(j.id)}`;
      // A dangling explicit booking association cannot prove account ownership.
      const linked = j.bookingId != null;
      const identityOK = matches(j.customerPhone, j.customerEmail) && (!linked || (j.nativeId != null && matches(j.nativePhone, j.nativeEmail)));
      append(key.startsWith("booking:") ? key : `job:${integer(j.id)}`, key, text(j.jobDate), text(j.serviceName), text(j.jobAddress), j.jobTotalCents, text(j.bookingStatus), identityOK, blockedStatus(j.bookingStatus) || j.missingFromLaunch27At != null || (linked && blockedStatus(j.nativeStatus)), j.nativeId != null && j.jobDate === j.nativeDate && (Number(j.firstProjectionCount) > 1 || Number(j.jobTotalCents) !== Number(j.nativeAmount)));
    }
    const nativeReasons = new Map<number, string | null>();
    for (const b of bookings) nativeReasons.set(integer(b.id), await this.nativeCollectionReason(db, integer(b.id), current));
    for (const service of result) {
      const source = invoiceOccurrence(service.occurrenceKey);
      const job = source.kind === "job" ? jobs.find(j => integer(j.id) === source.id) : null;
      // Native profile payments cover its first service, not unrelated later visits.
      const nativeId = source.kind === "booking" ? source.id : job?.nativeId != null && job.jobDate === job.nativeDate ? integer(job.nativeId) : null;
      if (nativeId != null) {
        if (!nativeReasons.has(nativeId)) nativeReasons.set(nativeId, await this.nativeCollectionReason(db, nativeId, current));
        const reason = nativeReasons.get(nativeId);
        if (reason) { service.eligible = false; service.reason = reason; if (reason.startsWith("A captured")) { service.paidCents = service.amountCents; service.paymentSource = "stripe"; } }
      }
    }
    for (const service of result) {
      const manual = await rows(db, `SELECT occurrenceKey, sourceServiceId, accountId, serviceDate, amountCents, requestId, payloadHash, reviewHash, recordedByAgentId, recordedAtMs FROM payable_invoice_manual_payments WHERE occurrenceKey = ?${current ? " FOR UPDATE" : ""}`, [service.occurrenceKey]);
      if (manual.length) {
        const mark = manual[0];
        if (manual.length !== 1 || integer(mark.accountId) !== client.id || mark.sourceServiceId !== service.id || mark.serviceDate !== service.date || integer(mark.amountCents) !== service.amountCents) return fail("MANUAL_PAYMENT_CONFLICT", "A recorded manual payment no longer matches the service/account snapshot.");
        service.paidCents = service.amountCents;
        service.paymentSource = "manual";
        if (service.eligible) service.reason = "Already paid — explicitly recorded by an agent before invoice creation.";
      }
    }
    for (const service of result) {
      const ownedLines = await rows(db, "SELECT l.sourceServiceId, l.serviceDate, l.amountCents, l.paidCents, l.manualPaidCents, i.accountId, i.status FROM payable_invoice_lines l INNER JOIN payable_invoices i ON i.id = l.invoiceId WHERE l.occurrenceKey = ?", [service.occurrenceKey]);
      if (ownedLines.length) {
        const line = ownedLines[0];
        if (ownedLines.length !== 1 || integer(line.accountId) !== client.id || line.sourceServiceId !== service.id || line.serviceDate !== service.date || integer(line.amountCents) !== service.amountCents) return fail("INVALID_SNAPSHOT", "An existing invoice claim conflicts with this service/account.");
        const paid = integer(line.paidCents);
        if (paid > service.amountCents) return fail("CORRUPT_SNAPSHOT", "Existing invoice payment amounts need review.");
        if (paid > 0) { service.paidCents = paid; service.paymentSource = integer(line.manualPaidCents ?? 0) === paid ? "manual" : "stripe"; }
        // The retained invoice owns this occurrence whether paid, open or void.
        const sourceEligible = service.eligible;
        service.eligible = false;
        if (sourceEligible) service.reason = line.status === "payment_review" ? "An existing invoice payment adjustment needs review." : paid === service.amountCents ? "Already paid on the existing invoice." : "This service already belongs to an existing invoice.";
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  private async nativeCollectionReason(db: SqlClient, bookingId: number, current = false): Promise<string | null> {
    const lock = current ? " FOR UPDATE" : "";
    const native = await rows(db, `SELECT id, paymentStatus FROM bookings WHERE id = ? LIMIT 1${lock}`, [bookingId]);
    if (!native[0]) return "The linked native booking no longer exists.";
    const observations = [native[0]];
    observations.push(...await rows(db, `SELECT id, bookingId, paymentStatus, stripePaymentIntentId, authorizedAt, capturedAt FROM booking_payment_profiles WHERE bookingId = ? ORDER BY id${lock}`, [bookingId]));
    observations.push(...await rows(db, `SELECT a.id, a.status, a.stripePaymentIntentId, a.authorizedAt, a.capturedAt, a.cancelledAt FROM payment_authorizations a INNER JOIN booking_payment_profiles p ON p.id = a.bookingPaymentProfileId WHERE p.bookingId = ? ORDER BY a.id${lock}`, [bookingId]));
    observations.push(...await rows(db, `SELECT id, status, stripePaymentIntentId, paidAt FROM booking_cash_app_payments WHERE bookingId = ? ORDER BY id${lock}`, [bookingId]));
    return observations.map(row => observedCollectionReason({ status: row.status, paymentStatus: row.paymentStatus, capturedAt: row.capturedAt, paidAt: row.paidAt, paymentChargedAt: row.paymentChargedAt, stripePaymentIntentId: row.stripePaymentIntentId, authorizedAt: row.authorizedAt, cancelledAt: row.cancelledAt })).find(reason => reason != null) ?? null;
  }

  private async assertClaims(db: SqlClient, services: Array<{ occurrenceKey: string }>, ownInvoiceId?: number): Promise<void> {
    for (const service of services.slice().sort((a, b) => a.occurrenceKey.localeCompare(b.occurrenceKey))) {
      invoiceOccurrence(service.occurrenceKey);
      // No gap-lock on a missing claim. The unique occurrence index serializes
      // competing insertions; existing own claims remain valid at checkout.
      const claims = await rows(db, "SELECT invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ?", [service.occurrenceKey]);
      if (claims.some(claim => integer(claim.invoiceId) !== ownInvoiceId)) return fail("SOURCE_ALREADY_INVOICED", "This service already belongs to another invoice.");
      if (ownInvoiceId != null && (claims.length !== 1 || integer(claims[0].invoiceId) !== ownInvoiceId)) return fail("INVALID_SNAPSHOT", "Invoice collection ownership needs review.");
    }
  }

  private async verifyInvoiceCollection(tx: PoolConnection, invoice: PayableInvoice, selectedIds?: number[]): Promise<void> {
    const accounts = await rows(tx, "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1 FOR UPDATE", [invoice.clientId]);
    if (accounts.length !== 1) return fail("CLIENT_NOT_FOUND", "The invoice customer account no longer exists.", 404);
    const current = await this.readServices(tx, clientFrom(accounts[0]), invoice.from, invoice.to, true);
    const unpaid = invoice.lines.filter(line => line.paidCents < line.amountCents && (!selectedIds || selectedIds.includes(line.id)));
    await this.assertClaims(tx, invoice.lines, invoice.id);
    for (const line of unpaid) {
      const fresh = current.find(s => s.occurrenceKey === line.occurrenceKey);
      if (!fresh || (!fresh.eligible && fresh.reason !== "This service already belongs to an existing invoice.") || (fresh.paidCents ?? 0) !== 0 || fresh.date !== line.date || fresh.amountCents !== line.amountCents) return fail("SERVICE_REVIEW_REQUIRED", "An invoice service changed, was paid elsewhere, or has an unresolved collection. No new payment was started.");
    }
  }

  async assertCollectionReady(selected: InvoiceService[] | PayableInvoice): Promise<void> {
    const db = await this.pool();
    if (Array.isArray(selected)) {
      if (!selected.length || selected.some(s => !s.eligible || !validServiceStatus(s.status) || !Number.isSafeInteger(s.amountCents) || s.amountCents <= 0)) return fail("SERVICE_REVIEW_REQUIRED", "Selected service identity, amount or payment state needs review.");
      await this.assertClaims(db, selected);
      for (const service of selected) {
        const source = invoiceOccurrence(service.occurrenceKey);
        if (source.kind === "booking") {
          const reason = await this.nativeCollectionReason(db, source.id);
          if (reason) return fail("PRIOR_PAYMENT_EXISTS", reason);
        }
      }
      return;
    }
    await this.transaction(async tx => {
      const found = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE`, [selected.id]);
      if (!found[0]) return fail("NOT_FOUND", "Invoice unavailable.", 404);
      const invoice = await this.invoiceView(tx, found[0]);
      if (invoice.clientId !== selected.clientId) return fail("INVALID_SNAPSHOT", "Invoice identity needs review.");
      if (invoice.status === "void" || invoice.status === "payment_review") return fail("PAYMENT_REVIEW_REQUIRED", "This invoice is not available for collection.");
      await this.verifyInvoiceCollection(tx, invoice);
    });
  }

  async adminById(id: number): Promise<PayableInvoice | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return this.transaction(async tx => {
      const found = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
      return found[0] ? this.invoiceView(tx, found[0]) : null;
    });
  }

  async adminInvoice(id: number): Promise<{ invoice: PayableInvoice; client: InvoiceClient; requestId: string }> {
    if (!Number.isSafeInteger(id) || id <= 0) return fail("NOT_FOUND", "Invoice unavailable.", 404);
    return this.transaction(async tx => {
      const found = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
      if (!found[0]) return fail("NOT_FOUND", "Invoice unavailable.", 404);
      const row = found[0];
      const client = clientFrom({ ...row, id: row.accountId, customerName: row.clientName, customerPhone: row.clientPhone, customerEmail: row.clientEmail } as Row);
      return { invoice: await this.invoiceView(tx, row), client, requestId: text(row.requestId) };
    });
  }

  async recordAdjustment(paymentId: string, refundedCents: number): Promise<void> {
    if (!/^pi_[A-Za-z0-9_]+$/.test(paymentId) || paymentId.length > 255 || !Number.isSafeInteger(refundedCents) || refundedCents < 0) return fail("PAYMENT_IDENTITY_MISMATCH", "Refund identity or amount is invalid.");
    await this.transaction(async tx => {
      const identity = await rows(tx, "SELECT id FROM payable_invoice_attempts WHERE paymentId = ? LIMIT 1", [paymentId]);
      if (!identity[0]) return fail("NOT_FOUND", "No stored invoice payment matches this adjustment.", 404);
      const { invoiceRow, attemptRow } = await this.lockedAttempt(tx, text(identity[0].id));
      const attempt = attemptFrom(attemptRow);
      if (attempt.state !== "paid" || attemptRow.paymentId !== paymentId || refundedCents > attempt.amountCents) return fail("PAYMENT_IDENTITY_MISMATCH", "Adjustment does not match a recorded paid invoice attempt.");
      const previous = integer(attemptRow.refundedCents ?? 0);
      if (refundedCents <= previous) return; // late/replayed events never reduce evidence
      await change(tx, "UPDATE payable_invoice_attempts SET refundedCents = ? WHERE id = ? AND invoiceId = ? AND paymentId = ? AND state = 'paid' AND refundedCents < ?", [refundedCents, attempt.id, attempt.invoiceId, paymentId, refundedCents]);
      await change(tx, "UPDATE payable_invoices SET status = 'payment_review', paidAtMs = NULL WHERE id = ?", [integer(invoiceRow.id)]);
      // Permanent line claims and paid allocations are deliberately untouched.
    });
  }

  private async invoiceView(db: PoolConnection, row: Row): Promise<PayableInvoice> {
    if (row.currency !== "usd" || !["open", "partially_paid", "paid", "void", "payment_review"].includes(text(row.status))) return fail("CORRUPT_SNAPSHOT", "Invoice storage needs review.");
    const id = integer(row.id);
    // Locking reads are CURRENT reads even if lockedAttempt's identity read
    // established an older REPEATABLE READ snapshot before waiting on invoice.
    const lineRows = bounded(await rows(db, "SELECT id, occurrenceKey, serviceDate, description, address, amountCents, paidCents, manualPaidCents FROM payable_invoice_lines WHERE invoiceId = ? ORDER BY serviceDate, id LIMIT 1001 FOR UPDATE", [id]));
    const lines = lineRows.map(line => ({ id: integer(line.id), occurrenceKey: text(line.occurrenceKey), date: text(line.serviceDate), description: text(line.description), address: text(line.address), amountCents: integer(line.amountCents), paidCents: integer(line.paidCents), manualPaidCents: integer(line.manualPaidCents ?? 0) }));
    if (!lines.length || lines.some(line => line.paidCents > line.amountCents || line.manualPaidCents > line.paidCents || (line.manualPaidCents !== 0 && line.manualPaidCents !== line.amountCents) || line.amountCents === 0)) return fail("CORRUPT_SNAPSHOT", "Invoice line amounts need review.");
    safeSum(lines.map(line => line.amountCents));
    const allocations = bounded(await rows(db, "SELECT a.attemptId, a.lineId, a.paymentId, a.amountCents, a.paidAtMs, t.refundedCents FROM payable_invoice_allocations a INNER JOIN payable_invoice_attempts t ON t.id = a.attemptId AND t.invoiceId = a.invoiceId WHERE a.invoiceId = ? ORDER BY a.paidAtMs, a.attemptId, a.lineId LIMIT 1001 FOR UPDATE", [id]));
    const receipts = new Map<string, { paymentId: string; amountCents: number; paidAt: string; lineIds: number[]; refundedCents: number }>();
    const allocated = new Map<number, number>();
    for (const allocation of allocations) {
      const key = text(allocation.attemptId);
      const existing = receipts.get(key) ?? { paymentId: text(allocation.paymentId), amountCents: 0, paidAt: new Date(integer(allocation.paidAtMs)).toISOString(), lineIds: [], refundedCents: integer(allocation.refundedCents ?? 0) };
      if (existing.paymentId !== text(allocation.paymentId) || !lines.some(line => line.id === integer(allocation.lineId))) return fail("CORRUPT_SNAPSHOT", "Payment allocations need review.");
      const lineId = integer(allocation.lineId);
      if (allocated.has(lineId) || integer(allocation.amountCents) === 0) return fail("CORRUPT_SNAPSHOT", "Payment allocation needs review.");
      allocated.set(lineId, integer(allocation.amountCents));
      existing.amountCents = safeSum([existing.amountCents, integer(allocation.amountCents)]);
      existing.lineIds.push(integer(allocation.lineId));
      receipts.set(key, existing);
    }
    if (Array.from(receipts.values()).some(receipt => receipt.refundedCents > receipt.amountCents)) return fail("CORRUPT_SNAPSHOT", "Refund evidence exceeds the payment amount.");
    if (lines.some(line => line.paidCents !== line.manualPaidCents + (allocated.get(line.id) ?? 0))) return fail("CORRUPT_SNAPSHOT", "Paid line and receipt allocations disagree.");
    const balance = invoiceBalance(lines);
    const paidTotal = safeSum(lines.map(line => line.paidCents));
    if ((row.status === "paid" && balance !== 0) || (row.status === "open" && paidTotal !== 0) || (row.status === "partially_paid" && (paidTotal === 0 || balance === 0))) return fail("CORRUPT_SNAPSHOT", "Invoice status and balances disagree.");
    return { id, number: text(row.number), clientId: integer(row.accountId), clientName: text(row.clientName), from: text(row.periodFrom), to: text(row.periodTo), dueDate: text(row.dueDate), currency: "usd", status: row.status as PayableInvoice["status"], activeAttemptId: row.activeAttemptId == null ? null : text(row.activeAttemptId), lines, receipts: Array.from(receipts.values()) };
  }

  private verifyReplay(row: Row, tokenHash: string, payloadHash: string): void {
    if (row.payloadHash !== payloadHash || row.tokenHash !== tokenHash) fail("IDEMPOTENCY_CONFLICT", "This request UUID was already used for a different invoice.");
  }

  async replayIssue(input: InvoiceIssueInput, tokenHash: string): Promise<PayableInvoice | null> {
    return this.transaction(async tx => {
      const found = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE requestId = ? LIMIT 1 FOR UPDATE`, [input.requestId]);
      if (!found[0]) return null;
      const row = found[0];
      const lines = await rows(tx, "SELECT sourceServiceId FROM payable_invoice_lines WHERE invoiceId = ? ORDER BY sourceServiceId FOR UPDATE", [integer(row.id)]);
      if (row.tokenHash !== tokenHash || integer(row.accountId) !== input.clientId || row.periodFrom !== input.from || row.periodTo !== input.to || row.dueDate !== input.dueDate || row.reviewHash !== input.reviewHash || JSON.stringify(lines.map(line => text(line.sourceServiceId)).sort()) !== JSON.stringify(input.serviceIds.slice().sort())) return fail("IDEMPOTENCY_CONFLICT", "This issuance request was already saved with a different client, period or selection.");
      return this.invoiceView(tx, row);
    });
  }

  async issue(input: InvoiceIssueInput, client: InvoiceClient, services: InvoiceService[], tokenHash: string, payloadHash: string): Promise<PayableInvoice> {
    invoiceIssueSchema.parse(input);
    if (client.id !== input.clientId || normalizePhone(client.phone) !== client.phone || !client.email || services.length !== input.serviceIds.length || new Set(input.serviceIds).size !== input.serviceIds.length || new Set(services.map(s => s.id)).size !== services.length || new Set(services.map(s => s.occurrenceKey)).size !== services.length || services.some(s => !s.eligible || !input.serviceIds.includes(s.id) || s.date < input.from || s.date > input.to)) return fail("INVALID_SNAPSHOT", "Selected service ownership and amounts need review.");
    const expectedHash = createHash("sha256").update(JSON.stringify({ clientId: input.clientId, from: input.from, to: input.to, dueDate: input.dueDate, services: services.slice().sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.occurrenceKey, s.date, s.amountCents, s.paidCents ?? 0]) })).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(tokenHash) || payloadHash !== expectedHash || safeSum(services.map(s => s.amountCents)) < 50) return fail("INVALID_SNAPSHOT", "Invoice snapshot is invalid.");
    try {
      return await this.transaction(async tx => {
        // No missing-row gap lock: concurrent inserts serialize through the
        // persistent unique request key instead of deadlocking shared gap locks.
        const existing = await rows(tx, "SELECT id FROM payable_invoices WHERE requestId = ? LIMIT 1", [input.requestId]);
        if (existing[0]) {
          const locked = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE`, [integer(existing[0].id)]);
          if (!locked[0]) return fail("CORRUPT_SNAPSHOT", "Stored invoice disappeared and needs review.");
          this.verifyReplay(locked[0], tokenHash, payloadHash);
          return this.invoiceView(tx, locked[0]);
        }
        const accounts = await rows(tx, "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1 FOR UPDATE", [client.id]);
        if (accounts.length !== 1) return fail("CLIENT_NOT_FOUND", "Customer account no longer exists.", 404);
        const currentClient = clientFrom(accounts[0]);
        if (currentClient.phone !== client.phone || currentClient.email !== client.email) return fail("CLIENT_IDENTITY_MISMATCH", "Customer identity changed after review.");
        const currentServices = await this.readServices(tx, currentClient, input.from, input.to, true);
        if (invoiceReviewHash(currentClient, currentServices, input.from, input.to) !== input.reviewHash) return fail("REVIEW_CHANGED", "Services changed since the explicit unpaid review. Refresh before issuing.");
        for (const selected of services) {
          const fresh = currentServices.find(s => s.id === selected.id);
          if (!fresh || !fresh.eligible || fresh.occurrenceKey !== selected.occurrenceKey || fresh.date !== selected.date || fresh.amountCents !== selected.amountCents || fresh.status !== selected.status || fresh.description !== selected.description || fresh.address !== selected.address || (fresh.paidCents ?? 0) !== (selected.paidCents ?? 0) || fresh.paymentSource !== selected.paymentSource) return fail("SERVICE_REVIEW_REQUIRED", "The reviewed service changed or has an existing payment. Refresh and review before issuing.");
        }
        await this.assertClaims(tx, services);
        const number = `INV-${randomUUID()}`;
        const createdAt = Date.now();
        const paidTotal = safeSum(services.map(s => s.paidCents ?? 0));
        const total = safeSum(services.map(s => s.amountCents));
        const initialStatus = paidTotal === total ? "paid" : paidTotal > 0 ? "partially_paid" : "open";
        const inserted = await change(tx, `INSERT INTO payable_invoices (number, accountId, clientName, clientPhone, clientEmail, periodFrom, periodTo, dueDate, currency, status, requestId, payloadHash, reviewHash, tokenHash, tokenExpiresAt, createdAtMs, paidAtMs)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?, ?, ?, ?)`, [number, client.id, client.name, client.phone, client.email, input.from, input.to, input.dueDate, initialStatus, input.requestId, payloadHash, input.reviewHash, tokenHash, createdAt + 90 * 24 * 60 * 60 * 1000, createdAt, initialStatus === "paid" ? createdAt : null]);
        const invoiceId = integer(inserted.insertId);
        for (const service of services.slice().sort((a, b) => a.occurrenceKey.localeCompare(b.occurrenceKey))) {
          if (service.amountCents <= 0 || !/^(job:\d+|booking:\d+:first:\d{4}-\d{2}-\d{2})$/.test(service.occurrenceKey) || service.id.length > 100 || service.occurrenceKey.length > 100 || service.description.length > 500 || service.address.length > 500) return fail("INVALID_SNAPSHOT", "Service snapshot exceeds supported bounds.");
          await change(tx, "INSERT INTO payable_invoice_lines (invoiceId, sourceServiceId, occurrenceKey, serviceDate, description, address, amountCents, paidCents, manualPaidCents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [invoiceId, service.id, service.occurrenceKey, service.date, service.description, service.address, service.amountCents, service.paidCents ?? 0, service.paymentSource === "manual" ? service.paidCents ?? 0 : 0]);
        }
        const persisted = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1`, [invoiceId]);
        return this.invoiceView(tx, persisted[0]);
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
      return this.transaction(async tx => {
        const existing = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE requestId = ? LIMIT 1 FOR UPDATE`, [input.requestId]);
        if (!existing[0]) return fail("SOURCE_ALREADY_INVOICED", "A selected visit already belongs to another invoice. Review instead of issuing twice.");
        this.verifyReplay(existing[0], tokenHash, payloadHash);
        return this.invoiceView(tx, existing[0]);
      });
    }
  }

  async markAlreadyPaid(input: { clientId: number; from: string; to: string; serviceIds: string[]; requestId: string; reviewHash: string }, agentId: number): Promise<void> {
    uuid(input.requestId);
    if (!Number.isSafeInteger(agentId) || agentId <= 0 || !Number.isSafeInteger(input.clientId) || input.clientId <= 0 || !/^[a-f0-9]{64}$/.test(input.reviewHash) || !invoicePeriodSchema.safeParse(input).success || !input.serviceIds.length || input.serviceIds.length > MAX_ROWS || new Set(input.serviceIds).size !== input.serviceIds.length) return fail("INVALID_REQUEST", "Explicit current service review and agent identity are required.", 400);
    return this.transaction(async tx => {
      const accounts = await rows(tx, "SELECT id, customerName, customerPhone, customerEmail FROM customer_portal_accounts WHERE id = ? LIMIT 1 FOR UPDATE", [input.clientId]);
      if (accounts.length !== 1) return fail("CLIENT_NOT_FOUND", "Customer account not found.", 404);
      const client = clientFrom(accounts[0]);
      const current = await this.readServices(tx, client, input.from, input.to, true);
      const selected = input.serviceIds.map(id => current.find(s => s.id === id));
      if (selected.some(s => !s || !s.eligible)) return fail("SERVICE_REVIEW_REQUIRED", "Only exact owned services without an existing collection may be marked already paid.");
      const services = selected as InvoiceService[];
      const payloadHash = createHash("sha256").update(JSON.stringify({ clientId: input.clientId, from: input.from, to: input.to, reviewHash: input.reviewHash, services: services.slice().sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.id, s.occurrenceKey, s.date, s.amountCents]) })).digest("hex");
      const replay = await rows(tx, "SELECT occurrenceKey, payloadHash FROM payable_invoice_manual_payments WHERE requestId = ? ORDER BY occurrenceKey FOR UPDATE", [input.requestId]);
      if (replay.length) {
        const keys = services.map(s => s.occurrenceKey).sort();
        if (replay.length !== keys.length || replay.some((r, i) => r.occurrenceKey !== keys[i] || r.payloadHash !== payloadHash)) return fail("IDEMPOTENCY_CONFLICT", "This manual-payment request was already used with another snapshot.");
        return;
      }
      await this.assertClaims(tx, services);
      if (services.some(s => (s.paidCents ?? 0) !== 0)) return fail("MANUAL_PAYMENT_CONFLICT", "A selected service is already marked paid; no payment was overwritten.");
      // Current review hashes are checked against the exact pre-mark snapshot.
      const review = invoiceReviewHash(client, current, input.from, input.to);
      if (review !== input.reviewHash) return fail("REVIEW_CHANGED", "Refresh and review the current services before marking them paid.");
      for (const service of services.slice().sort((a, b) => a.occurrenceKey.localeCompare(b.occurrenceKey))) {
        await change(tx, "INSERT INTO payable_invoice_manual_payments (occurrenceKey, sourceServiceId, accountId, serviceDate, amountCents, requestId, payloadHash, reviewHash, recordedByAgentId, recordedAtMs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [service.occurrenceKey, service.id, client.id, service.date, service.amountCents, input.requestId, payloadHash, input.reviewHash, agentId, Date.now()]);
        service.paidCents = service.amountCents; service.paymentSource = "manual"; service.reason = "Already paid — explicitly recorded by an agent before invoice creation.";
      }
      return;
    });
  }

  async byToken(tokenHash: string): Promise<PayableInvoice | null> {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) return null;
    return this.transaction(async tx => {
      const found = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE tokenHash = ? AND tokenExpiresAt > ? LIMIT 1 FOR UPDATE`, [tokenHash, Date.now()]);
      return found[0] ? this.invoiceView(tx, found[0]) : null;
    });
  }

  async reserve(invoiceId: number, requestId: string, lineIds: number[]): Promise<InvoiceAttempt> {
    uuid(requestId);
    const ids = canonicalIds(lineIds);
    return this.transaction(async tx => {
      const invoiceRows = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE`, [invoiceId]);
      if (!invoiceRows[0]) return fail("NOT_FOUND", "Invoice unavailable.", 404);
      const existing = await rows(tx, `SELECT ${ATTEMPT_COLUMNS} FROM payable_invoice_attempts WHERE invoiceId = ? AND requestId = ? LIMIT 1 FOR UPDATE`, [invoiceId, requestId]);
      if (existing[0]) {
        const previous = attemptFrom(existing[0]);
        if (JSON.stringify(previous.lineIds) !== JSON.stringify(ids)) return fail("IDEMPOTENCY_CONFLICT", "This checkout UUID has a different selection.");
        // Paid replay must return its immutable attempt, before balance checks.
        if (previous.state === "expired") return fail("PAYMENT_REVIEW_REQUIRED", "This retained payment attempt needs review.");
        if (previous.state !== "paid" && invoiceRows[0].activeAttemptId !== previous.id) return fail("PAYMENT_REVIEW_REQUIRED", "Payment ownership needs review.");
        return previous;
      }
      if (invoiceRows[0].activeAttemptId != null) return fail("CHECKOUT_IN_PROGRESS", "Another checkout is unresolved for this invoice. Review or resume it before starting another.");
      const invoice = await this.invoiceView(tx, invoiceRows[0]);
      const amount = selectedBalance(invoice, ids);
      await this.verifyInvoiceCollection(tx, invoice, ids);
      // Selection represents complete unpaid lines, not arbitrary partial cents.
      if (ids.some(id => invoice.lines.find(line => line.id === id)!.paidCents !== 0)) return fail("PAYMENT_REVIEW_REQUIRED", "A partially allocated service needs review.");
      const id = randomUUID();
      const createdAt = Date.now();
      await change(tx, "INSERT INTO payable_invoice_attempts (id, invoiceId, requestId, selectedLineIds, amountCents, currency, state, createdAtMs) VALUES (?, ?, ?, ?, ?, 'usd', 'pending', ?)", [id, invoiceId, requestId, JSON.stringify(ids), amount, createdAt]);
      const updated = await change(tx, "UPDATE payable_invoices SET activeAttemptId = ? WHERE id = ? AND activeAttemptId IS NULL AND status IN ('open', 'partially_paid')", [id, invoiceId]);
      if (updated.affectedRows !== 1) return fail("CHECKOUT_IN_PROGRESS", "Invoice payment ownership changed.");
      return { id, invoiceId, requestId, lineIds: ids, amountCents: amount, currency: "usd", state: "pending", sessionId: null, sessionUrl: null, createdAt };
    });
  }

  async attempt(id: string): Promise<InvoiceAttempt | null> {
    const found = await rows(await this.pool(), `SELECT ${ATTEMPT_COLUMNS} FROM payable_invoice_attempts WHERE id = ? LIMIT 1`, [id]);
    return found[0] ? attemptFrom(found[0]) : null;
  }

  private async lockedAttempt(tx: PoolConnection, id: string): Promise<{ invoiceRow: Row; attemptRow: Row }> {
    // Read identity only; every writer locks invoice FIRST, then attempt.
    const identity = await rows(tx, "SELECT invoiceId FROM payable_invoice_attempts WHERE id = ? LIMIT 1", [id]);
    if (!identity[0]) return fail("NOT_FOUND", "Payment attempt unavailable.", 404);
    const invoiceRows = await rows(tx, `SELECT ${INVOICE_COLUMNS} FROM payable_invoices WHERE id = ? LIMIT 1 FOR UPDATE`, [integer(identity[0].invoiceId)]);
    const attempts = await rows(tx, `SELECT ${ATTEMPT_COLUMNS} FROM payable_invoice_attempts WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
    if (!invoiceRows[0] || !attempts[0] || integer(attempts[0].invoiceId) !== integer(invoiceRows[0].id)) return fail("PAYMENT_IDENTITY_MISMATCH", "Payment ownership needs review.");
    return { invoiceRow: invoiceRows[0], attemptRow: attempts[0] };
  }

  async attachSession(attemptId: string, sessionId: string, url: string): Promise<void> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255 || url.length > 2048 || !/^https:\/\/checkout\.stripe\.com\//.test(url)) return fail("PAYMENT_IDENTITY_MISMATCH", "Invalid checkout binding.");
    await this.transaction(async tx => {
      const { invoiceRow, attemptRow } = await this.lockedAttempt(tx, attemptId);
      const attempt = attemptFrom(attemptRow);
      if (attempt.sessionId != null && (attempt.sessionId !== sessionId || (attempt.sessionUrl != null && attempt.sessionUrl !== url))) return fail("PAYMENT_IDENTITY_MISMATCH", "This payment attempt is bound to another checkout.");
      if (attempt.state !== "paid" && (invoiceRow.activeAttemptId !== attemptId || !["pending", "session_open"].includes(attempt.state))) return fail("PAYMENT_REVIEW_REQUIRED", "This checkout needs review.");
      await change(tx, "UPDATE payable_invoice_attempts SET sessionId = ?, sessionUrl = ?, state = CASE WHEN state = 'paid' THEN 'paid' ELSE 'session_open' END WHERE id = ? AND invoiceId = ?", [sessionId, url, attemptId, attempt.invoiceId]);
    });
  }

  /** Caller MUST first retrieve and verify the matching provider session is expired. */
  async expire(attemptId: string, sessionId: string): Promise<void> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255) return fail("PAYMENT_IDENTITY_MISMATCH", "Invalid checkout binding.");
    await this.transaction(async tx => {
      const { invoiceRow, attemptRow } = await this.lockedAttempt(tx, attemptId);
      const attempt = attemptFrom(attemptRow);
      if (attempt.sessionId !== sessionId) return fail("PAYMENT_IDENTITY_MISMATCH", "Expiration does not match the stored checkout session.");
      if (attempt.state === "paid") return fail("ALREADY_PAID", "A paid payment attempt cannot be expired.");
      if (attempt.state !== "expired" && invoiceRow.activeAttemptId !== attemptId) return fail("PAYMENT_REVIEW_REQUIRED", "Payment reservation ownership needs review.");
      if (attempt.state !== "expired") await change(tx, "UPDATE payable_invoice_attempts SET state = 'expired' WHERE id = ? AND invoiceId = ? AND state IN ('pending', 'session_open')", [attemptId, attempt.invoiceId]);
      // Idempotent expired replay must never clear a newer attempt's reservation.
      await change(tx, "UPDATE payable_invoices SET activeAttemptId = NULL WHERE id = ? AND activeAttemptId = ?", [attempt.invoiceId, attemptId]);
    });
  }

  async settle(attemptId: string, sessionId: string, paymentId: string, amountCents: number): Promise<void> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255 || !/^pi_[A-Za-z0-9_]+$/.test(paymentId) || paymentId.length > 255 || !Number.isSafeInteger(amountCents)) return fail("PAYMENT_IDENTITY_MISMATCH", "Payment references or amount need review.");
    await this.transaction(async tx => {
      const { invoiceRow, attemptRow } = await this.lockedAttempt(tx, attemptId);
      const attempt = attemptFrom(attemptRow);
      if (attempt.amountCents !== amountCents || (attempt.sessionId != null && attempt.sessionId !== sessionId)) return fail("PAYMENT_IDENTITY_MISMATCH", "Payment amount or session mismatch.");
      if (attempt.state === "paid") {
        if (attemptRow.paymentId !== paymentId || attempt.sessionId !== sessionId) return fail("PAYMENT_IDENTITY_MISMATCH", "Paid replay does not match the stored payment.");
        return;
      }
      if (invoiceRow.activeAttemptId !== attempt.id || !["pending", "session_open"].includes(attempt.state)) return fail("PAYMENT_REVIEW_REQUIRED", "Payment reservation is not active.");
      const invoice = await this.invoiceView(tx, invoiceRow);
      const ids = canonicalIds(attempt.lineIds);
      if (selectedBalance(invoice, ids) !== amountCents || ids.some(id => invoice.lines.find(line => line.id === id)!.paidCents !== 0)) return fail("PAYMENT_IDENTITY_MISMATCH", "Selected service balances do not match this payment.");
      const paidAt = Date.now();
      for (const id of ids) {
        const line = invoice.lines.find(candidate => candidate.id === id)!;
        const changed = await change(tx, "UPDATE payable_invoice_lines SET paidCents = paidCents + ? WHERE id = ? AND invoiceId = ? AND paidCents = 0 AND amountCents = ?", [line.amountCents, id, invoice.id, line.amountCents]);
        if (changed.affectedRows !== 1) return fail("PAYMENT_IDENTITY_MISMATCH", "Selected service allocation changed.");
        await change(tx, "INSERT INTO payable_invoice_allocations (invoiceId, attemptId, lineId, paymentId, amountCents, paidAtMs) VALUES (?, ?, ?, ?, ?, ?)", [invoice.id, attemptId, id, paymentId, line.amountCents, paidAt]);
        line.paidCents = line.amountCents;
      }
      await change(tx, "UPDATE payable_invoice_attempts SET state = 'paid', sessionId = ?, paymentId = ?, paidAtMs = ? WHERE id = ? AND invoiceId = ?", [sessionId, paymentId, paidAt, attemptId, invoice.id]);
      const paid = invoiceBalance(invoice.lines) === 0;
      const review = invoice.status === "payment_review";
      const updated = await change(tx, "UPDATE payable_invoices SET activeAttemptId = NULL, status = ?, paidAtMs = ? WHERE id = ? AND activeAttemptId = ?", [review ? "payment_review" : paid ? "paid" : "partially_paid", !review && paid ? paidAt : null, invoice.id, attemptId]);
      if (updated.affectedRows !== 1) return fail("PAYMENT_IDENTITY_MISMATCH", "Invoice payment ownership changed.");
    });
  }
}
