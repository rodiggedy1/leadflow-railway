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
  const tokenSecret = env.INVOICE_TOKEN_SECRET ?? "";
  const webhookSecret = env.INVOICE_STRIPE_WEBHOOK_SECRET ?? "";
  const stripeSecretKey = env.STRIPE_SECRET_KEY ?? "";
  const missing: string[] = [];
  if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
  if (tokenSecret.length < 32) missing.push("INVOICE_TOKEN_SECRET");
  if (!webhookSecret) missing.push("INVOICE_STRIPE_WEBHOOK_SECRET");
  return {
    origin: invoiceRuntimeOrigin(env), tokenSecret, webhookSecret, stripeSecretKey,
    paymentsReady: missing.length === 0,
    missing,
    message: missing.length ? `Invoice payment setup is incomplete: ${missing.join(", ")}. Booking lookup remains available.` : "",
  };
}
