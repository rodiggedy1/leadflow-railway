import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, bookingsAgentProcedure, router } from "./_core/trpc";
import { checkLiveText, getLiveTextFeed } from "./liveTextMonitorService";
import { isValidAuditDate } from "./dailyActionAuditEngine";
import { checkAndSyncLiveText } from "./liveTextMonitorAutoSync";

export const liveTextCheckInputSchema = z.object({
  sessionId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  messageKey: z.string().regex(/^session-text:[a-f0-9]{64}$/),
}).strict();

export const liveTextSyncInputSchema = liveTextCheckInputSchema.extend({
  revision: z.string().min(1).max(256),
  actionId: z.string().min(1).max(160),
  serviceDate: z.string().refine(isValidAuditDate, "Choose a valid service date."),
}).strict();
const syncProcedure = bookingsAgentProcedure.use(({ ctx, next }) => {
  if (!ctx.agent.isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  return next();
});

export const liveTextMonitorRouter = router({
  feed: adminAgentProcedure.input(z.void()).query(() => getLiveTextFeed()),
  check: adminAgentProcedure.input(liveTextCheckInputSchema).mutation(({ input }) => checkLiveText(input)),
  checkAndSync: syncProcedure.input(liveTextCheckInputSchema).mutation(({ input }) => checkAndSyncLiveText(input)),
});
