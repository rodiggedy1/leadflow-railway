import { randomBytes } from "crypto";
import Stripe from "stripe";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure, agentProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cashAppPaymentTokens } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getStripeClient } from "./stripeClient";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function requireStripe(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe is not configured." });
  }
  return getStripeClient();
}

async function getOpenToken(token: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [row] = await db.select().from(cashAppPaymentTokens).where(eq(cashAppPaymentTokens.token, token)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid payment link" });
  if (row.status === "paid") throw new TRPCError({ code: "FORBIDDEN", message: "This payment has already been completed" });
  if (row.status !== "open" && row.status !== "payment_started") throw new TRPCError({ code: "FORBIDDEN", message: "This payment link is no longer active" });
  if (row.expiresAt < Date.now()) {
    await db.update(cashAppPaymentTokens).set({ status: "expired" }).where(eq(cashAppPaymentTokens.id, row.id));
    throw new TRPCError({ code: "FORBIDDEN", message: "This payment link has expired" });
  }
  return { db, row };
}

export const cashAppRouter = router({
  generateLink: agentProcedure
    .input(z.object({
      customerPhone: z.string().min(7).max(30),
      customerName: z.string().trim().max(255).optional(),
      amountCents: z.number().int().min(50).max(10_000_000),
      description: z.string().trim().min(3).max(255),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const token = randomBytes(32).toString("hex");
      const expiresAt = Date.now() + TOKEN_TTL_MS;
      await db.insert(cashAppPaymentTokens).values({
        token,
        customerPhone: input.customerPhone,
        customerName: input.customerName || null,
        amountCents: input.amountCents,
        description: input.description,
        status: "open",
        stripePaymentIntentId: null,
        expiresAt,
        paidAt: null,
      });
      return { token, url: `https://quote.maidinblack.com/cashapp-pay/${token}`, expiresAt };
    }),

  getLink: publicProcedure
    .input(z.object({ token: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const { row } = await getOpenToken(input.token);
      return {
        customerName: row.customerName ?? "",
        amountCents: row.amountCents,
        description: row.description,
        expiresAt: row.expiresAt,
      };
    }),

  getStatus: publicProcedure
    .input(z.object({ token: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ status: cashAppPaymentTokens.status, amountCents: cashAppPaymentTokens.amountCents, description: cashAppPaymentTokens.description }).from(cashAppPaymentTokens).where(eq(cashAppPaymentTokens.token, input.token)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid payment link" });
      return row;
    }),

  createPaymentIntent: publicProcedure
    .input(z.object({ token: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const { db, row } = await getOpenToken(input.token);
      const stripe = requireStripe();
      if (row.stripePaymentIntentId) {
        const existing = await stripe.paymentIntents.retrieve(row.stripePaymentIntentId);
        if (existing.client_secret) return { clientSecret: existing.client_secret };
      }
      const intent = await stripe.paymentIntents.create({
        amount: row.amountCents,
        currency: "usd",
        payment_method_types: ["cashapp"],
        description: row.description,
        metadata: {
          cashAppPaymentToken: row.token,
          customerPhone: row.customerPhone,
        },
      });
      await db.update(cashAppPaymentTokens).set({ stripePaymentIntentId: intent.id, status: "payment_started" }).where(eq(cashAppPaymentTokens.id, row.id));
      return { clientSecret: intent.client_secret! };
    }),
});
