/**
 * settingsRouter — admin-only tRPC procedures for managing app settings.
 *
 * Settings are stored in the app_settings table as key-value pairs.
 * On first access, default settings are seeded if the table is empty.
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { appSettings, customPayRules } from "../drizzle/schema";
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
    value: "Awesome, we'd love to help! What day were you thinking so we can see how fast we can get you taken care of?",
    label: "Flow B — SMS 1: Greeting",
    description: "Sent immediately after the lead submits the quote form. Use {firstName} for the lead's first name.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms2",
    value: "Perfect. We handle a lot of {bedrooms} bed / {bathrooms} bath homes — no problem at all.\n\nJust so you know upfront: we bring all our own supplies and get everything done in one visit. Kitchens, bathrooms, floors, surfaces — the works. 🧹\n\nFor a home like yours, most clients land around ${price}. That covers everything, no hidden fees or surprises{extrasLine}.\n\nI've got {day} at 9am or 1pm — which one should I lock in?",
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
    value: "Perfect — I've reserved {slot} for you at {address}. ✅\nAnything I should pass to the team? (pets, gate code, anything like that)\nWe'll do a quick 60-sec call to confirm details — should I call now or in a few minutes?",
    label: "Flow B — SMS 4: Lock-In + Notes + Call Question",
    description: "Sent after the lead provides their address. Use {slot} for the booked time slot and {address} for the address.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms5",
    value: "Perfect {firstName}! Expect a call from us shortly. We look forward to serving you! 🏠✨",
    label: "Flow B — SMS 5: Call Confirmed (Now)",
    description: "Sent when the lead says to call now. Use {firstName} for the lead's first name.",
    fieldType: "textarea",
  },
  {
    key: "flowB_sms5_later",
    value: "No problem {firstName}! We'll give you a call in a few minutes. Talk soon! 🏠✨",
    label: "Flow B — SMS 5: Call Confirmed (Few Minutes)",
    description: "Sent when the lead says to call in a few minutes. Use {firstName} for the lead's first name.",
    fieldType: "textarea",
  },
  // ── Widget SMS Flow Selector ──────────────────────────────────────────────
  {
    key: "widgetSmsFlow",
    value: "B",
    label: "Widget SMS Conversation Flow",
    description: "Flow A (Madison): asks for bedrooms/bathrooms, then sends price upfront with Madison's photo. Flow B (Jade): asks for bedrooms/bathrooms, then greets and asks for day before revealing price. Split: randomly assigns A or B to each widget lead.",
    fieldType: "select",
  },
  // ── Widget Flow B (Jade) SMS Templates ───────────────────────────────────
  {
    key: "widgetFlowB_sms1",
    value: "Hey {firstName}! Jade here from Maids in Black 😊 To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)",
    label: "Widget Flow B — SMS 1: Sizing Question (Jade)",
    description: "Sent immediately after the widget lead submits their name and phone. Asks for home size. Use {firstName} for the lead's first name.",
    fieldType: "textarea",
  },
  // ── Widget Flow A (Madison) SMS Templates ────────────────────────────────
  {
    key: "widgetFlowA_sms1",
    value: "Hi {firstName}! 👋 Madison here from Maids in Black. To get you an instant price, how many bedrooms and bathrooms does your home have? (e.g. 3 bed / 2 bath)",
    label: "Widget Flow A — SMS 1: Sizing Question (Madison)",
    description: "Sent immediately after the widget lead submits their name and phone. Asks for home size. Use {firstName} for the lead's first name.",
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
  // ── Call Notification Settings ──────────────────────────────────────────────
  {
    key: "callAlertEnabled",
    value: "true",
    label: "Enable VAPI Call Notification",
    description: "When enabled, the system places an automated call to the alert phone number whenever a new lead arrives (7am–7pm ET only).",
    fieldType: "toggle",
  },
  {
    key: "callAlertPhone",
    value: "+13029816191",
    label: "Call Alert Phone Number",
    description: "The phone number to call when a new lead arrives. Must be in E.164 format, e.g. +12025551234.",
    fieldType: "text",
  },
  // ── Email Lead (Mailgun inbound) SMS Templates ────────────────────────────
  {
    key: "emailFlowA_sms1",
    value: "Hi {firstName}! 👋 Madison here from Maids in Black. I saw your request for {frequency} {serviceType} — your quote for a {bedrooms} bed / {bathrooms} bath home is ${price}. Our fully insured team handles everything. 🏠",
    label: "Email Lead — SMS 1: Opening Message (Madison)",
    description: "Sent immediately when an email lead arrives via Mailgun. Use {firstName}, {frequency}, {serviceType}, {bedrooms}, {bathrooms}, {price}.",
    fieldType: "textarea",
  },
  // ── Cleaner Pay Rules ────────────────────────────────────────────────────
  {
    key: "pay_fiveStarBonus",
    value: "10",
    label: "5-Star Rating Bonus",
    description: "Bonus added to cleaner pay when a customer leaves a 5-star rating.",
    fieldType: "number",
  },
  {
    key: "pay_lowRatingDeduction",
    value: "20",
    label: "Low Rating Deduction (≤3 stars)",
    description: "Amount deducted from cleaner pay when a customer leaves 3 stars or fewer, or reports a complaint.",
    fieldType: "number",
  },
  {
    key: "pay_photoBonus",
    value: "5",
    label: "Completion Photo Bonus",
    description: "Bonus added to cleaner pay when they upload a completion photo after the job.",
    fieldType: "number",
  },
  {
    key: "pay_noPhotoPenalty",
    value: "10",
    label: "No Photo Penalty",
    description: "Amount deducted from cleaner pay when no completion photo is submitted.",
    fieldType: "number",
  },
  {
    key: "pay_streakBonus",
    value: "50",
    label: "Streak Bonus Amount",
    description: "Bonus paid to a cleaner when they complete a full streak of consecutive clean jobs with no issues.",
    fieldType: "number",
  },
  {
    key: "pay_streakTarget",
    value: "10",
    label: "Streak Target (jobs)",
    description: "Number of consecutive clean jobs required to earn the streak bonus. Streak resets on any complaint or low rating.",
    fieldType: "number",
  },
  {
    key: "pay_recleanPenalty",
    value: "30",
    label: "Reclean / Poor Service Penalty",
    description: "Amount deducted from cleaner pay when a job requires a reclean due to poor service.",
    fieldType: "number",
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

/**
 * Pay rules shape returned by getPayRules().
 */
export type PayRules = {
  fiveStarBonus: number;
  lowRatingDeduction: number;
  photoBonus: number;
  noPhotoPenalty: number;
  streakBonus: number;
  streakTarget: number;
  recleanPenalty: number;
  googleReviewUrl: string;
};

/** Default pay rules (used as fallback if DB is unavailable) */
export const DEFAULT_PAY_RULES: PayRules = {
  fiveStarBonus: 10,
  lowRatingDeduction: 20,
  photoBonus: 5,
  noPhotoPenalty: 10,
  streakBonus: 50,
  streakTarget: 10,
  recleanPenalty: 30,
  googleReviewUrl: "https://share.google/Tm468dywmXkUnBQBL",
};

/**
 * Read all 7 pay rules from app_settings, falling back to defaults.
 * Used server-side by calculatePayAdjustments and setRecleanPenalty.
 */
export async function getPayRules(): Promise<PayRules> {
  const keys = [
    "pay_fiveStarBonus",
    "pay_lowRatingDeduction",
    "pay_photoBonus",
    "pay_noPhotoPenalty",
    "pay_streakBonus",
    "pay_streakTarget",
    "pay_recleanPenalty",
  ];
  const [results, reviewUrl] = await Promise.all([
    Promise.all(keys.map(k => getSetting(k, ""))),
    getSetting("googleReviewUrl", DEFAULT_PAY_RULES.googleReviewUrl),
  ]);
  const parse = (val: string, fallback: number) => {
    const n = parseFloat(val);
    return isNaN(n) || n < 0 ? fallback : n;
  };
  return {
    fiveStarBonus:       parse(results[0], DEFAULT_PAY_RULES.fiveStarBonus),
    lowRatingDeduction:  parse(results[1], DEFAULT_PAY_RULES.lowRatingDeduction),
    photoBonus:          parse(results[2], DEFAULT_PAY_RULES.photoBonus),
    noPhotoPenalty:      parse(results[3], DEFAULT_PAY_RULES.noPhotoPenalty),
    streakBonus:         parse(results[4], DEFAULT_PAY_RULES.streakBonus),
    streakTarget:        Math.max(1, Math.round(parse(results[5], DEFAULT_PAY_RULES.streakTarget))),
    recleanPenalty:      parse(results[6], DEFAULT_PAY_RULES.recleanPenalty),
    googleReviewUrl:     reviewUrl || DEFAULT_PAY_RULES.googleReviewUrl,
  };
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

  /**
   * Get the current pay rules (7 keys) as a typed object.
   * Used by the Pay Rules settings tab and the Cleaner Portal.
   */
  getPayRules: protectedProcedure.query(async () => {
    await seedDefaultSettings();
    return getPayRules();
  }),

  /**
   * Update multiple pay rule keys at once.
   */
  updatePayRules: protectedProcedure
    .input(
      z.object({
        fiveStarBonus:      z.number().min(0),
        lowRatingDeduction: z.number().min(0),
        photoBonus:         z.number().min(0),
        noPhotoPenalty:     z.number().min(0),
        streakBonus:        z.number().min(0),
        streakTarget:       z.number().int().min(1),
        recleanPenalty:     z.number().min(0),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await seedDefaultSettings();
      const pairs: [string, number][] = [
        ["pay_fiveStarBonus",      input.fiveStarBonus],
        ["pay_lowRatingDeduction", input.lowRatingDeduction],
        ["pay_photoBonus",         input.photoBonus],
        ["pay_noPhotoPenalty",     input.noPhotoPenalty],
        ["pay_streakBonus",        input.streakBonus],
        ["pay_streakTarget",       input.streakTarget],
        ["pay_recleanPenalty",     input.recleanPenalty],
      ];
      await Promise.all(
        pairs.map(([key, val]) =>
          db.update(appSettings).set({ value: String(val) }).where(eq(appSettings.key, key))
        )
      );
      return { success: true };
    }),

  /**
   * List all custom pay rules.
   */
  listCustomPayRules: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db.select().from(customPayRules).orderBy(customPayRules.createdAt);
    return rows;
  }),

  /**
   * Create a new custom pay rule.
   */
  createCustomPayRule: protectedProcedure
    .input(
      z.object({
        label:       z.string().min(1).max(128),
        type:        z.enum(["bonus", "deduction"]),
        amount:      z.number().min(0.01),
        description: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.insert(customPayRules).values({
        label:       input.label,
        type:        input.type,
        amount:      String(input.amount),
        description: input.description ?? null,
        isActive:    1,
      });
      return { success: true };
    }),

  /**
   * Update an existing custom pay rule.
   */
  updateCustomPayRule: protectedProcedure
    .input(
      z.object({
        id:          z.number().int(),
        label:       z.string().min(1).max(128).optional(),
        type:        z.enum(["bonus", "deduction"]).optional(),
        amount:      z.number().min(0.01).optional(),
        description: z.string().max(256).nullable().optional(),
        isActive:    z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const { id, ...rest } = input;
      const patch: Record<string, unknown> = {};
      if (rest.label       !== undefined) patch.label       = rest.label;
      if (rest.type        !== undefined) patch.type        = rest.type;
      if (rest.amount      !== undefined) patch.amount      = String(rest.amount);
      if (rest.description !== undefined) patch.description = rest.description;
      if (rest.isActive    !== undefined) patch.isActive    = rest.isActive ? 1 : 0;
      if (Object.keys(patch).length === 0) return { success: true };
      await db.update(customPayRules).set(patch).where(eq(customPayRules.id, id));
      return { success: true };
    }),

  /**
   * Delete a custom pay rule permanently.
   */
  deleteCustomPayRule: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.delete(customPayRules).where(eq(customPayRules.id, input.id));
      return { success: true };
    }),
});
