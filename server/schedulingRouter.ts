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
  scheduleJobLocks,
  teamDayUnavailability,
  teamDayLock,
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
/**
 * Solve the scheduling problem with two phases:
 *
 * Phase 1 — LOCK assigned jobs:
 *   Jobs that already have a teamName from Launch27 are locked to that team.
 *   Their start time comes from serviceDateTime (the real scheduled time).
 *   Route order within each team is sorted chronologically by serviceDateTime.
 *
 * Phase 2 — INSERT unassigned jobs:
 *   Jobs with no teamName are inserted into the best team based on:
 *   - Geographic proximity to that team's existing jobs (travel matrix)
 *   - Available capacity (team not over maxHoursPerDay)
 *   Unassigned jobs get an estimated start time after the team's last locked job.
 */
function solveVRP(
  jobs: GeocodedJob[],
  teams: TeamConfig[],
  travelMatrix: number[][],
  allPoints: LatLng[], // [team homes..., job points...]
  teamOffset: number,  // index where job points start in allPoints
): Assignment[] {
  // map teamId → list of job indices (into jobs[])
  const routes = new Map<number, number[]>();
  for (const t of teams) routes.set(t.id, []);

  // ── Phase 1: Lock assigned jobs to their Launch27 team ──────────────────────
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

  // Sort each team's locked jobs chronologically by serviceDateTime
  for (const [, route] of Array.from(routes.entries())) {
    route.sort((a, b) => {
      const ta = jobs[a].serviceDateTime ? new Date(jobs[a].serviceDateTime!).getTime() : 0;
      const tb = jobs[b].serviceDateTime ? new Date(jobs[b].serviceDateTime!).getTime() : 0;
      return ta - tb;
    });
  }

  // ── Phase 2: Insert unassigned jobs into best team by proximity ─────────────
  for (const ji of unassigned) {
    const jobPointIdx = teamOffset + ji;
    let bestTeam = teams[0];
    let bestCost = Infinity;

    for (const t of teams) {
      const route = routes.get(t.id)!;
      const totalHours = route.reduce((s, rji) => s + jobs[rji].durationHours, 0);
      if (totalHours >= t.maxHoursPerDay) continue; // team full

      // Cost = minimum travel time from this job to any of the team's existing jobs (or home)
      const teamIdx = teams.indexOf(t);
      let minCost = Infinity;
      if (route.length === 0) {
        minCost = travelMatrix[teamIdx]?.[jobPointIdx] ?? Infinity;
      } else {
        for (const rji of route) {
          const d = travelMatrix[teamOffset + rji]?.[jobPointIdx] ?? Infinity;
          if (d < minCost) minCost = d;
        }
      }
      if (minCost < bestCost) { bestCost = minCost; bestTeam = t; }
    }
    routes.get(bestTeam.id)!.push(ji);
  }

  // ── Build Assignment objects ─────────────────────────────────────────────────
  const BUFFER_MS = 15 * 60 * 1000; // 15 min buffer between jobs
  const assignments: Assignment[] = [];

  for (const [teamId, route] of Array.from(routes.entries())) {
    const team = teams.find(t => t.id === teamId)!;
    const teamIdx = teams.findIndex(t => t.id === teamId);

    // Separate locked (have Launch27 team + serviceDateTime) from newly inserted
    const locked = route.filter(ji => !!jobs[ji].serviceDateTime && !!jobs[ji].teamName);
    const inserted = route.filter(ji => !jobs[ji].serviceDateTime || !jobs[ji].teamName);

    // Sort locked jobs chronologically
    locked.sort((a, b) =>
      new Date(jobs[a].serviceDateTime!).getTime() - new Date(jobs[b].serviceDateTime!).getTime()
    );

    // Determine end time of last locked job (for appending inserted jobs after)
    const lastLockedEndMs = locked.length > 0
      ? new Date(jobs[locked[locked.length - 1]].serviceDateTime!).getTime()
        + jobs[locked[locked.length - 1]].durationHours * 3600000
      : Date.now();

    // Emit locked jobs — use real serviceDateTime as arrival
    locked.forEach((ji, order) => {
      const job = jobs[ji];
      const startMs = new Date(job.serviceDateTime!).getTime();
      const endMs = startMs + job.durationHours * 3600000;
      const prevIdx = order === 0 ? teamIdx : teamOffset + locked[order - 1];
      const driveSecs = travelMatrix[prevIdx]?.[teamOffset + ji] ?? 0;
      assignments.push({
        cleanerJobId: job.cleanerJobId,
        teamId,
        teamName: team.name,
        routeOrder: order,
        estimatedArrivalMs: startMs,
        estimatedDepartureMs: endMs,
        driveTimeSecs: driveSecs,
      });
    });

    // Emit inserted (unassigned) jobs — appended after locked jobs
    let currentMs = lastLockedEndMs + BUFFER_MS;
    inserted.forEach((ji, i) => {
      const job = jobs[ji];
      const startMs = currentMs;
      const endMs = startMs + job.durationHours * 3600000;
      currentMs = endMs + BUFFER_MS;
      const prevIdx = locked.length > 0 && i === 0
        ? teamOffset + locked[locked.length - 1]
        : i === 0 ? teamIdx : teamOffset + inserted[i - 1];
      const driveSecs = travelMatrix[prevIdx]?.[teamOffset + ji] ?? 0;
      assignments.push({
        cleanerJobId: job.cleanerJobId,
        teamId,
        teamName: team.name,
        routeOrder: locked.length + i,
        estimatedArrivalMs: startMs,
        estimatedDepartureMs: endMs,
        driveTimeSecs: driveSecs,
      });
    });
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
      // Build a lookup from scheduling_teams name -> team row
      const teamByName = new Map(teams.map(t => [t.name, t]));

      // For pre-optimization view: load geocache for all job addresses so we can
      // compute real drive times between consecutive jobs using Google Maps Distance Matrix.
      const jobAddresses = jobs.map(j => j.jobAddress?.trim().toLowerCase()).filter(Boolean) as string[];
      const geoCacheRows = jobAddresses.length > 0
        ? await db.select().from(jobGeoCache).where(inArray(jobGeoCache.addressKey, jobAddresses))
        : [];
      const geoByAddress = new Map(geoCacheRows.map(g => [g.addressKey, g]));

      // Geocode any addresses not yet in the cache (so drive times show on first load)
      const uncachedJobs = jobs.filter(j => j.jobAddress && !geoByAddress.has(j.jobAddress.trim().toLowerCase()));
      if (uncachedJobs.length > 0) {
        await Promise.all(uncachedJobs.map(async j => {
          try {
            const geo = await geocodeWithCache(j.jobAddress!);
            if (geo) {
              geoByAddress.set(j.jobAddress!.trim().toLowerCase(), {
                id: 0, addressKey: j.jobAddress!.trim().toLowerCase(),
                originalAddress: j.jobAddress!, lat: geo.lat, lng: geo.lng,
                formattedAddress: geo.formattedAddress, createdAt: new Date(),
              });
            }
          } catch { /* skip if geocode fails */ }
        }));
      }

      // Group jobs by team, sort by serviceDateTime
      const jobsByTeam = new Map<string, typeof jobs>();
      for (const j of jobs) {
        if (!j.teamName) continue;
        if (!jobsByTeam.has(j.teamName)) jobsByTeam.set(j.teamName, []);
        jobsByTeam.get(j.teamName)!.push(j);
      }
      for (const [, teamJobs] of Array.from(jobsByTeam)) {
        teamJobs.sort((a: typeof jobs[0], b: typeof jobs[0]) => {
          const ta = a.serviceDateTime ? new Date(a.serviceDateTime).getTime() : 0;
          const tb = b.serviceDateTime ? new Date(b.serviceDateTime).getTime() : 0;
          return ta - tb;
        });
      }

      // Build consecutive origin-destination pairs for Distance Matrix
      // Also include home → first job for each team
      // Use fromId = -teamId to distinguish home-to-first pairs (negative = home departure)
      const pairs: Array<{ fromId: number; toId: number; from: LatLng; to: LatLng }> = [];
      for (const [teamName, teamJobs] of Array.from(jobsByTeam)) {
        const team = teamByName.get(teamName);
        // Home → first job
        const firstJob = teamJobs[0];
        if (firstJob && team?.homeLat && team?.homeLng && !assignmentMap.has(firstJob.id)) {
          const firstGeo = geoByAddress.get(firstJob.jobAddress?.trim().toLowerCase() ?? "");
          if (firstGeo) {
            pairs.push({ fromId: -(team.id), toId: firstJob.id, from: { lat: team.homeLat, lng: team.homeLng }, to: { lat: firstGeo.lat, lng: firstGeo.lng } });
          }
        }
        // Consecutive job pairs
        for (let i = 1; i < teamJobs.length; i++) {
          const prev = teamJobs[i - 1];
          const curr = teamJobs[i];
          if (assignmentMap.has(curr.id)) continue; // already has real assignment
          const prevGeo = geoByAddress.get(prev.jobAddress?.trim().toLowerCase() ?? "");
          const currGeo = geoByAddress.get(curr.jobAddress?.trim().toLowerCase() ?? "");
          if (prevGeo && currGeo) {
            pairs.push({ fromId: prev.id, toId: curr.id, from: { lat: prevGeo.lat, lng: prevGeo.lng }, to: { lat: currGeo.lat, lng: currGeo.lng } });
          }
        }
      }

      // Fetch real drive times from Google Maps (batch as origin|origin... → dest|dest...)
      const estimatedDriveMap = new Map<number, number>();
      if (pairs.length > 0) {
        try {
          const CHUNK = 10;
          for (let i = 0; i < pairs.length; i += CHUNK) {
            const chunk = pairs.slice(i, i + CHUNK);
            const origins = chunk.map(p => `${p.from.lat},${p.from.lng}`).join("|");
            const destinations = chunk.map(p => `${p.to.lat},${p.to.lng}`).join("|");
            const result = await makeRequest<DistanceMatrixResult>("/maps/api/distancematrix/json", {
              origins,
              destinations,
              mode: "driving",
              units: "metric",
            });
            if (result.status === "OK") {
              // Each origin maps to its own destination (diagonal of the matrix)
              chunk.forEach((pair, idx) => {
                const el = result.rows[idx]?.elements[idx];
                if (el?.status === "OK") {
                  estimatedDriveMap.set(pair.toId, el.duration.value);
                } else {
                  // Fallback to haversine
                  const distM = haversineMeters(pair.from, pair.to);
                  estimatedDriveMap.set(pair.toId, Math.round(distM / 10));
                }
              });
            }
          }
        } catch {
          // Fallback: use haversine for all pairs
          for (const pair of pairs) {
            const distM = haversineMeters(pair.from, pair.to);
            estimatedDriveMap.set(pair.toId, Math.round(distM / 10));
          }
        }
      }

      const enriched = jobs.map(j => {
        const savedAssignment = assignmentMap.get(j.id);
        // If no saved assignment yet, synthesize one from the job's own Launch27 teamName
        const syntheticAssignment = !savedAssignment && j.teamName && teamByName.has(j.teamName)
          ? {
              cleanerJobId: j.id,
              jobDate: j.jobDate,
              teamId: teamByName.get(j.teamName)!.id,
              teamName: j.teamName,
              routeOrder: 0,
              estimatedArrivalMs: j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : null,
              estimatedDepartureMs: j.serviceDateTime ? new Date(j.serviceDateTime).getTime() + 2 * 3600000 : null,
              driveTimeSecs: estimatedDriveMap.get(j.id) ?? null,
              isManual: 0,
            }
          : null;
        return {
          ...j,
          assignment: savedAssignment ?? syntheticAssignment,
        };
      });

      // Build homeDriveTimeSecs map: teamId -> drive time from home to first job
      const homeDriveByTeam = new Map<number, number>();
      for (const [, teamJobs] of Array.from(jobsByTeam)) {
        const firstJob = teamJobs[0];
        if (firstJob) {
          const secs = estimatedDriveMap.get(firstJob.id);
          const team = teamByName.get(firstJob.teamName ?? "");
          // Only count it as home drive if the pair was a home pair (fromId < 0)
          // We stored it keyed by toId (firstJob.id) — check if a home pair exists for this job
          const homePair = pairs.find(p => p.toId === firstJob.id && p.fromId < 0);
          if (homePair && secs !== undefined && team) {
            homeDriveByTeam.set(team.id, secs);
          }
        }
      }
      const teamsWithHomeDrive = teams.map(t => ({
        ...t,
        homeDriveTimeSecs: homeDriveByTeam.get(t.id) ?? null,
      }));

      return { jobs: enriched, teams: teamsWithHomeDrive, hasAssignments: assignments.length > 0 };
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

      // 2. Load active teams, excluding those marked unavailable for this date
      const allTeams = await db.select().from(schedulingTeams).where(eq(schedulingTeams.isActive, 1));
      const unavailRows = await db.select({ teamId: teamDayUnavailability.teamId })
        .from(teamDayUnavailability)
        .where(eq(teamDayUnavailability.date, input.date));
      const unavailIds = new Set(unavailRows.map(r => r.teamId));
      const teams = allTeams.filter(t => !unavailIds.has(t.id));
      if (teams.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No available teams for this date. All teams are marked OFF." });

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
        // Group by team (locked), then assign unmatched to nearest team by name proximity
        const tGroups = new Map<number, GeocodedJob[]>();
        for (const t of teams) tGroups.set(t.id, []);
        const unmatched2: GeocodedJob[] = [];
        for (const job of geocoded) {
          const mt = teams.find(t => t.name === job.teamName);
          if (mt) tGroups.get(mt.id)!.push(job);
          else unmatched2.push(job);
        }
        for (const job of unmatched2) {
          tGroups.get(teams[0].id)!.push(job);
        }
        const simpleAssignments: Assignment[] = [];
        for (const [tid, tJobs] of Array.from(tGroups.entries())) {
          const team2 = teams.find(t => t.id === tid)!;
          const lockedJ = tJobs.filter(j => !!j.serviceDateTime && !!j.teamName)
            .sort((a, b) => new Date(a.serviceDateTime!).getTime() - new Date(b.serviceDateTime!).getTime());
          const insertedJ = tJobs.filter(j => !j.serviceDateTime || !j.teamName);
          const lastEndMs2 = lockedJ.length > 0
            ? new Date(lockedJ[lockedJ.length-1].serviceDateTime!).getTime() + lockedJ[lockedJ.length-1].durationHours * 3600000
            : Date.now();
          let curMs = lastEndMs2 + 15 * 60 * 1000;
          [...lockedJ, ...insertedJ].forEach((job, i) => {
            const startMs = i < lockedJ.length ? new Date(job.serviceDateTime!).getTime() : curMs;
            const endMs = startMs + job.durationHours * 3600000;
            if (i >= lockedJ.length) curMs = endMs + 15 * 60 * 1000;
            simpleAssignments.push({
              cleanerJobId: job.cleanerJobId,
              teamId: tid,
              teamName: team2.name,
              routeOrder: i,
              estimatedArrivalMs: startMs,
              estimatedDepartureMs: endMs,
              driveTimeSecs: 0,
            });
          });
        }
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
      // 7a. Respect team-level locks — all jobs on a locked team keep their existing assignment
      const teamLockRows = await db.select({ teamId: teamDayLock.teamId })
        .from(teamDayLock)
        .where(eq(teamDayLock.date, input.date));
      const lockedTeamIds = new Set(teamLockRows.map(r => r.teamId));
      if (lockedTeamIds.size > 0) {
        // Load existing assignments for locked teams and preserve them
        const existingForLockedTeams = await db.select().from(scheduleAssignments)
          .where(and(
            eq(scheduleAssignments.jobDate, input.date),
            inArray(scheduleAssignments.teamId, Array.from(lockedTeamIds)),
          ));
        // Mark those jobs as manual so they survive the persist step
        for (const ea of existingForLockedTeams) {
          manualJobIds.add(ea.cleanerJobId);
        }
        // Remove those jobs from the VRP assignments so they aren't re-assigned
        const lockedJobIdSet = new Set(existingForLockedTeams.map(e => e.cleanerJobId));
        assignments.splice(0, assignments.length, ...assignments.filter(a => !lockedJobIdSet.has(a.cleanerJobId)));
      }
      // 7b. Respect locked positions — locked jobs stay at their pinned routeOrder.
      // Unlocked jobs are re-ordered by the VRP result, slotted into the gaps.
      const locks = await db.select().from(scheduleJobLocks)
        .where(eq(scheduleJobLocks.date, input.date));
      const lockMap = new Map(locks.map(l => [l.jobId, l.lockedPosition]));

      if (lockMap.size > 0) {
        // Per-team: place locked jobs at their pinned positions, fill gaps with VRP order
        const byTeam = new Map<number, typeof assignments>();
        for (const a of assignments) {
          if (!byTeam.has(a.teamId)) byTeam.set(a.teamId, []);
          byTeam.get(a.teamId)!.push(a);
        }
        const reordered: typeof assignments = [];
        for (const [, teamJobs] of Array.from(byTeam.entries())) {
          const locked = teamJobs.filter(j => lockMap.has(j.cleanerJobId));
          const unlocked = teamJobs.filter(j => !lockMap.has(j.cleanerJobId));
          const slots: (typeof assignments[0] | null)[] = new Array(teamJobs.length).fill(null);
          for (const lj of locked) {
            const pos = Math.min(lockMap.get(lj.cleanerJobId)!, teamJobs.length - 1);
            slots[pos] = { ...lj, routeOrder: pos };
          }
          let ui = 0;
          for (let i = 0; i < slots.length; i++) {
            if (slots[i] === null && ui < unlocked.length) {
              slots[i] = { ...unlocked[ui++]!, routeOrder: i };
            }
          }
          reordered.push(...(slots.filter(Boolean) as typeof assignments));
        }
        assignments.splice(0, assignments.length, ...reordered);
      }

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
          estimatedArrivalMs: Date.now(),
          estimatedDepartureMs: Date.now() + 2 * 3600 * 1000,
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

  // ── Job lock procedures ──────────────────────────────────────────────────────
  lockJob: agentProcedure
    .input(z.object({
      jobId: z.number(),
      date: z.string(),
      cleanerId: z.number(),
      lockedPosition: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.insert(scheduleJobLocks)
        .values({
          jobId: input.jobId,
          date: input.date,
          cleanerId: input.cleanerId,
          lockedPosition: input.lockedPosition,
          lockedAt: Date.now(),
        })
        .onDuplicateKeyUpdate({
          set: {
            lockedPosition: input.lockedPosition,
            lockedAt: Date.now(),
          },
        });
      return { ok: true };
    }),

  unlockJob: agentProcedure
    .input(z.object({ jobId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(scheduleJobLocks)
        .where(and(
          eq(scheduleJobLocks.jobId, input.jobId),
          eq(scheduleJobLocks.date, input.date),
        ));
      return { ok: true };
    }),

  getJobLocks: agentProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const locks = await db.select().from(scheduleJobLocks)
        .where(eq(scheduleJobLocks.date, input.date));
      return locks;
    }),

  /**
   * resetOptimization — clears all non-manual schedule assignments and all locks
   * for the given date, restoring the original Launch27 order.
   */
  resetOptimization: agentProcedure
    .input(z.object({ date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Delete all non-manual assignments for this date
      await db.delete(scheduleAssignments)
        .where(and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(scheduleAssignments.isManual, 0),
        ));
      // Clear all locks for this date
      await db.delete(scheduleJobLocks)
        .where(eq(scheduleJobLocks.date, input.date));
      return { ok: true };
    }),

  /** Returns set of teamIds that are marked unavailable for a given date */
  getTeamUnavailability: agentProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({ teamId: teamDayUnavailability.teamId })
        .from(teamDayUnavailability)
        .where(eq(teamDayUnavailability.date, input.date));
      return rows.map(r => r.teamId);
    }),

  /** Mark a team unavailable for a specific date */
  setTeamUnavailable: agentProcedure
    .input(z.object({ teamId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(teamDayUnavailability)
        .values({ teamId: input.teamId, date: input.date })
        .onDuplicateKeyUpdate({ set: { teamId: input.teamId } });
      return { ok: true };
    }),

  /** Mark a team available again for a specific date (removes the unavailability row) */
  setTeamAvailable: agentProcedure
    .input(z.object({ teamId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(teamDayUnavailability)
        .where(and(
          eq(teamDayUnavailability.teamId, input.teamId),
          eq(teamDayUnavailability.date, input.date),
        ));
      return { ok: true };
    }),

  /** Returns set of teamIds that are locked for a given date */
  getTeamLocks: agentProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({ teamId: teamDayLock.teamId })
        .from(teamDayLock)
        .where(eq(teamDayLock.date, input.date));
      return rows.map(r => r.teamId);
    }),

  /** Lock a team for a specific date — optimizer preserves all its assignments */
  lockTeam: agentProcedure
    .input(z.object({ teamId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(teamDayLock)
        .values({ teamId: input.teamId, date: input.date })
        .onDuplicateKeyUpdate({ set: { teamId: input.teamId } });
      return { ok: true };
    }),

  /** Unlock a team for a specific date */
  unlockTeam: agentProcedure
    .input(z.object({ teamId: z.number(), date: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(teamDayLock)
        .where(and(
          eq(teamDayLock.teamId, input.teamId),
          eq(teamDayLock.date, input.date),
        ));
      return { ok: true };
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
