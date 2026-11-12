import { createHash } from "node:crypto";
import type { InvoiceClient, PayableInvoice } from "../shared/payableInvoice";

/** Saved-invoice review only; never an issuance hash or a public-link token. */
export function invoiceExistingReviewHash(invoice: PayableInvoice, client: InvoiceClient): string {
  const receipts = invoice.receipts.map(receipt => [receipt.paymentId, receipt.amountCents, receipt.paidAt,
    receipt.lineIds.slice().sort((a, b) => a - b), receipt.refundedCents ?? 0]);
  receipts.sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return createHash("sha256").update(JSON.stringify({
    namespace: "existing-invoice-review-v1",
    invoice: [invoice.id, invoice.number, invoice.clientId, invoice.clientName, invoice.from, invoice.to,
      invoice.dueDate, invoice.currency, invoice.status, invoice.activeAttemptId],
    client: [client.id, client.name, client.phone, client.email],
    lines: invoice.lines.slice().sort((a, b) => a.id - b.id).map(line => [line.id, line.occurrenceKey,
      line.date, line.description, line.address, line.amountCents, line.paidCents, line.manualPaidCents ?? 0]),
    receipts,
  })).digest("hex");
}
