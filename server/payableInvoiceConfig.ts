import { createHmac } from "node:crypto";
import { InvoiceError } from "../shared/payableInvoice";

export const INVOICE_PRODUCTION_ORIGIN = "https://quote.maidinblack.com";

/** Invoice-only trusted origins. Never inherit the old global quote-site URL. */
export function invoiceRuntimeOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const domain = env.PREVIEW_MODE === "true" ? env.RAILWAY_PUBLIC_DOMAIN : undefined;
  const value = domain ? `https://${domain}` : INVOICE_PRODUCTION_ORIGIN;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new InvoiceError("INVOICE_ORIGIN_INVALID", 503, "The invoice return URL is not configured correctly."); }
  if (parsed.origin !== value || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new InvoiceError("INVOICE_ORIGIN_INVALID", 503, "The invoice return URL is not configured correctly.");
  return value;
}

/** Values stay server-side; routes expose only readiness and safe setting names. */
export function invoiceConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const webhookSecret = env.INVOICE_STRIPE_WEBHOOK_SECRET ?? "";
  const stripeSecretKey = env.STRIPE_SECRET_KEY ?? "";
  // Reuse the configured payment credential through an invoice-only derivation.
  // An existing dedicated key remains authoritative so its links do not change.
  const tokenSecret = env.INVOICE_TOKEN_SECRET || (stripeSecretKey
    ? createHmac("sha256", stripeSecretKey).update("leadflow:invoice-token-key:v1").digest("hex")
    : "");
  const missing: string[] = [];
  if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
  if (tokenSecret.length < 32) missing.push("INVOICE_TOKEN_SECRET");
  // Checkout is confirmed through the existing Stripe API refresh/resume path.
  // Webhook handling still requires its own verified signature when configured.
  return {
    origin: invoiceRuntimeOrigin(env), tokenSecret, webhookSecret, stripeSecretKey,
    paymentsReady: missing.length === 0,
    missing,
    message: missing.length ? `Invoice payment setup is incomplete: ${missing.join(", ")}. Booking lookup remains available.` : "",
  };
}
