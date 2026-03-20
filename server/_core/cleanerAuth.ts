/**
 * cleanerAuth.ts — JWT-based session management for cleaner portal accounts.
 *
 * Cleaners log in with phone + password (no Manus OAuth required).
 * Their session is stored in a separate cookie: "cleaner_session_id".
 */
import { CLEANER_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

export type CleanerSessionPayload = {
  cleanerId: number;
  cleanerName: string;
  cleanerPhone: string;
};

function getSecret() {
  return new TextEncoder().encode(ENV.cookieSecret || "cleaner-fallback-secret");
}

/** Sign a JWT for a cleaner session. Returns the token string. */
export async function signCleanerSession(
  payload: CleanerSessionPayload,
  expiresInMs = ONE_YEAR_MS
): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);
  return new SignJWT({
    cleanerId: payload.cleanerId,
    cleanerName: payload.cleanerName,
    cleanerPhone: payload.cleanerPhone,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSecret());
}

/** Verify and decode a cleaner session JWT. Returns null if invalid/expired. */
export async function verifyCleanerSession(
  token: string | undefined | null
): Promise<CleanerSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    const { cleanerId, cleanerName, cleanerPhone } = payload as Record<string, unknown>;
    if (
      typeof cleanerId !== "number" ||
      typeof cleanerName !== "string" ||
      typeof cleanerPhone !== "string"
    ) {
      return null;
    }
    return { cleanerId, cleanerName, cleanerPhone };
  } catch {
    return null;
  }
}

/** Extract and verify cleaner session from an Express request's cookies. */
export async function getCleanerFromRequest(
  req: Request
): Promise<CleanerSessionPayload | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[CLEANER_COOKIE_NAME] ?? null;
  return verifyCleanerSession(token);
}
