/**
 * OpenPhone SMS Service
 * Sends text messages via the OpenPhone API v1
 * Docs: https://www.quo.com/docs/mdx/api-reference/messages/send-a-text-message
 */

import { ENV } from "./_core/env";

const OPENPHONE_API_URL = "https://api.openphone.com/v1/messages";

export interface SendSmsParams {
  to: string;       // Recipient phone number in E.164 format, e.g. "+12025551234"
  content: string;  // Text content of the message (1–1600 chars)
  mediaUrl?: string; // Optional MMS media URL (image/photo to attach)
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends an SMS via the OpenPhone API from the configured sender number.
 */
export async function sendSms({ to, content, mediaUrl }: SendSmsParams): Promise<SendSmsResult> {
  const apiKey = ENV.openPhoneApiKey;
  const fromNumberId = ENV.openPhoneNumberId;

  if (!apiKey || !fromNumberId) {
    console.error("[OpenPhone] Missing API key or phone number ID");
    return { success: false, error: "OpenPhone credentials not configured" };
  }

  try {
    const response = await fetch(OPENPHONE_API_URL, {
      method: "POST",
      headers: {
        "Authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        from: fromNumberId,
        to: [to],
        setInboxStatus: "done",
        ...(mediaUrl ? { media: [mediaUrl] } : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[OpenPhone] API error ${response.status}:`, errorBody);
      return {
        success: false,
        error: `OpenPhone API returned ${response.status}: ${errorBody}`,
      };
    }

    const data = await response.json() as { data: { id: string } };
    const messageId = data?.data?.id;

    console.log(`[OpenPhone] SMS sent successfully. Message ID: ${messageId}`);
    return { success: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[OpenPhone] Fetch error:", message);
    return { success: false, error: message };
  }
}

/**
 * Builds the initial quote SMS message for a lead.
 * Business: Maids in Black
 */
export function buildQuoteSmsMessage(params: {
  name: string;
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
}): string {
  const { name, bedrooms, bathrooms, serviceType } = params;
  const firstName = name.split(" ")[0] ?? name;

  // Pricing estimate logic (simple flat-rate table, can be replaced with ChatGPT later)
  const price = estimatePrice({ bedrooms, bathrooms, serviceType });

  return `Hi ${firstName}! Thanks for requesting a quote with Maids in Black. Based on your ${bedrooms} / ${bathrooms} home, here's your estimate: $${price}. Reply to this message with any questions!`;
}

/**
 * Real Maids in Black pricing table.
 *
 * Standard base prices (1 bathroom included):
 *   1 bed = $179, 2 bed = $209, 3 bed = $229, 4 bed = $279,
 *   5 bed = $319, 6 bed = $379, 7 bed = $419
 *
 * Additional bathrooms: +$30 each beyond the first.
 *
 * Service type surcharge:
 *   Standard Cleaning: +$0
 *   Deep Cleaning: +$60
 *   Move-In / Move-Out Cleaning: +$60
 *   Post-Construction Cleaning: +$60
 */
export function estimatePrice(params: {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
}): string {
  const { bedrooms, bathrooms, serviceType } = params;

  // Base price by bedroom count (includes 1 bathroom)
  const bedroomBase: Record<string, number> = {
    "Studio":       179,
    "1 Bedroom":    179,
    "2 Bedrooms":   209,
    "3 Bedrooms":   229,
    "4 Bedrooms":   279,
    "5 Bedrooms":   319,
    "6 Bedrooms":   379,
    "7 Bedrooms":   419,
    "7+ Bedrooms":  419,
  };

  // Additional bathrooms beyond the first: $30 each
  const bathroomCount: Record<string, number> = {
    "1 Bathroom":     1,
    "1.5 Bathrooms":  1,  // treat as 1 (half-baths don't add)
    "2 Bathrooms":    2,
    "2.5 Bathrooms":  2,
    "3 Bathrooms":    3,
    "3.5 Bathrooms":  3,
    "4 Bathrooms":    4,
    "4+ Bathrooms":   4,
  };

  // ── Office Cleaning: square footage-based pricing ──────────────────────────
  // Industry-standard commercial cleaning rates: ~$0.07–$0.15/sqft
  // Using $0.10/sqft as the base rate (mid-market DC commercial rate)
  if (serviceType === "Office Cleaning") {
    const officePricing: Record<string, number> = {
      "Under 500 sq ft":       75,   // minimum visit charge
      "500\u20131,000 sq ft":     120,
      "1,000\u20132,000 sq ft":   175,
      "2,000\u20133,000 sq ft":   250,
      "3,000\u20135,000 sq ft":   375,
      "5,000\u201310,000 sq ft":   650,
      "10,000+ sq ft":         999,  // custom quote — AI will note this
    };
    // bedrooms field holds the sqft range when service is Office Cleaning
    const price = officePricing[bedrooms];
    if (price) return price.toString();
    return "custom"; // triggers AI to say "let's get you a custom quote"
  }

  // Service type flat surcharge
  const serviceSurcharge: Record<string, number> = {
    "Standard Cleaning":          0,
    "Deep Cleaning":              60,
    "Move-In / Move-Out Cleaning": 60,
    "Post-Construction Cleaning": 60,
  };

  const base = bedroomBase[bedrooms] ?? 179;
  const baths = bathroomCount[bathrooms] ?? 1;
  const extraBaths = Math.max(0, baths - 1);
  const bathExtra = extraBaths * 30;
  const surcharge = serviceSurcharge[serviceType] ?? 0;

  const total = base + bathExtra + surcharge;
  return total.toString();
}
