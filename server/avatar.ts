/**
 * avatar.ts — server-side DiceBear avatar generation
 *
 * Generates a deterministic illustrated face SVG from a seed string (phone number
 * or any stable identifier). Returns a base64 data URL ready for use in <img src>.
 *
 * Uses the "notionists" style which produces realistic illustrated faces.
 * Zero external requests — all generation happens in-process.
 */
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";

/** In-process LRU cache — keeps the last 500 generated avatars in memory */
const cache = new Map<string, string>();
const CACHE_MAX = 500;

/**
 * Generate a deterministic avatar data URL for a given seed.
 * @param seed - Any stable string (phone number, customer ID, name, etc.)
 * @param size - Pixel size of the SVG viewport (default 64)
 * @returns `data:image/svg+xml;base64,...` string
 */
export function getAvatarDataUrl(seed: string, size = 64): string {
  const key = `${seed}:${size}`;
  if (cache.has(key)) return cache.get(key)!;

  const svg = createAvatar(notionists, {
    seed,
    size,
    // Consistent background color that blends with dark UI
    backgroundColor: ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"],
  }).toString();

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  // Evict oldest entry if cache is full
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, dataUrl);
  return dataUrl;
}

/**
 * Normalise a phone number to a clean seed string.
 * Strips all non-digit characters so +1 (702) 808-0970 → "17028080970"
 */
export function phoneSeed(phone: string): string {
  return phone.replace(/\D/g, "");
}
