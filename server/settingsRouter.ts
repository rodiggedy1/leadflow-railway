/**
 * settingsRouter — admin-only tRPC procedures for managing app settings.
 *
 * Settings are stored in the app_settings table as key-value pairs.
 * On first access, default settings are seeded if the table is empty.
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { appSettings } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ── Default settings seeded on first access ──────────────────────────────────

const DEFAULT_SETTINGS = [
  {
    key: "googleReviewUrl",
    value: "https://share.google/Tm468dywmXkUnBQBL",
    label: "Google Review URL",
    description: "The link sent to customers when they leave a 5-star rating. Update this if your Google Review link changes.",
    fieldType: "url",
  },
  {
    key: "trackerSmsTemplate",
    value: "Hi {firstName}! Your Maids in Black team is on the way today. Track your clean in real time here: {trackerLink} 🧹",
    label: "Tracker Link SMS Template",
    description: "Message sent at 8 AM on job day. Use {firstName} and {trackerLink} as placeholders.",
    fieldType: "textarea",
  },
  {
    key: "autoGoogleReviewOnFiveStar",
    value: "true",
    label: "Auto-send Google Review SMS on 5-star rating",
    description: "When a customer taps 5 stars on the tracker page, automatically send them the Google Review link via SMS.",
    fieldType: "toggle",
  },
  {
    key: "googleReviewSmsTemplate",
    value: "Hi {firstName}! 🌟 Thank you so much for the 5-star rating! We'd love it if you could share your experience on Google — it helps us a ton: {reviewLink}",
    label: "Google Review SMS Template",
    description: "Message sent after a 5-star tracker rating. Use {firstName} for the customer's name and {reviewLink} for the Google Review URL.",
    fieldType: "textarea",
  },
  {
    key: "businessPhone",
    value: "(202) 888-5362",
    label: "Business Phone Number",
    description: "Displayed on the customer tracker page as the contact number.",
    fieldType: "text",
  },
  {
    key: "businessName",
    value: "Maids in Black",
    label: "Business Name",
    description: "Displayed on the customer tracker page and in SMS messages.",
    fieldType: "text",
  },
  {
    key: "trackerSmsEnabled",
    value: "false",
    label: "Enable Tracker Link SMS (8 AM daily)",
    description: "When enabled, the system will automatically text tracker links to all customers with a job today at 8 AM ET.",
    fieldType: "toggle",
  },
  {
    key: "smsFlow",
    value: "B",
    label: "SMS Conversation Flow",
    description: "Flow A (Madison): sends price upfront in SMS 1, then asks for availability. Flow B (Jade): greets + asks for day first, reveals price in SMS 2. Split: randomly assigns A or B to each new lead for A/B testing.",
    fieldType: "select",
  },
  // ── Flow B (Jade) SMS Templates ───────────────────────────────────────────
  {
    key: "flowB_sms1",
    value: "Hey {firstName}! Jade here from Maids in Black 😊 Got your request — we'd love to help. What day were you thinking?",
    label: "Flow B — SMS 1: Greeting",
    description: "Sent immediately after the lead submits the quote form. Use {firstName} for the lead's first name.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms2",
    value: "Perfect. We handle a lot of {bedrooms} bed / {bathrooms} bath homes — no problem at all.\n\nJust so you know upfront: we bring all our own supplies and get everything done in one visit. Kitchens, bathrooms, floors, surfaces — the works. 🧹\n\nFor a home like yours, most clients land around ${price}. That covers everything, no hidden fees or surprises.\nI've got {day} at 9am or 1pm — which one should I lock in?",
    label: "Flow B — SMS 2: Price Reveal",
    description: "Sent after the lead names a day. Use {firstName}, {bedrooms}, {bathrooms}, {price}, {day} as placeholders.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms3",
    value: "Awesome {firstName}, what's the address for service?",
    label: "Flow B — SMS 3: Address Request",
    description: "Sent after the lead picks a time (9am or 1pm). Use {firstName} for the lead's first name.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms4",
    value: "Perfect, locking that in for you now ✅\nAnything I should pass to the team? (pets, gate code, anything like that)\nWe'll do a quick 60-sec call to confirm details — should I call now or in a few minutes?",
    label: "Flow B — SMS 4: Lock-In + Notes + Call Question",
    description: "Sent after the lead provides their address. Use {slot} for the booked time slot.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms5",
    value: "Perfect! Expect a call from us shortly. We look forward to serving you! 🏠✨",
    label: "Flow B — SMS 5: Call Confirmed (Now)",
    description: "Sent when the lead says to call now.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms5_later",
    value: "No problem! We'll give you a call in a few minutes. Talk soon! 🏠✨",
    label: "Flow B — SMS 5: Call Confirmed (Few Minutes)",
    description: "Sent when the lead says to call in a few minutes.",
    fieldType: "textarea",
  },
  // ── Flow A (Madison) SMS Templates ────────────────────────────────────────
  {
    key: "flowA_sms1",
    value: "Hi {firstName}! Madison here from Maids in Black. Your {serviceType} quote for a {bedrooms} bed / {bathrooms} bath home is ${price} — our fully insured team handles everything. 🏠",
    label: "Flow A — SMS 1: Price Quote (Madison)",
    description: "Sent immediately with a photo of Madison. Use {firstName}, {serviceType}, {bedrooms}, {bathrooms}, {price}.",
    fieldType: "textarea",
  },
  {
    key: "flowA_sms2",
    value: "We have openings {slot1} or {slot2} — which works better for you?",
    label: "Flow A — SMS 2: Availability Question",
    description: "Sent immediately after SMS 1. Use {slot1} and {slot2} for the two available days.",
    fieldType: "textarea",
  },
  {
    key: "flowA_sms3",
    value: "Great — {slot} it is! 🗓️\n\nWould morning or afternoon work better for you?",
    label: "Flow A — SMS 3: Time Preference",
    description: "Sent after the lead picks a day. Use {slot} for the chosen day.",
    fieldType: "textarea",
  },
  {
    key: "flowA_sms4",
    value: "{timePref} works! What's the address for the cleaning?",
    label: "Flow A — SMS 4: Address Request",
    description: "Sent after the lead picks morning or afternoon. Use {timePref} for the time preference.",
    fieldType: "textarea",
  },
  {
    key: "flowA_sms5",
    value: "Perfect — I've reserved {slot} for you at {address}.\n\nWe just do a quick 60-second confirmation call to finalize the booking and make sure we have everything correct.\n\nShould we call you now or in a few minutes?",
    label: "Flow A — SMS 5: Confirmation",
    description: "Sent after the lead provides their address. Use {slot} and {address}.",
    fieldType: "textarea",
  },
  {
    key: "flowA_sms6",
    value: "Perfect! Expect a call from us shortly. We look forward to serving you! 🏠✨",
    label: "Flow A — SMS 6: Call Confirmed (Now)",
    description: "Sent when the lead says to call now.",
    fieldType: "textarea",
  },
  {
    key: "flowA_sms6_later",
    value: "No problem! We'll give you a call in a few minutes. Talk soon! 🏠✨",
    label: "Flow A — SMS 6: Call Confirmed (Few Minutes)",
    description: "Sent when the lead says to call in a few minutes.",
    fieldType: "textarea",
  },
] as const;

async function seedDefaultSettings() {
  const db = await getDb();
  if (!db) return;
  for (const setting of DEFAULT_SETTINGS) {
    // Insert only if the key doesn't already exist
    await db
      .insert(appSettings)
      .ignore()
      .values(setting);
  }
}

/**
 * Get a single setting value from the DB, with a fallback default.
 * Used server-side by the conversation engine to read editable SMS templates.
 */
export async function getSetting(key: string, fallback = ""): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return fallback;
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    return rows[0]?.value ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fetch an SMS flow template from appSettings and substitute placeholder variables.
 * e.g. getFlowTemplate("flowB_sms1", "{firstName}", { "{firstName}": "Sarah" })
 */
export async function getFlowTemplate(
  key: string,
  fallback: string,
  vars?: Record<string, string>
): Promise<string> {
  let body = await getSetting(key, fallback);
  if (vars) {
    for (const [placeholder, value] of Object.entries(vars)) {
      body = body.replaceAll(placeholder, value);
    }
  }
  return body;
}

export const settingsRouter = router({
  /**
   * Get all settings. Seeds defaults on first access.
   */
  getAll: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await seedDefaultSettings();
    const rows = await db.select().from(appSettings).orderBy(appSettings.id);
    return rows;
  }),

  /**
   * Get a single setting by key.
   */
  get: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await seedDefaultSettings();
      const rows = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, input.key))
        .limit(1);
      return rows[0] ?? null;
    }),

  /**
   * Update a single setting value.
   */
  update: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .update(appSettings)
        .set({ value: input.value })
        .where(eq(appSettings.key, input.key));
      return { success: true };
    }),
});
