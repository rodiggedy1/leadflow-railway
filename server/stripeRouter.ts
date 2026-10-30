/**
 * stripeRouter — card-on-file integration for LeadFlow.
 *
 * Flow:
 *  1. Admin generates a /pay/:token link (stripe.generateCardAuthToken)
 *  2. Customer opens the link → stripe.getCardAuthToken returns appointment info
 *  3. Frontend calls stripe.createSetupIntent → gets clientSecret
 *  4. Stripe Elements confirms the SetupIntent (card never touches our server)
 *  5. Frontend calls stripe.confirmCardSaved with the paymentMethod.id
 *  6. Admin calls stripe.createPreauth to hold funds (capture_method=manual)
 *  7. Admin calls stripe.capturePayment to charge, or stripe.cancelPreauth to release
 *
 * Security:
 *  - Card data NEVER touches this server — Stripe Elements handles it entirely.
 *  - Public procedures only accept a token (not a phone number directly).
 *  - Admin procedures require agentProcedure (cookie session + isAdmin).
 */
import { z } from "zod";
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { publicProcedure, agentProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { cardAuthTokens, stripeCustomers, paymentAuthorizations } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { ENV } from "./_core/env";
import { reconcileMissingStripeCustomerCards } from "./stripeCardListReconciliation";

// ── Stripe client (lazy-initialised so missing key throws at call time, not import) ──
function getStripe(): Stripe {
  if (!ENV.stripeSecretKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stripe is not configured (missing STRIPE_SECRET_KEY)",
    });
  }
  return new Stripe(ENV.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });
}

// ── Token TTL: 7 days ────────────────────────────────────────────────────────
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const stripeRouter = router({
  // ────────────────────────────────────────────────────────────────────────────
  // 1. generateCardAuthToken (admin) — creates a /pay/:token link for a customer
  // ────────────────────────────────────────────────────────────────────────────
  generateCardAuthToken: agentProcedure
    .input(
      z.object({
        customerPhone: z.string().min(7).max(30),
        customerName: z.string().max(255).optional(),
        jobDate: z.string().max(64).optional(),
        jobAddress: z.string().max(512).optional(),
        cleanerJobId: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const token = randomBytes(32).toString("hex");
      const expiresAt = Date.now() + TOKEN_TTL_MS;

      await db.insert(cardAuthTokens).values({
        token,
        customerPhone: input.customerPhone,
        customerName: input.customerName ?? null,
        jobDate: input.jobDate ?? null,
        jobAddress: input.jobAddress ?? null,
        cleanerJobId: input.cleanerJobId ?? null,
        used: 0,
        expiresAt,
      });

      // NOTE: The /pay/:token route lives on THIS app (quote.maidinblack.com), NOT on the
      // external quote app. ENV.quoteAppUrl points to the external quote app API and must
      // NOT be used here — changing it would break SMS quote links sent to leads.
      const baseUrl = "https://quote.maidinblack.com";
      const params = new URLSearchParams();
      if (input.customerName) params.set("name", input.customerName);
      if (input.jobDate) params.set("date", input.jobDate);
      if (input.jobAddress) params.set("address", input.jobAddress);
      const qs = params.toString();
      const url = `${baseUrl}/pay/${token}${qs ? `?${qs}` : ""}`;

      return { token, url, expiresAt };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 2. getCardAuthToken (public) — validates the token from the URL.
  //    Returns appointment info to pre-fill the form. Does NOT mark as used.
  // ────────────────────────────────────────────────────────────────────────────
  getCardAuthToken: publicProcedure
    .input(z.object({ token: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select()
        .from(cardAuthTokens)
        .where(eq(cardAuthTokens.token, input.token))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid link" });
      if (row.used) throw new TRPCError({ code: "FORBIDDEN", message: "This link has already been used" });
      if (row.expiresAt < Date.now()) throw new TRPCError({ code: "FORBIDDEN", message: "This link has expired" });

      return {
        customerName: row.customerName ?? "",
        customerPhone: row.customerPhone,
        jobDate: row.jobDate ?? "",
        jobAddress: row.jobAddress ?? "",
        cleanerJobId: row.cleanerJobId ?? null,
      };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 3. createSetupIntent (public) — creates/reuses a Stripe Customer and returns
  //    a SetupIntent clientSecret so Stripe Elements can collect the card.
  //    Card data NEVER reaches this server.
  // ────────────────────────────────────────────────────────────────────────────
  createSetupIntent: publicProcedure
    .input(z.object({ token: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [tokenRow] = await db
        .select()
        .from(cardAuthTokens)
        .where(eq(cardAuthTokens.token, input.token))
        .limit(1);

      if (!tokenRow) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid link" });
      if (tokenRow.used) throw new TRPCError({ code: "FORBIDDEN", message: "This link has already been used" });
      if (tokenRow.expiresAt < Date.now()) throw new TRPCError({ code: "FORBIDDEN", message: "This link has expired" });

      const stripe = getStripe();
      const phone = tokenRow.customerPhone;
      const name = tokenRow.customerName ?? "";

      // Find or create Stripe Customer
      let stripeCustomerId: string;
      const [existing] = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.phone, phone))
        .limit(1);

      if (existing) {
        stripeCustomerId = existing.stripeCustomerId;
        if (name && !existing.name) {
          await db.update(stripeCustomers).set({ name }).where(eq(stripeCustomers.phone, phone));
          await stripe.customers.update(stripeCustomerId, { name });
        }
      } else {
        const customer = await stripe.customers.create({
          phone,
          name: name || undefined,
          metadata: { source: "leadflow_card_auth" },
        });
        stripeCustomerId = customer.id;
        await db.insert(stripeCustomers).values({
          phone,
          name: name || null,
          stripeCustomerId,
          stripePaymentMethodId: null,
          cardBrand: null,
          cardLast4: null,
          cardExpMonth: null,
          cardExpYear: null,
          cardSavedAt: null,
        });
      }

      // Create SetupIntent with usage=off_session so the card can be charged later
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: {
          customerPhone: phone,
          cardAuthToken: input.token,
        },
      });

      return {
        clientSecret: setupIntent.client_secret!,
      };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 4. confirmCardSaved (public) — called after Stripe Elements confirms the
  //    SetupIntent. Retrieves PaymentMethod details from Stripe (no raw card data),
  //    updates stripe_customers, and marks the token as used.
  // ────────────────────────────────────────────────────────────────────────────
  confirmCardSaved: publicProcedure
    .input(
      z.object({
        token: z.string().min(1).max(64),
        paymentMethodId: z.string().min(1).max(64),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [tokenRow] = await db
        .select()
        .from(cardAuthTokens)
        .where(eq(cardAuthTokens.token, input.token))
        .limit(1);

      if (!tokenRow) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid link" });
      if (tokenRow.used) throw new TRPCError({ code: "FORBIDDEN", message: "This link has already been used" });
      if (tokenRow.expiresAt < Date.now()) throw new TRPCError({ code: "FORBIDDEN", message: "This link has expired" });

      const stripe = getStripe();

      // Retrieve PaymentMethod from Stripe to get card details (brand, last4, exp)
      const pm = await stripe.paymentMethods.retrieve(input.paymentMethodId);
      if (pm.type !== "card" || !pm.card) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid payment method type" });
      }

      const { brand, last4, exp_month, exp_year } = pm.card;
      const now = Date.now();

      // Get the customer's Stripe Customer ID for attaching the payment method
      const [customerRow] = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.phone, tokenRow.customerPhone))
        .limit(1);

      if (customerRow) {
        // Attach the payment method to the customer if not already attached
        try {
          await stripe.paymentMethods.attach(input.paymentMethodId, {
            customer: customerRow.stripeCustomerId,
          });
        } catch (err: unknown) {
          const stripeErr = err as { code?: string };
          if (stripeErr?.code !== "payment_method_already_attached") {
            throw err;
          }
        }

        // Update stripe_customers row with card details
        await db
          .update(stripeCustomers)
          .set({
            stripePaymentMethodId: input.paymentMethodId,
            cardBrand: brand,
            cardLast4: last4,
            cardExpMonth: exp_month,
            cardExpYear: exp_year,
            cardSavedAt: now,
            name: tokenRow.customerName ?? undefined,
          })
          .where(eq(stripeCustomers.phone, tokenRow.customerPhone));
      }

      // Mark token as used
      await db
        .update(cardAuthTokens)
        .set({ used: 1, completedAt: now })
        .where(eq(cardAuthTokens.token, input.token));

      return {
        success: true,
        cardBrand: brand,
        cardLast4: last4,
        cardExpMonth: exp_month,
        cardExpYear: exp_year,
      };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 5. listCustomerCards (admin) — returns saved card info for a customer phone
  // ────────────────────────────────────────────────────────────────────────────
  listCustomerCards: agentProcedure
    .input(z.object({ customerPhone: z.string().min(7).max(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.phone, input.customerPhone))
        .limit(1);

      if (!row || !row.stripePaymentMethodId) {
        return { hasCard: false, card: null };
      }

      return {
        hasCard: true,
        card: {
          brand: row.cardBrand,
          last4: row.cardLast4,
          expMonth: row.cardExpMonth,
          expYear: row.cardExpYear,
          savedAt: row.cardSavedAt,
          stripeCustomerId: row.stripeCustomerId,
          stripePaymentMethodId: row.stripePaymentMethodId,
        },
      };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 6. createPreauth (admin) — places a manual-capture PaymentIntent (holds funds)
  // ────────────────────────────────────────────────────────────────────────────
  createPreauth: agentProcedure
    .input(
      z.object({
        customerPhone: z.string().min(7).max(30),
        amountCents: z.number().int().min(50).max(1_000_000),
        jobLabel: z.string().max(255).optional(),
        cleanerJobId: z.number().int().optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [customer] = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.phone, input.customerPhone))
        .limit(1);

      if (!customer || !customer.stripePaymentMethodId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No saved card found for this customer. Send them a card link first.",
        });
      }

      const stripe = getStripe();
      const agentName = ctx.agent?.agentName ?? "admin";
      // Persist the attempt before calling Stripe. A successful Stripe hold is
      // therefore still visible locally if a later process failure occurs.
      const [pending] = await db.insert(paymentAuthorizations).values({
        cleanerJobId: input.cleanerJobId ?? null,
        jobLabel: input.jobLabel ?? null,
        customerPhone: input.customerPhone,
        customerName: customer.name ?? null,
        stripeCustomerId: customer.stripeCustomerId,
        stripePaymentMethodId: customer.stripePaymentMethodId,
        stripePaymentIntentId: null,
        amountCents: input.amountCents,
        currency: "usd",
        operation: "authorization",
        status: "pending",
        errorMessage: null,
        createdBy: agentName,
        authorizedAt: null,
        notes: input.notes ?? null,
      }).$returningId();

      let paymentIntent: Stripe.PaymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.create({
          amount: input.amountCents,
          currency: "usd",
          customer: customer.stripeCustomerId,
          payment_method: customer.stripePaymentMethodId,
          capture_method: "manual",
          confirm: true,
          off_session: true,
          description: input.jobLabel ?? `LeadFlow job — ${input.customerPhone}`,
          metadata: {
            customerPhone: input.customerPhone,
            jobLabel: input.jobLabel ?? "",
            cleanerJobId: input.cleanerJobId?.toString() ?? "",
            createdBy: agentName,
            leadflowAuthorizationAttempt: "v1",
            leadflowAuthorizationAttemptId: String(pending.id),
          },
        });
      } catch (err: unknown) {
        const stripeErr = err as Stripe.StripeRawError;
        const message = stripeErr?.message ?? "Unknown Stripe error";
        const definitiveProviderFailure = typeof stripeErr?.statusCode === "number";
        await db.update(paymentAuthorizations).set(
          definitiveProviderFailure
            ? { status: "failed", errorMessage: message }
            : { errorMessage: `Stripe outcome is unknown; awaiting a signed webhook or explicit review. ${message}` }
        ).where(eq(paymentAuthorizations.id, Number(pending.id)));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: definitiveProviderFailure
            ? `Stripe preauth failed: ${message}`
            : "Stripe did not confirm the hold outcome. The local attempt remains in review to prevent a duplicate charge.",
        });
      }

      const now = Date.now();
      const status = paymentIntent.status === "requires_capture" ? "authorized" : "failed";
      await db.update(paymentAuthorizations).set({
        stripePaymentIntentId: paymentIntent.id,
        status,
        errorMessage: status === "failed" ? "PaymentIntent did not reach requires_capture" : null,
        authorizedAt: status === "authorized" ? now : null,
      }).where(eq(paymentAuthorizations.id, Number(pending.id)));

      return {
        id: Number(pending.id),
        stripePaymentIntentId: paymentIntent.id,
        status,
        amountCents: input.amountCents,
        authorizedAt: now,
      };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 6b. recoverVerifiedCardLinkHold (admin) — restores only a missing local
  // record for a verified preexisting Stripe hold. It never changes Stripe.
  // ────────────────────────────────────────────────────────────────────────────
  recoverVerifiedCardLinkHold: agentProcedure
    .input(z.object({
      cardAuthTokenId: z.number().int().positive(),
      paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/, "Enter a Stripe PaymentIntent ID beginning with pi_"),
      expectedAmountCents: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db.select().from(paymentAuthorizations)
        .where(eq(paymentAuthorizations.stripePaymentIntentId, input.paymentIntentId)).limit(1);
      if (existing) return { authorizationId: existing.id, recovered: false as const };

      const [token] = await db.select().from(cardAuthTokens)
        .where(eq(cardAuthTokens.id, input.cardAuthTokenId)).limit(1);
      if (!token?.used || !token.completedAt) {
        throw new TRPCError({ code: "CONFLICT", message: "Recovery requires a completed LeadFlow card link." });
      }
      const [customer] = await db.select().from(stripeCustomers)
        .where(eq(stripeCustomers.phone, token.customerPhone)).limit(1);
      if (!customer?.stripePaymentMethodId) {
        throw new TRPCError({ code: "CONFLICT", message: "The completed link no longer has a verified saved card." });
      }

      const stripe = getStripe();
      const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId);
      const intentCustomerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? null;
      const intentPaymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
      const paymentMethod = intentPaymentMethodId ? await stripe.paymentMethods.retrieve(intentPaymentMethodId) : null;
      const paymentMethodCustomerId = typeof paymentMethod?.customer === "string" ? paymentMethod.customer : paymentMethod?.customer?.id ?? null;
      const cardOptions = intent.payment_method_options?.card as { capture_before?: number } | undefined;
      const captureBefore = typeof cardOptions?.capture_before === "number"
        ? cardOptions.capture_before * 1000
        : null;
      const matchingJob = token.cleanerJobId === null || intent.metadata.cleanerJobId === String(token.cleanerJobId);
      const isVerifiedLegacyHold =
        intent.status === "requires_capture" &&
        intent.capture_method === "manual" &&
        intent.currency === "usd" &&
        intent.amount === input.expectedAmountCents &&
        intent.metadata.customerPhone === token.customerPhone &&
        matchingJob &&
        intentCustomerId === customer.stripeCustomerId &&
        intentPaymentMethodId === customer.stripePaymentMethodId &&
        paymentMethod?.type === "card" &&
        paymentMethodCustomerId === customer.stripeCustomerId;
      if (!isVerifiedLegacyHold) {
        throw new TRPCError({ code: "CONFLICT", message: "That Stripe PaymentIntent is not a verified active hold for this completed LeadFlow card link." });
      }

      const agentName = ctx.agent?.agentName ?? "admin";
      const [recovered] = await db.insert(paymentAuthorizations).values({
        cleanerJobId: token.cleanerJobId,
        jobLabel: intent.metadata.jobLabel || token.jobDate || intent.description || null,
        customerPhone: token.customerPhone,
        customerName: token.customerName ?? customer.name ?? null,
        stripeCustomerId: customer.stripeCustomerId,
        stripePaymentMethodId: customer.stripePaymentMethodId,
        stripePaymentIntentId: intent.id,
        amountCents: intent.amount,
        currency: intent.currency,
        operation: "authorization",
        status: "authorized",
        errorMessage: null,
        createdBy: agentName,
        authorizedAt: intent.created * 1000,
        captureBefore,
        notes: "Recovered from a verified existing Stripe hold. No Stripe action was performed.",
      }).$returningId();
      return { authorizationId: Number(recovered.id), recovered: true as const };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 7. capturePayment (admin) — captures a preauthorized PaymentIntent
  // ────────────────────────────────────────────────────────────────────────────
  capturePayment: agentProcedure
    .input(
      z.object({
        authorizationId: z.number().int(),
        amountCents: z.number().int().min(50).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [auth] = await db
        .select()
        .from(paymentAuthorizations)
        .where(eq(paymentAuthorizations.id, input.authorizationId))
        .limit(1);

      if (!auth) throw new TRPCError({ code: "NOT_FOUND", message: "Authorization not found" });
      if (auth.status !== "authorized") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot capture — current status is '${auth.status}'` });
      }
      if (!auth.stripePaymentIntentId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Missing Stripe PaymentIntent ID" });
      }

      const stripe = getStripe();
      const agentName = ctx.agent?.agentName ?? "admin";

      let captured: Stripe.PaymentIntent;
      try {
        captured = await stripe.paymentIntents.capture(auth.stripePaymentIntentId, {
          amount_to_capture: input.amountCents,
        });
      } catch (err: unknown) {
        const stripeErr = err as Stripe.StripeRawError;
        await db
          .update(paymentAuthorizations)
          .set({ status: "failed", errorMessage: stripeErr?.message ?? "Capture failed" })
          .where(eq(paymentAuthorizations.id, input.authorizationId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe capture failed: ${stripeErr?.message ?? "Unknown error"}`,
        });
      }

      const now = Date.now();
      await db
        .update(paymentAuthorizations)
        .set({
          status: "captured",
          capturedAt: now,
          actionBy: agentName,
          amountCents: input.amountCents ?? auth.amountCents,
        })
        .where(eq(paymentAuthorizations.id, input.authorizationId));

      return {
        success: true,
        stripePaymentIntentId: captured.id,
        capturedAt: now,
        amountCents: input.amountCents ?? auth.amountCents,
      };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 8. cancelPreauth (admin) — cancels a preauthorized PaymentIntent
  // ────────────────────────────────────────────────────────────────────────────
  cancelPreauth: agentProcedure
    .input(z.object({ authorizationId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [auth] = await db
        .select()
        .from(paymentAuthorizations)
        .where(eq(paymentAuthorizations.id, input.authorizationId))
        .limit(1);

      if (!auth) throw new TRPCError({ code: "NOT_FOUND", message: "Authorization not found" });
      if (auth.status !== "authorized") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot cancel — current status is '${auth.status}'` });
      }
      if (!auth.stripePaymentIntentId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Missing Stripe PaymentIntent ID" });
      }

      const stripe = getStripe();
      const agentName = ctx.agent?.agentName ?? "admin";

      try {
        await stripe.paymentIntents.cancel(auth.stripePaymentIntentId);
      } catch (err: unknown) {
        const stripeErr = err as Stripe.StripeRawError;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe cancel failed: ${stripeErr?.message ?? "Unknown error"}`,
        });
      }

      const now = Date.now();
      await db
        .update(paymentAuthorizations)
        .set({ status: "cancelled", cancelledAt: now, actionBy: agentName })
        .where(eq(paymentAuthorizations.id, input.authorizationId));

      return { success: true, cancelledAt: now };
    }),

  // ────────────────────────────────────────────────────────────────────────────
  // 9. listPaymentAuthorizations (admin) — lists payment history for a customer
  // ────────────────────────────────────────────────────────────────────────────
  listPaymentAuthorizations: agentProcedure
    .input(
      z.object({
        customerPhone: z.string().min(7).max(30).optional(),
        cleanerJobId: z.number().int().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [];
      if (input?.customerPhone) {
        conditions.push(eq(paymentAuthorizations.customerPhone, input.customerPhone));
      }
      if (input?.cleanerJobId) {
        conditions.push(eq(paymentAuthorizations.cleanerJobId, input.cleanerJobId));
      }

      const rows = await db
        .select()
        .from(paymentAuthorizations)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(paymentAuthorizations.createdAt));

      return rows;
    }),

  // 10. listAllCustomers (admin) — lists all stripe_customers rows
  // ────────────────────────────────────────────────────────────────────────────
  listAllCustomers: agentProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      try {
        const repaired = await reconcileMissingStripeCustomerCards(db);
        if (repaired > 0) console.log(`[StripeCards] Cards on File reconciliation complete: ${repaired} repaired.`);
      } catch (error) {
        // Existing card-list results remain available even if a historical repair is retried later.
        console.error("[StripeCards] Cards on File reconciliation failed:", error);
      }
      const rows = await db
        .select()
        .from(stripeCustomers)
        .orderBy(desc(stripeCustomers.updatedAt));
      return rows;
    }),

  // 11. listAllCardAuthTokens (admin) — lists recent card auth tokens
  // ────────────────────────────────────────────────────────────────────────────
  listAllCardAuthTokens: agentProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db
        .select()
        .from(cardAuthTokens)
        .orderBy(desc(cardAuthTokens.createdAt))
        .limit(input.limit);
      return rows;
    }),
});
