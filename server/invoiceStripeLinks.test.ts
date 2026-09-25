import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("native Stripe invoice links", () => {
  it("creates one Stripe-hosted manual-payment invoice only at the human email-send action", () => {
    const router = read("server/invoiceRouter.ts");

    expect(router).toContain("createNativeStripeInvoice");
    expect(router).toContain('collection_method: "send_invoice"');
    expect(router).toContain("auto_advance: false");
    expect(router).toContain("stripe.invoices.finalizeInvoice");
    expect(router).toContain("finalized.hosted_invoice_url");
    expect(router).not.toContain("stripe.invoices.sendInvoice");
    expect(router).toContain("createNativeStripeInvoice({");
    expect(router).toContain("recipientEmail: toEmail");
  });

  it("keeps the existing human-triggered email and appends the unique payment URL to it", () => {
    const router = read("server/invoiceRouter.ts");

    expect(router).toContain("You can pay securely online here");
    expect(router).toContain("Preserve the human-edited message and retain the unique payment URL.");
    expect(router).toContain("sendNewGmailEmailWithAttachment");
  });

  it("settles Stripe-backed invoices exclusively from signed invoice webhook events", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    const router = read("server/invoiceRouter.ts");
    const store = read("drizzle/invoiceStripeLinks.ts");

    expect(webhook).toContain('object.object === "invoice"');
    expect(webhook).toContain('event.type === "invoice.paid"');
    expect(webhook).toContain("findBoundLeadflowInvoice");
    expect(router).toContain("Stripe-backed invoices are marked paid only by the signed Stripe webhook.");
    expect(store).toContain('mysqlTable("invoice_stripe_links"');
    expect(store).toContain('uniqueIndex("uq_invoice_stripe_links_stripe_invoice")');
  });

  it("registers the isolated payment-link table with Railway's managed pre-deploy migration runner", () => {
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json")) as {
      migrations: Array<{ id: string; sqlFile: string; sha256: string; mode?: string; postconditionsFile: string }>;
    };
    const entry = manifest.migrations.find((migration) => migration.id === "0042_create_invoice_stripe_links");
    expect(entry).toMatchObject({
      mode: "create-table",
      sqlFile: "0042_create_invoice_stripe_links.sql",
      postconditionsFile: "0042_create_invoice_stripe_links.postconditions.json",
    });
    const sql = read(`server/versioned-migrations/${entry!.sqlFile}`);
    const postconditions = read(`server/versioned-migrations/${entry!.postconditionsFile}`);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `invoice_stripe_links`");
    expect(sql).not.toMatch(/^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    expect(postconditions).toContain('"table": "invoice_stripe_links"');
    expect(createHash("sha256").update(sql).digest("hex")).toBe(entry!.sha256);
  });
});
