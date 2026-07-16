import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


/**
 * Wrap a recording URL through the server-side media proxy so the browser
 * can stream it regardless of CORS restrictions on the upstream CDN.
 * Handles storage.vapi.ai, r2.cloudflarestorage.com, and .r2.dev URLs.
 */
export function proxyRecordingUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const needsProxy =
    url.includes("storage.vapi.ai") ||
    url.includes("r2.cloudflarestorage.com") ||
    url.includes(".r2.dev/");
  if (!needsProxy) return url;
  return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}
