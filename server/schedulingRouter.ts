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
  minJobs?: number | null;         // per-day job floor (null = no floor)
  maxJobs?: number | null;         // per-day job cap (null = no cap)
  earliestStartTime?: string | null; // "HH:MM" earliest first job start
  lockedJobCount?: number;          // jobs already locked to this team (excluded from VRP pool)
  avgRating?: number | null;        // all-time average customer rating (1-5)
  regionTags?: string[] | null;     // DC/MD/VA region tags for first-job preference
}

// ── Region helpers ────────────────────────────────────────────────────────────

/**
 * Infer DC/MD/VA region tags from an address string.
 * Looks for state abbreviations or city names in the address.
 * Returns an array of matching region codes (e.g. ["DC", "MD"]).
 */
function inferRegionFromAddress(address: string | null | undefined): string[] {
  if (!address) return [];
  const a = address.toUpperCase();
  const tags: string[] = [];
  // DC: ", DC" or "WASHINGTON DC" or "WASHINGTON, DC"
  if (/,\s*DC\b/.test(a) || /WASHINGTON[,\s]+DC/.test(a) || /\bDC\b/.test(a)) tags.push("DC");
  // MD: ", MD" or state name Maryland
  if (/,\s*MD\b/.test(a) || /\bMARYLAND\b/.test(a)) tags.push("MD");
  // VA: ", VA" or state name Virginia (but not West Virginia)
  if (/,\s*VA\b/.test(a) || (/\bVIRGINIA\b/.test(a) && !/WEST\s+VIRGINIA/.test(a))) tags.push("VA");
  return tags;
}

/**
 * Infer DC/MD/VA region from a job address string.
 * Returns the single best-match region code or null.
 */
function inferJobRegion(address: string | null | undefined): string | null {
  const tags = inferRegionFromAddress(address);
  return tags[0] ?? null;
}

interface Assignment {
  cleanerJobId: number;
  teamId: number;
  teamName: string;
  routeOrder: number;
  estimatedArrivalMs: number;
  estimatedDepartureMs: number;
  driveTimeSecs: number;
  rationale?: AssignmentRationale;
}

interface AssignmentRationale {
  /** Drive/insertion cost in seconds */
  driveCostSecs: number;
  /** Rating bonus applied (positive = bonus for high rating) in seconds equivalent */
  ratingBonus: number;
  /** Team avg rating at time of assignment */
  teamAvgRating: number | null;
  /** Load balance penalty in seconds equivalent */
  loadPenaltySecs: number;
  /** Floor bonus applied (large value if team was below minJobs) */
  floorBonus: number;
  /** Whether this job was locked (existing assignment preserved) */
  wasLocked: boolean;
  /** Home-return bonus applied (seconds equivalent) */
  homeReturnBonus?: number;
  /** Human-readable summary */
  summary: string;
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
                console.log(`[EL] [${oi+ri}][${di+ci}] = ${el.duration.value}s (${points[oi+ri].lat.toFixed(4)},${points[oi+ri].lng.toFixed(4)}) -> (${points[di+ci].lat.toFixed(4)},${points[di+ci].lng.toFixed(4)})`);
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
  // Priority rule: home proximity is the primary factor.
  //   - For an empty route: cost = home→job (pure home distance).
  //   - For a non-empty route: cost = current_tail→job (chain from last assigned job).
  // To enforce home-proximity-first we sort jobs by their minimum home→job distance
  // across all teams BEFORE the greedy loop runs. This guarantees each team claims
  // its closest job first, then chains subsequent jobs from that position.
  const fairShare = (unassigned.length + Array.from(routes.values()).reduce((s, r) => s + r.length, 0)) / teams.length;
  const LOAD_PENALTY_PER_JOB = 600; // seconds — raised from 300 to 600 to discourage overloading one team
  // Floor bonus: encourages teams to hit their minJobs target but must NOT override
  // a large geographic disadvantage. A 15-minute drive penalty = ~900s. We cap the
  // floor bonus at ~1200s per job (20 min equivalent) so geography always wins when
  // the distance difference is significant.
  const FLOOR_BONUS_PER_JOB = 1_200; // seconds — strong preference but geography dominates

  // ── Pre-seed pass: guarantee every team hits its minJobs floor before extras are assigned ──
  // For each team that has fewer jobs than its minJobs minimum, assign its single closest
  // available job (home→job distance). This runs repeatedly until no team is below floor
  // or no jobs remain. Only after every team has its minimum do we proceed to the main loop.
  const jobRationale = new Map<number, AssignmentRationale>();
  {
    let progress = true;
    while (progress && unassigned.length > 0) {
      progress = false;
      for (const t of teams) {
        const route = routes.get(t.id)!;
        const locked = t.lockedJobCount ?? 0;
        const totalJobCount = locked + route.length;
        if (t.minJobs == null || totalJobCount >= t.minJobs) continue;
        // This team is below its floor — find its closest available job
        const teamIdx = teams.indexOf(t);
        let bestJi = -1;
        let bestDist = Infinity;
        for (const ji of unassigned) {
          // Respect maxJobs hard cap
          if (t.maxJobs != null && totalJobCount >= t.maxJobs) break;
          // Respect hours cap
          const totalHours = route.reduce((s, rji) => s + jobs[rji].durationHours, 0);
          if (totalHours >= t.maxHoursPerDay) break;
          // Respect earliest start time
          if (t.earliestStartTime != null) {
            const jobDt = jobs[ji].serviceDateTime;
            if (jobDt && jobDt.slice(11, 16) < t.earliestStartTime) continue;
          }
          const dist = route.length === 0
            ? (travelMatrix[teamIdx]?.[teamOffset + ji] ?? Infinity)
            : (travelMatrix[teamOffset + route[route.length - 1]]?.[teamOffset + ji] ?? Infinity);
          if (dist < bestDist) { bestDist = dist; bestJi = ji; }
        }
        if (bestJi === -1) continue;
        // Assign this job to the team
        unassigned.splice(unassigned.indexOf(bestJi), 1);
        route.push(bestJi);
        jobRationale.set(bestJi, {
          driveCostSecs: Math.round(bestDist),
          ratingBonus: 0,
          teamAvgRating: t.avgRating ?? null,
          loadPenaltySecs: 0,
          floorBonus: 0,
          wasLocked: false,
          summary: `Assigned to meet team minimum (${Math.round(bestDist / 60)} min drive)`,
        });
        progress = true;
      }
    }
  }

  // Sort remaining unassigned jobs so that jobs closest to ANY team's home are processed first.
  // This prevents a team that already has a distant job from "stealing" a nearby job
  // via low insertion cost before the geographically correct team gets a chance.
  unassigned.sort((a, b) => {
    const minHomeA = Math.min(...teams.map(t => travelMatrix[teams.indexOf(t)]?.[teamOffset + a] ?? Infinity));
    const minHomeB = Math.min(...teams.map(t => travelMatrix[teams.indexOf(t)]?.[teamOffset + b] ?? Infinity));
    return minHomeA - minHomeB;
  });

  for (const ji of unassigned) {
    const jobPointIdx = teamOffset + ji;
    let bestTeam: TeamConfig | null = null;
    let bestCost = Infinity;
    // First pass: respect maxJobs hard cap
    // totalJobCount = locked jobs already on this team + jobs assigned so far by VRP
    for (const t of teams) {
      const route = routes.get(t.id)!;
      const locked = t.lockedJobCount ?? 0;
      const totalJobCount = locked + route.length; // total jobs this team will have
      const totalHours = route.reduce((s, rji) => s + jobs[rji].durationHours, 0);
      if (totalHours >= t.maxHoursPerDay) continue; // team full (hours)
      if (t.maxJobs != null && totalJobCount >= t.maxJobs) continue; // team full (job cap — hard limit vs total)
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
      // Cost:
      // - Empty route: home→job (home proximity is the dominant signal for first job)
      // - Non-empty route: tail→job (chain from last assigned job — closest to current position)
      // The sort above ensures jobs closest to home are processed first, so each team
      // claims its geographically nearest job before any chaining can steal it.
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
      const overload = Math.max(0, totalJobCount - fairShare);
      // Strong bonus for teams below their minJobs floor — compare against total job count
      const floorBonus = (t.minJobs != null && totalJobCount < t.minJobs)
        ? (t.minJobs - totalJobCount) * FLOOR_BONUS_PER_JOB
        : 0;
      // Secondary rating bonus: higher-rated teams get a small cost reduction.
      // Scale: each star above 3.0 = 60s cost reduction (max ~120s for 5-star vs 3-star).
      // This only breaks ties — route geometry still dominates.
      const RATING_BONUS_PER_STAR = 60; // seconds per star above baseline
      const ratingBonus = t.avgRating != null
        ? (t.avgRating - 3.0) * RATING_BONUS_PER_STAR
        : 0;
      // Tertiary home-return bonus: if this job is appended last AND the team has a home,
      // reward jobs that reduce the end-of-day drive back home.
      // Weight = 12% of the home-return drive saved — small enough to never override
      // cluster fit or route geometry, but meaningful as a final tiebreaker.
      const HOME_RETURN_WEIGHT = 0.12;
      let homeReturnBonus = 0;
      if (t.homeLat != null && t.homeLng != null) {
        const teamHomeIdx = teams.indexOf(t); // home is at teamIdx in travelMatrix
        const last = seq[seq.length - 1];
        // Current cost of last job → home (without the new job)
        const currentLastToHome = travelMatrix[last]?.[teamHomeIdx] ?? 0;
        // Cost if new job is appended last: last→new + new→home
        const newLastToHome = (travelMatrix[last]?.[jobPointIdx] ?? Infinity)
          + (travelMatrix[jobPointIdx]?.[teamHomeIdx] ?? 0);
        // Bonus = how much the home-return leg is reduced by placing this job last
        const homeReturnSaving = currentLastToHome - newLastToHome;
        homeReturnBonus = homeReturnSaving * HOME_RETURN_WEIGHT;
      }
      // Same-slot stacking penalty: discourage assigning two jobs at the same hour to one team.
      // A cleaner can only be in one place — if a team already has a job at the same hour,
      // add a 900s (15 min equivalent) penalty to prefer spreading across time slots.
      // Uses the "HH" portion of serviceDateTime (ISO string) for comparison.
      const SAME_SLOT_PENALTY = 900; // seconds — optimizer accepts up to 15 min extra drive to avoid same-slot stacking
      const jobHour = jobs[ji].serviceDateTime?.slice(11, 13) ?? null;
      const sameSlotCount = jobHour
        ? route.filter(rji => jobs[rji].serviceDateTime?.slice(11, 13) === jobHour).length
        : 0;
      const sameSlotPenalty = sameSlotCount * SAME_SLOT_PENALTY;
      // Region match bonus (first job only): if this is the team's first job AND the team has
      // region tags AND the job's address matches one of those tags, apply a strong bonus.
      // Weight: 1200s (20 min equivalent) — strong preference but a 20+ min drive advantage
      // for a mismatched team still wins. Only applied to the first job (empty route).
      // For jobs 2+, region is irrelevant — distance chaining dominates.
      const REGION_MATCH_BONUS = 1_200; // seconds — strong but overridable by distance
      let regionBonus = 0;
      if (seq.length === 1 && t.regionTags && t.regionTags.length > 0) {
        // First job for this team — check if job region matches team tags
        const jobRegion = inferJobRegion(jobs[ji].address);
        if (jobRegion && t.regionTags.includes(jobRegion)) {
          regionBonus = REGION_MATCH_BONUS;
        }
      }
      const totalCost = minInsertCost + overload * LOAD_PENALTY_PER_JOB + sameSlotPenalty - floorBonus - ratingBonus - homeReturnBonus - regionBonus;
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestTeam = t;
        // Record rationale for this candidate (will be overwritten if a better team is found)
        const overloadSecs = overload * LOAD_PENALTY_PER_JOB;
        const ratingStr = t.avgRating != null ? t.avgRating.toFixed(1) : null;
        const driveMins = Math.round(minInsertCost / 60);
        let summary = `Best route fit (${driveMins} min drive cost)`;
        if (ratingStr) summary += `, team rated ${ratingStr}⭐`;
        if (floorBonus > 0) summary += `, team needs more jobs`;
        if (overloadSecs > 0) summary += `, load-balanced`;
        if (sameSlotPenalty > 0) summary += `, spread across time slots`;
        if (homeReturnBonus > 0) summary += `, on the way home`;
        if (regionBonus > 0) summary += `, region match (${inferJobRegion(jobs[ji].address)})`;
        jobRationale.set(ji, {
          driveCostSecs: minInsertCost,
          ratingBonus: Math.round(ratingBonus),
          teamAvgRating: t.avgRating ?? null,
          loadPenaltySecs: Math.round(overloadSecs),
          floorBonus: Math.round(floorBonus),
          wasLocked: false,
          homeReturnBonus: Math.round(homeReturnBonus),
          summary,
        });
      }
    }
    // If all teams are at maxJobs or maxHours, fall back to least-loaded team (ignore cap)
    if (!bestTeam) {
      let fallbackBest = teams[0];
      let fallbackMin = Infinity;
      for (const t of teams) {
        const route = routes.get(t.id)!;
        if (route.length < fallbackMin) { fallbackMin = route.length; fallbackBest = t; }
      }
      bestTeam = fallbackBest;
      jobRationale.set(ji, {
        driveCostSecs: 0,
        ratingBonus: 0,
        teamAvgRating: bestTeam.avgRating ?? null,
        loadPenaltySecs: 0,
        floorBonus: 0,
        wasLocked: false,
        summary: 'Fallback assignment — all teams at capacity',
      });
    }
    routes.get(bestTeam.id)!.push(ji);
  }

  // ── Build Assignment objects ─────────────────────────────────────────────────
  const BUFFER_MS = 15 * 60 * 1000; // 15 min buffer between jobs
  const assignments: Assignment[] = [];

  for (const [teamId, route] of Array.from(routes.entries())) {
    const team = teams.find(t => t.id === teamId)!;
    const teamIdx = teams.findIndex(t => t.id === teamId);

    // Separate time-ordered jobs (have a real serviceDateTime for display) from VRP-placed jobs.
    // Use jobRationale.has(ji) to detect VRP-placed jobs — ALL jobs from Launch27 have both
    // serviceDateTime and teamName, so the old teamName check incorrectly marked every job as
    // "locked" (Existing Launch27 assignment). VRP-placed jobs always have a rationale entry.
    const inserted = route.filter(ji => jobRationale.has(ji));
    const locked = route.filter(ji => !jobRationale.has(ji) && !!jobs[ji].serviceDateTime);

    // Merge ALL jobs (locked + inserted) and sort the combined list chronologically.
    // Jobs with a serviceDateTime come first in time order; jobs without a time go last.
    // This ensures the final routeOrder reflects actual appointment times (8:30 → 2:30 → 4:30)
    // regardless of the order the VRP inserted them.
    const allRouteJobs = [...locked, ...inserted];
    allRouteJobs.sort((a, b) => {
      const ta = jobs[a].serviceDateTime ? new Date(jobs[a].serviceDateTime!).getTime() : Infinity;
      const tb = jobs[b].serviceDateTime ? new Date(jobs[b].serviceDateTime!).getTime() : Infinity;
      return ta - tb;
    });

    // Emit all jobs in chronological order
    let currentMs = 0;
    allRouteJobs.forEach((ji, order) => {
      const job = jobs[ji];
      const isLockedJob = !jobRationale.has(ji);

      let startMs: number;
      if (job.serviceDateTime) {
        startMs = new Date(job.serviceDateTime).getTime();
      } else {
        startMs = currentMs > 0 ? currentMs : Date.now();
      }
      const endMs = startMs + job.durationHours * 3600000;
      currentMs = endMs + BUFFER_MS;

      const prevIdx = order === 0 ? teamIdx : teamOffset + allRouteJobs[order - 1];
      const driveSecs = travelMatrix[prevIdx]?.[teamOffset + ji] ?? 0;

      const rationale: AssignmentRationale | undefined = isLockedJob
        ? {
            driveCostSecs: driveSecs,
            ratingBonus: 0,
            teamAvgRating: team.avgRating ?? null,
            loadPenaltySecs: 0,
            floorBonus: 0,
            wasLocked: true,
            summary: `Existing Launch27 assignment to ${team.name} — preserved`,
          }
        : jobRationale.get(ji);

      assignments.push({
        cleanerJobId: job.cleanerJobId,
        teamId,
        teamName: team.name,
        routeOrder: order,
        estimatedArrivalMs: startMs,
        estimatedDepartureMs: endMs,
        driveTimeSecs: driveSecs,
        rationale,
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
      /** Comma-separated region tags, e.g. "DC,MD". Pass null to clear. Omit to auto-infer from homeAddress. */
      regionTags: z.string().nullable().optional(),
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

      // Determine regionTags:
      // - If explicitly provided (including empty string), use that value
      // - If omitted and homeAddress is provided, auto-infer from the address
      // - Otherwise leave unchanged (update) or null (insert)
      let regionTagsValue: string | null | undefined = undefined;
      if (input.regionTags !== undefined) {
        // Explicit override — normalize to null if empty
        regionTagsValue = input.regionTags?.trim() || null;
      } else if (input.homeAddress) {
        // Auto-infer from address
        const inferred = inferRegionFromAddress(input.homeAddress);
        regionTagsValue = inferred.length > 0 ? inferred.join(",") : null;
      }

      if (input.id) {
        const updatePayload: Record<string, unknown> = {
          name: input.name, homeAddress: input.homeAddress, homeLat, homeLng,
          maxHoursPerDay: input.maxHoursPerDay, skills: input.skills,
          color: input.color, isActive: input.isActive ?? 1,
        };
        if (regionTagsValue !== undefined) updatePayload.regionTags = regionTagsValue;
        await db.update(schedulingTeams).set(updatePayload as any).where(eq(schedulingTeams.id, input.id));
        return { id: input.id };
      } else {
        const [result] = await db.insert(schedulingTeams).values({
          name: input.name, homeAddress: input.homeAddress, homeLat, homeLng,
          maxHoursPerDay: input.maxHoursPerDay, skills: input.skills,
          color: input.color ?? "#6366f1", isActive: 1,
          regionTags: regionTagsValue ?? null,
        });
        return { id: (result as any).insertId };
      }
    }),

  setTeamTag: agentProcedure
    .input(z.object({
      teamId: z.number(),
      tag: z.string().max(20).nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(schedulingTeams)
        .set({ tag: input.tag } as any)
        .where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
    }),

  setTeamRegionTags: agentProcedure
    .input(z.object({
      teamId: z.number(),
      /** Comma-separated region tags, e.g. "DC,MD". Pass null to clear. */
      regionTags: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(schedulingTeams)
        .set({ regionTags: input.regionTags?.trim() || null })
        .where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
    }),

  setTeamLimits: agentProcedure
    .input(z.object({
      teamId: z.number(),
      minJobs: z.number().nullable(),
      maxJobs: z.number().nullable(),
      earliestStartTime: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Use sql`NULL` for explicit null values so Drizzle doesn't skip them
      await db.update(schedulingTeams)
        .set({
          minJobs: input.minJobs,
          maxJobs: input.maxJobs,
          earliestStartTime: input.earliestStartTime,
        })
        .where(eq(schedulingTeams.id, input.teamId));
      return { ok: true };
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
      // Skip jobs that are explicitly unassigned (isManual=2) — they are hidden from the UI
      // and must not participate in the consecutive drive time chain.
      const jobsByTeam = new Map<string, typeof jobs>();
      for (const j of jobs) {
        if (!j.teamName) continue;
        const asgn = assignmentMap.get(j.id);
        if (asgn?.isManual === 2) continue; // explicitly unassigned — skip
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
        // Consecutive job pairs — always include ALL pairs so drive times are always live
        for (let i = 1; i < teamJobs.length; i++) {
          const prev = teamJobs[i - 1];
          const curr = teamJobs[i];
          const prevGeo = geoByAddress.get(prev.jobAddress?.trim().toLowerCase() ?? "");
          const currGeo = geoByAddress.get(curr.jobAddress?.trim().toLowerCase() ?? "");
          if (prevGeo && currGeo) {
            pairs.push({ fromId: prev.id, toId: curr.id, from: { lat: prevGeo.lat, lng: prevGeo.lng }, to: { lat: currGeo.lat, lng: currGeo.lng } });
          }
        }
      }

      // Fetch real drive times using a true N×N Distance Matrix.
      // Deduplicate all unique coordinates into one array, build the full matrix once
      // via buildTravelMatrix(), then look up each pair by index — no diagonal trick.
      const estimatedDriveMap = new Map<number, number>();
      if (pairs.length > 0) {
        const coordKey = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
        const uniquePoints: LatLng[] = [];
        const pointIndex = new Map<string, number>();
        for (const pair of pairs) {
          for (const pt of [pair.from, pair.to]) {
            const key = coordKey(pt);
            if (!pointIndex.has(key)) {
              pointIndex.set(key, uniquePoints.length);
              uniquePoints.push(pt);
            }
          }
        }
        uniquePoints.forEach((pt, i) => console.log(`[PT] idx=${i} lat=${pt.lat.toFixed(6)} lng=${pt.lng.toFixed(6)}`));
        pairs.forEach(p => console.log(`[PAIR] fromId=${p.fromId} toId=${p.toId} from=${p.from.lat.toFixed(6)},${p.from.lng.toFixed(6)} to=${p.to.lat.toFixed(6)},${p.to.lng.toFixed(6)}`));
        const matrix = await buildTravelMatrix(uniquePoints);
        for (const pair of pairs) {
          const fromIdx = pointIndex.get(coordKey(pair.from))!;
          const toIdx = pointIndex.get(coordKey(pair.to))!;
          const secs = matrix[fromIdx]?.[toIdx];
          estimatedDriveMap.set(
            pair.toId,
            secs != null && secs > 0 ? secs : Math.round(haversineMeters(pair.from, pair.to) / 10),
          );
        }
      }

      // Build a helper to detect job type badges from the job's fields
      const enriched = jobs.map(j => {
        const savedAssignment = assignmentMap.get(j.id);
        // isManual=2 is a sentinel meaning "explicitly unassigned" — treat as no assignment
        const isExplicitlyUnassigned = savedAssignment?.isManual === 2;
        // Parse rationale JSON from saved assignment
        let parsedRationale: AssignmentRationale | null = null;
        if (savedAssignment?.rationale) {
          try { parsedRationale = JSON.parse(savedAssignment.rationale); } catch { /* ignore */ }
        }
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
              rationale: null as AssignmentRationale | null,
            }
          : null;
        // Always use the freshly-computed drive time from the live N×N matrix,
        // overriding whatever stale value was stored in schedule_assignments.
        const freshDriveSecs = estimatedDriveMap.get(j.id) ?? null;
        const savedWithFreshDrive = savedAssignment && freshDriveSecs != null
          ? { ...savedAssignment, driveTimeSecs: freshDriveSecs }
          : savedAssignment;
        const baseAssignment = isExplicitlyUnassigned ? null : (savedWithFreshDrive ?? syntheticAssignment);
        // Compute badge flags
        const isNewClient = j.bookingStatus === "new";
        const isMoveInOut = /move.?in|move.?out/i.test(j.serviceType ?? "");
        const isRecurring = !!j.frequency && !/one.?time/i.test(j.frequency);
        return {
          ...j,
          isNewClient,
          isMoveInOut,
          isRecurring,
          assignment: baseAssignment ? { ...baseAssignment, rationale: parsedRationale } : null,
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
      // Compute all-time average customer rating per team (by teamName on cleanerJobs)
      const ratingRows = await db
        .select({
          teamName: cleanerJobs.teamName,
          avgRating: sql<number>`AVG(${cleanerJobs.customerRating})`,
          ratingCount: sql<number>`COUNT(${cleanerJobs.customerRating})`,
        })
        .from(cleanerJobs)
        .where(sql`${cleanerJobs.customerRating} IS NOT NULL AND ${cleanerJobs.teamName} IS NOT NULL`)
        .groupBy(cleanerJobs.teamName);
      const ratingByTeamName = new Map(ratingRows.map(r => [r.teamName, { avgRating: Number(r.avgRating), ratingCount: Number(r.ratingCount) }]));

      const teamsWithHomeDrive = teams.map(t => ({
        ...t,
        homeDriveTimeSecs: homeDriveByTeam.get(t.id) ?? null,
        avgRating: ratingByTeamName.get(t.name)?.avgRating ?? null,
        ratingCount: ratingByTeamName.get(t.name)?.ratingCount ?? 0,
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
      const _existingForLockedTeamsRaw = _lockedTeamIds.size > 0
        ? await db.select().from(scheduleAssignments)
            .where(and(
              eq(scheduleAssignments.jobDate, input.date),
              inArray(scheduleAssignments.teamId, Array.from(_lockedTeamIds)),
            ))
        : [];
      // Exclude isManual=2 sentinel rows (explicitly unassigned jobs) — they must not be
      // treated as locked-team jobs or the VRP will skip them and they'll vanish.
      const _existingForLockedTeamsSaved = _existingForLockedTeamsRaw.filter(e => e.isManual !== 2);
      const _savedLockedJobIds = new Set(_existingForLockedTeamsSaved.map(e => e.cleanerJobId));

      // Synthetic fallback: if a locked team has NO saved assignment rows yet (e.g. locked before
      // first optimize), synthesize assignments from the job's own Launch27 teamName field so the
      // team's jobs are preserved and excluded from the VRP.
      const _syntheticForLockedTeams: typeof _existingForLockedTeamsSaved = [];
      for (const lockedTeamId of Array.from(_lockedTeamIds)) {
        const lockedTeam = allTeams.find(t => t.id === lockedTeamId);
        if (!lockedTeam) continue;
        // Check if this team already has saved rows
        const hasSaved = _existingForLockedTeamsSaved.some(e => e.teamId === lockedTeamId);
        if (hasSaved) continue;
        // Fall back to jobs whose teamName matches this team's name
        const syntheticJobs = activeJobs.filter(j => j.teamName === lockedTeam.name);
        syntheticJobs.forEach((j, idx) => {
          _syntheticForLockedTeams.push({
            id: 0,
            jobDate: input.date,
            cleanerJobId: j.id,
            teamId: lockedTeamId,
            teamName: lockedTeam.name,
            routeOrder: idx,
            estimatedArrivalMs: j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : null,
            estimatedDepartureMs: j.serviceDateTime ? new Date(j.serviceDateTime).getTime() + 2 * 3600000 : null,
            driveTimeSecs: 0,
            isManual: 0,
            totalDistanceMeters: null,
            rationale: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        });
      }

      const _existingForLockedTeams = [..._existingForLockedTeamsSaved, ..._syntheticForLockedTeams];
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
      // Fetch all-time avg ratings per team name for the rating bonus in VRP
      const _ratingRows = await db
        .select({
          teamName: cleanerJobs.teamName,
          avgRating: sql<number>`AVG(${cleanerJobs.customerRating})`,
        })
        .from(cleanerJobs)
        .where(sql`${cleanerJobs.customerRating} IS NOT NULL AND ${cleanerJobs.teamName} IS NOT NULL`)
        .groupBy(cleanerJobs.teamName);
      const _ratingByTeamName = new Map(_ratingRows.map(r => [r.teamName, Number(r.avgRating)]));

      const teamConfigs: TeamConfig[] = teams
        .filter(t => t.homeLat != null && t.homeLng != null)
        .map(t => ({
          id: t.id,
          name: t.name,
          homeLat: t.homeLat!,
          homeLng: t.homeLng!,
          maxHoursPerDay: t.maxHoursPerDay ?? 8,
          color: t.color ?? "#6366f1",
          minJobs: t.minJobs ?? null,
          maxJobs: t.maxJobs ?? null,
          earliestStartTime: t.earliestStartTime ?? null,
          avgRating: _ratingByTeamName.get(t.name) ?? null,
          // Parse stored regionTags (comma-separated) or auto-infer from homeAddress
          regionTags: t.regionTags
            ? t.regionTags.split(",").map(s => s.trim()).filter(Boolean)
            : inferRegionFromAddress(t.homeAddress),
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
      // Compute how many jobs are already locked to each team so maxJobs/minJobs
      // are enforced against the TOTAL (locked + newly assigned), not just new ones.
      const lockedCountByTeam = new Map<number, number>();
      for (const ea of existingForLockedTeams) {
        lockedCountByTeam.set(ea.teamId, (lockedCountByTeam.get(ea.teamId) ?? 0) + 1);
      }
      for (const lockRow of _jobLockRows) {
        // Skip jobs already counted via team-level lock
        if (lockedTeamJobIdSet.has(lockRow.jobId)) continue;
        lockedCountByTeam.set(lockRow.cleanerId, (lockedCountByTeam.get(lockRow.cleanerId) ?? 0) + 1);
      }
      const vrpTeamConfigs = teamConfigs
        .filter(t => !lockedTeamIds.has(t.id))
        .map(t => ({ ...t, lockedJobCount: lockedCountByTeam.get(t.id) ?? 0 }));
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
        const lockedJobRow = activeJobs.find(j => j.id === lockRow.jobId);
        const arrivalMs = lockedJobRow?.serviceDateTime
          ? new Date(lockedJobRow.serviceDateTime).getTime()
          : Date.now();
        const durationHours = estimateDurationHours(lockedJobRow?.serviceType ?? null, lockedJobRow?.bedrooms ?? null);
        const departureMs = arrivalMs + durationHours * 3600000;
        assignments.push({
          cleanerJobId: lockRow.jobId,
          teamId: lockRow.cleanerId,
          teamName: lockedTeam?.name ?? "",
          routeOrder: lockRow.lockedPosition,
          estimatedArrivalMs: arrivalMs,
          estimatedDepartureMs: departureMs,
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

      // Find the team this job is currently assigned to (so we can recalc it after removal)
      const existing = await db.select({ teamId: scheduleAssignments.teamId })
        .from(scheduleAssignments)
        .where(and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(scheduleAssignments.cleanerJobId, input.cleanerJobId),
        ))
        .limit(1);
      const sourceTeamId = existing[0]?.teamId ?? null;

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

      // Recalculate the source team's remaining jobs so their route order and drive times stay accurate
      if (sourceTeamId && sourceTeamId !== 0) {
        await recalcTeamRoute(db, input.date, sourceTeamId);
      }

      return { ok: true };
    }),

  manualAssign: agentProcedure
    .input(z.object({
      date: z.string(),
      cleanerJobId: z.number(),
      teamId: z.number(),
      sourceTeamId: z.number().optional(), // team the job is being moved FROM (for recalc)
      routeOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const team = await db.select().from(schedulingTeams).where(eq(schedulingTeams.id, input.teamId)).limit(1);
      if (!team[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });

      // Step 1: Write the new assignment first (upsert) so it's included in the recalc
      await db.insert(scheduleAssignments)
        .values({
          jobDate: input.date,
          cleanerJobId: input.cleanerJobId,
          teamId: input.teamId,
          teamName: team[0].name,
          routeOrder: 0,
          isManual: 1,
          estimatedArrivalMs: Date.now(),
          estimatedDepartureMs: Date.now() + 2 * 3600 * 1000,
          driveTimeSecs: 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            teamId: input.teamId,
            teamName: team[0].name,
            isManual: 1,
            updatedAt: new Date(),
          },
        });

      // Step 2: Load all jobs currently assigned to this team for the date
      const teamAssignments = await db.select().from(scheduleAssignments)
        .where(and(
          eq(scheduleAssignments.jobDate, input.date),
          eq(scheduleAssignments.teamId, input.teamId),
        ));

      if (teamAssignments.length === 0) return { ok: true };

      // Step 3: Load the actual job records for those assignments
      const assignedJobIds = teamAssignments.map(a => a.cleanerJobId);
      const jobRows = await db.select().from(cleanerJobs)
        .where(inArray(cleanerJobs.id, assignedJobIds));

      // Step 4: Sort jobs by serviceDateTime (time-slot order)
      // Jobs with a serviceDateTime come first, sorted chronologically.
      // Jobs without a serviceDateTime (unscheduled) are appended at the end.
      const withTime = jobRows
        .filter(j => !!j.serviceDateTime)
        .sort((a, b) => new Date(a.serviceDateTime!).getTime() - new Date(b.serviceDateTime!).getTime());
      const withoutTime = jobRows.filter(j => !j.serviceDateTime);
      const orderedJobs = [...withTime, ...withoutTime];

      // Step 5: Geocode all job addresses (use cache)
      const geoMap = new Map<number, { lat: number; lng: number }>();
      for (const job of orderedJobs) {
        if (!job.jobAddress) continue;
        const geo = await geocodeWithCache(job.jobAddress);
        if (geo) geoMap.set(job.id, { lat: geo.lat, lng: geo.lng });
      }

      // Step 6: Build points array [home?, job0, job1, ...] for Distance Matrix
      const hasHome = team[0].homeLat != null && team[0].homeLng != null;
      const points: LatLng[] = [
        ...(hasHome ? [{ lat: team[0].homeLat!, lng: team[0].homeLng! }] : []),
        ...orderedJobs.map(j => geoMap.get(j.id) ?? { lat: 0, lng: 0 }),
      ];
      const homeOffset = hasHome ? 1 : 0;

      // Only call Distance Matrix if we have at least 2 real geocoded points
      const geocodedCount = orderedJobs.filter(j => geoMap.has(j.id)).length;
      let matrix: number[][] = [];
      if (geocodedCount >= 2 || (hasHome && geocodedCount >= 1)) {
        try {
          matrix = await buildTravelMatrix(points);
        } catch {
          matrix = [];
        }
      }

      // Step 7: Walk the ordered jobs, assign routeOrder and recalculate arrival/departure/drive
      const BUFFER_MS = 15 * 60 * 1000;
      let currentMs = 0;
      const updatedAssignments: Array<{
        cleanerJobId: number;
        routeOrder: number;
        estimatedArrivalMs: number;
        estimatedDepartureMs: number;
        driveTimeSecs: number;
      }> = [];

      orderedJobs.forEach((job, idx) => {
        const durationHours = estimateDurationHours(job.serviceType, job.bedrooms);
        const durationMs = durationHours * 3600000;

        // Arrival time: use serviceDateTime if available, otherwise chain from previous
        let arrivalMs: number;
        if (job.serviceDateTime) {
          arrivalMs = new Date(job.serviceDateTime).getTime();
        } else {
          arrivalMs = currentMs > 0 ? currentMs : Date.now();
        }

        const departureMs = arrivalMs + durationMs;
        currentMs = departureMs + BUFFER_MS;

        // Drive time from previous point (or home)
        let driveTimeSecs = 0;
        if (matrix.length > 0 && geoMap.has(job.id)) {
          const jobMatrixIdx = homeOffset + idx;
          const prevMatrixIdx = idx === 0 ? (hasHome ? 0 : -1) : homeOffset + (idx - 1);
          if (prevMatrixIdx >= 0) {
            driveTimeSecs = matrix[prevMatrixIdx]?.[jobMatrixIdx] ?? 0;
          }
        }

        updatedAssignments.push({
          cleanerJobId: job.id,
          routeOrder: idx,
          estimatedArrivalMs: arrivalMs,
          estimatedDepartureMs: departureMs,
          driveTimeSecs,
        });
      });

      // Step 8: Persist updated routeOrder + times for all jobs in this team
      for (const upd of updatedAssignments) {
        await db.update(scheduleAssignments)
          .set({
            routeOrder: upd.routeOrder,
            estimatedArrivalMs: upd.estimatedArrivalMs,
            estimatedDepartureMs: upd.estimatedDepartureMs,
            driveTimeSecs: upd.driveTimeSecs,
            updatedAt: new Date(),
          })
          .where(and(
            eq(scheduleAssignments.jobDate, input.date),
            eq(scheduleAssignments.cleanerJobId, upd.cleanerJobId),
          ));
      }

      // Step 9: Recalculate the source team (the one the job was moved FROM)
      // so its remaining jobs get correct routeOrder and drive times.
      if (input.sourceTeamId && input.sourceTeamId !== input.teamId) {
        await recalcTeamRoute(db, input.date, input.sourceTeamId);
      }

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

  // ── Suggest best time slots for a new job address ────────────────────────────
  suggestSlots: agentProcedure
    .input(z.object({ address: z.string(), date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Geocode the new address
      const newGeo = await geocodeWithCache(input.address);
      if (!newGeo) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not geocode address" });
      const newPoint: LatLng = { lat: newGeo.lat, lng: newGeo.lng };

      // 2. Load all jobs for the date with their assignments
      const jobs = await db.select().from(cleanerJobs).where(eq(cleanerJobs.jobDate, input.date));
      const jobIds = jobs.map(j => j.id);
      const assignments = jobIds.length > 0
        ? await db.select().from(scheduleAssignments)
            .where(and(
              eq(scheduleAssignments.jobDate, input.date),
              inArray(scheduleAssignments.cleanerJobId, jobIds),
            ))
        : [];
      const teams = await db.select().from(schedulingTeams).where(eq(schedulingTeams.isActive, 1));
      const teamByName = new Map(teams.map(t => [t.name, t]));
      const assignmentMap = new Map(assignments.filter(a => a.isManual !== 2).map(a => [a.cleanerJobId, a]));

      // 3. Geocode all job addresses from cache
      const jobAddresses = jobs.map(j => j.jobAddress?.trim().toLowerCase()).filter(Boolean) as string[];
      const geoCacheRows = jobAddresses.length > 0
        ? await db.select().from(jobGeoCache).where(inArray(jobGeoCache.addressKey, jobAddresses))
        : [];
      const geoByAddress = new Map(geoCacheRows.map(g => [g.addressKey, g]));

      // 4. Build per-team ordered job lists (same logic as getSchedule)
      type TeamRoute = {
        team: typeof teams[0];
        orderedJobs: Array<{ id: number; serviceDateTime: string | null; geo: LatLng | null; serviceType: string | null; bedrooms: number | null }>;
        jobCount: number;
      };
      const teamRoutes: TeamRoute[] = [];

      for (const team of teams) {
        // Get jobs assigned to this team (saved assignments first, then synthetic from teamName)
        const teamJobs = jobs.filter(j => {
          const asgn = assignmentMap.get(j.id);
          if (asgn) return asgn.teamId === team.id;
          // synthetic: no saved assignment, job's teamName matches
          return !assignmentMap.has(j.id) && j.teamName === team.name && teamByName.has(j.teamName);
        });

        // Sort by routeOrder (saved) or serviceDateTime
        teamJobs.sort((a, b) => {
          const ao = assignmentMap.get(a.id)?.routeOrder ?? 999;
          const bo = assignmentMap.get(b.id)?.routeOrder ?? 999;
          if (ao !== bo) return ao - bo;
          const ta = a.serviceDateTime ? new Date(a.serviceDateTime).getTime() : 0;
          const tb = b.serviceDateTime ? new Date(b.serviceDateTime).getTime() : 0;
          return ta - tb;
        });

        const orderedJobs = teamJobs.map(j => ({
          id: j.id,
          serviceDateTime: j.serviceDateTime,
          serviceType: j.serviceType ?? null,
          bedrooms: j.bedrooms ?? null,
          geo: (() => {
            const g = geoByAddress.get(j.jobAddress?.trim().toLowerCase() ?? "");
            return g ? { lat: g.lat, lng: g.lng } : null;
          })(),
        }));

        teamRoutes.push({ team, orderedJobs, jobCount: orderedJobs.length });
      }

      // 5. For each team, compute cheapest insertion cost at each gap
      type SlotResult = {
        teamId: number;
        teamName: string;
        teamColor: string;
        insertPosition: number; // 0 = before first job, N = after job N-1
        suggestedTimeMs: number | null;
        addedDriveSecs: number;
        totalTeamJobs: number;
      };
      const slots: SlotResult[] = [];

      // Collect all points we need drive times for: [newPoint] vs [prev, next] pairs
      // We'll batch all distance matrix calls across all teams
      type DrivePair = { fromLat: number; fromLng: number; toLat: number; toLng: number };
      const allPairs: DrivePair[] = [];
      type TeamGapSpec = {
        teamIdx: number;
        gapIdx: number; // position in route (0 = home→new→job0, N = jobN-1→new→jobN)
        prevPoint: LatLng | null; // null = home
        nextPoint: LatLng | null; // null = end of route
        prevJobDepartureMs: number | null;
        pairIdxPrevToNew: number;
        pairIdxNewToNext: number;
        pairIdxPrevToNext: number; // existing cost to remove
      };
      const gapSpecs: TeamGapSpec[] = [];

      for (let ti = 0; ti < teamRoutes.length; ti++) {
        const { team, orderedJobs } = teamRoutes[ti];
        // Check maxJobs cap
        const cap = team.maxJobs ?? 999;
        if (orderedJobs.length >= cap) continue;

        const homePoint: LatLng | null = team.homeLat != null && team.homeLng != null
          ? { lat: team.homeLat, lng: team.homeLng }
          : null;

        // Gaps: 0 = insert before first job (after home), ..., N = insert after last job
        const gapCount = orderedJobs.length + 1;
        for (let g = 0; g < gapCount; g++) {
          const prevPoint = g === 0 ? homePoint : (orderedJobs[g - 1].geo ?? null);
          const nextPoint = g < orderedJobs.length ? (orderedJobs[g].geo ?? null) : null;

          // We need: prev→new, new→next, prev→next (to compute delta)
          const pairIdxPrevToNew = allPairs.length;
          allPairs.push({ fromLat: (prevPoint ?? newPoint).lat, fromLng: (prevPoint ?? newPoint).lng, toLat: newPoint.lat, toLng: newPoint.lng });

          const pairIdxNewToNext = allPairs.length;
          if (nextPoint) {
            allPairs.push({ fromLat: newPoint.lat, fromLng: newPoint.lng, toLat: nextPoint.lat, toLng: nextPoint.lng });
          } else {
            allPairs.push({ fromLat: newPoint.lat, fromLng: newPoint.lng, toLat: newPoint.lat, toLng: newPoint.lng }); // placeholder
          }

          const pairIdxPrevToNext = allPairs.length;
          if (prevPoint && nextPoint) {
            allPairs.push({ fromLat: prevPoint.lat, fromLng: prevPoint.lng, toLat: nextPoint.lat, toLng: nextPoint.lng });
          } else {
            allPairs.push({ fromLat: newPoint.lat, fromLng: newPoint.lng, toLat: newPoint.lat, toLng: newPoint.lng }); // placeholder
          }

          // Estimate suggested time:
          // - prevJobEndMs = prevJob.serviceDateTime + estimatedDuration (not hardcoded 2h)
          // - The suggested start for the new job must be >= prevJobEndMs + driveFromPrevToNew
          // - It must also be <= nextJob.serviceDateTime - newJobDuration - driveFromNewToNext
          // We compute prevJobEndMs here; drive time will be added in step 7 after distance matrix.
          const prevJob = g > 0 ? orderedJobs[g - 1] : null;
          const prevJobEndMs = prevJob?.serviceDateTime
            ? new Date(prevJob.serviceDateTime).getTime() + estimateDurationHours(prevJob.serviceType, prevJob.bedrooms) * 3600000
            : null;
          const nextJobTime = g < orderedJobs.length ? orderedJobs[g].serviceDateTime : null;
          // Store prevJobEndMs so step 7 can add drive time to it
          const prevJobDep = prevJobEndMs;
          // Initial suggestion: earliest possible = prevJobEnd (drive time added in step 7)
          // Will be clamped against nextJobStart in step 7
          const suggestedTimeMs = prevJobEndMs ?? (nextJobTime ? new Date(nextJobTime).getTime() : null);

          gapSpecs.push({
            teamIdx: ti,
            gapIdx: g,
            prevPoint,
            nextPoint,
            prevJobDepartureMs: prevJobDep,
            pairIdxPrevToNew,
            pairIdxNewToNext,
            pairIdxPrevToNext,
            suggestedTimeMs: suggestedTimeMs ?? null,
          } as TeamGapSpec & { suggestedTimeMs: number | null });
        }
      }

      // 6. Batch distance matrix for all pairs (haversine fallback)
      const driveSecs: number[] = new Array(allPairs.length).fill(0);
      if (allPairs.length > 0) {
        try {
          const CHUNK = 10;
          for (let i = 0; i < allPairs.length; i += CHUNK) {
            const chunk = allPairs.slice(i, i + CHUNK);
            const origins = chunk.map(p => `${p.fromLat},${p.fromLng}`).join("|");
            const destinations = chunk.map(p => `${p.toLat},${p.toLng}`).join("|");
            const result = await makeRequest<DistanceMatrixResult>("/maps/api/distancematrix/json", {
              origins,
              destinations,
              mode: "driving",
              units: "metric",
            });
            if (result.status === "OK") {
              chunk.forEach((pair, idx) => {
                const el = result.rows[idx]?.elements[idx];
                if (el?.status === "OK") {
                  driveSecs[i + idx] = el.duration.value;
                } else {
                  driveSecs[i + idx] = Math.round(haversineMeters({ lat: pair.fromLat, lng: pair.fromLng }, { lat: pair.toLat, lng: pair.toLng }) / 10);
                }
              });
            } else {
              chunk.forEach((pair, idx) => {
                driveSecs[i + idx] = Math.round(haversineMeters({ lat: pair.fromLat, lng: pair.fromLng }, { lat: pair.toLat, lng: pair.toLng }) / 10);
              });
            }
          }
        } catch {
          allPairs.forEach((pair, idx) => {
            driveSecs[idx] = Math.round(haversineMeters({ lat: pair.fromLat, lng: pair.fromLng }, { lat: pair.toLat, lng: pair.toLng }) / 10);
          });
        }
      }

      // 7. Compute insertion cost for each gap
      for (const spec of gapSpecs as Array<TeamGapSpec & { suggestedTimeMs: number | null }>) {
        const { team, orderedJobs } = teamRoutes[spec.teamIdx];
        const prevToNew = driveSecs[spec.pairIdxPrevToNew];
        const newToNext = spec.nextPoint ? driveSecs[spec.pairIdxNewToNext] : 0;
        const prevToNext = (spec.prevPoint && spec.nextPoint) ? driveSecs[spec.pairIdxPrevToNext] : 0;
        const addedDriveSecs = prevToNew + newToNext - prevToNext;

        // Compute the earliest the new job can start:
        //   = prevJobEnd + driveFromPrevToNew
        // Then clamp: if a next job exists, the new job must also finish before it starts.
        // suggestedTimeMs from the spec is already prevJobEnd (or null if no prev job).
        let finalSuggestedTimeMs: number | null = spec.suggestedTimeMs;
        if (spec.suggestedTimeMs !== null) {
          // Add drive time from prev to new job
          finalSuggestedTimeMs = spec.suggestedTimeMs + prevToNew * 1000;
        }
        // If there's a next job, verify the new job can finish before it starts
        if (finalSuggestedTimeMs !== null && spec.nextPoint) {
          const nextJobIdx = spec.gapIdx;
          const nextJob = nextJobIdx < orderedJobs.length ? orderedJobs[nextJobIdx] : null;
          if (nextJob?.serviceDateTime) {
            const nextJobStartMs = new Date(nextJob.serviceDateTime).getTime();
            // New job must finish (+ drive to next) before next job starts
            // If it can't fit, the slot is not viable — mark as null so the UI can hide it
            // (addedDriveSecs will be high anyway, pushing it to the bottom of rankings)
            if (finalSuggestedTimeMs >= nextJobStartMs) {
              finalSuggestedTimeMs = null; // impossible to fit
            }
          }
        }
        // If no prev job, fall back to next job's start time as the suggestion
        if (finalSuggestedTimeMs === null && spec.gapIdx < orderedJobs.length) {
          const nextJob = orderedJobs[spec.gapIdx];
          if (nextJob?.serviceDateTime) {
            finalSuggestedTimeMs = new Date(nextJob.serviceDateTime).getTime();
          }
        }

        slots.push({
          teamId: team.id,
          teamName: team.name,
          teamColor: team.color ?? "#6366f1",
          insertPosition: spec.gapIdx,
          suggestedTimeMs: finalSuggestedTimeMs,
          addedDriveSecs: Math.max(0, addedDriveSecs),
          totalTeamJobs: orderedJobs.length,
        });
      }

      // 8. Deduplicate: keep only the best gap per team, then sort by addedDriveSecs
      const bestByTeam = new Map<number, SlotResult>();
      for (const s of slots) {
        const existing = bestByTeam.get(s.teamId);
        if (!existing || s.addedDriveSecs < existing.addedDriveSecs) {
          bestByTeam.set(s.teamId, s);
        }
      }
      const ranked = Array.from(bestByTeam.values())
        .sort((a, b) => a.addedDriveSecs - b.addedDriveSecs)
        .slice(0, 5);

      return { slots: ranked, geocodedAddress: newGeo.formattedAddress };
    }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recalculate routeOrder, arrival/departure times, and drive times for all jobs
 * currently assigned to a team on a given date.
 * Sorts by serviceDateTime first, then chains unscheduled jobs at the end.
 * Used after any manual assignment or unassignment to keep times consistent.
 */
async function recalcTeamRoute(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  date: string,
  teamId: number,
): Promise<void> {
  // Load team home for drive-from-home calculation
  const teamRows = await db.select().from(schedulingTeams).where(eq(schedulingTeams.id, teamId)).limit(1);
  const team = teamRows[0];

  // Load all active assignments for this team (exclude sentinel unassigned rows)
  const teamAssignments = await db.select().from(scheduleAssignments)
    .where(and(
      eq(scheduleAssignments.jobDate, date),
      eq(scheduleAssignments.teamId, teamId),
    ));
  // Filter out sentinel rows (isManual=2 means explicitly unassigned)
  const activeAssignments = teamAssignments.filter(a => a.isManual !== 2);
  if (activeAssignments.length === 0) return;

  // Load job records
  const jobIds = activeAssignments.map(a => a.cleanerJobId);
  const jobRows = await db.select().from(cleanerJobs).where(inArray(cleanerJobs.id, jobIds));

  // Sort: jobs with serviceDateTime first (chronological), then the rest
  const withTime = jobRows
    .filter(j => !!j.serviceDateTime)
    .sort((a, b) => new Date(a.serviceDateTime!).getTime() - new Date(b.serviceDateTime!).getTime());
  const withoutTime = jobRows.filter(j => !j.serviceDateTime);
  const orderedJobs = [...withTime, ...withoutTime];

  // Geocode all addresses via cache
  const geoMap = new Map<number, { lat: number; lng: number }>();
  for (const job of orderedJobs) {
    if (!job.jobAddress) continue;
    const geo = await geocodeWithCache(job.jobAddress);
    if (geo) geoMap.set(job.id, { lat: geo.lat, lng: geo.lng });
  }

  // Build points array [home?, job0, job1, ...]
  const hasHome = team?.homeLat != null && team?.homeLng != null;
  const points: LatLng[] = [
    ...(hasHome ? [{ lat: team!.homeLat!, lng: team!.homeLng! }] : []),
    ...orderedJobs.map(j => geoMap.get(j.id) ?? { lat: 0, lng: 0 }),
  ];
  const homeOffset = hasHome ? 1 : 0;

  let matrix: number[][] = [];
  const geocodedCount = orderedJobs.filter(j => geoMap.has(j.id)).length;
  if (geocodedCount >= 2 || (hasHome && geocodedCount >= 1)) {
    try { matrix = await buildTravelMatrix(points); } catch { matrix = []; }
  }

  const BUFFER_MS = 15 * 60 * 1000;
  let currentMs = 0;

  for (let idx = 0; idx < orderedJobs.length; idx++) {
    const job = orderedJobs[idx];
    const durationMs = estimateDurationHours(job.serviceType, job.bedrooms) * 3600000;

    const arrivalMs = job.serviceDateTime
      ? new Date(job.serviceDateTime).getTime()
      : (currentMs > 0 ? currentMs : Date.now());
    const departureMs = arrivalMs + durationMs;
    currentMs = departureMs + BUFFER_MS;

    let driveTimeSecs = 0;
    if (matrix.length > 0 && geoMap.has(job.id)) {
      const jobMatrixIdx = homeOffset + idx;
      const prevMatrixIdx = idx === 0 ? (hasHome ? 0 : -1) : homeOffset + (idx - 1);
      if (prevMatrixIdx >= 0) driveTimeSecs = matrix[prevMatrixIdx]?.[jobMatrixIdx] ?? 0;
    }

    await db.update(scheduleAssignments)
      .set({ routeOrder: idx, estimatedArrivalMs: arrivalMs, estimatedDepartureMs: departureMs, driveTimeSecs, updatedAt: new Date() })
      .where(and(
        eq(scheduleAssignments.jobDate, date),
        eq(scheduleAssignments.cleanerJobId, job.id),
      ));
  }
}

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
        rationale: a.rationale ? JSON.stringify(a.rationale) : null,
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
          rationale: a.rationale ? JSON.stringify(a.rationale) : null,
          updatedAt: new Date(),
        },
      });
  }
}
