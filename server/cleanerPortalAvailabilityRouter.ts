import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { cleanerProfiles, opsChatMessages, schedulingTeams, teamAvailabilityCheckins, teamWorkSchedule } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import { broadcastOpsUpdate } from "./sseBroadcast";

function etDate(offsetDays = 0) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const [month, day, year] = raw.split("/");
  return `${year}-${month}-${day}`;
}

const weeklyScheduleInput = z.object({
  mon: z.number().int().min(0).max(1),
  tue: z.number().int().min(0).max(1),
  wed: z.number().int().min(0).max(1),
  thu: z.number().int().min(0).max(1),
  fri: z.number().int().min(0).max(1),
  sat: z.number().int().min(0).max(1),
  sun: z.number().int().min(0).max(1),
  note: z.string().max(500).nullable(),
});

/**
 * Mirrors the established team_work_schedule and next-day availability-checkin
 * save behavior, but derives ownership exclusively from cleanerProfiles.launch27TeamId.
 */
export const cleanerPortalAvailabilityRouter = router({
  submitWeeklySchedule: cleanerProcedure.input(weeklyScheduleInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const cleanerRows = await db.select({ id: cleanerProfiles.id, name: cleanerProfiles.name, launch27TeamId: cleanerProfiles.launch27TeamId }).from(cleanerProfiles).where(eq(cleanerProfiles.id, ctx.cleaner.cleanerId)).limit(1);
    const cleaner = cleanerRows[0];
    if (!cleaner?.launch27TeamId) throw new Error("Your cleaner account has no assigned team.");

    const teams = await db.select({ id: schedulingTeams.id, name: schedulingTeams.name }).from(schedulingTeams).where(eq(schedulingTeams.launch27TeamId, cleaner.launch27TeamId)).limit(1);
    const team = teams[0];
    if (!team) throw new Error("Team not found in scheduling teams.");

    await db.insert(teamWorkSchedule).values({ teamId: team.id, ...input }).onDuplicateKeyUpdate({ set: input });

    const today = etDate();
    const tomorrow = etDate(1);
    await db.delete(teamAvailabilityCheckins).where(and(eq(teamAvailabilityCheckins.cleanerProfileId, cleaner.id), eq(teamAvailabilityCheckins.availabilityDate, tomorrow)));
    await db.insert(teamAvailabilityCheckins).values({
      cleanerProfileId: cleaner.id,
      submittedForDate: today,
      availabilityDate: tomorrow,
      isAvailable: input.mon || input.tue || input.wed || input.thu || input.fri || input.sat || input.sun ? 1 : 0,
      maxJobs: null,
      note: input.note,
      submittedAt: Date.now(),
    });

    const workingDays = [input.sun ? "Sun" : null, input.mon ? "Mon" : null, input.tue ? "Tue" : null, input.wed ? "Wed" : null, input.thu ? "Thu" : null, input.fri ? "Fri" : null, input.sat ? "Sat" : null].filter(Boolean).join(", ");
    const cleanerName = cleaner.name || ctx.cleaner.cleanerName || "A cleaner";
    await notifyOwner({ title: `Weekly Schedule: ${cleanerName} (${team.name})`, content: `${cleanerName} confirmed weekly schedule. Working days: ${workingDays || "None"}${input.note ? `. Note: ${input.note}` : ""}` }).catch(() => {});
    try {
      await db.insert(opsChatMessages).values({ channel: "command", cleanerJobId: null, authorName: cleanerName, authorRole: "cleaner", body: `Weekly schedule confirmed · Working: ${workingDays || "None"}${input.note ? ` · Note: ${input.note}` : ""}`, quickAction: "weekly_schedule", metadata: JSON.stringify({ cleanerName, teamName: team.name, teamId: team.id, ...input }) });
      broadcastOpsUpdate("new_message", { channel: "command" });
    } catch (error) {
      console.error("[cleanerPortalAvailability] CommandChat post failed:", error);
    }

    return { ok: true, teamId: team.id, teamName: team.name };
  }),
});
