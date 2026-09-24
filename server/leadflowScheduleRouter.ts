import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  cleanerPortalJobProgress,
  jobGeoCache,
  leadflowJobs,
  scheduleAssignments,
  scheduleJobLocks,
  schedulingTeams,
  teamDayConfig,
  teamDayLock,
  teamDayOverride,
  teamDayUnavailability,
  teamWorkSchedule,
} from "../drizzle/schema";
import { agentProcedure, router } from "./_core/trpc";
import { GeocodingResult, makeRequest } from "./_core/map";
import { getDb } from "./db";
import { bookingTeamDefault } from "./leadflowScheduleAssignmentDefaults";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TeamRow = typeof schedulingTeams.$inferSelect;
type JobRow = typeof leadflowJobs.$inferSelect;
type AssignmentRow = typeof scheduleAssignments.$inferSelect & { leadflowJobId: number | null };
type JobLockRow = typeof scheduleJobLocks.$inferSelect & { leadflowJobId: number | null; teamId: number | null };
type Point = { lat: number; lng: number };
type GeoPoint = Point & { formattedAddress: string };
type PlannedAssignment = {
  leadflowJobId: number;
  teamId: number;
  teamName: string;
  routeOrder: number;
  estimatedArrivalMs: number | null;
  estimatedDepartureMs: number | null;
  driveTimeSecs: number | null;
  isManual: number;
  rationale: string | null;
};
type Availability = {
  available: boolean;
  explicitlyUnavailable: boolean;
  workScheduleUnavailable: boolean;
  overrideIsAvailable: number | null;
  overrideNote: string | null;
  weeklyNote: string | null;
  schedule: {
    mon: number;
    tue: number;
    wed: number;
    thu: number;
    fri: number;
    sat: number;
    sun: number;
  };
};

const assignmentJobRef = sql<number>`${scheduleAssignments}.leadflowJobId`;
const lockJobRef = sql<number>`${scheduleJobLocks}.leadflowJobId`;
const excludedStatuses = ["cancelled", "rescheduled", "missing_from_launch27"] as const;
const defaultWorkSchedule = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 0, sun: 0 };
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");

function activeJobPredicate(date: string) {
  return and(
    eq(leadflowJobs.jobDate, date),
    notInArray(leadflowJobs.bookingStatus, [...excludedStatuses]),
  );
}

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

function dayKey(date: string): keyof typeof defaultWorkSchedule {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[day];
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/[.,#-]/g, "").replace(/\s+/g, " ").trim();
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateDurationHours(serviceName: string | null, bedrooms: number | null): number {
  const value = (serviceName ?? "").toLowerCase();
  if (/move.?in|move.?out/.test(value)) return 5;
  if (value.includes("deep")) return 4;
  if ((bedrooms ?? 0) >= 4) return 3.5;
  if ((bedrooms ?? 0) === 3) return 3;
  if ((bedrooms ?? 0) === 2) return 2.5;
  return 2;
}

function haversineMeters(a: Point, b: Point): number {
  const earthRadius = 6_371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value = sinLat * sinLat
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function estimatedDriveSeconds(a: Point, b: Point): number {
  return Math.max(0, Math.round(haversineMeters(a, b) / 10));
}

function inferRegionTags(address: string | null | undefined): string | null {
  if (!address) return null;
  const value = address.toUpperCase();
  const tags: string[] = [];
  if (/,\s*DC\b/.test(value) || /WASHINGTON[,\s]+DC/.test(value)) tags.push("DC");
  if (/,\s*MD\b/.test(value) || /\bMARYLAND\b/.test(value)) tags.push("MD");
  if (/,\s*VA\b/.test(value) || (/\bVIRGINIA\b/.test(value) && !/WEST\s+VIRGINIA/.test(value))) tags.push("VA");
  return tags.length ? tags.join(",") : null;
}

function ownedLockTeamId(lock: JobLockRow): number {
  return Number(lock.teamId ?? lock.cleanerId);
}

async function geocodeRemote(address: string): Promise<GeoPoint | null> {
  try {
    const response = await makeRequest<GeocodingResult>("/maps/api/geocode/json", { address });
    if (response.status !== "OK" || !response.results?.length) return null;
    const expectedState = address.match(/,\s*([A-Z]{2})\s*(?:\d{5})?\s*$/i)?.[1]?.toUpperCase();
    const selected = response.results.find(result => {
      if (!expectedState) return true;
      const state = result.address_components?.find(component =>
        component.types.includes("administrative_area_level_1"),
      )?.short_name?.toUpperCase();
      return !state || state === expectedState;
    }) ?? response.results[0];
    return {
      lat: selected.geometry.location.lat,
      lng: selected.geometry.location.lng,
      formattedAddress: selected.formatted_address,
    };
  } catch {
    return null;
  }
}

async function geocodeWithCache(db: Db, address: string): Promise<GeoPoint | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const addressKey = normalizeAddress(trimmed);
  const cached = await db.select().from(jobGeoCache)
    .where(eq(jobGeoCache.addressKey, addressKey))
    .limit(1);
  if (cached[0]) {
    return {
      lat: cached[0].lat,
      lng: cached[0].lng,
      formattedAddress: cached[0].formattedAddress ?? cached[0].originalAddress,
    };
  }
  const result = await geocodeRemote(trimmed);
  if (!result) return null;
  await db.insert(jobGeoCache).values({
    addressKey,
    originalAddress: trimmed,
    lat: result.lat,
    lng: result.lng,
    formattedAddress: result.formattedAddress,
  }).onDuplicateKeyUpdate({
    set: {
      originalAddress: trimmed,
      lat: result.lat,
      lng: result.lng,
      formattedAddress: result.formattedAddress,
    },
  });
  return result;
}

async function loadAvailability(db: Db, date: string, teams: TeamRow[]): Promise<Map<number, Availability>> {
  const [weeklyRows, overrideRows, unavailableRows] = await Promise.all([
    db.select().from(teamWorkSchedule),
    db.select().from(teamDayOverride).where(eq(teamDayOverride.date, date)),
    db.select().from(teamDayUnavailability).where(eq(teamDayUnavailability.date, date)),
  ]);
  const weeklyByTeam = new Map(weeklyRows.map(row => [Number(row.teamId), row]));
  const overrideByTeam = new Map(overrideRows.map(row => [Number(row.teamId), row]));
  const unavailableTeamIds = new Set(unavailableRows.map(row => Number(row.teamId)));
  const key = dayKey(date);
  const result = new Map<number, Availability>();

  for (const team of teams) {
    const weekly = weeklyByTeam.get(team.id);
    const schedule = weekly
      ? {
          mon: Number(weekly.mon), tue: Number(weekly.tue), wed: Number(weekly.wed),
          thu: Number(weekly.thu), fri: Number(weekly.fri), sat: Number(weekly.sat), sun: Number(weekly.sun),
        }
      : { ...defaultWorkSchedule };
    const override = overrideByTeam.get(team.id);
    const explicitlyUnavailable = unavailableTeamIds.has(team.id);
    const weeklyOff = schedule[key] !== 1;
    const workScheduleUnavailable = override?.isAvailable === 1
      ? false
      : override?.isAvailable === 0
        ? true
        : weeklyOff;
    result.set(team.id, {
      available: team.isActive === 1
        && team.isArchived !== 1
        && !explicitlyUnavailable
        && !workScheduleUnavailable,
      explicitlyUnavailable,
      workScheduleUnavailable,
      overrideIsAvailable: override?.isAvailable ?? null,
      overrideNote: override?.note ?? null,
      weeklyNote: weekly?.note ?? null,
      schedule,
    });
  }
  return result;
}

function teamProjection(team: TeamRow, availability?: Availability) {
  return {
    id: team.id,
    name: team.name,
    launch27TeamId: team.launch27TeamId,
    homeAddress: team.homeAddress,
    homeLat: team.homeLat,
    homeLng: team.homeLng,
    maxHoursPerDay: team.maxHoursPerDay,
    skills: team.skills,
    isActive: team.isActive,
    color: team.color,
    minJobs: team.minJobs,
    maxJobs: team.maxJobs,
    earliestStartTime: team.earliestStartTime,
    tag: team.tag,
    regionTags: team.regionTags,
    isArchived: team.isArchived,
    available: availability?.available ?? (team.isActive === 1 && team.isArchived !== 1),
    explicitlyUnavailable: availability?.explicitlyUnavailable ?? false,
    workScheduleUnavailable: availability?.workScheduleUnavailable ?? false,
    overrideIsAvailable: availability?.overrideIsAvailable ?? null,
    overrideNote: availability?.overrideNote ?? null,
    weeklyNote: availability?.weeklyNote ?? null,
    schedule: availability?.schedule ?? { ...defaultWorkSchedule },
  };
}

async function findActiveJob(db: Db, date: string, id: number): Promise<JobRow> {
  const rows = await db.select().from(leadflowJobs)
    .where(and(activeJobPredicate(date), eq(leadflowJobs.id, id)))
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Active LeadFlow job not found for this date" });
  }
  return rows[0];
}

async function findTeam(db: Db, id: number, requireActive = false): Promise<TeamRow> {
  const rows = await db.select().from(schedulingTeams)
    .where(eq(schedulingTeams.id, id))
    .limit(1);
  const team = rows[0];
  if (!team || (requireActive && (team.isActive !== 1 || team.isArchived === 1))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Active scheduling team not found" });
  }
  return team;
}

async function readOwnedAssignments(db: Db, date: string, ids?: number[]): Promise<AssignmentRow[]> {
  if (ids && ids.length === 0) return [];
  const predicate = ids
    ? and(
        eq(scheduleAssignments.jobDate, date),
        isNotNull(assignmentJobRef),
        inArray(assignmentJobRef, ids),
      )
    : and(eq(scheduleAssignments.jobDate, date), isNotNull(assignmentJobRef));
  return await db.select({
    id: scheduleAssignments.id,
    jobDate: scheduleAssignments.jobDate,
    leadflowJobId: assignmentJobRef,
    teamId: scheduleAssignments.teamId,
    teamName: scheduleAssignments.teamName,
    routeOrder: scheduleAssignments.routeOrder,
    estimatedArrivalMs: scheduleAssignments.estimatedArrivalMs,
    estimatedDepartureMs: scheduleAssignments.estimatedDepartureMs,
    driveTimeSecs: scheduleAssignments.driveTimeSecs,
    isManual: scheduleAssignments.isManual,
    totalDistanceMeters: scheduleAssignments.totalDistanceMeters,
    rationale: scheduleAssignments.rationale,
    createdAt: scheduleAssignments.createdAt,
    updatedAt: scheduleAssignments.updatedAt,
  }).from(scheduleAssignments).where(predicate) as unknown as AssignmentRow[];
}

async function readOwnedLocks(db: Db, date: string, ids?: number[]): Promise<JobLockRow[]> {
  if (ids && ids.length === 0) return [];
  const predicate = ids
    ? and(eq(scheduleJobLocks.date, date), isNotNull(lockJobRef), inArray(lockJobRef, ids))
    : and(eq(scheduleJobLocks.date, date), isNotNull(lockJobRef));
  return await db.select({
    id: scheduleJobLocks.id,
    leadflowJobId: lockJobRef,
    date: scheduleJobLocks.date,
    teamId: sql<number>`${scheduleJobLocks}.teamId`,
    lockedPosition: scheduleJobLocks.lockedPosition,
    lockedAt: scheduleJobLocks.lockedAt,
  }).from(scheduleJobLocks).where(predicate) as unknown as JobLockRow[];
}

async function persistOwnedAssignments(db: Db, date: string, rows: PlannedAssignment[]): Promise<void> {
  await db.delete(scheduleAssignments).where(
    and(eq(scheduleAssignments.jobDate, date), isNotNull(assignmentJobRef)),
  );
  for (const row of rows) {
    await db.execute(sql`
      INSERT INTO ${scheduleAssignments}
        (jobDate, leadflowJobId, teamId, teamName, routeOrder, estimatedArrivalMs,
         estimatedDepartureMs, driveTimeSecs, isManual, rationale)
      VALUES
        (${date}, ${row.leadflowJobId}, ${row.teamId}, ${row.teamName}, ${row.routeOrder},
         ${row.estimatedArrivalMs}, ${row.estimatedDepartureMs}, ${row.driveTimeSecs},
         ${row.isManual}, ${row.rationale})
    `);
  }
}

function orderRoute(
  jobs: JobRow[],
  geos: Map<number, GeoPoint>,
  home: Point | null,
  lockedPositions: Map<number, number>,
): JobRow[] {
  const fixed = jobs
    .filter(job => lockedPositions.has(job.id))
    .sort((a, b) => (lockedPositions.get(a.id) ?? 0) - (lockedPositions.get(b.id) ?? 0));
  const remaining = jobs.filter(job => !lockedPositions.has(job.id));
  const nearest: JobRow[] = [];
  let point = home;
  while (remaining.length) {
    let selectedIndex = 0;
    if (point) {
      let bestDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((job, index) => {
        const geo = geos.get(job.id);
        if (!geo) return;
        const distance = haversineMeters(point!, geo);
        if (distance < bestDistance) {
          bestDistance = distance;
          selectedIndex = index;
        }
      });
    } else {
      remaining.sort((a, b) => (parseTime(a.serviceDateTime) ?? Number.POSITIVE_INFINITY)
        - (parseTime(b.serviceDateTime) ?? Number.POSITIVE_INFINITY));
    }
    const selected = remaining.splice(selectedIndex, 1)[0];
    nearest.push(selected);
    point = geos.get(selected.id) ?? point;
  }

  const route = new Array<JobRow | undefined>(jobs.length);
  for (const job of fixed) {
    let position = Math.max(0, Math.min(jobs.length - 1, lockedPositions.get(job.id) ?? 0));
    while (position < route.length && route[position]) position += 1;
    if (position >= route.length) {
      position = route.length - 1;
      while (position >= 0 && route[position]) position -= 1;
    }
    if (position >= 0) route[position] = job;
  }
  let next = 0;
  for (let index = 0; index < route.length; index += 1) {
    if (!route[index]) route[index] = nearest[next++];
  }
  return route.filter((job): job is JobRow => Boolean(job));
}

function buildRouteAssignments(
  team: TeamRow,
  jobs: JobRow[],
  geos: Map<number, GeoPoint>,
  existingByJob: Map<number, AssignmentRow>,
  lockPositionByJob: Map<number, number>,
): PlannedAssignment[] {
  const home = team.homeLat != null && team.homeLng != null
    ? { lat: team.homeLat, lng: team.homeLng }
    : null;
  const ordered = orderRoute(jobs, geos, home, lockPositionByJob);
  const rows: PlannedAssignment[] = [];
  let priorPoint = home;
  let priorDeparture: number | null = null;

  ordered.forEach((job, routeOrder) => {
    const existing = existingByJob.get(job.id);
    const geo = geos.get(job.id);
    const driveTimeSecs = priorPoint && geo ? estimatedDriveSeconds(priorPoint, geo) : null;
    const scheduled = parseTime(job.serviceDateTime);
    const arrival = scheduled ?? (priorDeparture != null ? priorDeparture + (driveTimeSecs ?? 0) * 1000 : null);
    const departure = arrival == null
      ? null
      : arrival + estimateDurationHours(job.serviceName, job.bedrooms) * 3_600_000;
    rows.push({
      leadflowJobId: job.id,
      teamId: team.id,
      teamName: team.name,
      routeOrder,
      estimatedArrivalMs: arrival,
      estimatedDepartureMs: departure,
      driveTimeSecs,
      isManual: existing?.isManual === 1 ? 1 : 0,
      rationale: null,
    });
    priorPoint = geo ?? null;
    priorDeparture = departure;
  });
  return rows;
}

export const leadflowScheduleRouter = router({
  getTeams: agentProcedure.query(async () => {
    const db = await requireDb();
    const teams = await db.select().from(schedulingTeams).orderBy(asc(schedulingTeams.name));
    return teams.map(team => teamProjection(team));
  }),

  getSchedule: agentProcedure
    .input(z.object({ date: dateInput }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const [jobRows, teams] = await Promise.all([
        db.select({ job: leadflowJobs, jobStatus: cleanerPortalJobProgress.jobStatus })
          .from(leadflowJobs)
          .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
          .where(activeJobPredicate(input.date))
          .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id)),
        db.select().from(schedulingTeams).orderBy(asc(schedulingTeams.name)),
      ]);
      const jobs = jobRows.map(row => row.job);
      const jobStatusById = new Map(jobRows.map(row => [row.job.id, row.jobStatus]));
      const [assignments, availability] = await Promise.all([
        readOwnedAssignments(db, input.date, jobs.map(job => job.id)),
        loadAvailability(db, input.date, teams),
      ]);
      const assignmentByJob = new Map(assignments.map(row => [Number(row.leadflowJobId), row]));
      const projectedJobs = jobs.map(job => {
        const persistedAssignment = assignmentByJob.get(job.id);
        const bookingDefaultTeam = persistedAssignment ? null : bookingTeamDefault(job, teams);
        const serviceType = job.serviceName ?? null;
        return {
          id: job.id,
          leadflowJobId: job.id,
          jobDate: job.jobDate,
          serviceDateTime: job.serviceDateTime,
          customerName: job.customerName,
          customerPhone: job.customerPhone,
          customerEmail: job.customerEmail,
          jobAddress: job.jobAddress,
          serviceType,
          frequency: job.frequency,
          bedrooms: job.bedrooms,
          bathrooms: job.bathrooms,
          extras: job.extras,
          bookingStatus: job.bookingStatus,
          customerNotes: job.customerNotes,
          jobTotalCents: job.jobTotalCents,
          jobStatus: jobStatusById.get(job.id) ?? null,
          hasStripeCard: job.hasStripeCard,
          paymentBrand: job.paymentBrand,
          paymentLast4: job.paymentLast4,
          isNewClient: job.bookingStatus === "new",
          isMoveInOut: /move.?in|move.?out/i.test(serviceType ?? ""),
          isRecurring: Boolean(job.frequency && !/one.?time/i.test(job.frequency)),
          requestedTeam: null,
          staffNotes: null,
          adminNotes: null,
          checklistItems: null,
          clientHistory: null,
          recentCalls: [],
          callsSummary: null,
          confirmationCall: null,
          assignment: persistedAssignment
            ? {
                leadflowJobId: Number(persistedAssignment.leadflowJobId),
                teamId: Number(persistedAssignment.teamId),
                teamName: persistedAssignment.teamName,
                routeOrder: Number(persistedAssignment.routeOrder),
                driveTimeSecs: persistedAssignment.driveTimeSecs,
                estimatedArrivalMs: persistedAssignment.estimatedArrivalMs,
                estimatedDepartureMs: persistedAssignment.estimatedDepartureMs,
                isManual: persistedAssignment.isManual,
                rationale: persistedAssignment.rationale,
                source: "schedule" as const,
              }
            : bookingDefaultTeam
              ? {
                  leadflowJobId: job.id,
                  teamId: bookingDefaultTeam.id,
                  teamName: bookingDefaultTeam.name,
                  routeOrder: 999,
                  driveTimeSecs: null,
                  estimatedArrivalMs: null,
                  estimatedDepartureMs: null,
                  isManual: 0,
                  rationale: null,
                  source: "booking_default" as const,
                }
              : null,
        };
      });
      return {
        jobs: projectedJobs,
        teams: teams.map(team => teamProjection(team, availability.get(team.id))),
        hasAssignments: assignments.length > 0,
      };
    }),

  getJobLocks: agentProcedure
    .input(z.object({ date: dateInput }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const jobs = await db.select({ id: leadflowJobs.id }).from(leadflowJobs)
        .where(activeJobPredicate(input.date));
      const locks = await readOwnedLocks(db, input.date, jobs.map(job => job.id));
      return locks.map(lock => ({
        id: lock.id,
        leadflowJobId: Number(lock.leadflowJobId),
        date: lock.date,
        teamId: ownedLockTeamId(lock),
        lockedPosition: Number(lock.lockedPosition),
        lockedAt: Number(lock.lockedAt),
      }));
    }),

  analyzeSchedule: agentProcedure
    .input(z.object({ date: dateInput }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const [jobs, teams] = await Promise.all([
        db.select().from(leadflowJobs).where(activeJobPredicate(input.date)),
        db.select().from(schedulingTeams),
      ]);
      const ids = jobs.map(job => job.id);
      const [assignments, locks, availability, teamLocks] = await Promise.all([
        readOwnedAssignments(db, input.date, ids),
        readOwnedLocks(db, input.date, ids),
        loadAvailability(db, input.date, teams),
        db.select().from(teamDayLock).where(eq(teamDayLock.date, input.date)),
      ]);
      const assignmentByJob = new Map(assignments.map(row => [Number(row.leadflowJobId), row]));
      const jobById = new Map(jobs.map(job => [job.id, job]));
      const teamById = new Map(teams.map(team => [team.id, team]));
      const issues: Array<{
        severity: "critical" | "warning" | "info";
        code: string;
        title: string;
        detail: string;
        leadflowJobId?: number;
        teamId?: number;
        customerName?: string;
        teamName?: string;
      }> = [];

      for (const job of jobs) {
        const assignment = assignmentByJob.get(job.id);
        if (!assignment) {
          issues.push({
            severity: "critical",
            code: "JOB_UNASSIGNED",
            title: "Active job has no team assignment",
            detail: `${job.customerName || "Customer"} has no owned schedule assignment.`,
            leadflowJobId: job.id,
            customerName: job.customerName,
          });
        }
        if (!job.jobAddress?.trim()) {
          issues.push({
            severity: "warning",
            code: "JOB_NO_ADDRESS",
            title: "Job has no address",
            detail: `${job.customerName || "Customer"} cannot be routed until an address is available.`,
            leadflowJobId: job.id,
            customerName: job.customerName,
          });
        }
        if (!assignment) continue;
        const team = teamById.get(Number(assignment.teamId));
        if (!team || (assignment.teamName != null && assignment.teamName !== team.name)) {
          issues.push({
            severity: "critical",
            code: "ASSIGNMENT_TEAM_MISMATCH",
            title: "Assignment team mismatch",
            detail: team
              ? `${job.customerName || "Customer"} has assignment team name "${assignment.teamName}" but team ${team.id} is "${team.name}".`
              : `${job.customerName || "Customer"} is assigned to a team that no longer exists.`,
            leadflowJobId: job.id,
            teamId: Number(assignment.teamId),
            customerName: job.customerName,
            teamName: team?.name,
          });
        }
        if (team && !availability.get(team.id)?.available) {
          issues.push({
            severity: "critical",
            code: "UNAVAILABLE_TEAM_HAS_JOB",
            title: "Job assigned to an unavailable team",
            detail: `${team.name} is unavailable on ${input.date} but has ${job.customerName || "a customer"} assigned.`,
            leadflowJobId: job.id,
            teamId: team.id,
            customerName: job.customerName,
            teamName: team.name,
          });
        }
      }

      const assignmentsByTeam = new Map<number, AssignmentRow[]>();
      for (const assignment of assignments) {
        const list = assignmentsByTeam.get(Number(assignment.teamId)) ?? [];
        list.push(assignment);
        assignmentsByTeam.set(Number(assignment.teamId), list);
      }
      for (const [teamId, teamAssignments] of Array.from(assignmentsByTeam.entries())) {
        const sorted = [...teamAssignments]
          .filter(row => row.estimatedArrivalMs != null && row.estimatedDepartureMs != null)
          .sort((a, b) => Number(a.estimatedArrivalMs) - Number(b.estimatedArrivalMs));
        for (let index = 0; index < sorted.length; index += 1) {
          const first = sorted[index];
          const firstEnd = Number(first.estimatedDepartureMs);
          for (let otherIndex = index + 1; otherIndex < sorted.length; otherIndex += 1) {
            const second = sorted[otherIndex];
            const secondStart = Number(second.estimatedArrivalMs);
            if (secondStart >= firstEnd) break;
            const firstJob = jobById.get(Number(first.leadflowJobId));
            const secondJob = jobById.get(Number(second.leadflowJobId));
            issues.push({
              severity: "critical",
              code: "TEAM_TIME_OVERLAP",
              title: "Team jobs overlap",
              detail: `${firstJob?.customerName || "A job"} overlaps ${secondJob?.customerName || "another job"} on ${teamById.get(teamId)?.name || `team ${teamId}`}.`,
              leadflowJobId: secondJob?.id,
              teamId,
              customerName: secondJob?.customerName,
              teamName: teamById.get(teamId)?.name,
            });
          }
        }
      }

      for (const lock of locks) {
        const id = Number(lock.leadflowJobId);
        const assignment = assignmentByJob.get(id);
        if (!assignment) {
          issues.push({
            severity: "warning",
            code: "LOCK_WITHOUT_ASSIGNMENT",
            title: "Job lock has no assignment",
            detail: `The lock for LeadFlow job ${id} has no matching owned assignment.`,
            leadflowJobId: id,
          });
          continue;
        }
        if (Number(assignment.teamId) !== ownedLockTeamId(lock)) {
          issues.push({
            severity: "critical",
            code: "LOCK_TEAM_MISMATCH",
            title: "Job lock and assignment disagree",
            detail: `The lock and assignment for LeadFlow job ${id} reference different teams.`,
            leadflowJobId: id,
            teamId: Number(assignment.teamId),
            teamName: teamById.get(Number(assignment.teamId))?.name,
          });
        }
        if (Number(assignment.routeOrder) !== Number(lock.lockedPosition)) {
          issues.push({
            severity: "warning",
            code: "LOCK_POSITION_MISMATCH",
            title: "Locked position changed",
            detail: `The assignment for LeadFlow job ${id} is at position ${assignment.routeOrder}, not locked position ${lock.lockedPosition}.`,
            leadflowJobId: id,
            teamId: Number(assignment.teamId),
            teamName: teamById.get(Number(assignment.teamId))?.name,
          });
        }
      }

      for (const lock of teamLocks) {
        const team = teamById.get(Number(lock.teamId));
        if (!team) {
          issues.push({
            severity: "warning",
            code: "TEAM_LOCK_MISSING_TEAM",
            title: "Team lock references a missing team",
            detail: `A team lock for ${input.date} references team ${lock.teamId}, which no longer exists.`,
            teamId: Number(lock.teamId),
          });
        }
      }

      const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
      issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
      const assignedJobs = jobs.filter(job => assignmentByJob.has(job.id)).length;
      return {
        date: input.date,
        issues,
        aiSummary: "",
        counts: {
          critical: issues.filter(issue => issue.severity === "critical").length,
          warning: issues.filter(issue => issue.severity === "warning").length,
          info: issues.filter(issue => issue.severity === "info").length,
          total: issues.length,
        },
        meta: {
          totalJobs: jobs.length,
          assignedJobs,
          totalTeams: teams.filter(team => team.isActive === 1 && team.isArchived !== 1).length,
        },
      };
    }),

  suggestSlots: agentProcedure
    .input(z.object({ address: z.string().trim().min(3), date: dateInput }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const suppliedGeo = await geocodeWithCache(db, input.address);
      if (!suppliedGeo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Could not geocode address" });
      }
      const [jobs, teams] = await Promise.all([
        db.select().from(leadflowJobs).where(activeJobPredicate(input.date)),
        db.select().from(schedulingTeams)
          .where(and(eq(schedulingTeams.isActive, 1), eq(schedulingTeams.isArchived, 0))),
      ]);
      const [assignments, availability, configs] = await Promise.all([
        readOwnedAssignments(db, input.date, jobs.map(job => job.id)),
        loadAvailability(db, input.date, teams),
        db.select().from(teamDayConfig).where(eq(teamDayConfig.date, input.date)),
      ]);
      const jobById = new Map(jobs.map(job => [job.id, job]));
      const configByTeam = new Map(configs.map(config => [Number(config.teamId), config]));
      const addressKeys = jobs.map(job => job.jobAddress ? normalizeAddress(job.jobAddress) : null)
        .filter((value): value is string => Boolean(value));
      const cachedRows = addressKeys.length
        ? await db.select().from(jobGeoCache).where(inArray(jobGeoCache.addressKey, addressKeys))
        : [];
      const geoByAddress = new Map(cachedRows.map(row => [row.addressKey, { lat: row.lat, lng: row.lng }]));
      const assignmentByTeam = new Map<number, AssignmentRow[]>();
      for (const assignment of assignments) {
        const list = assignmentByTeam.get(Number(assignment.teamId)) ?? [];
        list.push(assignment);
        assignmentByTeam.set(Number(assignment.teamId), list);
      }

      const slots: Array<{
        teamId: number;
        teamName: string;
        teamColor: string;
        insertPosition: number;
        suggestedTimeMs: number | null;
        addedDriveSecs: number;
        totalTeamJobs: number;
      }> = [];
      for (const team of teams) {
        if (!availability.get(team.id)?.available) continue;
        const route = [...(assignmentByTeam.get(team.id) ?? [])]
          .filter(row => jobById.has(Number(row.leadflowJobId)))
          .sort((a, b) => Number(a.routeOrder) - Number(b.routeOrder));
        const dailyConfig = configByTeam.get(team.id);
        const cap = dailyConfig?.maxJobs ?? team.maxJobs;
        if (cap != null && route.length >= cap) continue;

        const home = team.homeLat != null && team.homeLng != null
          ? { lat: team.homeLat, lng: team.homeLng }
          : null;
        let best: (typeof slots)[number] | null = null;
        for (let position = 0; position <= route.length; position += 1) {
          const previousJob = position > 0 ? jobById.get(Number(route[position - 1].leadflowJobId)) : null;
          const nextJob = position < route.length ? jobById.get(Number(route[position].leadflowJobId)) : null;
          const previous = previousJob?.jobAddress
            ? geoByAddress.get(normalizeAddress(previousJob.jobAddress)) ?? null
            : home;
          const next = nextJob?.jobAddress
            ? geoByAddress.get(normalizeAddress(nextJob.jobAddress)) ?? null
            : null;
          if (!previous && route.length > 0) continue;
          const previousToNew = previous ? estimatedDriveSeconds(previous, suppliedGeo) : 0;
          const newToNext = next ? estimatedDriveSeconds(suppliedGeo, next) : 0;
          const previousToNext = previous && next ? estimatedDriveSeconds(previous, next) : 0;
          const addedDriveSecs = Math.max(0, previousToNew + newToNext - previousToNext);
          const previousDeparture = position > 0 ? route[position - 1].estimatedDepartureMs : null;
          const nextArrival = position < route.length
            ? route[position].estimatedArrivalMs ?? parseTime(nextJob?.serviceDateTime)
            : null;
          let suggestedTimeMs = previousDeparture != null
            ? Number(previousDeparture) + previousToNew * 1000
            : nextArrival != null
              ? Number(nextArrival)
              : parseTime(`${input.date}T09:00:00-04:00`);
          if (nextArrival != null && suggestedTimeMs != null && suggestedTimeMs >= Number(nextArrival)) {
            suggestedTimeMs = null;
          }
          const candidate = {
            teamId: team.id,
            teamName: team.name,
            teamColor: team.color ?? "#6366f1",
            insertPosition: position,
            suggestedTimeMs,
            addedDriveSecs,
            totalTeamJobs: route.length,
          };
          if (!best || candidate.addedDriveSecs < best.addedDriveSecs) best = candidate;
        }
        if (best) slots.push(best);
      }

      slots.sort((a, b) => a.addedDriveSecs - b.addedDriveSecs || a.totalTeamJobs - b.totalTeamJobs);
      return { geocodedAddress: suppliedGeo.formattedAddress, slots: slots.slice(0, 5) };
    }),

  optimizeDay: agentProcedure
    .input(z.object({ date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [jobs, teams] = await Promise.all([
        db.select().from(leadflowJobs).where(activeJobPredicate(input.date)),
        db.select().from(schedulingTeams)
          .where(and(eq(schedulingTeams.isActive, 1), eq(schedulingTeams.isArchived, 0))),
      ]);
      if (!jobs.length) return { assigned: 0, unassigned: [], message: "No active jobs for this date." };

      const ids = jobs.map(job => job.id);
      const [existing, locks, availability, teamLocks, configs] = await Promise.all([
        readOwnedAssignments(db, input.date, ids),
        readOwnedLocks(db, input.date, ids),
        loadAvailability(db, input.date, teams),
        db.select().from(teamDayLock).where(eq(teamDayLock.date, input.date)),
        db.select().from(teamDayConfig).where(eq(teamDayConfig.date, input.date)),
      ]);
      const jobById = new Map(jobs.map(job => [job.id, job]));
      const teamById = new Map(teams.map(team => [team.id, team]));
      const existingByJob = new Map(existing.map(row => [Number(row.leadflowJobId), row]));
      const lockByJob = new Map(locks.map(row => [Number(row.leadflowJobId), row]));
      const lockedTeamIds = new Set(teamLocks.map(row => Number(row.teamId)));
      const configByTeam = new Map(configs.map(row => [Number(row.teamId), row]));
      const geos = new Map<number, GeoPoint>();
      const unassigned: Array<{ leadflowJobId: number; customerName: string; reason: string }> = [];

      for (const job of jobs) {
        if (!job.jobAddress?.trim()) {
          unassigned.push({ leadflowJobId: job.id, customerName: job.customerName, reason: "missing_address" });
          continue;
        }
        const geo = await geocodeWithCache(db, job.jobAddress);
        if (!geo) {
          unassigned.push({ leadflowJobId: job.id, customerName: job.customerName, reason: "geocode_failed" });
          continue;
        }
        geos.set(job.id, geo);
      }

      const teamHomes = new Map<number, Point>();
      for (const team of teams) {
        if (team.homeLat != null && team.homeLng != null) {
          teamHomes.set(team.id, { lat: team.homeLat, lng: team.homeLng });
        } else if (team.homeAddress?.trim()) {
          const geo = await geocodeWithCache(db, team.homeAddress);
          if (geo) teamHomes.set(team.id, geo);
        }
      }

      const assignmentTeamByJob = new Map<number, number>();
      const fixedJobs = new Set<number>();
      for (const job of jobs) {
        if (!geos.has(job.id)) continue;
        const prior = existingByJob.get(job.id);
        if (!prior) continue;
        const teamId = Number(prior.teamId);
        const team = teamById.get(teamId);
        const lock = lockByJob.get(job.id);
        const fixedByJobLock = lock && ownedLockTeamId(lock) === teamId;
        const fixedByTeamLock = lockedTeamIds.has(teamId);
        const fixedByManualAction = prior.isManual === 1 && availability.get(teamId)?.available;
        if (team && (fixedByJobLock || fixedByTeamLock || fixedByManualAction)) {
          assignmentTeamByJob.set(job.id, teamId);
          fixedJobs.add(job.id);
        }
      }

      const candidateTeams = teams.filter(team =>
        availability.get(team.id)?.available
        && !lockedTeamIds.has(team.id)
        && teamHomes.has(team.id),
      );
      const teamLoads = new Map<number, number>();
      const teamHours = new Map<number, number>();
      const teamEndpoints = new Map<number, Point>();
      for (const [id, teamId] of Array.from(assignmentTeamByJob.entries())) {
        const job = jobById.get(id)!;
        teamLoads.set(teamId, (teamLoads.get(teamId) ?? 0) + 1);
        teamHours.set(teamId, (teamHours.get(teamId) ?? 0) + estimateDurationHours(job.serviceName, job.bedrooms));
        teamEndpoints.set(teamId, geos.get(id)!);
      }

      const remaining = jobs.filter(job => geos.has(job.id) && !assignmentTeamByJob.has(job.id));
      remaining.sort((a, b) => (parseTime(a.serviceDateTime) ?? Number.POSITIVE_INFINITY)
        - (parseTime(b.serviceDateTime) ?? Number.POSITIVE_INFINITY));
      for (const job of remaining) {
        const duration = estimateDurationHours(job.serviceName, job.bedrooms);
        let selected: TeamRow | null = null;
        let bestCost = Number.POSITIVE_INFINITY;
        for (const team of candidateTeams) {
          const config = configByTeam.get(team.id);
          const maxJobs = config?.maxJobs ?? team.maxJobs;
          const currentJobs = teamLoads.get(team.id) ?? 0;
          const currentHours = teamHours.get(team.id) ?? 0;
          if (maxJobs != null && currentJobs >= maxJobs) continue;
          if (currentHours + duration > (team.maxHoursPerDay ?? 8)) continue;
          const earliest = config?.earliestStartTime ?? team.earliestStartTime;
          const scheduled = parseTime(job.serviceDateTime);
          if (earliest && scheduled != null) {
            const [hours, minutes] = earliest.split(":").map(Number);
            const localMinutes = Number(new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
            }).format(new Date(scheduled)).replace(":", ""));
            const minimum = hours * 100 + minutes;
            if (Number.isFinite(localMinutes) && localMinutes < minimum) continue;
          }
          const from = teamEndpoints.get(team.id) ?? teamHomes.get(team.id)!;
          const cost = haversineMeters(from, geos.get(job.id)!);
          if (cost < bestCost) {
            bestCost = cost;
            selected = team;
          }
        }
        if (!selected) {
          unassigned.push({ leadflowJobId: job.id, customerName: job.customerName, reason: "no_available_team_capacity" });
          continue;
        }
        assignmentTeamByJob.set(job.id, selected.id);
        teamLoads.set(selected.id, (teamLoads.get(selected.id) ?? 0) + 1);
        teamHours.set(selected.id, (teamHours.get(selected.id) ?? 0) + duration);
        teamEndpoints.set(selected.id, geos.get(job.id)!);
      }

      const planned: PlannedAssignment[] = [];
      for (const team of teams) {
        const teamJobs = jobs.filter(job => assignmentTeamByJob.get(job.id) === team.id);
        if (!teamJobs.length) continue;
        const positions = new Map<number, number>();
        for (const job of teamJobs) {
          const lock = lockByJob.get(job.id);
          if (lock && ownedLockTeamId(lock) === team.id) positions.set(job.id, Number(lock.lockedPosition));
          else if (fixedJobs.has(job.id) && lockedTeamIds.has(team.id)) {
            positions.set(job.id, Number(existingByJob.get(job.id)?.routeOrder ?? 0));
          }
        }
        planned.push(...buildRouteAssignments(team, teamJobs, geos, existingByJob, positions));
      }

      await persistOwnedAssignments(db, input.date, planned);
      return {
        assigned: planned.length,
        unassigned,
        message: `Optimized ${planned.length} jobs; ${unassigned.length} left unassigned.`,
      };
    }),

  resetOptimization: agentProcedure
    .input(z.object({ date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(scheduleAssignments).where(
        and(eq(scheduleAssignments.jobDate, input.date), isNotNull(assignmentJobRef)),
      );
      await db.delete(scheduleJobLocks).where(
        and(eq(scheduleJobLocks.date, input.date), isNotNull(lockJobRef)),
      );
      return { ok: true };
    }),

  rerunDistances: agentProcedure
    .input(z.object({ date: dateInput, teamId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.teamId != null) await findTeam(db, input.teamId, true);
      const jobs = await db.select().from(leadflowJobs).where(activeJobPredicate(input.date));
      const ids = jobs.map(job => job.id);
      const assignments = await readOwnedAssignments(db, input.date, ids);
      const selectedAssignments = input.teamId == null
        ? assignments
        : assignments.filter(row => Number(row.teamId) === input.teamId);
      const teamIds = Array.from(new Set(selectedAssignments.map(row => Number(row.teamId))));
      const teams = teamIds.length
        ? await db.select().from(schedulingTeams).where(inArray(schedulingTeams.id, teamIds))
        : [];
      const teamById = new Map(teams.map(team => [team.id, team]));
      const jobById = new Map(jobs.map(job => [job.id, job]));
      const geos = new Map<number, GeoPoint>();
      const skipped: Array<{ leadflowJobId: number; reason: string }> = [];
      for (const assignment of selectedAssignments) {
        const id = Number(assignment.leadflowJobId);
        const job = jobById.get(id);
        if (!job?.jobAddress?.trim()) {
          skipped.push({ leadflowJobId: id, reason: "missing_address" });
          continue;
        }
        const geo = await geocodeWithCache(db, job.jobAddress);
        if (geo) geos.set(id, geo);
        else skipped.push({ leadflowJobId: id, reason: "geocode_failed" });
      }

      let updated = 0;
      for (const teamId of teamIds) {
        const team = teamById.get(teamId);
        if (!team) continue;
        let previous: Point | null = team.homeLat != null && team.homeLng != null
          ? { lat: team.homeLat, lng: team.homeLng }
          : null;
        if (!previous && team.homeAddress?.trim()) previous = await geocodeWithCache(db, team.homeAddress);
        const route = selectedAssignments
          .filter(row => Number(row.teamId) === teamId)
          .sort((a, b) => Number(a.routeOrder) - Number(b.routeOrder));
        for (const assignment of route) {
          const id = Number(assignment.leadflowJobId);
          const geo = geos.get(id);
          if (!geo) {
            previous = null;
            continue;
          }
          const seconds = previous ? estimatedDriveSeconds(previous, geo) : null;
          await db.update(scheduleAssignments).set({ driveTimeSecs: seconds }).where(
            and(
              eq(scheduleAssignments.jobDate, input.date),
              eq(assignmentJobRef, id),
              eq(scheduleAssignments.teamId, teamId),
            ),
          );
          updated += 1;
          previous = geo;
        }
      }
      return { updated, skipped, message: `Updated drive times for ${updated} job legs.` };
    }),

  lockJob: agentProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      date: dateInput,
      teamId: z.number().int().positive(),
      lockedPosition: z.number().int().min(0),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findActiveJob(db, input.date, input.jobId);
      await findTeam(db, input.teamId, true);
      const assignment = await db.select().from(scheduleAssignments).where(
        and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(assignmentJobRef, input.jobId),
          eq(scheduleAssignments.teamId, input.teamId),
        ),
      ).limit(1) as unknown as AssignmentRow[];
      if (!assignment[0]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Job is not assigned to this team on this date" });
      }
      const lockedAt = Date.now();
      await db.execute(sql`
        INSERT INTO ${scheduleJobLocks}
          (leadflowJobId, date, teamId, cleanerId, lockedPosition, lockedAt)
        VALUES
          (${input.jobId}, ${input.date}, ${input.teamId}, ${input.teamId}, ${input.lockedPosition}, ${lockedAt})
        ON DUPLICATE KEY UPDATE
          teamId = ${input.teamId},
          cleanerId = ${input.teamId},
          lockedPosition = ${input.lockedPosition},
          lockedAt = ${lockedAt}
      `);
      return { ok: true };
    }),

  unlockJob: agentProcedure
    .input(z.object({ jobId: z.number().int().positive(), date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(scheduleJobLocks).where(
        and(eq(scheduleJobLocks.date, input.date), eq(lockJobRef, input.jobId)),
      );
      return { ok: true };
    }),

  manualAssign: agentProcedure
    .input(z.object({
      date: dateInput,
      jobId: z.number().int().positive(),
      teamId: z.number().int().positive(),
      sourceTeamId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [job, team] = await Promise.all([
        findActiveJob(db, input.date, input.jobId),
        findTeam(db, input.teamId, true),
      ]);
      const rows = await readOwnedAssignments(db, input.date, [input.jobId]);
      const existing = rows[0];
      const serviceStart = parseTime(job.serviceDateTime);
      const route = await db.select({ routeOrder: scheduleAssignments.routeOrder })
        .from(scheduleAssignments)
        .where(and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(scheduleAssignments.teamId, input.teamId),
          isNotNull(assignmentJobRef),
        ));
      const routeOrder = existing && Number(existing.teamId) === input.teamId
        ? Number(existing.routeOrder)
        : route.reduce((max, row) => Math.max(max, Number(row.routeOrder)), -1) + 1;
      const serviceEnd = serviceStart == null
        ? null
        : serviceStart + estimateDurationHours(job.serviceName, job.bedrooms) * 3_600_000;
      await db.execute(sql`
        INSERT INTO ${scheduleAssignments}
          (jobDate, leadflowJobId, teamId, teamName, routeOrder, estimatedArrivalMs,
           estimatedDepartureMs, driveTimeSecs, isManual, rationale)
        VALUES
          (${input.date}, ${input.jobId}, ${input.teamId}, ${team.name}, ${routeOrder},
           ${serviceStart}, ${serviceEnd}, ${existing?.driveTimeSecs ?? null}, 1, NULL)
        ON DUPLICATE KEY UPDATE
          teamId = ${input.teamId},
          teamName = ${team.name},
          routeOrder = ${routeOrder},
          estimatedArrivalMs = ${serviceStart},
          estimatedDepartureMs = ${serviceEnd},
          driveTimeSecs = NULL,
          isManual = 1,
          rationale = NULL
      `);
      return { ok: true };
    }),

  unassignJob: agentProcedure
    .input(z.object({ date: dateInput, jobId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findActiveJob(db, input.date, input.jobId);
      await db.delete(scheduleAssignments).where(
        and(eq(scheduleAssignments.jobDate, input.date), eq(assignmentJobRef, input.jobId)),
      );
      return { ok: true };
    }),

  upsertTeam: agentProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(255),
      homeAddress: z.string().trim().max(500).nullable().optional(),
      maxHoursPerDay: z.number().min(1).max(16).default(8),
      skills: z.string().max(500).nullable().optional(),
      color: z.string().max(10).nullable().optional(),
      isActive: z.number().int().min(0).max(1).optional(),
      regionTags: z.string().max(50).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      let geo: GeoPoint | null = null;
      if (input.homeAddress?.trim()) geo = await geocodeWithCache(db, input.homeAddress);
      if (input.id != null) {
        const existing = await findTeam(db, input.id);
        const values: Record<string, unknown> = {
          name: input.name,
          maxHoursPerDay: input.maxHoursPerDay,
        };
        if (input.homeAddress !== undefined) {
          values.homeAddress = input.homeAddress || null;
          values.homeLat = geo?.lat ?? null;
          values.homeLng = geo?.lng ?? null;
        }
        if (input.skills !== undefined) values.skills = input.skills;
        if (input.color !== undefined) values.color = input.color;
        if (input.isActive !== undefined) values.isActive = input.isActive;
        if (input.regionTags !== undefined) values.regionTags = input.regionTags?.trim() || null;
        else if (input.homeAddress !== undefined) values.regionTags = inferRegionTags(input.homeAddress);
        else if (existing.regionTags == null && existing.homeAddress) values.regionTags = inferRegionTags(existing.homeAddress);
        await db.update(schedulingTeams).set(values).where(eq(schedulingTeams.id, input.id));
        return { id: input.id };
      }
      const [result] = await db.insert(schedulingTeams).values({
        name: input.name,
        homeAddress: input.homeAddress || null,
        homeLat: geo?.lat ?? null,
        homeLng: geo?.lng ?? null,
        maxHoursPerDay: input.maxHoursPerDay,
        skills: input.skills ?? null,
        color: input.color ?? "#6366f1",
        isActive: input.isActive ?? 1,
        regionTags: input.regionTags?.trim() || inferRegionTags(input.homeAddress),
      });
      return { id: Number((result as { insertId?: number }).insertId) };
    }),

  archiveTeam: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), archive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      await db.update(schedulingTeams)
        .set({ isArchived: input.archive ? 1 : 0 })
        .where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
    }),

  deleteTeam: agentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.id);
      await db.delete(schedulingTeams).where(eq(schedulingTeams.id, input.id));
      return { ok: true };
    }),

  setTeamUnavailable: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      await db.insert(teamDayUnavailability).values(input).onDuplicateKeyUpdate({
        set: { teamId: input.teamId },
      });
      return { ok: true };
    }),

  setTeamAvailable: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      await db.delete(teamDayUnavailability).where(
        and(eq(teamDayUnavailability.teamId, input.teamId), eq(teamDayUnavailability.date, input.date)),
      );
      return { ok: true };
    }),

  getTeamUnavailability: agentProcedure
    .input(z.object({ date: dateInput }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db.select({ teamId: teamDayUnavailability.teamId })
        .from(teamDayUnavailability)
        .where(eq(teamDayUnavailability.date, input.date));
      return rows.map(row => Number(row.teamId));
    }),

  setTeamLimits: agentProcedure
    .input(z.object({
      teamId: z.number().int().positive(),
      minJobs: z.number().int().min(0).nullable(),
      maxJobs: z.number().int().min(0).nullable(),
      earliestStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    }))
    .mutation(async ({ input }) => {
      if (input.minJobs != null && input.maxJobs != null && input.minJobs > input.maxJobs) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Minimum jobs cannot exceed maximum jobs" });
      }
      const db = await requireDb();
      await findTeam(db, input.teamId);
      await db.update(schedulingTeams).set({
        minJobs: input.minJobs,
        maxJobs: input.maxJobs,
        earliestStartTime: input.earliestStartTime,
      }).where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
    }),

  setTeamTag: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), tag: z.string().trim().max(20).nullable() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      await db.update(schedulingTeams).set({ tag: input.tag || null }).where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
    }),

  setTeamRegionTags: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), regionTags: z.string().max(50).nullable() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      await db.update(schedulingTeams)
        .set({ regionTags: input.regionTags?.trim() || null })
        .where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
    }),

  setTeamWorkSchedule: agentProcedure
    .input(z.object({
      teamId: z.number().int().positive(),
      mon: z.number().int().min(0).max(1),
      tue: z.number().int().min(0).max(1),
      wed: z.number().int().min(0).max(1),
      thu: z.number().int().min(0).max(1),
      fri: z.number().int().min(0).max(1),
      sat: z.number().int().min(0).max(1),
      sun: z.number().int().min(0).max(1),
      note: z.string().trim().max(500).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      const values = {
        mon: input.mon, tue: input.tue, wed: input.wed, thu: input.thu,
        fri: input.fri, sat: input.sat, sun: input.sun, note: input.note ?? null,
      };
      await db.insert(teamWorkSchedule).values({ teamId: input.teamId, ...values })
        .onDuplicateKeyUpdate({ set: values });
      return { ok: true };
    }),

  setTeamDayOverride: agentProcedure
    .input(z.object({
      teamId: z.number().int().positive(),
      date: dateInput,
      isAvailable: z.number().int().min(0).max(1).nullable(),
      note: z.string().trim().max(500).nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId);
      if (input.isAvailable === null && !input.note) {
        await db.delete(teamDayOverride).where(
          and(eq(teamDayOverride.teamId, input.teamId), eq(teamDayOverride.date, input.date)),
        );
        return { ok: true, deleted: true };
      }
      await db.insert(teamDayOverride).values({
        teamId: input.teamId,
        date: input.date,
        isAvailable: input.isAvailable,
        note: input.note || null,
      }).onDuplicateKeyUpdate({
        set: { isAvailable: input.isAvailable, note: input.note || null },
      });
      return { ok: true, deleted: false };
    }),

  getTeamLocks: agentProcedure
    .input(z.object({ date: dateInput }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db.select({ teamId: teamDayLock.teamId })
        .from(teamDayLock)
        .where(eq(teamDayLock.date, input.date));
      return rows.map(row => Number(row.teamId));
    }),

  lockTeam: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await findTeam(db, input.teamId, true);
      await db.insert(teamDayLock).values(input).onDuplicateKeyUpdate({ set: { teamId: input.teamId } });
      return { ok: true };
    }),

  unlockTeam: agentProcedure
    .input(z.object({ teamId: z.number().int().positive(), date: dateInput }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(teamDayLock).where(
        and(eq(teamDayLock.teamId, input.teamId), eq(teamDayLock.date, input.date)),
      );
      return { ok: true };
    }),

  geocodeAddress: agentProcedure
    .input(z.object({ address: z.string().trim().min(3) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const result = await geocodeWithCache(db, input.address);
      if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not geocode address" });
      return result;
    }),
});
