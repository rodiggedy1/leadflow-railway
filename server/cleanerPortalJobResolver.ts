import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { cleanerPortalJobProgress, leadflowJobs } from "../drizzle/schema";
import { getDb } from "./db";
import { cleanerPortalJobOwnership, findCleanerPortalTeam } from "./cleanerPortalOwnership";

export const portalJobKeySchema = z.string().regex(/^leadflow:\d+$/, "Invalid portal job reference.");

function parseLeadflowJobId(portalJobKey: string) {
  const value = Number.parseInt(portalJobKey.slice("leadflow:".length), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal job reference." });
  }
  return value;
}

export async function resolveOwnedLeadflowJob(cleanerId: number, portalJobKey: string, unavailableMessage: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: unavailableMessage });
  const team = await findCleanerPortalTeam(db, cleanerId);
  if (!team) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });
  const leadflowJobId = parseLeadflowJobId(portalJobKey);
  const rows = await db
    .select()
    .from(leadflowJobs)
    .where(and(
      eq(leadflowJobs.id, leadflowJobId),
      cleanerPortalJobOwnership(team),
      ne(leadflowJobs.bookingStatus, "cancelled"),
      ne(leadflowJobs.bookingStatus, "rescheduled"),
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
    ))
    .limit(1);
  const job = rows[0];
  if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "This job is not assigned to your team." });
  return {
    db,
    team,
    cleaner: { id: team.cleanerProfileId, teamId: team.launch27TeamId },
    job,
  };
}

export async function listOwnedLeadflowJobs(cleanerId: number, startDate: string, endDate: string, unavailableMessage: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: unavailableMessage });
  const team = await findCleanerPortalTeam(db, cleanerId);
  if (!team) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });
  const jobs = await db
    .select({ job: leadflowJobs, progress: cleanerPortalJobProgress })
    .from(leadflowJobs)
    .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
    .where(and(
      cleanerPortalJobOwnership(team),
      gte(leadflowJobs.jobDate, startDate),
      lte(leadflowJobs.jobDate, endDate),
      ne(leadflowJobs.bookingStatus, "cancelled"),
      ne(leadflowJobs.bookingStatus, "rescheduled"),
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
    ))
    .orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id));
  return { db, team, jobs };
}
