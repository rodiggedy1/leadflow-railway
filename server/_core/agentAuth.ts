/**
 * agentAuth.ts — JWT-based session management for internal agent accounts.
 *
 * Agents log in with email + password (no Manus OAuth required).
 * Their session is stored in a separate cookie: "agent_session_id".
 */
import { AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

export type AgentSessionPayload = {
  agentId: number;
  agentName: string;
  agentEmail: string;
  isAdmin: boolean;
};

function getSecret() {
  return new TextEncoder().encode(ENV.cookieSecret || "agent-fallback-secret");
}

/** Sign a JWT for an agent session. Returns the token string. */
export async function signAgentSession(
  payload: AgentSessionPayload,
  expiresInMs = ONE_YEAR_MS
): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);
  return new SignJWT({
    agentId: payload.agentId,
    agentName: payload.agentName,
    agentEmail: payload.agentEmail,
    isAdmin: payload.isAdmin,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSecret());
}

/** Verify and decode an agent session JWT. Returns null if invalid/expired. */
export async function verifyAgentSession(
  token: string | undefined | null
): Promise<AgentSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    const { agentId, agentName, agentEmail, isAdmin } = payload as Record<string, unknown>;
    if (
      typeof agentId !== "number" ||
      typeof agentName !== "string" ||
      typeof agentEmail !== "string"
    ) {
      return null;
    }
    return { agentId, agentName, agentEmail, isAdmin: isAdmin === true };
  } catch {
    return null;
  }
}

/** Extract and verify the agent session cookie from an Express request. */
export async function getAgentFromRequest(
  req: Request
): Promise<AgentSessionPayload | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[AGENT_COOKIE_NAME];
  return verifyAgentSession(token);
}
