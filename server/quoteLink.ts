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
 * Parse a bedroom/bathroom value that may be a number or a string like "2 Bedrooms" / "1 Bathroom".
 * Returns the integer count, defaulting to 1 if parsing fails.
 */
function parseRoomCount(value: string | number): number {
  if (typeof value === "number") return value || 1;
  // Extract the first integer from strings like "2 Bedrooms", "1 Bathroom", "Studio"
  const match = String(value).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

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
        bedrooms: parseRoomCount(params.bedrooms),
        bathrooms: parseRoomCount(params.bathrooms),
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
