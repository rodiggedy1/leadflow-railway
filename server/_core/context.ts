import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getAgentFromRequest } from "./agentAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // Capability for the existing agents.me read only; no added database lookup.
  // The client also requires the returned active agent to be an actual admin.
  const includesAgentMe = opts.req.path.split("/").pop()?.split(",").includes("agents.me") === true;
  if (includesAgentMe) {
    let apiDebugEligible = false;
    if (process.env.RAILWAY_ENVIRONMENT_NAME === "preview" && process.env.PREVIEW_MODE === "true" && process.env.COMMAND_CHAT_API_DEBUG_ENABLED === "true") {
      try {
        apiDebugEligible = (await getAgentFromRequest(opts.req))?.isAdmin === true;
      } catch { /* An invalid session never grants diagnostic eligibility. */ }
    }
    opts.res.setHeader("X-Command-Chat-API-Debug", apiDebugEligible ? "1" : "0");
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
