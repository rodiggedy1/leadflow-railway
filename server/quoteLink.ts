/**
 * quoteLink.ts
 *
 * Calls the external quote app API to generate a personalized quote page
 * for a lead and returns the public URL to send via SMS.
 */

import { ENV } from "./_core/env";

export interface QuoteLinkParams {
  customerName: string;
  customerPhone: string;
  bedrooms: string | number;
  bathrooms: string | number;
  serviceType?: string;
  frequency?: string;
  price: string | number;
  slots?: string[];
  source?: string;
  conversationSummary?: string;
}

export interface QuoteLinkResult {
  url: string;
  slug: string;
  quoteId: string;
}

/**
 * Creates a personalized quote page in the quote app and returns its public URL.
 * Returns null if the quote app is unavailable or misconfigured — callers should
 * fall back to the plain-text price SMS in that case.
 */
export async function createQuoteLink(params: QuoteLinkParams): Promise<QuoteLinkResult | null> {
  const { quoteAppUrl, quoteAppSecret } = ENV;

  if (!quoteAppSecret || !quoteAppUrl) {
    console.warn("[QuoteLink] QUOTE_APP_SECRET or QUOTE_APP_URL not configured — skipping quote page generation");
    return null;
  }

  try {
    const res = await fetch(`${quoteAppUrl}/api/quotes/create-from-leadflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": quoteAppSecret,
      },
      body: JSON.stringify({
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        bedrooms: Number(params.bedrooms) || 0,
        bathrooms: Number(params.bathrooms) || 0,
        serviceType: params.serviceType ?? "Standard Cleaning",
        frequency: params.frequency ?? "One-time",
        price: Number(params.price) || 0,
        slots: params.slots ?? [],
        source: params.source ?? "LeadFlow SMS",
        conversationSummary: params.conversationSummary ?? "",
      }),
    });

    if (!res.ok) {
      console.error(`[QuoteLink] Quote app returned ${res.status} for ${params.customerPhone}`);
      return null;
    }

    const json = (await res.json()) as QuoteLinkResult;
    if (!json?.url) {
      console.error("[QuoteLink] Quote app response missing url field:", json);
      return null;
    }

    console.log(`[QuoteLink] Created quote page for ${params.customerPhone}: ${json.url}`);
    return json;
  } catch (err) {
    console.error("[QuoteLink] Failed to create quote page:", err);
    return null;
  }
}
