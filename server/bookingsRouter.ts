import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bookingsAgentProcedure, router, publicProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  appSettings,
  bookingAssignments,
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookingSeries,
  bookings,
  customerPortalServiceRequests,
  cleanerProfiles,
  leadflowJobs,
  schedulingTeams,
} from "../drizzle/schema";
import {
  BOOKING_WIDGET_DRAFT_SETTING,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  parseBookingWidgetDraft,
} from "../shared/bookingWidgetConfig";
import {
  bookingGetInputSchema,
  bookingListInputSchema,
  bookingRecurringFrequencySchema,
  bookingServiceIdSchema,
  prepareBookingInputSchema,
} from "../shared/booking";
import { BOOKING_TIME_ZONE } from "../shared/easternTime";
import {
  NativeBookingIdempotencyConflictError,
  NativeBookingInputError,
  buildPreparedCanonicalBooking,
  prepareNativeBooking,
  type PreparePublicBookingInput,
  type PreparedNativeBooking,
} from "./bookingsService";
import { ENV } from "./_core/env";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";
import {
  calculatePublicBookingPrice,
  isPublicBookingPriceSnapshot,
  PUBLIC_BOOKING_PRICED_EXTRAS,
  PUBLIC_BOOKING_POST_BOOKING_UPSELLS,
  PUBLIC_BOOKING_PRICING_VERSION,
} from "../shared/publicBookingPricing";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";
import { persistCanonicalBooking } from "./canonicalBookingPersistence";
import { cancelCanonicalBooking } from "./bookingCancellationService";
import { applyCanonicalAdditionalServices, BookingUpsellInputError } from "./bookingUpsellEngine";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";
import {
  NATIVE_BOOKING_OPERATIONAL_ORIGIN,
  nativeBookingCustomerNotes,
  nativeBookingExtras,
  nativeBookingFrequency,
  nativeBookingServiceDateTime,
  syncNativeBookingOperationalProjection,
} from "./bookingLifecycleService";

const PREPARE_WINDOW_MS = 10 * 60_000;
const PREPARE_LIMIT = 20;
const prepareAttempts = new Map<string, { count: number; resetAt: number }>();
const NATIVE_BOOKING_RECURRENCES = [
  "one-time",
  "weekly",
  "biweekly",
  "monthly",
] as const;

const internalPublicBookingInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  paymentMethod: z.enum(["card", "cashapp", "invoice"]),
  companyNotes: z.string().trim().max(4_000).nullable(),
  additionalServices: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        quantity: z.number().int().min(1).max(50),
      })
    )
    .max(20)
    .default([]),
  booking: z.object({
    surface: z.literal("popup"),
    customer: z.object({
      fullName: z.string().trim().min(2).max(255),
      phone: z.string().trim().min(7).max(40),
      email: z.string().trim().email().max(320),
    }),
    service: z.object({
      serviceId: bookingServiceIdSchema,
      bedrooms: z.number().int().min(0).max(7),
      bathrooms: z.number().int().min(1).max(20),
      extras: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(64),
            quantity: z.number().int().min(1).max(50),
          })
        )
        .max(20),
      specialRequestNotes: z.array(z.string().trim().min(1).max(1_000)).max(20),
    }),
    address: z.string().trim().min(5).max(500),
    requestedSchedule: z.object({
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    recurrence: bookingRecurringFrequencySchema,
    acceptedPricing: z.object({
      version: z.literal(PUBLIC_BOOKING_PRICING_VERSION),
      totalCents: z.number().int().min(0).max(10_000_000),
    }),
    pricing: z.object({
      pricingMode: z.enum(["home", "hourly"]),
      serviceId: bookingServiceIdSchema,
      bedrooms: z.number().int().min(0).max(7),
      bathrooms: z.number().int().min(1).max(5),
      homeType: z.enum(["House", "Apartment", "Townhome", "Condo"]),
      condition: z.number().int().min(1).max(10),
      maidCount: z.number().int().min(1).max(4),
      hourCount: z.number().int().min(1).max(8),
      extras: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(80),
            quantity: z.number().int().min(1).max(50),
          })
        )
        .max(50),
      recurrence: bookingRecurringFrequencySchema,
    }),
  }),
});

async function applyInternalAdditionalServices(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingId: number,
  selections: Array<{ id: string; quantity: number }>,
) {
  try {
    return await applyCanonicalAdditionalServices(db, bookingId, selections);
  } catch (error) {
    if (error instanceof BookingUpsellInputError) throw new NativeBookingInputError(error.message);
    throw error;
  }
}
function nativeBookingFutureVisitTotalCents(
  booking: typeof bookings.$inferSelect,
  recurrence: (typeof NATIVE_BOOKING_RECURRENCES)[number]
) {
  if (recurrence === "one-time") return null;
  if (isPublicBookingPriceSnapshot(booking.priceSnapshot)) {
    return calculatePublicBookingPrice({
      ...booking.priceSnapshot.input,
      recurrence,
    }).futureVisitTotalCents;
  }
  return booking.futureVisitTotalCents;
}

function publishNativeBookingRefresh() {
  broadcastCleanerPortalJobsChanged();
}

function requestKey(req: {
  headers: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string | null };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]
      : "";
  return String(
    firstForwarded || req.socket?.remoteAddress || "unknown"
  ).trim();
}

export function assertBookingPrepareRateLimit(
  key: string,
  nowMs = Date.now()
): void {
  const existing = prepareAttempts.get(key);
  if (!existing || existing.resetAt <= nowMs) {
    prepareAttempts.set(key, { count: 1, resetAt: nowMs + PREPARE_WINDOW_MS });
    return;
  }
  if (existing.count >= PREPARE_LIMIT) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many booking attempts. Please try again shortly.",
    });
  }
  existing.count += 1;
}

export function resetBookingPrepareRateLimitForTests(): void {
  prepareAttempts.clear();
}

function isDuplicateEntry(error: unknown): boolean {
  const candidate = error as {
    code?: string;
    errno?: number;
    message?: string;
  };
  return (
    candidate.code === "ER_DUP_ENTRY" ||
    candidate.errno === 1062 ||
    candidate.message?.includes("Duplicate entry") === true
  );
}

async function findBookingByIdempotencyKey(
  db: Awaited<ReturnType<typeof getDb>>,
  idempotencyKey: string
) {
  if (!db) return undefined;
  const rows = await db
    .select({
      id: bookings.id,
      publicBookingNumber: bookings.publicBookingNumber,
      commandHash: bookings.commandHash,
    })
    .from(bookings)
    .where(eq(bookings.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0];
}

async function persistPreparedBooking(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  prepared: PreparedNativeBooking,
  options: {
    createAtomicPaymentProfile?: boolean;
    paymentMethod?: "card" | "cashapp" | "invoice";
    companyNotes?: string | null;
  } = {}
) {
  const result = await persistCanonicalBooking(db, prepared, {
    paymentMethod: options.paymentMethod,
    companyNotes: options.companyNotes,
    initialBookingStatus: options.paymentMethod === "card"
      ? "pending_payment"
      : "needs_attention",
  });
  return {
    booking: {
      id: result.bookingId,
      publicBookingNumber: result.publicBookingNumber,
      commandHash: result.commandHash,
    },
    created: result.created,
  };
}

type ActiveBookingAssignment = {
  teamId: number | null;
  teamName: string | null;
};

async function activeAssignmentsByBookingId(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingIds: number[]
) {
  if (!bookingIds.length) return new Map<number, ActiveBookingAssignment>();
  const rows = await db
    .select({
      bookingId: bookingAssignments.bookingId,
      teamId: bookingAssignments.teamId,
      teamName: bookingAssignments.teamName,
    })
    .from(bookingAssignments)
    .where(
      and(
        inArray(bookingAssignments.bookingId, bookingIds),
        eq(bookingAssignments.status, "assigned")
      )
    )
    .orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id));
  const assignments = new Map<number, ActiveBookingAssignment>();
  for (const row of rows) {
    if (!assignments.has(row.bookingId)) {
      assignments.set(row.bookingId, {
        teamId: row.teamId,
        teamName: row.teamName,
      });
    }
  }
  return assignments;
}

function mapAdminBooking(
  row: typeof bookings.$inferSelect,
  assignment?: ActiveBookingAssignment
) {
  return {
    id: row.id,
    publicBookingNumber: row.publicBookingNumber,
    status: row.status,
    availabilityStatus: row.availabilityStatus,
    assignmentStatus: row.assignmentStatus,
    assignedTeamId: assignment?.teamId ?? null,
    assignedTeamName: assignment?.teamName ?? null,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    extras: row.extras,
    specialRequestNotes: row.specialRequestNotes,
    address: row.address,
    requestedLocalDate: row.requestedLocalDate,
    requestedLocalTime: row.requestedLocalTime,
    requestedTimeZone: row.requestedTimeZone,
    requestedStartAt: row.requestedStartAt,
    recurrence: row.recurrence,
    recurringIntentStatus: row.recurringIntentStatus,
    pricingVersion: row.pricingVersion,
    firstCleaningTotalCents: row.firstCleaningTotalCents,
    futureVisitTotalCents: row.futureVisitTotalCents,
    companyNotes: row.companyNotes,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const bookingsRouter = router({
  getPublicWidgetConfig: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return DEFAULT_BOOKING_WIDGET_DRAFT;
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, BOOKING_WIDGET_DRAFT_SETTING.key))
      .limit(1);
    return parseBookingWidgetDraft(rows[0]?.value);
  }),

  prepare: publicProcedure
    .input(prepareBookingInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertBookingPrepareRateLimit(requestKey(ctx.req));
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      try {
        return await prepareNativeBooking(input, {
          nowMs: Date.now(),
          timeZone: BOOKING_TIME_ZONE,
          persist: prepared => persistPreparedBooking(db, prepared),
        });
      } catch (error) {
        if (error instanceof NativeBookingIdempotencyConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "IDEMPOTENCY_CONFLICT",
          });
        }
        if (
          error instanceof NativeBookingInputError ||
          error instanceof RangeError
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  createInternal: bookingsAgentProcedure
    .input(internalPublicBookingInputSchema)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      try {
        const preparedInput: PreparePublicBookingInput = {
          ...input.booking,
          idempotencyKey: input.idempotencyKey,
        };
        const built = buildPreparedCanonicalBooking(preparedInput, {
          nowMs: Date.now(),
          timeZone: BOOKING_TIME_ZONE,
        });
        if (built.type === "price_changed") {
          throw new NativeBookingInputError(
            `The booking price changed. Current total is $${(built.totalCents / 100).toFixed(2)}.`
          );
        }
        const persisted = await persistPreparedBooking(db, built.prepared, {
          createAtomicPaymentProfile: true,
          paymentMethod: input.paymentMethod,
          companyNotes: input.companyNotes,
        });
        const additionalServices = await applyInternalAdditionalServices(
          db,
          persisted.booking.id,
          input.additionalServices
        );
        publishNativeBookingRefresh();
        return {
          bookingId: persisted.booking.id,
          publicBookingNumber: persisted.booking.publicBookingNumber,
          created: persisted.created,
          paymentMethod: input.paymentMethod,
          totalCents:
            additionalServices?.totalCents ??
            built.prepared.firstCleaningTotalCents,
        };
      } catch (error) {
        if (error instanceof NativeBookingIdempotencyConflictError)
          throw new TRPCError({
            code: "CONFLICT",
            message: "IDEMPOTENCY_CONFLICT",
          });
        if (
          error instanceof NativeBookingInputError ||
          error instanceof RangeError
        )
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),

  list: bookingsAgentProcedure
    .input(bookingListInputSchema.optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const conditions = [
        input?.date ? eq(bookings.requestedLocalDate, input.date) : undefined,
        input?.status ? eq(bookings.status, input.status) : undefined,
      ].filter(Boolean) as ReturnType<typeof eq>[];
      const query = db.select().from(bookings);
      const rows = conditions.length
        ? await query
            .where(and(...conditions))
            .orderBy(asc(bookings.requestedLocalTime), desc(bookings.createdAt))
            .limit(input?.limit ?? 200)
        : await query
            .orderBy(
              asc(bookings.requestedLocalDate),
              asc(bookings.requestedLocalTime),
              desc(bookings.createdAt)
            )
            .limit(input?.limit ?? 200);
      const search = input?.query?.trim().toLowerCase();
      const assignments = await activeAssignmentsByBookingId(
        db,
        rows.map(row => row.id)
      );
      return rows
        .filter(
          row =>
            !search ||
            `${row.customerName} ${row.customerPhone} ${row.customerEmail} ${row.address} ${row.publicBookingNumber}`
              .toLowerCase()
              .includes(search)
        )
        .map(row => mapAdminBooking(row, assignments.get(row.id)));
    }),

  standardTimeCounts: bookingsAgentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      return db
        .select({
          time: bookings.requestedLocalTime,
          count: sql<number>`count(*)`,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.requestedLocalDate, input.date),
            sql`${bookings.status} NOT IN ('cancelled', 'expired')`
          )
        )
        .groupBy(bookings.requestedLocalTime);
    }),

  get: bookingsAgentProcedure
    .input(bookingGetInputSchema)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const rows = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!rows[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found.",
        });
      const assignments = await activeAssignmentsByBookingId(db, [rows[0].id]);
      return mapAdminBooking(rows[0], assignments.get(rows[0].id));
    }),
  teams: bookingsAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Booking service unavailable.",
      });
    return db
      .select({ id: schedulingTeams.id, name: schedulingTeams.name })
      .from(schedulingTeams)
      .innerJoin(
        cleanerProfiles,
        and(
          eq(cleanerProfiles.launch27TeamId, schedulingTeams.launch27TeamId),
          eq(cleanerProfiles.isActive, 1)
        )
      )
      .where(
        and(eq(schedulingTeams.isActive, 1), eq(schedulingTeams.isArchived, 0))
      )
      .orderBy(asc(schedulingTeams.name));
  }),
  assignTeam: bookingsAgentProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        teamId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const assignment = await db.transaction(async tx => {
        const bookingRows = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .limit(1);
        const booking = bookingRows[0];
        if (!booking)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found.",
          });
        const teamRows = await tx
          .select({ id: schedulingTeams.id, name: schedulingTeams.name })
          .from(schedulingTeams)
          .innerJoin(
            cleanerProfiles,
            and(
              eq(
                cleanerProfiles.launch27TeamId,
                schedulingTeams.launch27TeamId
              ),
              eq(cleanerProfiles.isActive, 1)
            )
          )
          .where(
            and(
              eq(schedulingTeams.id, input.teamId),
              eq(schedulingTeams.isActive, 1),
              eq(schedulingTeams.isArchived, 0)
            )
          )
          .limit(1);
        const team = teamRows[0];
        if (!team)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Active team not found.",
          });

        const now = new Date();
        await tx
          .update(bookingAssignments)
          .set({ status: "unassigned", unassignedAt: now, updatedAt: now })
          .where(
            and(
              eq(bookingAssignments.bookingId, input.bookingId),
              eq(bookingAssignments.status, "assigned")
            )
          );
        await tx.insert(bookingAssignments).values({
          bookingId: input.bookingId,
          teamId: team.id,
          teamName: team.name,
          status: "assigned",
          assignedByAgentId: ctx.agent.agentId,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await tx
          .update(bookings)
          .set({ assignmentStatus: "assigned", updatedAt: now })
          .where(eq(bookings.id, input.bookingId));
        await syncNativeBookingOperationalProjection(tx, booking, {
          teamId: team.id,
          teamName: team.name,
        });
        return {
          bookingId: input.bookingId,
          teamId: team.id,
          teamName: team.name,
          assignmentStatus: "assigned" as const,
        };
      });
      publishNativeBookingRefresh();
      return assignment;
    }),
  updateAdditionalServices: bookingsAgentProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        additionalServices: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(80),
              quantity: z.number().int().min(1).max(50),
            })
          )
          .max(20),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      try {
        return (
          (await applyInternalAdditionalServices(
            db,
            input.bookingId,
            input.additionalServices
          )) ?? { totalCents: 0, extras: [] }
        );
      } catch (error) {
        if (error instanceof NativeBookingInputError)
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),

  updateDetails: bookingsAgentProcedure
    .input(
      z
        .object({
          bookingId: z.number().int().positive(),
          extras: z
            .array(
              z.object({
                id: z.string().trim().min(1).max(80),
                quantity: z.number().int().min(1).max(50),
              })
            )
            .max(50)
            .optional(),
          firstCleaningTotalCents: z
            .number()
            .int()
            .min(0)
            .max(10_000_000)
            .optional(),
          companyNotes: z.string().trim().max(4_000).nullable().optional(),
          requestedLocalDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          recurrence: z.enum(NATIVE_BOOKING_RECURRENCES).optional(),
        })
        .refine(
          value =>
            value.extras !== undefined ||
            value.firstCleaningTotalCents !== undefined ||
            value.companyNotes !== undefined ||
            value.requestedLocalDate !== undefined ||
            value.recurrence !== undefined,
          "Choose booking details to update."
        )
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const updatedBooking = await db.transaction(async tx => {
        const rows = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .limit(1);
        const booking = rows[0];
        if (!booking)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Booking not found.",
          });

        const existingExtrasById = new Map(
          booking.extras.map(extra => [extra.id, extra])
        );
        const seenExtras = new Set<string>();
        const extras = (
          input.extras ??
          booking.extras.map(extra => ({
            id: extra.id,
            quantity: extra.quantity,
          }))
        )
          .map(selection => {
            if (seenExtras.has(selection.id))
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Each extra can only be selected once.",
              });
            seenExtras.add(selection.id);
            const catalogExtra = PUBLIC_BOOKING_PRICED_EXTRAS[selection.id];
            const existingExtra = existingExtrasById.get(selection.id);
            if (!catalogExtra && !existingExtra)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Unsupported booking extra.",
              });
            const unitPriceCents = catalogExtra
              ? catalogExtra.unitPrice * 100
              : existingExtra!.unitPriceCents;
            return {
              id: selection.id,
              label: catalogExtra?.label ?? existingExtra!.label,
              quantity: selection.quantity,
              unitPriceCents,
              totalCents: unitPriceCents * selection.quantity,
            };
          })
          .sort((left, right) => left.id.localeCompare(right.id));

        const firstCleaningTotalCents =
          input.firstCleaningTotalCents ?? booking.firstCleaningTotalCents;
        const companyNotes =
          input.companyNotes === undefined
            ? booking.companyNotes
            : input.companyNotes?.trim() || null;
        const requestedLocalDate =
          input.requestedLocalDate ?? booking.requestedLocalDate;
        const recurrence =
          input.recurrence ??
          (booking.recurrence as (typeof NATIVE_BOOKING_RECURRENCES)[number]);
        const futureVisitTotalCents = nativeBookingFutureVisitTotalCents(
          booking,
          recurrence
        );
        const requestedStartAt = businessLocalDateTimeToUtcMs(
          requestedLocalDate,
          booking.requestedLocalTime,
          booking.requestedTimeZone
        );
        const now = new Date();

        await tx
          .update(bookings)
          .set({
            extras,
            firstCleaningTotalCents,
            companyNotes,
            requestedLocalDate,
            requestedStartAt,
            recurrence,
            recurringIntentStatus:
              recurrence === "one-time" ? null : "intent_pending",
            futureVisitTotalCents,
            updatedAt: now,
          })
          .where(eq(bookings.id, booking.id));

        const [activeAssignment] = await tx
          .select({ teamId: bookingAssignments.teamId, teamName: bookingAssignments.teamName })
          .from(bookingAssignments)
          .where(
            and(
              eq(bookingAssignments.bookingId, booking.id),
              eq(bookingAssignments.status, "assigned"),
            ),
          )
          .orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id))
          .limit(1);

        const [series] = await tx
          .select()
          .from(bookingSeries)
          .where(eq(bookingSeries.bookingId, booking.id))
          .limit(1);
        if (recurrence !== "one-time" && futureVisitTotalCents !== null) {
          const seriesValues = {
            status: "intent_pending",
            frequency: recurrence,
            anchorLocalDate: requestedLocalDate,
            anchorLocalTime: booking.requestedLocalTime,
            timeZone: booking.requestedTimeZone,
            firstCleaningTotalCents,
            futureVisitTotalCents,
            updatedAt: now,
          };
          if (series)
            await tx
              .update(bookingSeries)
              .set(seriesValues)
              .where(eq(bookingSeries.id, series.id));
          else
            await tx.insert(bookingSeries).values({
              bookingId: booking.id,
              ...seriesValues,
              createdAt: now,
            });
        } else if (series) {
          await tx
            .update(bookingSeries)
            .set({ status: "cancelled", updatedAt: now })
            .where(eq(bookingSeries.id, series.id));
        }

        const nextBooking = {
          ...booking,
          extras,
          firstCleaningTotalCents,
          companyNotes,
          requestedLocalDate,
          requestedStartAt,
          recurrence,
          futureVisitTotalCents,
        };
        await syncNativeBookingOperationalProjection(
          tx,
          nextBooking,
          activeAssignment && activeAssignment.teamId !== null && activeAssignment.teamName !== null
            ? { teamId: activeAssignment.teamId, teamName: activeAssignment.teamName }
            : null,
        );

        return {
          bookingId: booking.id,
          extras,
          firstCleaningTotalCents,
          futureVisitTotalCents,
          companyNotes,
          requestedLocalDate,
          recurrence,
        };
      });
      publishNativeBookingRefresh();
      return updatedBooking;
    }),
  cancel: bookingsAgentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const rows = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, input.id))
        .limit(1);
      if (!rows[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found.",
        });
      const cancelled = await cancelCanonicalBooking(db, input.id);
      if (!cancelled)
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      publishNativeBookingRefresh();
      return cancelled;
    }),
  staffRequests: bookingsAgentProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(200) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      return db
        .select()
        .from(customerPortalServiceRequests)
        .orderBy(desc(customerPortalServiceRequests.createdAt))
        .limit(input.limit);
    }),
  cancelStaffRequest: bookingsAgentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const rows = await db
        .select({ id: customerPortalServiceRequests.id })
        .from(customerPortalServiceRequests)
        .where(eq(customerPortalServiceRequests.id, input.id))
        .limit(1);
      if (!rows[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service request not found.",
        });
      await db
        .update(customerPortalServiceRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(customerPortalServiceRequests.id, input.id));
      return { id: input.id, status: "cancelled" as const };
    }),
  staffMagicLink: bookingsAgentProcedure
    .input(
      z.object({
        customerName: z.string().trim().min(1).max(250),
        customerPhone: z.string().trim().min(1).max(40),
        customerEmail: z.string().trim().max(320).nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      const url = await getOrCreateCustomerPortalMagicLink(db, input);
      return { url };
    }),
});
