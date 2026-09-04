import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

export type CustomerPortalSession = {
  accountId: number;
  customerName: string;
  customerPhone: string;
};

function signingKey() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function signCustomerPortalSession(session: CustomerPortalSession, expiresInMs = ONE_YEAR_MS): Promise<string> {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + expiresInMs) / 1_000))
    .sign(signingKey());
}

export async function verifyCustomerPortalSession(token: string | undefined | null): Promise<CustomerPortalSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] });
    const { accountId, customerName, customerPhone } = payload as Record<string, unknown>;
    if (!Number.isInteger(accountId) || typeof customerName !== "string" || typeof customerPhone !== "string") return null;
    return { accountId: Number(accountId), customerName, customerPhone };
  } catch {
    return null;
  }
}

export async function getCustomerPortalSessionFromRequest(req: Request): Promise<CustomerPortalSession | null> {
  const raw = req.headers.cookie;
  if (!raw) return null;
  return verifyCustomerPortalSession(parseCookieHeader(raw)[CUSTOMER_PORTAL_COOKIE_NAME]);
}
