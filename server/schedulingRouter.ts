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
  teamDayConfig,
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
  maxJobs?: number | null;         // per-day job cap (null = no cap)
  earliestStartTime?: string | null; // "HH:MM" earliest first job start
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

  // ── Phase 1: All jobs go to unassigned pool — VRP distributes across all available teams.
  // We no longer lock jobs to their Launch27 teamName so every available team gets work.
  // Jobs with existing serviceDateTime are treated as "locked" in Phase 2 for time ordering.
  const unassigned: number[] = [];
  for (let ji = 0; ji < jobs.length; ji++) {
    unassigned.push(ji);
  }

  // Sort each team's locked jobs chronologically by serviceDateTime
  for (const [, route] of Array.from(routes.entries())) {
    route.sort((a, b) => {
      const ta = jobs[a].serviceDateTime ? new Date(jobs[a].serviceDateTime!).getTime() : 0;
      const tb = jobs[b].serviceDateTime ? new Date(jobs[b].serviceDateTime!).getTime() : 0;
      return ta - tb;
    });
  }

  // ── Phase 2: Insert unassigned jobs into best team by insertion cost ─────────
  // Cost = drive insertion cost + load-balancing penalty.
  // The load penalty discourages piling jobs onto already-heavy teams so that
  // jobs spread more evenly. Fair share = totalJobs / numTeams.
  // Penalty per extra job above fair share = 300 seconds (5 min equivalent).
  const fairShare = (unassigned.length + Array.from(routes.values()).reduce((s, r) => s + r.length, 0)) / teams.length;
  const LOAD_PENALTY_PER_JOB = 300; // seconds — tune this to trade off balance vs drive time
  for (const ji of unassigned) {
    const jobPointIdx = teamOffset + ji;
    let bestTeam = teams[0];
    let bestCost = Infinity;
    for (const t of teams) {
      const route = routes.get(t.id)!;
      const totalHours = route.reduce((s, rji) => s + jobs[rji].durationHours, 0);
      if (totalHours >= t.maxHoursPerDay) continue; // team full (hours)
      if (t.maxJobs != null && route.length >= t.maxJobs) continue; // team full (job cap)
      // Enforce earliest start time: skip this team if the job starts before the team's window
      if (t.earliestStartTime != null) {
        const jobDt = jobs[ji].serviceDateTime; // ISO string or null
        if (jobDt) {
          const jobHHMM = jobDt.slice(11, 16); // "HH:MM" from ISO datetime
          if (jobHHMM < t.earliestStartTime) continue;
        }
      }
      const teamIdx = teams.indexOf(t);
      // Build the full sequence of point indices for this team: [home, job0, job1, ...]
      const seq = [teamIdx, ...route.map(rji => teamOffset + rji)];
      // Try inserting the new job at every position in the sequence
      // Insertion cost at position i = drive(seq[i-1]→new) + drive(new→seq[i]) - drive(seq[i-1]→seq[i])
      let minInsertCost = Infinity;
      if (seq.length === 1) {
        // Empty route — cost is just home→job
        minInsertCost = travelMatrix[teamIdx]?.[jobPointIdx] ?? Infinity;
      } else {
        for (let pos = 1; pos < seq.length; pos++) {
          const prev = seq[pos - 1];
          const next = seq[pos];
          const insertCost =
            (travelMatrix[prev]?.[jobPointIdx] ?? Infinity) +
            (travelMatrix[jobPointIdx]?.[next] ?? Infinity) -
            (travelMatrix[prev]?.[next] ?? 0);
          if (insertCost < minInsertCost) minInsertCost = insertCost;
        }
        // Also try appending at the end
        const last = seq[seq.length - 1];
        const appendCost = travelMatrix[last]?.[jobPointIdx] ?? Infinity;
        if (appendCost < minInsertCost) minInsertCost = appendCost;
      }
      // Add load-balancing penalty: penalise teams that already exceed fair share
      const overload = Math.max(0, route.length - fairShare);
      const totalCost = minInsertCost + overload * LOAD_PENALTY_PER_JOB;
      if (totalCost < bestCost) { bestCost = totalCost; bestTeam = t; }
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

      // Pass 1: home→first pairs based on saved assignment routeOrder=0 (post-optimization view)
      // Group saved assignments by teamId, find the job with routeOrder=0
      const assignedFirstByTeam = new Map<number, number>(); // teamId -> jobId with routeOrder=0
      for (const [jobId, asgn] of Array.from(assignmentMap.entries())) {
        if (asgn.routeOrder === 0 && asgn.teamId && asgn.teamId !== 0 && asgn.isManual !== 2) {
          assignedFirstByTeam.set(asgn.teamId, jobId);
        }
      }
      const seenHomePairs = new Set<number>(); // track which jobIds already have a home pair
      for (const [teamId, firstJobId] of Array.from(assignedFirstByTeam.entries())) {
        const team = teams.find(t => t.id === teamId);
        const firstJob = jobs.find(j => j.id === firstJobId);
        if (team?.homeLat && team?.homeLng && firstJob?.jobAddress) {
          const firstGeo = geoByAddress.get(firstJob.jobAddress.trim().toLowerCase());
          if (firstGeo) {
            pairs.push({ fromId: -(team.id), toId: firstJobId, from: { lat: team.homeLat, lng: team.homeLng }, to: { lat: firstGeo.lat, lng: firstGeo.lng } });
            seenHomePairs.add(firstJobId);
          }
        }
      }

      // Pass 2: home→first pairs based on Launch27 teamName grouping (pre-optimization view)
      for (const [teamName, teamJobs] of Array.from(jobsByTeam)) {
        const team = teamByName.get(teamName);
        // Home → first job (only if not already added from saved assignment)
        const firstJob = teamJobs[0];
        if (firstJob && team?.homeLat && team?.homeLng && !seenHomePairs.has(firstJob.id)) {
          const firstGeo = geoByAddress.get(firstJob.jobAddress?.trim().toLowerCase() ?? "");
          if (firstGeo) {
            pairs.push({ fromId: -(team.id), toId: firstJob.id, from: { lat: team.homeLat, lng: team.homeLng }, to: { lat: firstGeo.lat, lng: firstGeo.lng } });
          }
        }
        // Consecutive job pairs (only for jobs without saved assignments)
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
        // isManual=2 is a sentinel meaning "explicitly unassigned" — treat as no assignment
        const isExplicitlyUnassigned = savedAssignment?.isManual === 2;
        // If no saved assignment yet, synthesize one from the job's own Launch27 teamName
        const syntheticAssignment = !savedAssignment && !isExplicitlyUnassigned && j.teamName && teamByName.has(j.teamName)
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
          assignment: isExplicitlyUnassigned ? null : (savedAssignment ?? syntheticAssignment),
        };
      });

      // Build homeDriveTimeSecs map: teamId -> drive time from home to first job.
      // Use enriched (post-assignment) jobs grouped by assigned teamId so we use the
      // optimizer-assigned team, not the original Launch27 teamName.
      const homeDriveByTeam = new Map<number, number>();
      const enrichedByTeam = new Map<number, typeof enriched>();
      for (const ej of enriched) {
        const tid = ej.assignment?.teamId;
        if (tid == null || tid === 0) continue;
        if (!enrichedByTeam.has(tid)) enrichedByTeam.set(tid, []);
        enrichedByTeam.get(tid)!.push(ej);
      }
      for (const [tid, teamEnriched] of Array.from(enrichedByTeam.entries())) {
        // Sort by routeOrder to find the actual first job
        teamEnriched.sort((a, b) => (a.assignment?.routeOrder ?? 0) - (b.assignment?.routeOrder ?? 0));
        const firstJob = teamEnriched[0];
        if (firstJob) {
          const secs = estimatedDriveMap.get(firstJob.id);
          if (secs !== undefined) {
            homeDriveByTeam.set(tid, secs);
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

      // Load locks before ANY assignment path so both simple and VRP paths respect them
      const _teamLockRows = await db.select({ teamId: teamDayLock.teamId })
        .from(teamDayLock)
        .where(eq(teamDayLock.date, input.date));
      const _lockedTeamIds = new Set(_teamLockRows.map(r => r.teamId));
      const _existingForLockedTeams = _lockedTeamIds.size > 0
        ? await db.select().from(scheduleAssignments)
            .where(and(
              eq(scheduleAssignments.jobDate, input.date),
              inArray(scheduleAssignments.teamId, Array.from(_lockedTeamIds)),
            ))
        : [];
      const _lockedTeamJobIdSet = new Set(_existingForLockedTeams.map(e => e.cleanerJobId));
      const _jobLockRows = await db.select().from(scheduleJobLocks)
        .where(eq(scheduleJobLocks.date, input.date));
      // _jobLockRows contains cleanerId (= teamId at lock time) and lockedPosition
      // We do NOT query schedule_assignments for locked jobs — the assignment may have been
      // moved by a previous optimize run. Instead we use cleanerId from the lock row directly.
      const _allLockedJobIds = new Set([
        ...Array.from(_lockedTeamJobIdSet),
        ..._jobLockRows.map(l => l.jobId),
      ]);

      // 3b. Load per-team daily config (max jobs + earliest start time)
      const _dayConfigRows = await db.select().from(teamDayConfig).where(eq(teamDayConfig.date, input.date));
      const _dayConfigMap = new Map(_dayConfigRows.map(r => [r.teamId, r]));

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
          maxJobs: _dayConfigMap.get(t.id)?.maxJobs ?? null,
          earliestStartTime: _dayConfigMap.get(t.id)?.earliestStartTime ?? null,
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
        const _simpleToSave = simpleAssignments.filter(a => !_allLockedJobIds.has(a.cleanerJobId));
        await persistAssignments(db, input.date, _simpleToSave);
        for (const _ea of _existingForLockedTeams) {
          await persistAssignments(db, input.date, [{
            cleanerJobId: _ea.cleanerJobId, teamId: _ea.teamId, teamName: _ea.teamName ?? "",
            routeOrder: _ea.routeOrder, estimatedArrivalMs: _ea.estimatedArrivalMs ?? Date.now(),
            estimatedDepartureMs: _ea.estimatedDepartureMs ?? Date.now(), driveTimeSecs: _ea.driveTimeSecs ?? 0,
          }]);
        }
        for (const _lockRow of _jobLockRows) {
          if (_lockedTeamJobIdSet.has(_lockRow.jobId)) continue;
          const _lockedTeam = teams.find(t => t.id === _lockRow.cleanerId);
          await persistAssignments(db, input.date, [{
            cleanerJobId: _lockRow.jobId, teamId: _lockRow.cleanerId, teamName: _lockedTeam?.name ?? "",
            routeOrder: _lockRow.lockedPosition, estimatedArrivalMs: Date.now(),
            estimatedDepartureMs: Date.now(), driveTimeSecs: 0,
          }]);
        }
        return { assigned: simpleAssignments.length, message: `Assigned ${simpleAssignments.length} jobs (no home addresses set — add team home addresses for route optimization).` };
      }

      const allPoints: LatLng[] = [
        ...teamConfigs.map(t => ({ lat: t.homeLat, lng: t.homeLng })),
        ...geocoded.map(j => ({ lat: j.lat, lng: j.lng })),
      ];

      // 5. Build travel matrix
      const travelMatrix = await buildTravelMatrix(allPoints);

       // 6a/6b. Locks already loaded above — alias for clarity
      const lockedTeamIds = _lockedTeamIds;
      const existingForLockedTeams = _existingForLockedTeams;
      const lockedTeamJobIdSet = _lockedTeamJobIdSet;
      const lockedJobIdSet = _allLockedJobIds;

      // Filter out all locked jobs from VRP input so solver doesn't touch them
      const vrpGeocodedJobs = geocoded.filter(j => !lockedJobIdSet.has(j.cleanerJobId));
      // Exclude locked teams from VRP so solver cannot assign new jobs to them
      const vrpTeamConfigs = teamConfigs.filter(t => !lockedTeamIds.has(t.id));
      // Rebuild allPoints and travelMatrix for the filtered job set
      const vrpAllPoints: LatLng[] = [
        ...vrpTeamConfigs.map(t => ({ lat: t.homeLat, lng: t.homeLng })),
        ...vrpGeocodedJobs.map(j => ({ lat: j.lat, lng: j.lng })),
      ];
      const vrpTravelMatrix = vrpGeocodedJobs.length > 0
        ? await buildTravelMatrix(vrpAllPoints)
        : travelMatrix;
      // 6c. Solve VRP (only for unlocked jobs on unlocked teams)
      const assignments = vrpGeocodedJobs.length > 0
        ? solveVRP(vrpGeocodedJobs, vrpTeamConfigs, vrpTravelMatrix, vrpAllPoints, vrpTeamConfigs.length)
        : [];
      // Re-add locked-team assignments as-is (they are preserved verbatim)
      for (const ea of existingForLockedTeams) {
        assignments.push({
          cleanerJobId: ea.cleanerJobId,
          teamId: ea.teamId,
          teamName: ea.teamName ?? "",
          routeOrder: ea.routeOrder,
          estimatedArrivalMs: ea.estimatedArrivalMs ?? Date.now(),
          estimatedDepartureMs: ea.estimatedDepartureMs ?? Date.now(),
          driveTimeSecs: ea.driveTimeSecs ?? 0,
        });
      }
      // Re-add individually job-locked assignments using the team from the lock row (cleanerId).
      // Do NOT use schedule_assignments — it may reflect a previous bad optimize run.
      for (const lockRow of _jobLockRows) {
        // Skip if already covered by a team-level lock (avoid duplicates)
        if (lockedTeamJobIdSet.has(lockRow.jobId)) continue;
        const lockedTeam = teams.find(t => t.id === lockRow.cleanerId);
        assignments.push({
          cleanerJobId: lockRow.jobId,
          teamId: lockRow.cleanerId,
          teamName: lockedTeam?.name ?? "",
          routeOrder: lockRow.lockedPosition,
          estimatedArrivalMs: Date.now(),
          estimatedDepartureMs: Date.now(),
          driveTimeSecs: 0,
        });
      }
      // 7. Preserve manual overrides
      const existingManual = await db.select().from(scheduleAssignments)
        .where(and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(scheduleAssignments.isManual, 1),
        ));
      const manualJobIds = new Set(existingManual.map(m => m.cleanerJobId));
      // Mark locked-team AND job-locked assignments as manual so they survive the persist step
      for (const ea of existingForLockedTeams) {
        manualJobIds.add(ea.cleanerJobId);
      }
      for (const lockRow of _jobLockRows) {
        manualJobIds.add(lockRow.jobId);
      }
      // 7b. Job-locked jobs were excluded from VRP entirely and restored verbatim above.
      // Their routeOrder from the existing assignment is already correct — no re-ordering needed.

      // 8. Persist (replace non-manual assignments)
      // Also exclude ALL locked jobs (team-locked + job-locked) from the persist step.
      // Their existing DB rows must not be touched — they were already restored verbatim above.
      const toSave = assignments.filter(a =>
        !manualJobIds.has(a.cleanerJobId) && !lockedJobIdSet.has(a.cleanerJobId)
      );
      await persistAssignments(db, input.date, toSave);

      return { assigned: assignments.length, message: `Optimized ${assignments.length} jobs across ${teamConfigs.length} teams.` };
    }),

  // ── Manual override ─────────────────────────────────────────────────────────

  unassignJob: agentProcedure
    .input(z.object({ date: z.string(), cleanerJobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Insert sentinel row (isManual=2, teamId=0) to explicitly mark as unassigned.
      // This prevents getSchedule from synthesizing an assignment from job.teamName.
      await db.insert(scheduleAssignments)
        .values({
          jobDate: input.date,
          cleanerJobId: input.cleanerJobId,
          teamId: 0,
          teamName: null,
          routeOrder: 0,
          isManual: 2, // sentinel: explicitly unassigned
          estimatedArrivalMs: null,
          estimatedDepartureMs: null,
          driveTimeSecs: null,
        })
        .onDuplicateKeyUpdate({
          set: { teamId: 0, teamName: null, isManual: 2, routeOrder: 0,
                 estimatedArrivalMs: null, estimatedDepartureMs: null, driveTimeSecs: null,
                 updatedAt: new Date() },
        });
      // Also remove any job-level lock for this job on this date
      await db.delete(scheduleJobLocks)
        .where(and(
          eq(scheduleJobLocks.date, input.date),
          eq(scheduleJobLocks.jobId, input.cleanerJobId),
        ));
      return { ok: true };
    }),

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
      // Delete ALL assignments for this date (regardless of lock/manual status)
      await db.delete(scheduleAssignments)
        .where(eq(scheduleAssignments.jobDate, input.date));
      // Clear all job-level locks for this date
      await db.delete(scheduleJobLocks)
        .where(eq(scheduleJobLocks.date, input.date));
      // Clear all team-day locks for this date
      await db.delete(teamDayLock)
        .where(eq(teamDayLock.date, input.date));
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

  // ── Per-team daily config (max jobs + earliest start time) ────────────────
  getTeamDayConfigs: agentProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(teamDayConfig).where(eq(teamDayConfig.date, input.date));
    }),

  setTeamDayConfig: agentProcedure
    .input(z.object({
      teamId: z.number(),
      date: z.string(),
      maxJobs: z.number().nullable(),
      earliestStartTime: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.maxJobs === null && input.earliestStartTime === null) {
        await db.delete(teamDayConfig)
          .where(and(eq(teamDayConfig.teamId, input.teamId), eq(teamDayConfig.date, input.date)));
        return { ok: true };
      }
      await db.insert(teamDayConfig)
        .values({
          teamId: input.teamId,
          date: input.date,
          maxJobs: input.maxJobs ?? undefined,
          earliestStartTime: input.earliestStartTime ?? undefined,
        })
        .onDuplicateKeyUpdate({
          set: {
            maxJobs: input.maxJobs ?? undefined,
            earliestStartTime: input.earliestStartTime ?? undefined,
          },
        });
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
