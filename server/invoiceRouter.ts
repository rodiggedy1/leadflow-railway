/**
 * invoiceRouter.ts
 * Invoice template management and PDF generation for Maids in Black.
 *
 * Procedures:
 *   invoice.createTemplate      — create a new per-customer invoice template
 *   invoice.updateTemplate      — update an existing template
 *   invoice.deleteTemplate      — delete a template
 *   invoice.listTemplates       — list all templates (optionally filter by customerName)
 *   invoice.getTemplate         — get a single template by id
 *   invoice.generateInvoice     — generate PDF from template + serviceDate, store in R2, return URL
 *   invoice.listInvoices        — list generated invoices (optionally filter by customerName)
 *   invoice.getInvoice          — get a single invoice by id
 *   invoice.deleteInvoice       — delete an invoice record
 */
import { router, adminAgentProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { invoiceTemplates, invoices, completedJobs } from "../drizzle/schema";
import { eq, desc, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";
import { MIB_LOGO_B64 } from "./invoiceLogo";
import { storagePut } from "./storage";
import { sendNewGmailEmailWithAttachment } from "./gmailService";

// ─── Types ────────────────────────────────────────────────────────────────────

const lineItemSchema = z.object({
  date: z.string(),
  description: z.string(),
  price: z.number(), // in dollars (e.g. 230.00)
});

type LineItem = z.infer<typeof lineItemSchema>;

// ─── PDF Generation ───────────────────────────────────────────────────────────

// Burnt orange color #C8573A
const ORANGE = rgb(200 / 255, 87 / 255, 58 / 255);
// Light orange background for payment box
const LIGHT_ORANGE = rgb(253 / 255, 242 / 255, 238 / 255);
// Dark text
const DARK = rgb(0.1, 0.1, 0.1);
// Medium gray
const GRAY = rgb(0.45, 0.45, 0.45);
// Light gray for dividers
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
// White
const WHITE = rgb(1, 1, 1);

// Page dimensions: US Letter in points (72 pts/inch)
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

function pts(n: number) { return n; }

export async function generateInvoicePdf(params: {
  invoiceNumber: number;
  customerName: string;
  billTo: string;
  serviceAddress: string;
  stripeLink: string;
  lineItems: LineItem[];
  totalCents: number;
  serviceDate: string;
  billingDate: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);

  // Embed fonts
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);

  // Embed logo
  const b64 = MIB_LOGO_B64.split("base64,")[1];
  const logoBytes = Buffer.from(b64, "base64");
  const logoImg = await doc.embedPng(logoBytes);

  // ── Header: logo top-left, company info top-right ──────────────────────────
  const LOGO_SIZE = 72;
  const HEADER_TOP = PAGE_H - MARGIN;

  // Logo (top-left)
  page.drawImage(logoImg, {
    x: MARGIN,
    y: HEADER_TOP - LOGO_SIZE,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  });

  // Company info (top-right)
  const companyLines = [
    { text: "Maids In Black", font: fontBold, size: 14, color: ORANGE },
    { text: "Support@maidsinblacksupport.com", font: fontReg, size: 9, color: GRAY },
    { text: "202-888-5362", font: fontReg, size: 9, color: GRAY },
    { text: "MaidsInBlack.com", font: fontReg, size: 9, color: GRAY },
  ];
  let companyY = HEADER_TOP - 4;
  for (const line of companyLines) {
    const tw = line.font.widthOfTextAtSize(line.text, line.size);
    page.drawText(line.text, {
      x: PAGE_W - MARGIN - tw,
      y: companyY,
      size: line.size,
      font: line.font,
      color: line.color,
    });
    companyY -= line.size + 3;
  }

  // Thin orange divider line below header
  const DIVIDER_Y = HEADER_TOP - LOGO_SIZE - 12;
  page.drawLine({
    start: { x: MARGIN, y: DIVIDER_Y },
    end: { x: PAGE_W - MARGIN, y: DIVIDER_Y },
    thickness: 1,
    color: ORANGE,
  });

  // ── Invoice header band ────────────────────────────────────────────────────
  const BAND_H = 36;
  const BAND_Y = DIVIDER_Y - 16 - BAND_H;

  page.drawRectangle({
    x: MARGIN,
    y: BAND_Y,
    width: CONTENT_W,
    height: BAND_H,
    color: ORANGE,
  });

  // "INVOICE" label
  page.drawText("INVOICE", {
    x: MARGIN + 12,
    y: BAND_Y + (BAND_H - 14) / 2 + 2,
    size: 14,
    font: fontBold,
    color: WHITE,
  });

  // Invoice # and billing date (right side of band)
  const invNumText = `Invoice #: ${params.invoiceNumber}`;
  const billDateText = `Billing Date: ${params.billingDate}`;
  const invNumW = fontReg.widthOfTextAtSize(invNumText, 9);
  const billDateW = fontReg.widthOfTextAtSize(billDateText, 9);
  const rightX = PAGE_W - MARGIN - Math.max(invNumW, billDateW) - 8;

  page.drawText(invNumText, {
    x: rightX,
    y: BAND_Y + BAND_H - 13,
    size: 9,
    font: fontReg,
    color: WHITE,
  });
  page.drawText(billDateText, {
    x: rightX,
    y: BAND_Y + 6,
    size: 9,
    font: fontReg,
    color: WHITE,
  });

  // ── Three-column info section ──────────────────────────────────────────────
  const INFO_TOP = BAND_Y - 14;
  const COL_W = CONTENT_W / 3;
  const COL1_X = MARGIN;
  const COL2_X = MARGIN + COL_W;
  const COL3_X = MARGIN + COL_W * 2;

  // Column headers
  const colHeaders = [
    { label: "FROM", x: COL1_X },
    { label: "BILL TO", x: COL2_X },
    { label: "SERVICE ADDRESS", x: COL3_X },
  ];
  for (const h of colHeaders) {
    page.drawText(h.label, {
      x: h.x,
      y: INFO_TOP,
      size: 8,
      font: fontBold,
      color: ORANGE,
    });
  }

  // Column content
  const INFO_CONTENT_TOP = INFO_TOP - 14;

  // FROM column
  const fromLines = [
    { text: "Maids In Black", font: fontBold, size: 9 },
    { text: "Support@maidsinblacksupport.com", font: fontReg, size: 8 },
    { text: "202-888-5362", font: fontReg, size: 8 },
    { text: "MaidsInBlack.com", font: fontReg, size: 8 },
  ];
  let fromY = INFO_CONTENT_TOP;
  for (const l of fromLines) {
    page.drawText(l.text, { x: COL1_X, y: fromY, size: l.size, font: l.font, color: DARK });
    fromY -= l.size + 3;
  }

  // BILL TO column — wrap long lines
  const billToLines = wrapText(params.billTo, fontReg, 9, COL_W - 8);
  let billToY = INFO_CONTENT_TOP;
  // First line bold (customer name)
  if (billToLines.length > 0) {
    page.drawText(billToLines[0], { x: COL2_X, y: billToY, size: 9, font: fontBold, color: DARK });
    billToY -= 12;
    for (let i = 1; i < billToLines.length; i++) {
      page.drawText(billToLines[i], { x: COL2_X, y: billToY, size: 8, font: fontReg, color: DARK });
      billToY -= 11;
    }
  }

  // SERVICE ADDRESS column — wrap long lines
  const addrLines = wrapText(params.serviceAddress, fontReg, 8, COL_W - 8);
  let addrY = INFO_CONTENT_TOP;
  for (const l of addrLines) {
    page.drawText(l, { x: COL3_X, y: addrY, size: 8, font: fontReg, color: DARK });
    addrY -= 11;
  }

  // Compute where the info section ends (lowest Y of all columns)
  const INFO_BOTTOM = Math.min(fromY, billToY, addrY) - 8;

  // ── Line items table ───────────────────────────────────────────────────────
  const TABLE_TOP = INFO_BOTTOM - 8;
  const TABLE_HEADER_H = 24;

  // Table header band
  page.drawRectangle({
    x: MARGIN,
    y: TABLE_TOP - TABLE_HEADER_H,
    width: CONTENT_W,
    height: TABLE_HEADER_H,
    color: ORANGE,
  });

  // Column widths: Date | Description | Price
  const DATE_COL_W = 100;
  const PRICE_COL_W = 80;
  const DESC_COL_W = CONTENT_W - DATE_COL_W - PRICE_COL_W;

  const TH_Y = TABLE_TOP - TABLE_HEADER_H + (TABLE_HEADER_H - 9) / 2 + 1;
  page.drawText("Date of Service", {
    x: MARGIN + 6, y: TH_Y, size: 9, font: fontBold, color: WHITE,
  });
  page.drawText("Service Provided", {
    x: MARGIN + DATE_COL_W + 6, y: TH_Y, size: 9, font: fontBold, color: WHITE,
  });
  const priceHeaderW = fontBold.widthOfTextAtSize("Price", 9);
  page.drawText("Price", {
    x: MARGIN + CONTENT_W - PRICE_COL_W + (PRICE_COL_W - priceHeaderW) / 2,
    y: TH_Y, size: 9, font: fontBold, color: WHITE,
  });

  // Table rows
  let rowY = TABLE_TOP - TABLE_HEADER_H - 4;
  for (const item of params.lineItems) {
    const descLines = wrapText(item.description, fontBold, 9, DESC_COL_W - 12);
    const descSubLines = item.description.includes("—") || item.description.includes("-")
      ? [] // no sub-description if already has dash
      : [];

    // Row height: at least 28 pts
    const rowH = Math.max(28, descLines.length * 12 + 8);

    // Date
    page.drawText(item.date, {
      x: MARGIN + 6, y: rowY - 12, size: 9, font: fontReg, color: DARK,
    });

    // Description (first line bold, rest regular)
    let descY = rowY - 12;
    for (let i = 0; i < descLines.length; i++) {
      page.drawText(descLines[i], {
        x: MARGIN + DATE_COL_W + 6,
        y: descY,
        size: i === 0 ? 9 : 8,
        font: i === 0 ? fontBold : fontReg,
        color: DARK,
      });
      descY -= 11;
    }

    // Price (right-aligned)
    const priceStr = `$${item.price.toFixed(2)}`;
    const priceW = fontReg.widthOfTextAtSize(priceStr, 9);
    page.drawText(priceStr, {
      x: MARGIN + CONTENT_W - 6 - priceW,
      y: rowY - 12,
      size: 9, font: fontReg, color: DARK,
    });

    // Bottom divider
    rowY -= rowH;
    page.drawLine({
      start: { x: MARGIN, y: rowY },
      end: { x: PAGE_W - MARGIN, y: rowY },
      thickness: 0.5,
      color: LIGHT_GRAY,
    });
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const TOTALS_TOP = rowY - 12;
  const totalDollars = params.totalCents / 100;

  // Subtotal
  const subtotalLabel = "Subtotal";
  const subtotalValue = `$${totalDollars.toFixed(2)}`;
  const subtotalLabelW = fontReg.widthOfTextAtSize(subtotalLabel, 9);
  const subtotalValueW = fontReg.widthOfTextAtSize(subtotalValue, 9);
  page.drawText(subtotalLabel, {
    x: PAGE_W - MARGIN - 120 - subtotalLabelW,
    y: TOTALS_TOP,
    size: 9, font: fontReg, color: DARK,
  });
  page.drawText(subtotalValue, {
    x: PAGE_W - MARGIN - subtotalValueW,
    y: TOTALS_TOP,
    size: 9, font: fontReg, color: DARK,
  });

  // Divider above Total Due
  const TOTAL_DIVIDER_Y = TOTALS_TOP - 10;
  page.drawLine({
    start: { x: PAGE_W - MARGIN - 180, y: TOTAL_DIVIDER_Y },
    end: { x: PAGE_W - MARGIN, y: TOTAL_DIVIDER_Y },
    thickness: 0.5,
    color: LIGHT_GRAY,
  });

  // Total Due (bold, orange)
  const totalLabel = "Total Due";
  const totalValue = `$${totalDollars.toFixed(2)}`;
  const totalLabelW = fontBold.widthOfTextAtSize(totalLabel, 11);
  const totalValueW = fontBold.widthOfTextAtSize(totalValue, 11);
  page.drawText(totalLabel, {
    x: PAGE_W - MARGIN - 120 - totalLabelW,
    y: TOTAL_DIVIDER_Y - 14,
    size: 11, font: fontBold, color: ORANGE,
  });
  page.drawText(totalValue, {
    x: PAGE_W - MARGIN - totalValueW,
    y: TOTAL_DIVIDER_Y - 14,
    size: 11, font: fontBold, color: DARK,
  });

  // ── Payment box ────────────────────────────────────────────────────────────
  const PAY_BOX_TOP = TOTAL_DIVIDER_Y - 40;
  const PAY_BOX_H = 60;

  page.drawRectangle({
    x: MARGIN,
    y: PAY_BOX_TOP - PAY_BOX_H,
    width: CONTENT_W,
    height: PAY_BOX_H,
    color: LIGHT_ORANGE,
    borderColor: ORANGE,
    borderWidth: 0.5,
  });

  page.drawText("PAYMENT", {
    x: MARGIN + 10,
    y: PAY_BOX_TOP - 14,
    size: 9, font: fontBold, color: ORANGE,
  });
  page.drawText("Pay securely online via the link below:", {
    x: MARGIN + 10,
    y: PAY_BOX_TOP - 28,
    size: 8, font: fontReg, color: DARK,
  });

  // Stripe link (truncate if too long)
  const maxLinkW = CONTENT_W - 20;
  let linkText = params.stripeLink;
  while (linkText.length > 10 && fontReg.widthOfTextAtSize(linkText, 8) > maxLinkW) {
    linkText = linkText.slice(0, -4) + "...";
  }
  page.drawText(linkText, {
    x: MARGIN + 10,
    y: PAY_BOX_TOP - 42,
    size: 8, font: fontReg, color: rgb(0.1, 0.3, 0.8),
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const FOOTER_Y = MARGIN + 8;
  const footerText = "Thank you for choosing Maids In Black — Support@maidsinblacksupport.com  |  202-888-5362  |  MaidsInBlack.com";
  const footerW = fontReg.widthOfTextAtSize(footerText, 7.5);
  page.drawText(footerText, {
    x: (PAGE_W - footerW) / 2,
    y: FOOTER_Y,
    size: 7.5, font: fontReg, color: GRAY,
  });

  return doc.save();
}

// ─── Text wrapping helper ─────────────────────────────────────────────────────

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  // Split on explicit newlines first
  const paragraphs = text.split(/\n/);
  for (const para of paragraphs) {
    const words = para.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const invoiceRouter = router({
  // ── Template CRUD ──────────────────────────────────────────────────────────

  createTemplate: adminAgentProcedure
    .input(z.object({
      customerName: z.string().min(1).max(255),
      billTo: z.string().min(1),
      serviceAddress: z.string().min(1).max(500),
      stripeLink: z.string().max(1000).default(""),
      lineItems: z.array(lineItemSchema),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [result] = await db.insert(invoiceTemplates).values({
        customerName: input.customerName,
        billTo: input.billTo,
        serviceAddress: input.serviceAddress,
        stripeLink: input.stripeLink,
        lineItems: input.lineItems,
      });
      return { id: result.insertId };
    }),

  updateTemplate: adminAgentProcedure
    .input(z.object({
      id: z.number(),
      customerName: z.string().min(1).max(255).optional(),
      billTo: z.string().min(1).optional(),
      serviceAddress: z.string().min(1).max(500).optional(),
      stripeLink: z.string().max(1000).optional(),
      lineItems: z.array(lineItemSchema).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...fields } = input;
      const updates: Record<string, unknown> = {};
      if (fields.customerName !== undefined) updates.customerName = fields.customerName;
      if (fields.billTo !== undefined) updates.billTo = fields.billTo;
      if (fields.serviceAddress !== undefined) updates.serviceAddress = fields.serviceAddress;
      if (fields.stripeLink !== undefined) updates.stripeLink = fields.stripeLink;
      if (fields.lineItems !== undefined) updates.lineItems = fields.lineItems;
      if (Object.keys(updates).length === 0) return { ok: true };
      await db.update(invoiceTemplates).set(updates).where(eq(invoiceTemplates.id, id));
      return { ok: true };
    }),

  deleteTemplate: adminAgentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(invoiceTemplates).where(eq(invoiceTemplates.id, input.id));
      return { ok: true };
    }),

  listTemplates: adminAgentProcedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = input.search
        ? await db.select().from(invoiceTemplates)
            .where(like(invoiceTemplates.customerName, `%${input.search}%`))
            .orderBy(desc(invoiceTemplates.updatedAt))
        : await db.select().from(invoiceTemplates)
            .orderBy(desc(invoiceTemplates.updatedAt));
      return rows;
    }),

  getTemplate: adminAgentProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(invoiceTemplates).where(eq(invoiceTemplates.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      return row;
    }),

  // ── Invoice generation ─────────────────────────────────────────────────────

  generateInvoice: adminAgentProcedure
    .input(z.object({
      templateId: z.number(),
      serviceDate: z.string().min(1), // e.g. "June 29, 2026"
      billingDate: z.string().optional(), // defaults to today
      // Optional overrides
      stripeLink: z.string().optional(),
      lineItems: z.array(lineItemSchema).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Load template
      const [tmpl] = await db.select().from(invoiceTemplates).where(eq(invoiceTemplates.id, input.templateId));
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      // Compute next invoice number
      const [maxRow] = await db.select({ maxNum: sql<number>`MAX(invoiceNumber)` }).from(invoices);
      const nextNum = (maxRow?.maxNum ?? 0) + 1;

      // Resolve line items and total
      const lineItems = (input.lineItems ?? (tmpl.lineItems as LineItem[]));
      const totalCents = Math.round(lineItems.reduce((sum, item) => sum + item.price, 0) * 100);

      // Billing date
      const billingDate = input.billingDate ?? new Date().toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });

      // Generate PDF
      const pdfBytes = await generateInvoicePdf({
        invoiceNumber: nextNum,
        customerName: tmpl.customerName,
        billTo: tmpl.billTo,
        serviceAddress: tmpl.serviceAddress,
        stripeLink: input.stripeLink ?? tmpl.stripeLink,
        lineItems,
        totalCents,
        serviceDate: input.serviceDate,
        billingDate,
      });

      // Upload to R2
      const key = `invoices/${nextNum}-${tmpl.customerName.replace(/\s+/g, "_")}-${Date.now()}.pdf`;
      let pdfUrl = "";
      try {
        const { url } = await storagePut(key, Buffer.from(pdfBytes), "application/pdf");
        pdfUrl = url;
      } catch (e) {
        // R2 not configured — return base64 fallback
        pdfUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`;
      }

      // Look up customer email from completed_jobs (best-effort, non-fatal)
      let customerEmail: string | null = null;
      try {
        const [jobRow] = await db
          .select({ email: completedJobs.email })
          .from(completedJobs)
          .where(like(completedJobs.name, `%${tmpl.customerName}%`))
          .orderBy(desc(completedJobs.id))
          .limit(1);
        customerEmail = jobRow?.email ?? null;
      } catch { /* non-fatal */ }

      // Save invoice record
      const [ins] = await db.insert(invoices).values({
        invoiceNumber: nextNum,
        templateId: input.templateId,
        customerName: tmpl.customerName,
        serviceDate: input.serviceDate,
        billingDate,
        stripeLink: input.stripeLink ?? tmpl.stripeLink,
        lineItems,
        totalCents,
        pdfUrl,
      });

      return {
        id: ins.insertId,
        invoiceNumber: nextNum,
        pdfUrl,
        customerName: tmpl.customerName,
        billingDate,
        serviceDate: input.serviceDate,
        totalCents,
        stripeLink: input.stripeLink ?? tmpl.stripeLink ?? null,
        customerEmail,
      };
    }),
  // ── Invoice list / get ─────────────────────────────────────────────────────

  listInvoices: adminAgentProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = input.search
        ? await db.select().from(invoices)
            .where(like(invoices.customerName, `%${input.search}%`))
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit)
        : await db.select().from(invoices)
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit);
      return rows;
    }),

  getInvoice: adminAgentProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(invoices).where(eq(invoices.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      return row;
    }),

  deleteInvoice: adminAgentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(invoices).where(eq(invoices.id, input.id));
      return { ok: true };
    }),

  // ── Send invoice by email ──────────────────────────────────────────────────

  sendByEmail: adminAgentProcedure
    .input(z.object({
      invoiceId: z.number(),
      /** Override recipient email — if omitted, looked up from completed_jobs by customerName */
      toEmail: z.string().email().optional(),
      /** Override subject line */
      subject: z.string().optional(),
      /** Override plain-text body (converted to simple HTML paragraphs) */
      bodyText: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Load the invoice
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      if (!inv.pdfUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice has no PDF yet" });

      // Resolve recipient email
      let toEmail = input.toEmail ?? null;
      if (!toEmail) {
        // Look up most recent completed_jobs record with this customer name that has an email
        const [jobRow] = await db
          .select({ email: completedJobs.email })
          .from(completedJobs)
          .where(like(completedJobs.name, `%${inv.customerName}%`))
          .orderBy(desc(completedJobs.id))
          .limit(1);
        toEmail = jobRow?.email ?? null;
      }

      if (!toEmail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No email found for ${inv.customerName}. Please provide the email address manually.`,
        });
      }

      const totalDollars = (inv.totalCents / 100).toFixed(2);
      const subject = input.subject ?? `Your Invoice #${inv.invoiceNumber} from Maids In Black - $${totalDollars}`;
      let bodyHtml: string;
      if (input.bodyText) {
        // Convert plain-text body to HTML paragraphs
        bodyHtml = input.bodyText
          .split(/\n\n+/)
          .map(para => `<p>${para.replace(/\n/g, "<br>")}</p>`)
          .join("\n");
      } else {
        bodyHtml = [
          `<p>Hi ${inv.customerName.split(" ")[0]},</p>`,
          `<p>Please find your invoice attached for cleaning services on <strong>${inv.serviceDate}</strong>.</p>`,
          `<p><strong>Invoice #${inv.invoiceNumber}</strong> &mdash; Total Due: <strong>$${totalDollars}</strong></p>`,
          inv.stripeLink
            ? `<p>You can pay securely online here: <a href="${inv.stripeLink}">${inv.stripeLink}</a></p>`
            : "",
          `<p>Thank you for choosing Maids In Black!</p>`,
          `<p style="color:#888;font-size:12px">Maids In Black &bull; Support@maidsinblacksupport.com &bull; 202-888-5362 &bull; MaidsInBlack.com</p>`,
        ].join("\n");
      }

      const filename = `Invoice_${inv.invoiceNumber}_${inv.customerName.replace(/\s+/g, "_")}.pdf`;

      await sendNewGmailEmailWithAttachment({
        to: toEmail,
        subject,
        bodyHtml,
        attachments: [{ url: inv.pdfUrl, filename, mimeType: "application/pdf" }],
      });

      return { ok: true, toEmail, invoiceNumber: inv.invoiceNumber, customerName: inv.customerName };
    }),
});
