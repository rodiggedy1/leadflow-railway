import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { quoteLeads } from "../drizzle/schema";
import { sendSms, buildQuoteSmsMessage } from "./openphone";

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
   * submitQuote — public procedure
   * 1. Validates the form data
   * 2. Saves the lead to the database
   * 3. Sends an SMS via OpenPhone to the lead's phone number
   * 4. Returns success status and the estimated price
   */
  quotes: router({
    submit: publicProcedure
      .input(quoteFormSchema)
      .mutation(async ({ input }) => {
        const db = await getDb();

        // Build the SMS message
        const smsContent = buildQuoteSmsMessage({
          name: input.name,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          serviceType: input.serviceType,
        });

        // Send the SMS via OpenPhone
        const smsResult = await sendSms({
          to: input.phone,
          content: smsContent,
        });

        // Save the lead to the database (regardless of SMS success)
        if (db) {
          try {
            await db.insert(quoteLeads).values({
              name: input.name,
              email: input.email,
              phone: input.phone,
              serviceType: input.serviceType,
              bedrooms: input.bedrooms,
              bathrooms: input.bathrooms,
              smsSent: smsResult.success ? 1 : 0,
              smsMessageId: smsResult.messageId ?? null,
            });
          } catch (dbErr) {
            console.error("[submitQuote] Failed to save lead to DB:", dbErr);
            // Don't throw — SMS was already sent, we still want to return success
          }
        }

        if (!smsResult.success) {
          console.error("[submitQuote] SMS failed:", smsResult.error);
          // Return partial success so the user still sees the thank-you screen
          return {
            success: true,
            smsSent: false,
            message: "Quote request received. We'll be in touch shortly.",
          };
        }

        return {
          success: true,
          smsSent: true,
          message: smsContent,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
