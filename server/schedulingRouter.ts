/**
 * schedulingRouter.ts
 * Geographic route optimization for cleaning teams.
 *
 * Architecture:
 *   1. Geocode job addresses via Google Maps (cached in job_geo_cache)
 *   2. Build a travel-time matrix via Distance Matrix API
 *   3. Solve the VRP using a nearest-neighbor + 2-opt heuristic (pure TS,
 *      no Python dependency — fast enough for ≤30 jobs/day)
 *   4. Persist optimized assignments in schedule_assignments
 *   5. Expose tRPC procedures for the UI
 */

import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  schedulingTeams,
  scheduleAssignments,
  jobGeoCache,
  cleanerJobs,
} from "../drizzle/schema";
import { makeRequest, GeocodingResult, DistanceMatrixResult } from "./_core/map";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LatLng { lat: number; lng: number; }

interface GeocodedJob {
  cleanerJobId: number;
  address: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  durationHours: number; // estimated job duration
  customerName: string | null;
  serviceType: string | null;
  serviceDateTime: string | null;
  teamName: string | null; // from Launch27
  teamId: number | null;
  bookingStatus: string | null;
}

interface TeamConfig {
  id: number;
  name: string;
  homeLat: number;
  homeLng: number;
  maxHoursPerDay: number;
  color: string;
}

interface Assignment {
  cleanerJobId: number;
  teamId: number;
  teamName: string;
  routeOrder: number;
  estimatedArrivalMs: number;
  estimatedDepartureMs: number;
  driveTimeSecs: number;
}

// ── Geocoding helper ──────────────────────────────────────────────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  try {
    const result = await makeRequest<GeocodingResult>("/maps/api/geocode/json", { address });
    if (result.status !== "OK" || !result.results[0]) return null;
    const loc = result.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng, formattedAddress: result.results[0].formatted_address };
  } catch {
    return null;
  }
}

async function geocodeWithCache(address: string): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const key = address.trim().toLowerCase();

  // Check cache
  const cached = await db.select().from(jobGeoCache).where(eq(jobGeoCache.addressKey, key)).limit(1);
  if (cached[0]) return { lat: cached[0].lat, lng: cached[0].lng, formattedAddress: cached[0].formattedAddress ?? address };

  // Geocode fresh
  const result = await geocodeAddress(address);
  if (!result) return null;

  // Store in cache
  try {
    await db.insert(jobGeoCache).ignore().values({
      addressKey: key,
      originalAddress: address,
      lat: result.lat,
      lng: result.lng,
      formattedAddress: result.formattedAddress,
    });
  } catch { /* ignore duplicate */ }

  return result;
}

// ── Distance Matrix helper ────────────────────────────────────────────────────

/**
 * Fetch a travel-time matrix for N origins × N destinations.
 * Google Distance Matrix API supports max 25 origins × 25 destinations per request.
 * We chunk if needed.
 */
async function buildTravelMatrix(points: LatLng[]): Promise<number[][]> {
  const n = points.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  const CHUNK = 10; // safe chunk size
  for (let oi = 0; oi < n; oi += CHUNK) {
    const origins = points.slice(oi, oi + CHUNK).map(p => `${p.lat},${p.lng}`).join("|");
    for (let di = 0; di < n; di += CHUNK) {
      const destinations = points.slice(di, di + CHUNK).map(p => `${p.lat},${p.lng}`).join("|");
      try {
        const result = await makeRequest<DistanceMatrixResult>("/maps/api/distancematrix/json", {
          origins,
          destinations,
          mode: "driving",
          units: "metric",
        });
        if (result.status === "OK") {
          result.rows.forEach((row, ri) => {
            row.elements.forEach((el, ci) => {
              if (el.status === "OK") {
                matrix[oi + ri][di + ci] = el.duration.value; // seconds
              } else {
                // Fallback: straight-line distance × 1.4 speed factor
                const p1 = points[oi + ri];
                const p2 = points[di + ci];
                const dist = haversineMeters(p1, p2);
                matrix[oi + ri][di + ci] = Math.round(dist / 10); // ~36 km/h
              }
            });
          });
        }
      } catch {
        // Fallback to haversine for this chunk
        for (let ri = 0; ri < CHUNK && oi + ri < n; ri++) {
          for (let ci = 0; ci < CHUNK && di + ci < n; ci++) {
            const p1 = points[oi + ri];
            const p2 = points[di + ci];
            matrix[oi + ri][di + ci] = Math.round(haversineMeters(p1, p2) / 10);
          }
        }
      }
    }
  }
  return matrix;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

// ── VRP Solver (nearest-neighbor + 2-opt) ────────────────────────────────────

/**
 * Estimate job duration in hours from service type string.
 */
function estimateDurationHours(serviceType: string | null, bedrooms: number | null): number {
  const s = (serviceType ?? "").toLowerCase();
  if (s.includes("move") || s.includes("deep")) return 4;
  if (s.includes("4 bed") || (bedrooms ?? 0) >= 4) return 3.5;
  if (s.includes("3 bed") || (bedrooms ?? 0) === 3) return 3;
  if (s.includes("2 bed") || (bedrooms ?? 0) === 2) return 2.5;
  return 2;
}

/**
 * Solve the VRP using a greedy nearest-neighbor heuristic followed by 2-opt improvement.
 * Returns an array of team assignments with route order.
 *
 * Strategy:
 *   1. If a job already has a Launch27 team assignment, prefer that team.
 *   2. Assign remaining unmatched jobs to the team with the nearest existing route endpoint.
 *   3. Run 2-opt within each team's route to reduce total drive time.
 */
function solveVRP(
  jobs: GeocodedJob[],
  teams: TeamConfig[],
  travelMatrix: number[][],
  allPoints: LatLng[], // [team homes..., job points...]
  teamOffset: number,  // index where job points start in allPoints
): Assignment[] {
  const DAY_START_MS = 8 * 3600 * 1000; // 8 AM in ms from midnight
  const BUFFER_SECS = 900; // 15 min buffer between jobs

  // Build team routes: map teamId → list of job indices (into jobs[])
  const routes = new Map<number, number[]>();
  for (const t of teams) routes.set(t.id, []);

  // Step 1: Assign jobs that already have a matching team name
  const unassigned: number[] = [];
  for (let ji = 0; ji < jobs.length; ji++) {
    const job = jobs[ji];
    const matchedTeam = teams.find(t => t.name === job.teamName);
    if (matchedTeam) {
      routes.get(matchedTeam.id)!.push(ji);
    } else {
      unassigned.push(ji);
    }
  }

  // Step 2: Assign unmatched jobs to nearest team (by drive time from team home)
  for (const ji of unassigned) {
    const jobPointIdx = teamOffset + ji;
    let bestTeam = teams[0];
    let bestCost = Infinity;
    for (const t of teams) {
      const teamHomeIdx = teams.indexOf(t);
      const route = routes.get(t.id)!;
      // Cost = drive time from last point in route (or home) to this job
      const lastIdx = route.length > 0 ? teamOffset + route[route.length - 1] : teamHomeIdx;
      const cost = travelMatrix[lastIdx]?.[jobPointIdx] ?? Infinity;
      // Penalize overloaded teams
      const totalHours = route.reduce((s, rji) => s + jobs[rji].durationHours, 0);
      const teamCfg = teams.find(tt => tt.id === t.id)!;
      if (totalHours >= teamCfg.maxHoursPerDay) continue;
      if (cost < bestCost) { bestCost = cost; bestTeam = t; }
    }
    routes.get(bestTeam.id)!.push(ji);
  }

  // Step 3: 2-opt improvement within each team's route
  for (const [teamId, route] of Array.from(routes.entries())) {
    if (route.length < 3) continue;
    const teamIdx = teams.findIndex(t => t.id === teamId);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < route.length - 1; i++) {
        for (let k = i + 1; k < route.length; k++) {
          const before = routeCost(route, i, k, teamIdx, teamOffset, travelMatrix);
          // Reverse segment [i+1..k]
          const newRoute = [...route.slice(0, i + 1), ...route.slice(i + 1, k + 1).reverse(), ...route.slice(k + 1)];
          const after = routeCost(newRoute, i, k, teamIdx, teamOffset, travelMatrix);
          if (after < before) {
            route.splice(0, route.length, ...newRoute);
            improved = true;
          }
        }
      }
    }
  }

  // Step 4: Build Assignment objects with estimated arrival times
  const assignments: Assignment[] = [];
  for (const [teamId, route] of Array.from(routes.entries())) {
    const team = teams.find(t => t.id === teamId)!;
    const teamIdx = teams.findIndex(t => t.id === teamId);
    let currentTimeMs = DAY_START_MS;
    let prevPointIdx = teamIdx;

    for (let order = 0; order < route.length; order++) {
      const ji = route[order];
      const job = jobs[ji];
      const jobPointIdx = teamOffset + ji;
      const driveSecs = travelMatrix[prevPointIdx]?.[jobPointIdx] ?? 0;
      currentTimeMs += driveSecs * 1000 + BUFFER_SECS * 1000;
      const arrivalMs = currentTimeMs;
      const departureMs = arrivalMs + job.durationHours * 3600 * 1000;
      currentTimeMs = departureMs;
      prevPointIdx = jobPointIdx;

      assignments.push({
        cleanerJobId: job.cleanerJobId,
        teamId,
        teamName: team.name,
        routeOrder: order,
        estimatedArrivalMs: arrivalMs,
        estimatedDepartureMs: departureMs,
        driveTimeSecs: driveSecs,
      });
    }
  }

  return assignments;
}

function routeCost(route: number[], i: number, k: number, teamIdx: number, teamOffset: number, matrix: number[][]): number {
  let cost = 0;
  const prev = (idx: number) => idx === 0 ? teamIdx : teamOffset + route[idx - 1];
  for (let x = i; x <= k; x++) {
    cost += matrix[prev(x)]?.[teamOffset + route[x]] ?? 0;
  }
  return cost;
}

// ── tRPC Router ───────────────────────────────────────────────────────────────

export const schedulingRouter = router({

  // ── Teams CRUD ──────────────────────────────────────────────────────────────

  getTeams: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    // Auto-sync: insert any new teamNames from cleaner_jobs not yet in scheduling_teams
    const SKIP = ["Unassigned", "fake rohan team"];
    const COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316","#84cc16","#06b6d4","#a855f7"];
    const [distinctRows] = await (db as any).execute(
      sql`SELECT DISTINCT teamName, teamId FROM cleaner_jobs WHERE teamName IS NOT NULL`
    ) as [Array<{teamName:string;teamId:number|null}>];
    const existing = await db.select({ name: schedulingTeams.name }).from(schedulingTeams);
    const existingNames = new Set(existing.map(r => r.name));
    const toInsert = distinctRows.filter((r: any) => r.teamName && !SKIP.includes(r.teamName) && !existingNames.has(r.teamName));
    if (toInsert.length > 0) {
      const colorCount = existingNames.size;
      await db.insert(schedulingTeams).values(
        toInsert.map((r: any, i: number) => ({
          name: r.teamName,
          launch27TeamId: r.teamId ?? undefined,
          maxHoursPerDay: 8,
          color: COLORS[(colorCount + i) % COLORS.length],
          isActive: 1,
        }))
      );
    }
    return db.select().from(schedulingTeams).orderBy(schedulingTeams.name);
  }),

  upsertTeam: agentProcedure
    .input(z.object({
      id: z.number().optional(),
      name: z.string().min(1),
      homeAddress: z.string().optional(),
      maxHoursPerDay: z.number().min(1).max(16).default(8),
      skills: z.string().optional(),
      color: z.string().optional(),
      isActive: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Geocode home address if provided
      let homeLat: number | undefined;
      let homeLng: number | undefined;
      if (input.homeAddress) {
        const geo = await geocodeWithCache(input.homeAddress);
        if (geo) { homeLat = geo.lat; homeLng = geo.lng; }
      }

      if (input.id) {
        await db.update(schedulingTeams)
          .set({ name: input.name, homeAddress: input.homeAddress, homeLat, homeLng, maxHoursPerDay: input.maxHoursPerDay, skills: input.skills, color: input.color, isActive: input.isActive ?? 1 })
          .where(eq(schedulingTeams.id, input.id));
        return { id: input.id };
      } else {
        const [result] = await db.insert(schedulingTeams).values({
          name: input.name, homeAddress: input.homeAddress, homeLat, homeLng,
          maxHoursPerDay: input.maxHoursPerDay, skills: input.skills,
          color: input.color ?? "#6366f1", isActive: 1,
        });
        return { id: (result as any).insertId };
      }
    }),

  deleteTeam: agentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(schedulingTeams).where(eq(schedulingTeams.id, input.id));
      return { ok: true };
    }),

  // ── Schedule for a date ─────────────────────────────────────────────────────

  getSchedule: agentProcedure
    .input(z.object({ date: z.string() })) // YYYY-MM-DD
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Get all jobs for the date
      const jobs = await db.select().from(cleanerJobs)
        .where(eq(cleanerJobs.jobDate, input.date));

      // Get existing assignments for the date
      const jobIds = jobs.map(j => j.id);
      const assignments = jobIds.length > 0
        ? await db.select().from(scheduleAssignments)
            .where(and(
              eq(scheduleAssignments.jobDate, input.date),
              inArray(scheduleAssignments.cleanerJobId, jobIds),
            ))
        : [];

      // Get all teams
      const teams = await db.select().from(schedulingTeams).where(eq(schedulingTeams.isActive, 1));

      // Merge: attach assignment info to each job
      const assignmentMap = new Map(assignments.map(a => [a.cleanerJobId, a]));
      const enriched = jobs.map(j => ({
        ...j,
        assignment: assignmentMap.get(j.id) ?? null,
      }));

      return { jobs: enriched, teams, hasAssignments: assignments.length > 0 };
    }),

  // ── Run optimizer ───────────────────────────────────────────────────────────

  optimizeDay: agentProcedure
    .input(z.object({ date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Load jobs for the date (skip cancelled)
      const rawJobs = await db.select().from(cleanerJobs)
        .where(eq(cleanerJobs.jobDate, input.date));
      const activeJobs = rawJobs.filter(j => j.bookingStatus !== "cancelled");

      if (activeJobs.length === 0) return { assigned: 0, message: "No active jobs for this date." };

      // 2. Load active teams
      const teams = await db.select().from(schedulingTeams).where(eq(schedulingTeams.isActive, 1));
      if (teams.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No active teams configured. Add teams first." });

      // 3. Geocode all job addresses
      const geocoded: GeocodedJob[] = [];
      for (const j of activeJobs) {
        if (!j.jobAddress) continue;
        const geo = await geocodeWithCache(j.jobAddress);
        if (!geo) continue;
        geocoded.push({
          cleanerJobId: j.id,
          address: j.jobAddress,
          lat: geo.lat,
          lng: geo.lng,
          formattedAddress: geo.formattedAddress,
          durationHours: estimateDurationHours(j.serviceType, j.bedrooms),
          customerName: j.customerName,
          serviceType: j.serviceType,
          serviceDateTime: j.serviceDateTime,
          teamName: j.teamName,
          teamId: j.teamId,
          bookingStatus: j.bookingStatus,
        });
      }

      if (geocoded.length === 0) return { assigned: 0, message: "No jobs with geocodable addresses." };

      // 4. Build all points array: [team homes..., job points...]
      const teamConfigs: TeamConfig[] = teams
        .filter(t => t.homeLat != null && t.homeLng != null)
        .map(t => ({
          id: t.id,
          name: t.name,
          homeLat: t.homeLat!,
          homeLng: t.homeLng!,
          maxHoursPerDay: t.maxHoursPerDay ?? 8,
          color: t.color ?? "#6366f1",
        }));

      if (teamConfigs.length === 0) {
        // No teams have home addresses — use simple team-name matching only
        const simpleAssignments: Assignment[] = geocoded.map((job, i) => {
          const matchedTeam = teams.find(t => t.name === job.teamName) ?? teams[0];
          return {
            cleanerJobId: job.cleanerJobId,
            teamId: matchedTeam.id,
            teamName: matchedTeam.name,
            routeOrder: i,
            estimatedArrivalMs: 8 * 3600 * 1000,
            estimatedDepartureMs: (8 + job.durationHours) * 3600 * 1000,
            driveTimeSecs: 0,
          };
        });
        await persistAssignments(db, input.date, simpleAssignments);
        return { assigned: simpleAssignments.length, message: `Assigned ${simpleAssignments.length} jobs (no home addresses set — add team home addresses for route optimization).` };
      }

      const allPoints: LatLng[] = [
        ...teamConfigs.map(t => ({ lat: t.homeLat, lng: t.homeLng })),
        ...geocoded.map(j => ({ lat: j.lat, lng: j.lng })),
      ];

      // 5. Build travel matrix
      const travelMatrix = await buildTravelMatrix(allPoints);

      // 6. Solve VRP
      const assignments = solveVRP(geocoded, teamConfigs, travelMatrix, allPoints, teamConfigs.length);

      // 7. Preserve manual overrides
      const existingManual = await db.select().from(scheduleAssignments)
        .where(and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(scheduleAssignments.isManual, 1),
        ));
      const manualJobIds = new Set(existingManual.map(m => m.cleanerJobId));

      // 8. Persist (replace non-manual assignments)
      const toSave = assignments.filter(a => !manualJobIds.has(a.cleanerJobId));
      await persistAssignments(db, input.date, toSave);

      return { assigned: assignments.length, message: `Optimized ${assignments.length} jobs across ${teamConfigs.length} teams.` };
    }),

  // ── Manual override ─────────────────────────────────────────────────────────

  manualAssign: agentProcedure
    .input(z.object({
      date: z.string(),
      cleanerJobId: z.number(),
      teamId: z.number(),
      routeOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const team = await db.select().from(schedulingTeams).where(eq(schedulingTeams.id, input.teamId)).limit(1);
      if (!team[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });

      await db.insert(scheduleAssignments)
        .values({
          jobDate: input.date,
          cleanerJobId: input.cleanerJobId,
          teamId: input.teamId,
          teamName: team[0].name,
          routeOrder: input.routeOrder ?? 0,
          isManual: 1,
          estimatedArrivalMs: 8 * 3600 * 1000,
          estimatedDepartureMs: 10 * 3600 * 1000,
          driveTimeSecs: 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            teamId: input.teamId,
            teamName: team[0].name,
            routeOrder: input.routeOrder ?? 0,
            isManual: 1,
            updatedAt: new Date(),
          },
        });

      return { ok: true };
    }),

  // ── Geocode a single address (for team home setup) ──────────────────────────

  geocodeAddress: agentProcedure
    .input(z.object({ address: z.string() }))
    .mutation(async ({ input }) => {
      const result = await geocodeWithCache(input.address);
      if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not geocode address" });
      return result;
    }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function persistAssignments(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, date: string, assignments: Assignment[]) {
  for (const a of assignments) {
    await db.insert(scheduleAssignments)
      .values({
        jobDate: date,
        cleanerJobId: a.cleanerJobId,
        teamId: a.teamId,
        teamName: a.teamName,
        routeOrder: a.routeOrder,
        estimatedArrivalMs: a.estimatedArrivalMs,
        estimatedDepartureMs: a.estimatedDepartureMs,
        driveTimeSecs: a.driveTimeSecs,
        isManual: 0,
      })
      .onDuplicateKeyUpdate({
        set: {
          teamId: a.teamId,
          teamName: a.teamName,
          routeOrder: a.routeOrder,
          estimatedArrivalMs: a.estimatedArrivalMs,
          estimatedDepartureMs: a.estimatedDepartureMs,
          driveTimeSecs: a.driveTimeSecs,
          isManual: 0,
          updatedAt: new Date(),
        },
      });
  }
}
