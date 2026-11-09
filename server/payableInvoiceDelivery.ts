import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { InvoiceError, invoiceBalance, invoiceDate, invoiceTotal, safeSum, type PayableInvoice } from "../shared/payableInvoice";

export type InvoiceEmail = {
  to: string;
  subject: string;
  bodyHtml: string;
  attachmentFilename: string;
};
export type InvoiceEmailTransport = (message: {
  to: string;
  subject: string;
  bodyHtml: string;
  attachments: { url: string; filename: string; mimeType: string }[];
}) => Promise<{ messageId: string; threadId: string }>;

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const BOTTOM = 76;
const WIDTH = PAGE_WIDTH - MARGIN * 2;
const DARK = rgb(0.16, 0.16, 0.16);
const ORANGE = rgb(0.83, 0.32, 0.08);
const GRAY = rgb(0.45, 0.45, 0.45);
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const PAYMENT_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

function cents(value: number): string {
  safeSum([value]);
  return USD.format(value / 100);
}

function totals(invoice: PayableInvoice) {
  if (invoice.currency !== "usd") throw new InvoiceError("INVALID_CURRENCY", 409, "Invoice currency needs review.");
  const total = invoiceTotal(invoice.lines);
  const paid = safeSum(invoice.lines.map(line => line.paidCents));
  const balance = invoiceBalance(invoice.lines);
  // Never replace the all-service total with a checkout selection or receipt gross amount.
  let selected: number | undefined;
  if (invoice.activeLineIds?.length) {
    if (new Set(invoice.activeLineIds).size !== invoice.activeLineIds.length) {
      throw new InvoiceError("INVALID_SELECTION", 409, "Invoice selection needs review.");
    }
    selected = safeSum(invoice.activeLineIds.map(id => {
      const line = invoice.lines.find(item => item.id === id);
      if (!line) throw new InvoiceError("INVALID_SELECTION", 409, "Invoice selection needs review.");
      return line.amountCents - line.paidCents;
    }));
  }
  invoiceDate.parse(invoice.from);
  invoiceDate.parse(invoice.to);
  invoiceDate.parse(invoice.dueDate);
  invoice.lines.forEach(line => invoiceDate.parse(line.date));
  invoice.receipts.forEach(receipt => {
    safeSum([receipt.amountCents]);
    if (receipt.refundedCents !== undefined) {
      safeSum([receipt.refundedCents, receipt.amountCents - receipt.refundedCents]);
    }
    if (!Number.isFinite(new Date(receipt.paidAt).getTime())) {
      throw new InvoiceError("INVALID_RECEIPT_DATE", 409, "Payment date needs review.");
    }
  });
  return { total, paid, balance, selected };
}

/** The caller supplies the exact opaque link built and origin-validated by the invoice server.
 * This guard rejects dangerous schemes, credentials and header/control characters; it does
 * not substitute for the route's configured-origin validation and never reconstructs tokens. */
function checkedUrl(url: string): string {
  if (/[\u0000-\u0020\u007f]/.test(url)) throw new InvoiceError("INVALID_INVOICE_URL", 400, "Invalid invoice link.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new InvoiceError("INVALID_INVOICE_URL", 400, "Invalid invoice link."); }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
    throw new InvoiceError("INVALID_INVOICE_URL", 400, "Invalid invoice link.");
  }
  return url;
}

/** Only a single stored, server-verified mailbox is accepted: no display name, list, or override. */
function checkedRecipient(recipient: string): string {
  if (recipient.length > 320 || /[\u0000-\u0020\u007f]/.test(recipient) || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(recipient)) {
    throw new InvoiceError("INVALID_RECIPIENT", 400, "A verified client email address is required.");
  }
  return recipient;
}

// Gmail's existing helper writes raw MIME headers and a 7bit HTML body. Keep headers ASCII
// and encode non-ASCII body characters as entities without modifying that shared helper.
function headerText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[^\x20-\x7e]/g, "?").replace(/\s+/g, " ").trim();
}
function html(value: string): string {
  return Array.from(value).map(character => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    if (escaped[character]) return escaped[character];
    const code = character.codePointAt(0)!;
    return code < 32 || code > 126 ? `&#${code};` : character;
  }).join("");
}
function filename(invoice: PayableInvoice): string {
  // No client/contact data, path separators, quotes, or MIME/header injection in filename.
  const number = headerText(invoice.number).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || String(invoice.id);
  return `Invoice_${number}.pdf`;
}

export function buildInvoiceEmail(invoice: PayableInvoice, recipient: string, url: string): InvoiceEmail {
  const to = checkedRecipient(recipient);
  const link = checkedUrl(url);
  const amounts = totals(invoice);
  const payable = invoice.status !== "void" && invoice.status !== "payment_review" && amounts.balance > 0;
  const summary = [
    `<p>Hi ${html(invoice.clientName)},</p>`,
    `<p>Please find invoice <strong>${html(invoice.number)}</strong> attached for services from ${html(invoice.from)} through ${html(invoice.to)}.</p>`,
    `<p>All-service total: <strong>${cents(amounts.total)}</strong><br>Payments applied (net): ${cents(amounts.paid)}<br>All-service balance: <strong>${cents(amounts.balance)}</strong><br>Due date: ${html(invoice.dueDate)}</p>`,
    amounts.selected === undefined ? "" : `<p>Selected service balance: ${cents(amounts.selected)}. This selection does not change the all-service invoice balance.</p>`,
    ...invoice.receipts.map(receipt => `<p>Payment received (gross): ${cents(receipt.amountCents)}${receipt.refundedCents === undefined ? "" : `<br>Refunded: ${cents(receipt.refundedCents)}<br>Receipt amount after refund: ${cents(receipt.amountCents - receipt.refundedCents)}`}</p>`),
    invoice.status === "void" ? "<p>This invoice is void and is not payable.</p>" : invoice.status === "payment_review" ? "<p>A payment adjustment needs review before another payment can be accepted.</p>" : amounts.balance === 0 ? "<p>This invoice is paid. You can review the invoice and payment receipts below.</p>" : "<p>Review your services and choose which outstanding services to pay using the secure invoice link below.</p>",
    `<p><a href="${html(link)}">View invoice${payable ? " and pay securely" : " and receipts"}</a></p>`,
    "<p>Thank you for choosing Maids In Black!</p>",
  ];
  return { to, subject: `Your Maids In Black Invoice ${headerText(invoice.number).slice(0, 120)}`, bodyHtml: summary.filter(Boolean).join("\n"), attachmentFilename: filename(invoice) };
}

/** StandardFonts uses WinAnsi, not full Unicode. Preserve supported glyphs, transliterate
 * unsupported Latin glyphs where possible, and visibly replace unsupported runs. */
function printable(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  const aliases: Record<string, string> = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i", "−": "-", "ﬁ": "fi", "ﬂ": "fl" };
  let missing = false;
  let result = "";
  for (const character of Array.from(text.replace(/[\u0000-\u001f\u007f]/g, " "))) {
    let value = character;
    if (!supported.has(character.codePointAt(0)!)) {
      value = aliases[character] ?? character.normalize("NFKD").replace(new RegExp("\\p{Mark}", "gu"), "");
    }
    if (!value || !Array.from(value).every(part => supported.has(part.codePointAt(0)!))) {
      if (!missing) result += "[unavailable]";
      missing = true;
    } else {
      result += value;
      missing = false;
    }
  }
  return result;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = [];
  let line = "";
  // Character-based hard wrapping also handles opaque tokens and long words safely.
  for (const character of printable(text, font)) {
    if (line && font.widthOfTextAtSize(line + character, size) > width) {
      result.push(line.trimEnd());
      line = character === " " ? "" : character;
    } else line += character;
  }
  result.push(line.trimEnd());
  return result;
}

export async function generatePayableInvoicePdf(invoice: PayableInvoice, url: string): Promise<Uint8Array> {
  const link = checkedUrl(url);
  const amounts = totals(invoice);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(printable(`Invoice ${invoice.number}`, regular));
  doc.setAuthor("Maids In Black");
  let page!: PDFPage;
  let y = 0;
  let replaced = false;

  function draw(text: string, x: number, at: number, size = 9, font = regular, color = DARK) {
    const safe = printable(text, font);
    if (safe !== text.replace(/[\u0000-\u001f\u007f]/g, " ")) replaced = true;
    page.drawText(safe, { x, y: at, size, font, color });
  }
  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    draw("MAIDS IN BLACK", MARGIN, 746, 14, bold, ORANGE);
    draw(`Invoice | Page ${doc.getPageCount()}`, MARGIN, 728, 9, regular, GRAY);
    page.drawLine({ start: { x: MARGIN, y: 718 }, end: { x: PAGE_WIDTH - MARGIN, y: 718 }, thickness: 1, color: ORANGE });
    y = 698;
  }
  function ensure(height: number) { if (y - height < BOTTOM) newPage(); }
  function paragraph(text: string, font = regular, size = 9) {
    // The wrapping itself sanitizes text; track fallback before it discards original glyphs.
    if (printable(text, font) !== text.replace(/[\u0000-\u001f\u007f]/g, " ")) replaced = true;
    for (const line of wrap(text, font, size, WIDTH)) {
      ensure(size + 5);
      draw(line, MARGIN, y, size, font);
      y -= size + 5;
    }
  }
  function tableHeader() {
    ensure(28);
    page.drawRectangle({ x: MARGIN, y: y - 18, width: WIDTH, height: 22, color: ORANGE });
    draw("Service date", MARGIN + 5, y - 10, 8, bold, rgb(1, 1, 1));
    draw("Description", 135, y - 10, 8, bold, rgb(1, 1, 1));
    draw("Service amount", 402, y - 10, 8, bold, rgb(1, 1, 1));
    draw("Balance", 518, y - 10, 8, bold, rgb(1, 1, 1));
    y -= 32;
  }
  function right(text: string, edge: number, at: number) {
    draw(text, edge - regular.widthOfTextAtSize(text, 9), at);
  }

  newPage();
  paragraph(`Invoice: ${invoice.number}`, bold, 12);
  paragraph(`Bill to: ${invoice.clientName}`);
  // Date-only snapshots are Washington service calendar dates: never convert them via UTC.
  paragraph(`Service period: ${invoice.from} through ${invoice.to} | Due: ${invoice.dueDate}`);
  paragraph(`Status: ${invoice.status.replace(/_/g, " ")} | Currency: USD`);
  y -= 8;
  tableHeader();
  for (const line of invoice.lines) {
    if (printable(line.description, regular) !== line.description.replace(/[\u0000-\u001f\u007f]/g, " ")) replaced = true;
    const description = wrap(line.description, regular, 9, 253);
    // Split even a single exceptionally long description across pages, with context repeated.
    let offset = 0;
    while (offset < description.length) {
      if (y - 24 < BOTTOM) { newPage(); tableHeader(); }
      const capacity = Math.max(1, Math.floor((y - BOTTOM - 10) / 13));
      const chunk = description.slice(offset, offset + capacity);
      draw(line.date, MARGIN + 5, y);
      chunk.forEach((text, index) => draw(text, 135, y - index * 13));
      right(cents(line.amountCents), 477, y);
      right(cents(line.amountCents - line.paidCents), 559, y);
      y -= Math.max(24, chunk.length * 13 + 10);
      page.drawLine({ start: { x: MARGIN, y: y + 5 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 5 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
      offset += chunk.length;
    }
  }
  const summaryHeight = amounts.selected === undefined ? 72 : 90;
  ensure(summaryHeight);
  y -= 6;
  paragraph(`All-service total: ${cents(amounts.total)}`, bold);
  paragraph(`Payments applied (net): ${cents(amounts.paid)}`);
  paragraph(`All-service balance: ${cents(amounts.balance)}`, bold, 11);
  if (amounts.selected !== undefined) paragraph(`Selected service balance: ${cents(amounts.selected)} (not the all-service balance)`);
  if (invoice.receipts.length) {
    ensure(42);
    y -= 8;
    paragraph("Payment receipts", bold, 11);
    paragraph("Receipt amounts below are gross payments; the balance above uses net applied payments.", regular, 8);
    for (const receipt of invoice.receipts) {
      ensure(28);
      paragraph(`Payment received (gross): ${cents(receipt.amountCents)} | ${PAYMENT_DATE.format(new Date(receipt.paidAt))}`);
      paragraph(`Services: ${receipt.lineIds.join(", ") || "No allocation recorded"}`, regular, 8);
      if (receipt.refundedCents !== undefined) {
        paragraph(`Refunded: ${cents(receipt.refundedCents)} | Receipt amount after refund: ${cents(receipt.amountCents - receipt.refundedCents)}`);
      }
    }
  }
  ensure(62);
  y -= 8;
  paragraph(invoice.status === "void" ? "View void invoice (not payable)" : invoice.status === "payment_review" ? "View invoice (payment adjustment needs review; not payable)" : amounts.balance === 0 ? "View paid invoice and receipts" : "View invoice and choose services to pay securely", bold, 10);
  // A true URI annotation preserves the exact server-validated opaque URL without rendering
  // or truncating it. It is never written to public storage or diagnostic logs.
  const annotation = doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [MARGIN, y - 8, MARGIN + WIDTH, y + 18],
    Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(link) },
  }));
  page.node.set(PDFName.of("Annots"), doc.context.obj([annotation]));
  paragraph("Click here to open your secure invoice", regular, 9);
  if (replaced) {
    ensure(38);
    y -= 6;
    paragraph("Some unsupported characters were transliterated or marked [unavailable] in this PDF.", regular, 8);
  }
  doc.getPages().forEach((item, index) => {
    item.drawText(`Maids In Black | Invoice | Page ${index + 1} of ${doc.getPageCount()}`, {
      x: MARGIN, y: 48, size: 8, font: regular, color: GRAY,
    });
  });
  return doc.save();
}

const lazyGmailTransport: InvoiceEmailTransport = async message => {
  const { sendNewGmailEmailWithAttachment } = await import("./gmailService");
  return sendNewGmailEmailWithAttachment(message);
};

/** Explicit human-triggered delivery ONLY. The admin route must bind verifiedRecipient to
 * this invoice's stored client email and validate url's configured origin before calling.
 * Reservation, authorization, retries and durable delivery status are owned by the caller.
 * No draft/send hooks, DB access, uploads, automatic retries or other side effects live here. */
export async function sendPayableInvoiceEmail(
  invoice: PayableInvoice,
  url: string,
  verifiedRecipient: string,
  transport: InvoiceEmailTransport = lazyGmailTransport,
): Promise<{ messageId: string; threadId: string }> {
  const email = buildInvoiceEmail(invoice, verifiedRecipient, url);
  const pdf = await generatePayableInvoicePdf(invoice, url);
  return transport({
    to: email.to, subject: email.subject, bodyHtml: email.bodyHtml,
    attachments: [{ url: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`, filename: email.attachmentFilename, mimeType: "application/pdf" }],
  });
}
