import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { bookingsAgentProcedure, router, publicProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  appSettings,
  bookingAssignments,
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
  prepareBookingInputSchema,
} from "../shared/booking";
import {
  NativeBookingIdempotencyConflictError,
  NativeBookingInputError,
  prepareNativeBooking,
  type PreparedNativeBooking,
} from "./bookingsService";
import { ENV } from "./_core/env";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";
import {
  calculatePublicBookingPrice,
  isPublicBookingPriceSnapshot,
  PUBLIC_BOOKING_PRICED_EXTRAS,
} from "../shared/publicBookingPricing";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

const PREPARE_WINDOW_MS = 10 * 60_000;
const PREPARE_LIMIT = 20;
const prepareAttempts = new Map<string, { count: number; resetAt: number }>();
const NATIVE_BOOKING_OPERATIONAL_ORIGIN = "native_booking";
const NATIVE_BOOKING_RECURRENCES = [
  "one-time",
  "weekly",
  "biweekly",
  "monthly",
] as const;

function nativeBookingFrequency(recurrence: string) {
  if (recurrence === "weekly") return "Weekly";
  if (recurrence === "biweekly") return "Bi-weekly";
  if (recurrence === "monthly") return "Monthly";
  return "One time";
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

function nativeBookingServiceDateTime(
  booking: typeof bookings.$inferSelect
): string {
  return new Date(
    businessLocalDateTimeToUtcMs(
      booking.requestedLocalDate,
      booking.requestedLocalTime,
      booking.requestedTimeZone
    )
  ).toISOString();
}

function nativeBookingExtras(booking: typeof bookings.$inferSelect): string {
  return JSON.stringify(booking.extras.map(extra => extra.id));
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
  prepared: PreparedNativeBooking
) {
  try {
    const booking = await db.transaction(async tx => {
      const now = new Date();
      const result = await tx.insert(bookings).values({
        publicBookingNumber: prepared.publicBookingNumber,
        idempotencyKey: prepared.idempotencyKey,
        commandHash: prepared.commandHash,
        source: prepared.source,
        status: prepared.status,
        availabilityStatus: prepared.availabilityStatus,
        assignmentStatus: prepared.assignmentStatus,
        paymentStatus: prepared.paymentStatus,
        customerName: prepared.customerName,
        customerPhone: prepared.customerPhone,
        customerEmail: prepared.customerEmail,
        serviceId: prepared.serviceId,
        serviceName: prepared.serviceName,
        bedrooms: prepared.bedrooms,
        bathrooms: prepared.bathrooms,
        extras: prepared.extras,
        specialRequestNotes: prepared.specialRequestNotes,
        address: prepared.address,
        requestedLocalDate: prepared.requestedLocalDate,
        requestedLocalTime: prepared.requestedLocalTime,
        requestedTimeZone: prepared.requestedTimeZone,
        requestedStartAt: prepared.requestedStartAt,
        recurrence: prepared.recurrence,
        recurringIntentStatus: prepared.recurringIntentStatus,
        pricingVersion: prepared.pricingVersion,
        firstCleaningTotalCents: prepared.firstCleaningTotalCents,
        futureVisitTotalCents: prepared.futureVisitTotalCents,
        priceSnapshot: prepared.priceSnapshot,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const bookingId = Number(
        (result as unknown as { insertId?: number })?.insertId ??
          (result as unknown as Array<{ insertId?: number }>)[0]?.insertId
      );
      if (!Number.isInteger(bookingId) || bookingId < 1)
        throw new Error("Native booking insert did not return an ID.");

      if (
        prepared.recurrence !== "one-time" &&
        prepared.futureVisitTotalCents !== null
      ) {
        await tx.insert(bookingSeries).values({
          bookingId,
          status: "intent_pending",
          frequency: prepared.recurrence,
          anchorLocalDate: prepared.requestedLocalDate,
          anchorLocalTime: prepared.requestedLocalTime,
          timeZone: prepared.requestedTimeZone,
          firstCleaningTotalCents: prepared.firstCleaningTotalCents,
          futureVisitTotalCents: prepared.futureVisitTotalCents,
          createdAt: now,
          updatedAt: now,
        });
      }

      return {
        publicBookingNumber: prepared.publicBookingNumber,
        commandHash: prepared.commandHash,
      };
    });
    return { booking, created: true };
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    const existing = await findBookingByIdempotencyKey(
      db,
      prepared.idempotencyKey
    );
    if (!existing) throw error;
    return { booking: existing, created: false };
  }
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
          timeZone: ENV.businessTimezone,
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
              eq(cleanerProfiles.launch27TeamId, schedulingTeams.launch27TeamId),
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
        const operationalRows = await tx
          .select({ id: leadflowJobs.id })
          .from(leadflowJobs)
          .where(
            and(
              eq(leadflowJobs.bookingId, booking.id),
              eq(leadflowJobs.jobDate, booking.requestedLocalDate)
            )
          )
          .limit(1);
        const operationalJob = {
          bookingId: booking.id,
          jobDate: booking.requestedLocalDate,
          serviceDateTime: nativeBookingServiceDateTime(booking),
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          customerEmail: booking.customerEmail,
          jobAddress: booking.address,
          serviceName: booking.serviceName,
          bedrooms: booking.bedrooms,
          bathrooms: booking.bathrooms,
          extras: nativeBookingExtras(booking),
          frequency: nativeBookingFrequency(booking.recurrence),
          teamName: team.name,
          teamId: team.id,
          customerNotes: booking.specialRequestNotes.join("\n") || null,
          jobTotalCents: booking.firstCleaningTotalCents,
          hasStripeCard:
            booking.paymentStatus === "card_on_file" ||
            booking.paymentStatus === "captured"
              ? 1
              : 0,
          paymentBrand: null,
          paymentLast4: null,
        };
        if (operationalRows[0]) {
          await tx
            .update(leadflowJobs)
            .set({ ...operationalJob, updatedAt: now })
            .where(eq(leadflowJobs.id, operationalRows[0].id));
        } else {
          await tx.insert(leadflowJobs).values({
            origin: NATIVE_BOOKING_OPERATIONAL_ORIGIN,
            launch27BookingId: null,
            bookingSeriesId: null,
            bookingStatus: "assigned",
            ...operationalJob,
          });
        }
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

        const operationalRows = await tx
          .select({ id: leadflowJobs.id, jobDate: leadflowJobs.jobDate })
          .from(leadflowJobs)
          .where(eq(leadflowJobs.bookingId, booking.id))
          .orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.id));
        const currentOperationalJob =
          operationalRows.find(
            job => job.jobDate === booking.requestedLocalDate
          ) ?? operationalRows[0];
        const nativeExtras = JSON.stringify(extras.map(extra => extra.id));
        const operationalFrequency = nativeBookingFrequency(recurrence);
        if (currentOperationalJob) {
          await tx
            .update(leadflowJobs)
            .set({
              jobDate: requestedLocalDate,
              serviceDateTime: new Date(requestedStartAt).toISOString(),
              extras: nativeExtras,
              frequency: operationalFrequency,
              customerNotes: booking.specialRequestNotes.join("\n") || null,
              jobTotalCents: firstCleaningTotalCents,
              nextOccurrenceCreatedAt: null,
              updatedAt: now,
            })
            .where(eq(leadflowJobs.id, currentOperationalJob.id));
        }
        if (futureVisitTotalCents !== null) {
          await tx
            .update(leadflowJobs)
            .set({
              extras: nativeExtras,
              frequency: operationalFrequency,
              jobTotalCents: futureVisitTotalCents,
              updatedAt: now,
            })
            .where(
              and(
                eq(leadflowJobs.bookingId, booking.id),
                gt(leadflowJobs.jobDate, requestedLocalDate)
              )
            );
        }

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
      await db
        .update(bookings)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(bookings.id, input.id));
      await db
        .update(leadflowJobs)
        .set({ bookingStatus: "cancelled", updatedAt: new Date() })
        .where(eq(leadflowJobs.bookingId, input.id));
      publishNativeBookingRefresh();
      return { id: input.id, status: "cancelled" as const };
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
