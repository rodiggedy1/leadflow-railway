/**
 * schedulingUtils.ts
 * Shared utilities for the scheduling system, extracted to avoid circular imports.
 */

import { eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { makeRequest } from "./_core/map";
import { schedulingTeams, jobGeoCache } from "../drizzle/schema";

/**
 * Geocode a single address using Google Maps API and cache the result.
 * Returns { lat, lng } or null on failure.
 */
export async function geocodeAddressAndCache(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const key = address.trim().toLowerCase();

  // Check cache first
  const cached = await db.select().from(jobGeoCache).where(eq(jobGeoCache.addressKey, key)).limit(1);
  if (cached[0]) return { lat: cached[0].lat, lng: cached[0].lng };

  // Call Google
  const r = await makeRequest<any>("/maps/api/geocode/json", { address });
  if (r?.status !== "OK" || !r.results?.[0]) return null;

  const lat = r.results[0].geometry.location.lat as number;
  const lng = r.results[0].geometry.location.lng as number;
  const formattedAddress = r.results[0].formatted_address as string;

  // Save to cache
  await db
    .insert(jobGeoCache)
    .ignore()
    .values({ addressKey: key, originalAddress: address, lat, lng, formattedAddress })
    .catch(() => {});

  return { lat, lng };
}

/**
 * On startup: find all scheduling_teams rows that have a homeAddress but null homeLat/homeLng,
 * geocode them, and persist the result. This fixes teams that were created before geocoding
 * was wired up, and also handles any future cases where geocoding fails transiently.
 */
export async function backfillTeamGeocodesOnStartup(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const teams = await db
    .select()
    .from(schedulingTeams)
    .where(isNull(schedulingTeams.homeLat));

  const toFix = teams.filter((t) => t.homeAddress);
  if (toFix.length === 0) {
    console.log("[GeoBackfill] All teams already geocoded.");
    return;
  }

  console.log(`[GeoBackfill] Geocoding ${toFix.length} team(s) with missing homeLat/homeLng...`);

  for (const t of toFix) {
    try {
      const geo = await geocodeAddressAndCache(t.homeAddress!);
      if (geo) {
        await db
          .update(schedulingTeams)
          .set({ homeLat: geo.lat, homeLng: geo.lng } as any)
          .where(eq(schedulingTeams.id, t.id));
        console.log(`[GeoBackfill] Fixed team "${t.name}": (${geo.lat}, ${geo.lng})`);
      } else {
        console.warn(`[GeoBackfill] Could not geocode team "${t.name}": ${t.homeAddress}`);
      }
    } catch (e) {
      console.error(`[GeoBackfill] Error for team "${t.name}":`, e);
    }
  }
}
