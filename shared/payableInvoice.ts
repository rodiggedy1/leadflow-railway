import { z } from "zod";

export const invoiceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid service date");
export const invoicePeriodSchema = z.object({ from: invoiceDate, to: invoiceDate }).refine(value => value.from <= value.to, "End date must not precede start date");
export const invoiceLookupSchema = z.object({ phone: z.string().trim().max(40).default(""), email: z.string().trim().max(320).default(""), from: invoiceDate, to: invoiceDate }).strict().refine(value => value.from <= value.to, "Invalid service period").refine(value => !!value.phone || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email), "Enter a phone or email");
export const invoiceIssueSchema = z.object({ requestId: z.string().uuid(), clientId: z.number().int().positive(), from: invoiceDate, to: invoiceDate, serviceIds: z.array(z.string().max(100)).min(1).max(1000), confirmedUnpaid: z.literal(true), dueDate: invoiceDate, reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(value => value.from <= value.to, "Invalid service period");
export const invoiceCheckoutSchema = z.object({ requestId: z.string().uuid(), lineIds: z.array(z.number().int().positive()).min(1).max(1000) }).strict();
export const invoiceMarkPaidSchema = z.object({ requestId: z.string().uuid(), clientId: z.number().int().positive(), from: invoiceDate, to: invoiceDate, serviceIds: z.array(z.string().max(100)).min(1).max(1000), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(value => value.from <= value.to, "Invalid service period");
export const invoiceSendSchema = z.object({ requestId: z.string().uuid(), confirmed: z.literal(true) }).strict();

export type InvoiceClient = { id: number; name: string; phone: string; email: string | null };
export type InvoiceService = { id: string; occurrenceKey: string; date: string; description: string; address: string; amountCents: number; status: string; eligible: boolean; reason: string | null; paidCents?: number; paymentSource?: "manual" | "stripe" | null };
export type InvoiceLine = { id: number; occurrenceKey: string; date: string; description: string; address: string; amountCents: number; paidCents: number; manualPaidCents?: number };
export type InvoiceReceipt = { paymentId: string; amountCents: number; paidAt: string; lineIds: number[]; refundedCents?: number };
export type PayableInvoice = { id: number; number: string; clientId: number; clientName: string; from: string; to: string; dueDate: string; currency: "usd"; status: "open" | "partially_paid" | "paid" | "void" | "payment_review"; lines: InvoiceLine[]; receipts: InvoiceReceipt[]; activeAttemptId: string | null; activeLineIds?: number[] };
export type InvoiceAttempt = { id: string; invoiceId: number; requestId: string; lineIds: number[]; amountCents: number; currency: "usd"; state: "pending" | "session_open" | "paid" | "expired"; sessionId: string | null; sessionUrl: string | null; createdAt: number };

export class InvoiceError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message); }
}
export function invoiceTotal(lines: InvoiceLine[]): number { return safeSum(lines.map(line => line.amountCents)); }
export function invoiceBalance(lines: InvoiceLine[]): number { return safeSum(lines.map(line => line.amountCents - line.paidCents)); }
export function safeSum(values: number[]): number {
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new InvoiceError("INVALID_AMOUNT", 409, "Invoice amounts need review.");
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total > 99_999_999) throw new InvoiceError("INVALID_AMOUNT", 409, "Invoice total exceeds supported bounds.");
  return total;
}
export function selectedBalance(invoice: PayableInvoice, ids: number[]): number {
  if (invoice.status === "void") throw new InvoiceError("INVOICE_VOID", 409, "This invoice is no longer payable.");
  if (invoice.status === "payment_review") throw new InvoiceError("PAYMENT_REVIEW_REQUIRED", 409, "A payment adjustment needs review before another payment can be accepted.");
  if (new Set(ids).size !== ids.length || ids.length === 0) throw new InvoiceError("INVALID_SELECTION", 400, "Select each service only once.");
  const lines = ids.map(id => invoice.lines.find(line => line.id === id));
  if (lines.some(line => !line || line.paidCents >= line.amountCents)) throw new InvoiceError("BALANCE_CHANGED", 409, "Some selected services are unavailable or already paid. Refresh the invoice.");
  const total = safeSum(lines.map(line => line!.amountCents - line!.paidCents));
  if (total < 50) throw new InvoiceError("INVALID_AMOUNT", 409, "The selected amount is below the supported card payment minimum.");
  return total;
}
