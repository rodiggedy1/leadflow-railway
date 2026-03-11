import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { quoteLeads, conversationSessions } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { generateQuoteMessage, generatePricingFollowUp } from "./aiService";
import { buildNewLeadAlert, notifyAgentOfLead } from "./agentNotification";

// Zod schema for the quote form submission
const quoteFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email").max(320),
  phone: z.string().min(7, "Phone is required").max(30),
  serviceType: z.string().min(1).max(100),
  bedrooms: z.string().min(1).max(50),
  bathrooms: z.string().min(1).max(50),
});

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /**
   * quotes.submit — public procedure
   *
   * Returns IMMEDIATELY to the user with a success response.
   * All AI generation, SMS sending, and DB writes happen in the background
   * via a fire-and-forget async task so the form never hangs.
   */
  quotes: router({
    submit: publicProcedure
      .input(quoteFormSchema)
      .mutation(async ({ input }) => {
        // ── 1. Calculate price synchronously (instant, no network call) ────────
        const price = estimatePrice({
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          serviceType: input.serviceType,
        });

        // ── 2. Fire-and-forget: AI generation + SMS + DB in background ─────────
        // We do NOT await this — the form gets an instant response
        processQuoteInBackground(input, price).catch(err => {
          console.error("[submitQuote] Background processing error:", err);
        });

        // ── 3. Return immediately ──────────────────────────────────────────────
        return {
          success: true,
          smsSent: true, // optimistic — background will handle actual sending
          message: "Quote sent! Check your phone for your personalized quote.",
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;

// ─── Background processor ─────────────────────────────────────────────────────

/**
 * Runs all the slow work (AI calls, SMS, DB writes) after the form has
 * already returned a success response to the user.
 */
async function processQuoteInBackground(
  input: {
    name: string;
    email: string;
    phone: string;
    serviceType: string;
    bedrooms: string;
    bathrooms: string;
  },
  price: string
): Promise<void> {
  const normalizedPhone = normalizePhone(input.phone);

  // ── Step 1: Alert support team immediately (fire-and-forget) ──────────────
  const alertMsg = buildNewLeadAlert({
    name: input.name,
    phone: normalizedPhone,
    serviceType: input.serviceType,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    price,
  });
  sendSms({ to: "+12028885362", content: alertMsg }).catch(err =>
    console.error("[submitQuote] Failed to send new lead alert to support:", err)
  );

  // ── Step 2: Generate AI quote messages (with fallback) ────────────────────
  const msg1 = await generateQuoteMessage({
    leadName: input.name,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    serviceType: input.serviceType,
    price,
  });
  const msg2 = await generatePricingFollowUp({
    leadName: input.name,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    serviceType: input.serviceType,
    price,
  });

  // ── Step 3: Send SMS #1: Quote + price + value note to lead ───────────────
  const sms1 = await sendSms({ to: input.phone, content: msg1 });
  console.log(`[submitQuote] SMS1 sent: ${sms1.success}`);

  // ── Step 4: Send SMS #2: Availability question (natural delay) ────────────
  await delay(2000);
  const sms2 = await sendSms({ to: input.phone, content: msg2 });
  console.log(`[submitQuote] SMS2 sent: ${sms2.success}`);

  const db = await getDb();
  if (!db) {
    console.warn("[submitQuote] No DB — skipping session and lead save");
    return;
  }

  // ── Step 5: Create/update conversation session ────────────────────────────
  const initialHistory = JSON.stringify([
    { role: "assistant", content: msg1 },
    { role: "assistant", content: msg2 },
  ]);

  try {
    const existing = await db
      .select()
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(conversationSessions)
        .set({
          stage: "AVAILABILITY",
          leadName: input.name,
          quotedPrice: price,
          serviceType: input.serviceType,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          selectedSlot: null,
          address: null,
          callPreference: null,
          messageHistory: initialHistory,
        })
        .where(eq(conversationSessions.leadPhone, normalizedPhone));
    } else {
      await db.insert(conversationSessions).values({
        leadPhone: normalizedPhone,
        leadName: input.name,
        stage: "AVAILABILITY",
        quotedPrice: price,
        serviceType: input.serviceType,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        messageHistory: initialHistory,
      });
    }
  } catch (dbErr) {
    console.error("[submitQuote] Failed to create conversation session:", dbErr);
  }

  // ── Step 6: Save lead record ──────────────────────────────────────────────
  try {
    await db.insert(quoteLeads).values({
      name: input.name,
      email: input.email,
      phone: normalizedPhone,
      serviceType: input.serviceType,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      smsSent: sms1.success ? 1 : 0,
      smsMessageId: sms1.messageId ?? null,
    });
  } catch (dbErr) {
    console.error("[submitQuote] Failed to save lead:", dbErr);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX).
 * Handles inputs like: "7259009272", "725-900-9272", "(725) 900-9272", "+17259009272"
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (phone.startsWith("+")) {
    return phone.replace(/[^\d+]/g, "");
  }
  return `+${digits}`;
}
