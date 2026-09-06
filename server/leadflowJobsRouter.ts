import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { leadflowJobs } from "../drizzle/schema";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { importLaunch27JobsForDate, importNextThirtyDaysOfLaunch27Jobs, isSameLeadflowJobIdentity, LEADFLOW_JOB_ORIGIN_LAUNCH27, moveServiceDateTimeToBusinessDate, refreshImportedLaunch27JobDetails } from "./leadflowJobsService";

const listInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  query: z.string().trim().max(255).optional(),
});

const updateInput = z.object({
  jobId: z.number().int().positive(),
  jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  frequency: z.enum(["One time", "Weekly", "Bi-weekly", "Tri-weekly", "Monthly"]).optional(),
}).refine((value) => value.jobDate !== undefined || value.frequency !== undefined, "Choose a date or frequency to update.");

export const leadflowJobsRouter = router({
  list: adminAgentProcedure.input(listInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const search = input.query?.toLowerCase();
    const rows = await db
      .select()
      .from(leadflowJobs)
      .where(eq(leadflowJobs.jobDate, input.date))
      .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));
    return rows.filter((row) => !search || `${row.customerName} ${row.customerPhone ?? ""} ${row.customerEmail ?? ""} ${row.jobAddress ?? ""} ${row.launch27BookingId ?? ""}`.toLowerCase().includes(search));
  }),

  importNextThirtyDays: adminAgentProcedure.mutation(async () => importNextThirtyDaysOfLaunch27Jobs()),

  syncDate: adminAgentProcedure.input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ input }) => (
    importLaunch27JobsForDate(input.date)
  )),

  importStatus: adminAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select({ id: leadflowJobs.id }).from(leadflowJobs).where(eq(leadflowJobs.origin, LEADFLOW_JOB_ORIGIN_LAUNCH27)).limit(1);
    return { completed: existing.length > 0 };
  }),

  refreshImportedDetails: adminAgentProcedure.mutation(async () => refreshImportedLaunch27JobDetails()),

  update: adminAgentProcedure.input(updateInput).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const existing = await db.select().from(leadflowJobs).where(eq(leadflowJobs.id, input.jobId)).limit(1);
    const job = existing[0];
    if (!job) throw new Error("LeadFlow job not found.");
    const jobDate = input.jobDate ?? job.jobDate;
    if (input.jobDate && jobDate !== job.jobDate) {
      const jobsOnTargetDate = await db.select().from(leadflowJobs).where(eq(leadflowJobs.jobDate, jobDate));
      if (jobsOnTargetDate.some((candidate) => candidate.id !== job.id && isSameLeadflowJobIdentity(job, candidate))) {
        throw new Error("A matching LeadFlow job already exists on that date.");
      }
    }
    await db.update(leadflowJobs).set({
      ...(input.jobDate ? { jobDate, serviceDateTime: moveServiceDateTimeToBusinessDate(job.serviceDateTime, jobDate) } : {}),
      ...(input.frequency ? { frequency: input.frequency } : {}),
    }).where(eq(leadflowJobs.id, job.id));
    return { id: job.id, jobDate, frequency: input.frequency ?? job.frequency };
  }),
});
