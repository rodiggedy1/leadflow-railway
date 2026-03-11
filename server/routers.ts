import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { quoteLeads, conversationSessions } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import {
  buildQuoteMessage,
  buildPricingFollowUp,
  buildAvailabilityMessage,
} from "./conversationEngine";

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
   * On form submission:
   * 1. Calculates the price estimate
   * 2. Sends SMS #1: Quote + price
   * 3. Sends SMS #2 (immediately after): Pricing follow-up
   * 4. Sends SMS #3 (immediately after): Availability question
   * 5. Creates a conversation_session row so the webhook can continue the flow
   * 6. Saves the lead to quote_leads
   */
  quotes: router({
    submit: publicProcedure
      .input(quoteFormSchema)
      .mutation(async ({ input }) => {
        const db = await getDb();

        // ── 1. Calculate price ────────────────────────────────────────────────
        const price = estimatePrice({
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          serviceType: input.serviceType,
        });

        const ctx = {
          leadName: input.name,
          quotedPrice: price,
          serviceType: input.serviceType,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
        };

        // ── 2. Build all three opening messages ───────────────────────────────
        const msg1 = buildQuoteMessage(ctx);
        const msg2 = buildPricingFollowUp(ctx);
        const msg3 = buildAvailabilityMessage();

        // ── 3. Send SMS #1: Quote + price ─────────────────────────────────────
        const sms1 = await sendSms({ to: input.phone, content: msg1 });
        console.log(`[submitQuote] SMS1 sent: ${sms1.success}`);

        // ── 4. Send SMS #2: Pricing follow-up (slight delay for natural feel) ─
        await delay(1500);
        const sms2 = await sendSms({ to: input.phone, content: msg2 });
        console.log(`[submitQuote] SMS2 sent: ${sms2.success}`);

        // ── 5. Send SMS #3: Availability question ─────────────────────────────
        await delay(1500);
        const sms3 = await sendSms({ to: input.phone, content: msg3 });
        console.log(`[submitQuote] SMS3 sent: ${sms3.success}`);

        // ── 6. Create/update conversation session ─────────────────────────────
        if (db) {
          // Initial message history: the three outbound messages
          const initialHistory = JSON.stringify([
            { role: "assistant", content: msg1 },
            { role: "assistant", content: msg2 },
            { role: "assistant", content: msg3 },
          ]);

          try {
            // Upsert: if the phone already has a session, restart it
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

          // ── 7. Save lead record ───────────────────────────────────────────
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

        const smsSent = sms1.success;

        if (!smsSent) {
          console.error("[submitQuote] Initial SMS failed:", sms1.error);
        }

        return {
          success: true,
          smsSent,
          message: smsSent
            ? "Quote sent! Check your phone for your personalized quote."
            : "Quote request received. We'll be in touch shortly.",
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;

// ── Utility ───────────────────────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
