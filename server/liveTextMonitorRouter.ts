import { z } from "zod";
import { adminAgentProcedure, router } from "./_core/trpc";
import { checkLiveText, getLiveTextFeed } from "./liveTextMonitorService";

export const liveTextCheckInputSchema = z.object({
  captureId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const liveTextMonitorRouter = router({
  feed: adminAgentProcedure.input(z.void()).query(() => getLiveTextFeed()),
  check: adminAgentProcedure.input(liveTextCheckInputSchema).mutation(({ input }) => checkLiveText(input.captureId)),
});
