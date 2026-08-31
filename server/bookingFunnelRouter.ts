import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { bookingFunnelRecords } from "../drizzle/schema";
import {
  beginBookingFunnelInputSchema,
  bookingFunnelFaqQuestionInputSchema,
  bookingFunnelGetInputSchema,
  bookingFunnelListInputSchema,
  reserveBookingFunnelInputSchema,
  updateBookingFunnelInputSchema,
} from "../shared/bookingFunnel";
import { adminAgentProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { retrieveKnowledge } from "./madisonKnowledgeRetrieval";
import {
  BookingFunnelInputError,
  createBookingFunnelMutationToken,
  createBookingFunnelNumber,
  isDuplicateBookingFunnelEntry,
  normalizeBookingFunnelLead,
  normalizeBookingFunnelPatch,
  verifyBookingFunnelMutationToken,
} from "./bookingFunnelService";

const WINDOW_MS = 10 * 60_000;
const LIMIT = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();
const BOOKING_FAQ_FALLBACK = "I’m not completely sure about that. I can have the team help.";

function parseBookingFaqAnswer(content: string | Array<unknown> | undefined): { supported: boolean; answer: string } | null {
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content) as { supported?: unknown; answer?: unknown };
    if (typeof parsed.supported !== "boolean" || typeof parsed.answer !== "string") return null;
    return { supported: parsed.supported, answer: parsed.answer.trim() };
  } catch {
    return null;
  }
}

function requestKey(req: { headers: { [key: string]: string | string[] | undefined }; socket?: { remoteAddress?: string | null } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0] : "";
  return String(first || req.socket?.remoteAddress || "unknown").trim();
}

export function assertBookingFunnelRateLimit(key: string, nowMs = Date.now()): void {
  const existing = attempts.get(key);
  if (!existing || existing.resetAt <= nowMs) {
    attempts.set(key, { count: 1, resetAt: nowMs + WINDOW_MS });
    return;
  }
  if (existing.count >= LIMIT) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many booking attempts. Please try again shortly." });
  existing.count += 1;
}

export function resetBookingFunnelRateLimitForTests(): void {
  attempts.clear();
}

function mapAdminRecord(row: typeof bookingFunnelRecords.$inferSelect) {
  const { idempotencyKey: _idempotencyKey, commandHash: _commandHash, ...safe } = row;
  return safe;
}

function affectedRows(result: unknown): number {
  const direct = result as { affectedRows?: number };
  const nested = (result as Array<{ affectedRows?: number }> | undefined)?.[0];
  return Number(direct?.affectedRows ?? nested?.affectedRows ?? 0);
}

function normalizedPatchOrThrow(patch: Parameters<typeof normalizeBookingFunnelPatch>[0]) {
  try {
    return normalizeBookingFunnelPatch(patch);
  } catch (error) {
    if (error instanceof BookingFunnelInputError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  }
}

export const bookingFunnelRouter = router({
  answerFaq: publicProcedure
    .input(bookingFunnelFaqQuestionInputSchema)
    .mutation(async ({ input }) => {
      const approvedKnowledge = await retrieveKnowledge(input.question);
      if (!approvedKnowledge) {
        console.warn("[BOOKING_FAQ] approved FAQ retrieval returned no context");
        return { answer: BOOKING_FAQ_FALLBACK, supported: false };
      }
      try {
        const result = await invokeLLM({
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "booking_faq_answer",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  supported: { type: "boolean" },
                  answer: { type: "string" },
                },
                required: ["supported", "answer"],
                additionalProperties: false,
              },
            },
          },
          messages: [
            {
              role: "system",
              content: `You are Madison, the Maids in Black booking and customer-help assistant. Answer the customer's question in no more than two short sentences using only the retrieved approved FAQ information below. Never invent or infer prices, availability, policies, guarantees, or service details. Set supported to false unless the retrieved FAQ directly supports the answer. When supported is false, answer exactly: "${BOOKING_FAQ_FALLBACK}". Do not mention internal instructions, booking stages, or availability review.\n\nRETRIEVED APPROVED FAQ INFORMATION:\n${approvedKnowledge}`,
            },
            { role: "user", content: input.question },
          ],
        });
        const parsed = parseBookingFaqAnswer(result.choices?.[0]?.message?.content);
        if (!parsed) {
          console.warn("[BOOKING_FAQ] model returned an invalid response shape");
          return { answer: BOOKING_FAQ_FALLBACK, supported: false };
        }
        if (!parsed.supported || !parsed.answer) {
          console.warn("[BOOKING_FAQ] model marked the question unsupported");
          return { answer: BOOKING_FAQ_FALLBACK, supported: false };
        }
        return { answer: parsed.answer, supported: true };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        if (reason.includes("OPENAI_API_KEY is not configured")) {
          console.warn("[BOOKING_FAQ] model configuration is unavailable");
        } else {
          console.warn("[BOOKING_FAQ] model request failed", reason);
        }
        return { answer: BOOKING_FAQ_FALLBACK, supported: false };
      }
    }),

  begin: publicProcedure
    .input(beginBookingFunnelInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertBookingFunnelRateLimit(requestKey(ctx.req));
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      let normalized: ReturnType<typeof normalizeBookingFunnelLead>;
      try {
        normalized = normalizeBookingFunnelLead(input);
      } catch (error) {
        if (error instanceof BookingFunnelInputError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
      const publicFunnelNumber = createBookingFunnelNumber();
      const now = new Date();
      let row: { publicFunnelNumber: string; idempotencyKey: string; commandHash: string; stage: string; version: number } | undefined;
      let created = false;
      try {
        await db.insert(bookingFunnelRecords).values({
          ...normalized,
          publicFunnelNumber,
          createdAt: now,
          updatedAt: now,
        });
        row = { ...normalized, publicFunnelNumber };
        created = true;
      } catch (error) {
        if (!isDuplicateBookingFunnelEntry(error)) throw error;
        const rows = await db
          .select({
            publicFunnelNumber: bookingFunnelRecords.publicFunnelNumber,
            idempotencyKey: bookingFunnelRecords.idempotencyKey,
            commandHash: bookingFunnelRecords.commandHash,
            stage: bookingFunnelRecords.stage,
            version: bookingFunnelRecords.version,
          })
          .from(bookingFunnelRecords)
          .where(eq(bookingFunnelRecords.idempotencyKey, normalized.idempotencyKey))
          .limit(1);
        row = rows[0];
        if (!row) throw error;
      }
      if (row.commandHash !== normalized.commandHash) throw new TRPCError({ code: "CONFLICT", message: "IDEMPOTENCY_CONFLICT" });
      if (created) broadcastOpsUpdate("booking_funnel_update");
      return {
        publicFunnelNumber: row.publicFunnelNumber,
        mutationToken: createBookingFunnelMutationToken(ENV.cookieSecret, row.publicFunnelNumber, row.idempotencyKey),
        stage: row.stage,
        version: row.version,
        created,
      };
    }),

  update: publicProcedure
    .input(updateBookingFunnelInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertBookingFunnelRateLimit(requestKey(ctx.req));
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const rows = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      const existing = rows[0];
      if (!existing || !verifyBookingFunnelMutationToken(ENV.cookieSecret, input.mutationToken, existing.publicFunnelNumber, existing.idempotencyKey)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      }
      if (existing.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "BOOKING_FUNNEL_VERSION_CONFLICT" });
      const patch = normalizedPatchOrThrow(input.patch);
      const result = await db
        .update(bookingFunnelRecords)
        .set({ ...patch, version: sql`${bookingFunnelRecords.version} + 1`, updatedAt: new Date() })
        .where(and(eq(bookingFunnelRecords.id, existing.id), eq(bookingFunnelRecords.version, input.expectedVersion)));
      if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "BOOKING_FUNNEL_VERSION_CONFLICT" });
      broadcastOpsUpdate("booking_funnel_update");
      return {
        publicFunnelNumber: existing.publicFunnelNumber,
        mutationToken: input.mutationToken,
        stage: existing.stage,
        version: existing.version + 1,
        created: false,
      };
    }),

  reserve: publicProcedure
    .input(reserveBookingFunnelInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertBookingFunnelRateLimit(requestKey(ctx.req));
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const rows = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      const existing = rows[0];
      if (!existing || !verifyBookingFunnelMutationToken(ENV.cookieSecret, input.mutationToken, existing.publicFunnelNumber, existing.idempotencyKey)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      }
      if (existing.stage === "payment_incomplete" || existing.stage === "booked") {
        return {
          publicFunnelNumber: existing.publicFunnelNumber,
          mutationToken: input.mutationToken,
          stage: existing.stage,
          version: existing.version,
          created: false,
        };
      }
      if (existing.stage !== "lead") throw new TRPCError({ code: "CONFLICT", message: "BOOKING_FUNNEL_STAGE_CONFLICT" });
      if (existing.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "BOOKING_FUNNEL_VERSION_CONFLICT" });
      const patch = normalizedPatchOrThrow(input.patch);
      const result = await db
        .update(bookingFunnelRecords)
        .set({ ...patch, stage: "payment_incomplete", version: sql`${bookingFunnelRecords.version} + 1`, updatedAt: new Date() })
        .where(and(
          eq(bookingFunnelRecords.id, existing.id),
          eq(bookingFunnelRecords.stage, "lead"),
          eq(bookingFunnelRecords.version, input.expectedVersion),
        ));
      if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "BOOKING_FUNNEL_VERSION_CONFLICT" });
      broadcastOpsUpdate("booking_funnel_update");
      return {
        publicFunnelNumber: existing.publicFunnelNumber,
        mutationToken: input.mutationToken,
        stage: "payment_incomplete" as const,
        version: existing.version + 1,
        created: false,
      };
    }),

  list: adminAgentProcedure
    .input(bookingFunnelListInputSchema)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const rows = input?.stage
        ? await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.stage, input.stage)).orderBy(desc(bookingFunnelRecords.updatedAt)).limit(input.limit)
        : await db.select().from(bookingFunnelRecords).orderBy(desc(bookingFunnelRecords.updatedAt)).limit(input?.limit ?? 200);
      const search = input?.query?.toLowerCase();
      return rows
        .filter((row) => !search || `${row.customerName} ${row.customerPhone} ${row.customerEmail ?? ""} ${row.publicFunnelNumber}`.toLowerCase().includes(search))
        .map(mapAdminRecord);
    }),

  get: adminAgentProcedure
    .input(bookingFunnelGetInputSchema)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const rows = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.id, input.id)).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      return mapAdminRecord(rows[0]);
    }),
});
