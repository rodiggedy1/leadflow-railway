import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { InvoiceError } from "../shared/payableInvoice";

export class InvoiceMailOutbox {
  constructor(private readonly pool: () => Promise<Pool>) {}
  async send(requestId: string, invoiceId: number, recipient: string, url: string, send: () => Promise<{ messageId: string }>) {
    const hash = createHash("sha256").update(JSON.stringify([invoiceId, recipient, url])).digest("hex");
    const db = await this.pool();
    try {
      await db.execute("INSERT INTO payable_invoice_deliveries (requestId, invoiceId, recipient, payloadHash, state, createdAtMs) VALUES (?, ?, ?, ?, 'pending', ?)", [requestId, invoiceId, recipient, hash, Date.now()]);
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
      const [rows] = await db.execute<RowDataPacket[]>("SELECT payloadHash, state FROM payable_invoice_deliveries WHERE requestId = ? LIMIT 1", [requestId]);
      if (rows[0]?.payloadHash !== hash) throw new InvoiceError("IDEMPOTENCY_CONFLICT", 409, "This send request belongs to a different invoice.");
      if (rows[0]?.state === "sent") return { sent: true, replayed: true };
      throw new InvoiceError("SEND_REVIEW_REQUIRED", 409, "This email may already be sending or sent. Check the sent mailbox before starting a new send.");
    }
    try {
      const result = await send();
      await db.execute("UPDATE payable_invoice_deliveries SET state = 'sent', providerMessageId = ?, sentAtMs = ? WHERE requestId = ? AND state = 'pending'", [result.messageId, Date.now(), requestId]);
      return { sent: true, replayed: false };
    } catch {
      await db.execute("UPDATE payable_invoice_deliveries SET state = 'unknown' WHERE requestId = ? AND state = 'pending'", [requestId]);
      throw new InvoiceError("SEND_REVIEW_REQUIRED", 503, "Email delivery was not confirmed. Check the sent mailbox before sending again.");
    }
  }
}
