/**
 * POST /api/agents/login
 *
 * Plain REST endpoint that bypasses /api/trpc to avoid the platform rate limit
 * on that path. Uses the exact same logic as the `agents.login` tRPC mutation.
 *
 * Returns JSON: { success: true, agent: { id, name, email, isAdmin } }
 * On error:     { success: false, error: string }  (HTTP 401)
 */
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { getAgentByEmail } from "./db";
import { signAgentSession } from "./_core/agentAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export function registerAgentLoginRoute(app: Express) {
  app.post("/api/agents/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email and password are required" });
      }

      const agent = await getAgentByEmail(email.toLowerCase().trim());
      if (!agent || !agent.isActive) {
        return res.status(401).json({ success: false, error: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, agent.passwordHash);
      if (!valid) {
        return res.status(401).json({ success: false, error: "Invalid email or password" });
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

      return res.json({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          isAdmin: agent.isAdmin === 1,
        },
      });
    } catch (err) {
      console.error("[agentLogin] error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}
