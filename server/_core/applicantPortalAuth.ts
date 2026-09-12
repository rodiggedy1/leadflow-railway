import { APPLICANT_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

export type ApplicantPortalSession = { candidateId: number; firstName: string; lastName: string };

function signingKey() { return new TextEncoder().encode(ENV.cookieSecret); }

export async function signApplicantPortalSession(session: ApplicantPortalSession, expiresInMs = ONE_YEAR_MS): Promise<string> {
  return new SignJWT(session).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor((Date.now() + expiresInMs) / 1_000)).sign(signingKey());
}

export async function verifyApplicantPortalSession(token: string | undefined | null): Promise<ApplicantPortalSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] });
    const { candidateId, firstName, lastName } = payload as Record<string, unknown>;
    if (!Number.isInteger(candidateId) || typeof firstName !== "string" || typeof lastName !== "string") return null;
    return { candidateId: Number(candidateId), firstName, lastName };
  } catch { return null; }
}

export async function getApplicantPortalSessionFromRequest(req: Request): Promise<ApplicantPortalSession | null> {
  return verifyApplicantPortalSession(parseCookieHeader(req.headers.cookie ?? "")[APPLICANT_PORTAL_COOKIE_NAME]);
}
