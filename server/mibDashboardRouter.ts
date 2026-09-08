import { and, asc, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { activityLog, bookingFunnelRecords, bookings } from "../drizzle/schema";
import { aggregateMibDashboardBookings, mergeMibDashboardBookings } from "../shared/mibDashboard";
import { adminAgentProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

/**
 * Read-only data contract for the MIB operations dashboard. It mirrors the
 * Bookings workspace's native-plus-unconverted-funnel composition and does
 * not read legacy cleaner job data or mutate application state.
 */
export const mibDashboardRouter = router({
  /**
   * Aggregate-only dashboard data. This intentionally uses the same public
   * access model as Command Chat's leads.stats ticker: it returns counts and
   * totals only, never customer, address, phone, or booking detail fields.
   */
  getPublicBookingMetrics: publicProcedure
    .input(z.object({ startDate: localDate, endDate: localDate, serviceStartDate: localDate }))
    .query(async ({ input }) => {
      if (input.startDate > input.endDate || input.serviceStartDate < input.startDate || input.serviceStartDate > input.endDate) {
        throw new Error("Invalid dashboard date range");
      }
      const db = await getDb();
      if (!db) throw new Error("Booking service unavailable.");
      const [nativeRows, funnelRows] = await Promise.all([
        db
          .select({
            id: bookings.id,
            customerName: bookings.customerName,
            requestedLocalDate: bookings.requestedLocalDate,
            requestedLocalTime: bookings.requestedLocalTime,
            serviceName: bookings.serviceName,
            assignmentStatus: bookings.assignmentStatus,
            paymentStatus: bookings.paymentStatus,
            firstCleaningTotalCents: bookings.firstCleaningTotalCents,
            status: bookings.status,
          })
          .from(bookings)
          .where(and(gte(bookings.requestedLocalDate, input.startDate), lte(bookings.requestedLocalDate, input.endDate))),
        db
          .select({
            id: bookingFunnelRecords.id,
            bookingId: bookingFunnelRecords.bookingId,
            customerName: bookingFunnelRecords.customerName,
            requestedLocalDate: bookingFunnelRecords.requestedLocalDate,
            requestedLocalTime: bookingFunnelRecords.requestedLocalTime,
            serviceName: bookingFunnelRecords.serviceName,
            paymentLast4: bookingFunnelRecords.paymentLast4,
            firstCleaningTotalCents: bookingFunnelRecords.firstCleaningTotalCents,
            stage: bookingFunnelRecords.stage,
          })
          .from(bookingFunnelRecords)
          .where(and(gte(bookingFunnelRecords.requestedLocalDate, input.startDate), lte(bookingFunnelRecords.requestedLocalDate, input.endDate))),
      ]);
      const rows = mergeMibDashboardBookings(nativeRows, funnelRows);
      const currentWindowRows = rows.filter((row) => row.requestedLocalDate !== null && row.requestedLocalDate >= input.serviceStartDate);
      const serviceCounts = new Map<string, number>();
      for (const row of currentWindowRows) {
        const serviceName = row.serviceName?.trim() || "Service not specified";
        serviceCounts.set(serviceName, (serviceCounts.get(serviceName) ?? 0) + 1);
      }
      return {
        days: aggregateMibDashboardBookings(rows, input.startDate, input.endDate),
        services: [...serviceCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, bookings]) => ({ name, bookings })),
      };
    }),
  getBookingWindow: adminAgentProcedure
    .input(z.object({ startDate: localDate, endDate: localDate }))
    .query(async ({ input }) => {
      if (input.startDate > input.endDate) {
        throw new Error("Dashboard start date must be on or before end date");
      }
      const db = await getDb();
      if (!db) throw new Error("Booking service unavailable.");

      const [nativeRows, funnelRows] = await Promise.all([
        db
          .select({
            id: bookings.id,
            customerName: bookings.customerName,
            requestedLocalDate: bookings.requestedLocalDate,
            requestedLocalTime: bookings.requestedLocalTime,
            serviceName: bookings.serviceName,
            assignmentStatus: bookings.assignmentStatus,
            paymentStatus: bookings.paymentStatus,
            firstCleaningTotalCents: bookings.firstCleaningTotalCents,
            status: bookings.status,
          })
          .from(bookings)
          .where(and(gte(bookings.requestedLocalDate, input.startDate), lte(bookings.requestedLocalDate, input.endDate)))
          .orderBy(asc(bookings.requestedLocalDate), asc(bookings.requestedLocalTime)),
        db
          .select({
            id: bookingFunnelRecords.id,
            bookingId: bookingFunnelRecords.bookingId,
            customerName: bookingFunnelRecords.customerName,
            requestedLocalDate: bookingFunnelRecords.requestedLocalDate,
            requestedLocalTime: bookingFunnelRecords.requestedLocalTime,
            serviceName: bookingFunnelRecords.serviceName,
            paymentLast4: bookingFunnelRecords.paymentLast4,
            firstCleaningTotalCents: bookingFunnelRecords.firstCleaningTotalCents,
            stage: bookingFunnelRecords.stage,
          })
          .from(bookingFunnelRecords)
          .where(and(gte(bookingFunnelRecords.requestedLocalDate, input.startDate), lte(bookingFunnelRecords.requestedLocalDate, input.endDate)))
          .orderBy(asc(bookingFunnelRecords.requestedLocalDate), asc(bookingFunnelRecords.requestedLocalTime)),
      ]);

      return { bookings: mergeMibDashboardBookings(nativeRows, funnelRows) };
    }),

  getRecentActivity: adminAgentProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(5) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Activity service unavailable.");
      const items = await db
        .select({
          id: activityLog.id,
          eventType: activityLog.eventType,
          title: activityLog.title,
          body: activityLog.body,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .orderBy(desc(activityLog.createdAt))
        .limit(input?.limit ?? 5);
      return { items };
    }),
});
