import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import type { PayableInvoice } from "../shared/payableInvoice";
import { buildInvoiceEmail, generatePayableInvoicePdf, sendPayableInvoiceEmail, type InvoiceEmailTransport } from "./payableInvoiceDelivery";

// All data is synthetic; Gmail and other provider modules are never loaded by these tests.
vi.mock("./gmailService", () => { throw new Error("Provider import is forbidden in delivery tests"); });
const URL = `https://invoice.example.test/invoice/${"a".repeat(64)}?view=all&receipt=yes`;
const RECIPIENT = "storedclient@example.test";
function fixture(count = 2): PayableInvoice {
  return {
    id: 42, number: "TEST-0042", clientId: 17, clientName: "Example Client",
    from: "2026-11-01", to: "2026-11-07", dueDate: "2026-11-20", currency: "usd",
    status: "partially_paid", activeAttemptId: null, activeLineIds: [1],
    lines: Array.from({ length: count }, (_, index) => ({
      id: index + 1, occurrenceKey: `owned:${index + 1}`, date: index % 2 ? "2026-11-05" : "2026-11-02",
      description: `Cleaning service ${index + 1}`, address: "Synthetic service address",
      amountCents: 12345, paidCents: index === 0 ? 345 : 0,
    })),
    receipts: [{ paymentId: "synthetic-payment", amountCents: 345, paidAt: "2026-11-03T01:30:00Z", lineIds: [1] }],
  };
}
async function readPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const streams = doc.getPages().map(page => {
    const contents = page.node.lookup(PDFName.of("Contents"), PDFArray);
    return Array.from({ length: contents.size() }, (_, index) =>
      Buffer.from(decodePDFRawStream(contents.lookup(index, PDFRawStream)).decode()).toString("latin1"),
    ).join("\n");
  });
  const text = streams.join("\n").replace(/<([0-9a-f]+)>/gi, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
  return { doc, streams, text };
}
afterEach(() => vi.unstubAllGlobals());

describe("payable invoice PDF: memory-only snapshot rendering", () => {
  it("uses each service date and authoritative all/selected cents, not a receipt or selection total", async () => {
    const { text } = await readPdf(await generatePayableInvoicePdf(fixture(), URL));
    expect(text).toContain("2026-11-02");
    expect(text).toContain("2026-11-05");
    expect(text).toContain("All-service total: $246.90");
    expect(text).toContain("Payments applied (net): $3.45");
    expect(text).toContain("All-service balance: $243.45");
    expect(text).toContain("Selected service balance: $120.00");
    expect(text).toContain("Payment received (gross): $3.45");
    // Receipt instants use Washington time while service calendar dates stay unchanged.
    expect(text).toContain("Nov 2, 2026, 8:30 PM EST");
  });

  it.each([41, 100])("paginates %i service rows and keeps all text/totals on-page", async count => {
    const { doc, streams, text } = await readPdf(await generatePayableInvoicePdf(fixture(count), URL));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(text).toContain(`Cleaning service ${count}`);
    expect(text).toContain("All-service balance:");
    for (const stream of streams) {
      for (const match of stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(48);
        expect(Number(match[1])).toBeLessThan(564);
        expect(Number(match[2])).toBeGreaterThanOrEqual(48);
        expect(Number(match[2])).toBeLessThanOrEqual(746);
      }
    }
    expect(streams.at(-1)).toMatch(/URI|BT/);
  });

  it("splits a very long single description without drawing it off-page", async () => {
    const invoice = fixture(1);
    invoice.lines[0].description = "Long service detail ".repeat(1500) + " LAST_DETAIL";
    const { doc, text } = await readPdf(await generatePayableInvoicePdf(invoice, URL));
    expect(doc.getPageCount()).toBeGreaterThan(2);
    expect(text.replace(/\s+/g, " ")).toContain("LAST_DETAIL");
    expect(text).toContain("All-service balance: $120.00");
  });

  it("creates a real URI annotation with the exact opaque URL", async () => {
    const { doc } = await readPdf(await generatePayableInvoicePdf(fixture(), URL));
    const links = doc.getPages().flatMap(page => {
      const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annotations) return [];
      return Array.from({ length: annotations.size() }, (_, index) => annotations.lookup(index, PDFDict));
    });
    expect(links).toHaveLength(1);
    const action = links[0].lookup(PDFName.of("A"), PDFDict);
    expect(action.lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(URL);
    expect(action.lookup(PDFName.of("S"), PDFName).asString()).toBe("/URI");
  });

  it("safely renders accented, non-Latin and emoji names without font assets", async () => {
    const invoice = fixture();
    invoice.clientName = "Jos\u00e9 Łukasz 李 😊";
    invoice.lines[0].description = "Cr\u00e8me cleaning – 東京 🧹";
    const { text } = await readPdf(await generatePayableInvoicePdf(invoice, URL));
    expect(text).toContain("Jos\u00e9 Lukasz [unavailable]");
    expect(text).toContain("unsupported characters were transliterated");
  });

  it("labels a paid invoice with gross receipts and a zero net balance", async () => {
    const invoice = fixture(1);
    invoice.status = "paid";
    invoice.activeLineIds = undefined;
    invoice.lines[0].paidCents = 12345;
    invoice.receipts[0].amountCents = 12345;
    const { text } = await readPdf(await generatePayableInvoicePdf(invoice, URL));
    expect(text).toContain("All-service balance: $0.00");
    expect(text).toContain("Payment received (gross): $123.45");
    expect(text).toContain("View paid invoice and receipts");
  });

  it("labels typed refunds separately and never recalculates net applied snapshot totals from receipts", async () => {
    const invoice = fixture(1);
    invoice.status = "payment_review";
    invoice.receipts[0].amountCents = 1000;
    invoice.receipts[0].refundedCents = 500;
    const { text } = await readPdf(await generatePayableInvoicePdf(invoice, URL));
    expect(text).toContain("Payment received (gross): $10.00");
    expect(text).toContain("Refunded: $5.00");
    expect(text).toContain("Receipt amount after refund: $5.00");
    expect(text).toContain("Payments applied (net): $3.45");
    expect(text).toContain("All-service balance: $120.00");
    expect(text).toContain("payment adjustment needs review; not payable");
    const email = buildInvoiceEmail(invoice, RECIPIENT, URL);
    expect(email.bodyHtml).toContain("Refunded: $5.00");
    expect(email.bodyHtml).toContain("before another payment can be accepted");
    expect(email.bodyHtml).not.toContain("pay securely");
    invoice.receipts[0].refundedCents = 1001;
    await expect(generatePayableInvoicePdf(invoice, URL)).rejects.toThrow("Invoice amounts need review");
  });

  it("does not silently clamp invalid cents or inconsistent selection snapshots", async () => {
    const invoice = fixture();
    invoice.lines[0].paidCents = 12346;
    await expect(generatePayableInvoicePdf(invoice, URL)).rejects.toThrow("Invoice amounts need review");
    invoice.lines[0].paidCents = 345;
    invoice.activeLineIds = [999];
    await expect(generatePayableInvoicePdf(invoice, URL)).rejects.toThrow("Invoice selection needs review");
  });
});

describe("payable invoice email: explicit verified-recipient delivery", () => {
  it("escapes HTML, preserves Unicode via ASCII entities, and sanitizes MIME headers/filename", () => {
    const invoice = fixture();
    invoice.clientName = 'Jos\u00e9 <img src=x onerror="bad"> & 客';
    invoice.number = 'TEST\r\nBcc: stolen@example.test/"bad';
    const email = buildInvoiceEmail(invoice, RECIPIENT, URL);
    expect(email.to).toBe(RECIPIENT);
    expect(email.bodyHtml).toContain("Jos&#233; &lt;img");
    expect(email.bodyHtml).toContain("&quot;bad&quot;");
    expect(email.bodyHtml).toContain("&#23458;");
    expect(email.bodyHtml).toContain("?view=all&amp;receipt=yes");
    expect(email.bodyHtml).not.toContain("<img");
    expect(email.bodyHtml).not.toMatch(/[^\x00-\x7f]/);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.attachmentFilename).toMatch(/^Invoice_[A-Za-z0-9_-]+\.pdf$/);
    expect(email.attachmentFilename).not.toContain(invoice.clientName);
    expect(email.bodyHtml).toContain("All-service balance: <strong>$243.45");
    expect(email.bodyHtml).toContain("Selected service balance: $120.00");
  });

  it.each(["good@example.test\r\nBcc: other@example.test", "good@example.test\n", "a@example.test,b@example.test", "Name <a@example.test>", "missing"])('rejects non-single-mailbox recipient "%s"', recipient => {
    expect(() => buildInvoiceEmail(fixture(), recipient, URL)).toThrow("verified client email");
  });

  it.each(["javascript:alert(1)", "https://user:pass@example.test/x", "https://example.test/x\r\nBad:yes", "data:text/html,x"])('rejects dangerous link "%s"', url => {
    expect(() => buildInvoiceEmail(fixture(), RECIPIENT, url)).toThrow("Invalid invoice link");
  });

  it("build/generate have no transport calls; explicit send calls the stub once with an in-memory data URL", async () => {
    const forbiddenFetch = vi.fn(() => { throw new Error("Network access forbidden"); });
    vi.stubGlobal("fetch", forbiddenFetch);
    const transport = vi.fn<InvoiceEmailTransport>().mockResolvedValue({ messageId: "synthetic-message", threadId: "synthetic-thread" });
    const invoice = fixture();
    buildInvoiceEmail(invoice, RECIPIENT, URL);
    await generatePayableInvoicePdf(invoice, URL);
    expect(transport).not.toHaveBeenCalled();
    const result = await sendPayableInvoiceEmail(invoice, URL, RECIPIENT, transport);
    expect(result).toEqual({ messageId: "synthetic-message", threadId: "synthetic-thread" });
    expect(transport).toHaveBeenCalledTimes(1);
    const sent = transport.mock.calls[0][0];
    expect(sent.to).toBe(RECIPIENT);
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].url).toMatch(/^data:application\/pdf;base64,/);
    expect(sent.attachments[0].mimeType).toBe("application/pdf");
    const pdf = Buffer.from(sent.attachments[0].url.split(",")[1], "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });

  it("propagates transport failure without retry or other provider call", async () => {
    const transport = vi.fn<InvoiceEmailTransport>().mockRejectedValue(new Error("synthetic transport failure"));
    await expect(sendPayableInvoiceEmail(fixture(), URL, RECIPIENT, transport)).rejects.toThrow("synthetic transport failure");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
