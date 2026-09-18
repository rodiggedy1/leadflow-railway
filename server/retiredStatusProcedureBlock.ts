import { TRPCError } from "@trpc/server";
import { cleanerRouter } from "./cleanerRouter";
import { publicProcedure } from "./_core/trpc";

/**
 * The current Cleaner Portal writes progress only through the LeadFlow-owned
 * portal procedures. The retired status endpoint is deliberately retained as
 * a named tRPC entry only so stale clients receive an explicit error instead
 * of updating a job or sending a customer notification.
 */
export function installRetiredStatusProcedureBlock() {
  const procedures = (cleanerRouter as any)._def.procedures as Record<string, unknown>;
  procedures.updateJobStatus = publicProcedure.mutation(() => {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This retired job-status endpoint is unavailable. Use the current Cleaner Portal.",
    });
  });
}

installRetiredStatusProcedureBlock();
