import { and, asc, desc, gte, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, leadflowJobs } from "../drizzle/schema";
import { mapLeadflowJobsForMibDashboard } from "../shared/mibDashboard";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

/**
 * Read-only data contract for the MIB operations dashboard. It uses the
 * LeadFlow-owned jobs table selected by the user and performs no mutations.
 */
export const mibDashboardRouter = router({
  getBookingWindow: adminAgentProcedure
    .input(z.object({ startDate: localDate, endDate: localDate }))
    .query(async ({ input }) => {
      if (input.startDate > input.endDate) {
        throw new Error("Dashboard start date must be on or before end date");
      }
      const db = await getDb();
      if (!db) throw new Error("Booking service unavailable.");

      const activeJobs = sql`LOWER(${leadflowJobs.bookingStatus}) NOT IN ('cancelled', 'canceled')`;
      const normalizedPhone = sql<string>`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10)`;
      const [jobRows, customerHistoryRows] = await Promise.all([
        db
          .select({
            id: leadflowJobs.id,
            customerName: leadflowJobs.customerName,
            customerPhone: leadflowJobs.customerPhone,
            jobDate: leadflowJobs.jobDate,
            serviceDateTime: leadflowJobs.serviceDateTime,
            serviceName: leadflowJobs.serviceName,
            bookingStatus: leadflowJobs.bookingStatus,
            teamName: leadflowJobs.teamName,
            jobTotalCents: leadflowJobs.jobTotalCents,
            hasStripeCard: leadflowJobs.hasStripeCard,
            customerRating: leadflowJobs.customerRating,
          })
          .from(leadflowJobs)
          .where(and(gte(leadflowJobs.jobDate, input.startDate), lte(leadflowJobs.jobDate, input.endDate), activeJobs))
          .orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.serviceDateTime)),
        db
          .select({
            phone: normalizedPhone,
            firstJobDate: sql<string>`MIN(${leadflowJobs.jobDate})`,
          })
          .from(leadflowJobs)
          .where(and(isNotNull(leadflowJobs.customerPhone), activeJobs))
          .groupBy(normalizedPhone),
      ]);
      const firstJobDateByPhone = Object.fromEntries(customerHistoryRows.filter((row) => Boolean(row.phone)).map((row) => [row.phone, row.firstJobDate]));
      return { bookings: mapLeadflowJobsForMibDashboard(jobRows, firstJobDateByPhone) };
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
