import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { leadflowJobs } from "../drizzle/schema";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { importNextThirtyDaysOfLaunch27Jobs } from "./leadflowJobsService";

const listInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  query: z.string().trim().max(255).optional(),
});

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
});
