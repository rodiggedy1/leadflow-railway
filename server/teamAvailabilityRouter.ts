import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { cleanerProfiles, schedulingTeams, teamAvailabilityCheckins, teamWorkSchedule } from "../drizzle/schema";
import { agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

function etDate(offsetDays = 0) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const [month, day, year] = raw.split("/");
  return `${year}-${month}-${day}`;
}

/** Staff-only, read-only overview of the same availability records cleaners save. */
export const teamAvailabilityRouter = router({
  getOverview: agentProcedure.input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const availabilityDate = input?.date ?? etDate(1);
    const teams = await db.select({ id: schedulingTeams.id, name: schedulingTeams.name, launch27TeamId: schedulingTeams.launch27TeamId, homeAddress: schedulingTeams.homeAddress }).from(schedulingTeams).where(and(eq(schedulingTeams.isActive, 1), eq(schedulingTeams.isArchived, 0))).orderBy(schedulingTeams.name);
    const launch27TeamIds = teams.map(team => team.launch27TeamId).filter((value): value is number => value !== null);
    const profiles = launch27TeamIds.length
      ? await db.select({ id: cleanerProfiles.id, name: cleanerProfiles.name, launch27TeamId: cleanerProfiles.launch27TeamId }).from(cleanerProfiles).where(and(eq(cleanerProfiles.isActive, 1), inArray(cleanerProfiles.launch27TeamId, launch27TeamIds)))
      : [];
    const profileByLaunch27TeamId = new Map(profiles.filter(profile => profile.launch27TeamId !== null).map(profile => [profile.launch27TeamId!, profile]));
    const schedules = teams.length ? await db.select().from(teamWorkSchedule).where(inArray(teamWorkSchedule.teamId, teams.map(team => team.id))) : [];
    const scheduleByTeamId = new Map(schedules.map(schedule => [schedule.teamId, schedule]));
    const profileIds = profiles.map(profile => profile.id);
    const checkins = profileIds.length ? await db.select().from(teamAvailabilityCheckins).where(and(eq(teamAvailabilityCheckins.availabilityDate, availabilityDate), inArray(teamAvailabilityCheckins.cleanerProfileId, profileIds))) : [];
    const checkinByProfileId = new Map<number, typeof checkins[number]>();
    for (const checkin of checkins) {
      const current = checkinByProfileId.get(checkin.cleanerProfileId);
      if (!current || checkin.submittedAt > current.submittedAt) checkinByProfileId.set(checkin.cleanerProfileId, checkin);
    }

    return {
      availabilityDate,
      teams: teams.map(team => {
        const profile = team.launch27TeamId === null ? undefined : profileByLaunch27TeamId.get(team.launch27TeamId);
        const schedule = scheduleByTeamId.get(team.id);
        const checkin = profile ? checkinByProfileId.get(profile.id) : undefined;
        return {
          teamId: team.id,
          teamName: team.name,
          homeAddress: team.homeAddress,
          cleanerName: profile?.name ?? null,
          weeklySchedule: schedule ? { mon: schedule.mon, tue: schedule.tue, wed: schedule.wed, thu: schedule.thu, fri: schedule.fri, sat: schedule.sat, sun: schedule.sun, note: schedule.note ?? null, updatedAt: schedule.updatedAt } : null,
          nextDayAvailability: checkin ? { isAvailable: checkin.isAvailable === 1, note: checkin.note ?? null, submittedAt: checkin.submittedAt } : null,
        };
      }),
    };
  }),
});
