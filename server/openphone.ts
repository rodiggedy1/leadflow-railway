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
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends an SMS via the OpenPhone API from the configured sender number.
 */
export async function sendSms({ to, content }: SendSmsParams): Promise<SendSmsResult> {
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
 * Simple price estimation table.
 * Replace with ChatGPT-powered dynamic pricing when ready.
 */
function estimatePrice(params: {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
}): string {
  const { bedrooms, bathrooms, serviceType } = params;

  // Base price by bedroom count
  const bedroomBase: Record<string, number> = {
    "Studio": 80,
    "1 Bedroom": 100,
    "2 Bedrooms": 130,
    "3 Bedrooms": 160,
    "4 Bedrooms": 190,
    "5+ Bedrooms": 220,
  };

  // Bathroom multiplier
  const bathroomAdd: Record<string, number> = {
    "1 Bathroom": 0,
    "1.5 Bathrooms": 15,
    "2 Bathrooms": 25,
    "2.5 Bathrooms": 35,
    "3 Bathrooms": 45,
    "3.5+ Bathrooms": 60,
  };

  // Service type multiplier
  const serviceMultiplier: Record<string, number> = {
    "Standard Cleaning": 1.0,
    "Deep Cleaning": 1.5,
    "Move-In / Move-Out Cleaning": 1.6,
    "Post-Construction Cleaning": 1.8,
    "Office Cleaning": 1.2,
    "Recurring Service": 0.9,
  };

  const base = bedroomBase[bedrooms] ?? 120;
  const bathExtra = bathroomAdd[bathrooms] ?? 0;
  const multiplier = serviceMultiplier[serviceType] ?? 1.0;

  const total = Math.round((base + bathExtra) * multiplier);
  return total.toString();
}
