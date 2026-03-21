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
