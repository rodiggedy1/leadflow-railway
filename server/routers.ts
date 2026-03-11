import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { quoteLeads, conversationSessions } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { buildAvailabilityMessage } from "./conversationEngine";
import { generateQuoteMessage, generatePricingFollowUp } from "./aiService";

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
  const db = await getDb();

  // ── Step 1: Generate AI messages (parallel, each has its own fallback) ──────
  const [msg1, msg2] = await Promise.all([
    generateQuoteMessage({
      leadName: input.name,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      serviceType: input.serviceType,
      price,
    }),
    generatePricingFollowUp({
      leadName: input.name,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      serviceType: input.serviceType,
      price,
    }),
  ]);
  const msg3 = buildAvailabilityMessage();

  // ── Step 2: Send SMS #1: Quote + price ───────────────────────────────────────
  const sms1 = await sendSms({ to: input.phone, content: msg1 });
  console.log(`[submitQuote] SMS1 sent: ${sms1.success}`);

  // ── Step 3: Send SMS #2: Pricing follow-up (natural delay) ───────────────────
  await delay(1500);
  const sms2 = await sendSms({ to: input.phone, content: msg2 });
  console.log(`[submitQuote] SMS2 sent: ${sms2.success}`);

  // ── Step 4: Send SMS #3: Availability question ───────────────────────────────
  await delay(1500);
  const sms3 = await sendSms({ to: input.phone, content: msg3 });
  console.log(`[submitQuote] SMS3 sent: ${sms3.success}`);

  if (!db) {
    console.warn("[submitQuote] No DB — skipping session and lead save");
    return;
  }

  // ── Step 5: Create/update conversation session ───────────────────────────────
  const initialHistory = JSON.stringify([
    { role: "assistant", content: msg1 },
    { role: "assistant", content: msg2 },
    { role: "assistant", content: msg3 },
  ]);

  try {
    const existing = await db
      .select()
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, input.phone))
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
        .where(eq(conversationSessions.leadPhone, input.phone));
    } else {
      await db.insert(conversationSessions).values({
        leadPhone: input.phone,
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

  // ── Step 6: Save lead record ──────────────────────────────────────────────────
  try {
    await db.insert(quoteLeads).values({
      name: input.name,
      email: input.email,
      phone: input.phone,
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

// ── Utility ───────────────────────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
