/**
 * GET /api/emergency-agent-login?token=SECRET&email=agent@example.com
 *
 * TEMPORARY emergency bypass for the Manus platform 429 rate limit on /api/trpc.
 * Remove this route once Manus support resolves the rate limit issue.
 *
 * - Validates token against EMERGENCY_AGENT_LOGIN_TOKEN env var
 * - Looks up agent by `email` query param (falls back to EMERGENCY_AGENT_EMAIL)
 * - Sets the same session cookie as agents.login
 * - Redirects to /admin (admin agents) or /agent (non-admin agents)
 * - Logs every use (IP + timestamp + email)
 * - Returns 403 if token is invalid or env vars are missing
 */
import type { Express, Request, Response } from "express";
import { getAgentByEmail } from "./db";
import { signAgentSession } from "./_core/agentAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export function registerEmergencyAgentLoginRoute(app: Express) {
  app.get("/api/emergency-agent-login", async (req: Request, res: Response) => {
    const expectedToken = process.env.EMERGENCY_AGENT_LOGIN_TOKEN;
    const defaultEmail = process.env.EMERGENCY_AGENT_EMAIL;

    // If env vars not set, route is disabled
    if (!expectedToken || !defaultEmail) {
      return res.status(403).send("Forbidden");
    }

    const providedToken = req.query.token as string | undefined;

    if (!providedToken || providedToken !== expectedToken) {
      console.warn(`[EmergencyLogin] INVALID token attempt from ${req.ip} at ${new Date().toISOString()}`);
      return res.status(403).send("Forbidden");
    }

    // Use email from query param if provided, otherwise fall back to env default
    const emailParam = req.query.email as string | undefined;
    const targetEmail = (emailParam || defaultEmail).toLowerCase().trim();

    try {
      const agent = await getAgentByEmail(targetEmail);
      if (!agent || !agent.isActive) {
        console.error(`[EmergencyLogin] Agent not found or inactive: ${targetEmail}`);
        return res.status(403).send("Forbidden");
      }

      const token = await signAgentSession({
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        isAdmin: agent.isAdmin === 1,
      });

      const cookieOpts = getSessionCookieOptions(req);
      res.cookie(AGENT_COOKIE_NAME, token, {
        ...cookieOpts,
        maxAge: ONE_YEAR_MS,
      });

      console.log(`[EmergencyLogin] SUCCESS — logged in as ${agent.email} (id=${agent.id}, isAdmin=${agent.isAdmin}) from ${req.ip} at ${new Date().toISOString()}`);

      // Redirect admins to /admin, agents to /agent
      const destination = agent.isAdmin === 1 ? "/admin" : "/agent";
      return res.redirect(destination);
    } catch (err) {
      console.error("[EmergencyLogin] error:", err);
      return res.status(500).send("Internal server error");
    }
  });
}
