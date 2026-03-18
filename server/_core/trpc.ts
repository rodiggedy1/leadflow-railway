import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getAgentFromRequest } from "./agentAuth";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * agentProcedure — validates the agent cookie session (any logged-in agent, not just admin).
 * Use this for procedures accessible to all agents.
 */
export const agentProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const agent = await getAgentFromRequest(ctx.req);
    if (!agent) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Agent login required" });
    }
    return next({
      ctx: {
        ...ctx,
        agent,
      },
    });
  }),
);

/**
 * adminAgentProcedure — validates the agent cookie session and requires isAdmin=true.
 * Use this for all admin-only procedures instead of protectedProcedure (which requires Manus OAuth).
 */
export const adminAgentProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const agent = await getAgentFromRequest(ctx.req);
    if (!agent) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Agent login required" });
    }
    if (!agent.isAdmin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return next({
      ctx: {
        ...ctx,
        agent,
      },
    });
  }),
);
