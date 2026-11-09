import { createHash } from "node:crypto";
import type { InvoiceClient, InvoiceService } from "../shared/payableInvoice";

export function invoiceReviewHash(client: InvoiceClient, services: InvoiceService[], from: string, to: string): string {
  return createHash("sha256").update(JSON.stringify({ client: [client.id, client.name, client.phone, client.email], from, to, services: services.slice().sort((a, b) => a.id.localeCompare(b.id)).map(row => [row.id, row.occurrenceKey, row.date, row.description, row.address, row.amountCents, row.paidCents ?? 0, row.paymentSource ?? null, row.status, row.eligible]) })).digest("hex");
}
