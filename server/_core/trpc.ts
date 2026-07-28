import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getAgentFromRequest } from "./agentAuth";
import { getCleanerFromRequest } from "./cleanerAuth";

// ── lastSeenAt throttle ───────────────────────────────────────────────────────
// Prevents a DB write on every opsChatProcedure call.
// Writes only when: (a) >30s since last write, OR (b) caller was absent for >30s
// (offline→online transition) — ensures the first activity after reconnect is
// immediately reflected in the presence indicator.
//
// Key: agent email or owner openId. Value: timestamp of last DB write (ms).
const lastSeenAtCache = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 30_000; // 30 seconds

function shouldWriteLastSeenAt(key: string): boolean {
  const now = Date.now();
  const lastWrite = lastSeenAtCache.get(key);
  // Write if: never written, OR >30s since last write (covers offline→online:
  // if absent >30s the cache entry is stale and we write immediately).
  if (lastWrite === undefined || now - lastWrite >= LAST_SEEN_THROTTLE_MS) {
    lastSeenAtCache.set(key, now);
    return true;
  }
  return false;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// ── Per-procedure timing instrumentation ──────────────────────────────────────
// Logs every procedure call that takes > 250ms, with DB pool queue depth.
// Stays in place until QUEUE_LIMIT failures are gone and we have a ranked
// list of the heaviest DB consumers.
const timingMiddleware = t.middleware(async (opts) => {
  const start = Date.now();
  const result = await opts.next();
  const durationMs = Date.now() - start;
  if (durationMs > 250) {
    try {
      const { getPool } = await import('../db');
      const pool = getPool();
      const corePool = (pool as any)?.pool;
      console.warn('[tRPC Slow]', {
        path: opts.path,
        duration_ms: durationMs,
        pool_all:   corePool?._allConnections?.length  ?? -1,
        pool_free:  corePool?._freeConnections?.length ?? -1,
        pool_queue: corePool?._connectionQueue?.length ?? -1,
      });
    } catch {
      console.warn('[tRPC Slow]', { path: opts.path, duration_ms: durationMs });
    }
  }
  return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

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

/**
 * opsChatProcedure — accepts EITHER a Manus OAuth owner session OR an agent session.
 * Use this for all OpsChat procedures so both the owner and agents can access them.
 * Injects ctx.opsCaller = { id: string; name: string; isOwner: boolean }
 */
export const opsChatProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    // First try Manus OAuth (owner)
    if (ctx.user) {
      // Fire-and-forget lastSeenAt heartbeat for owner (non-blocking)
      // Throttled to once per 30s per caller (shouldWriteLastSeenAt) to avoid a DB
      // write on every tRPC request. The offline→online transition is covered because
      // if the owner was absent >30s the cache entry is stale and we write immediately.
      if (shouldWriteLastSeenAt(ctx.user.openId)) {
        try {
          const { getDb } = await import("../db");
          const { agents } = await import("../../drizzle/schema");
          const { like } = await import("drizzle-orm");
          const db = await getDb();
          if (db && ctx.user.name) {
            const firstName = ctx.user.name.split(/\s+/)[0];
            db.update(agents)
              .set({ lastSeenAt: new Date() })
              .where(like(agents.name, `${firstName}%`))
              .execute()
              .catch(() => { /* ignore */ });
          }
        } catch { /* ignore */ }
      }
      return next({
        ctx: {
          ...ctx,
          opsCaller: {
            id: ctx.user.openId,
            name: ctx.user.name ?? "Owner",
            isOwner: true,
          },
        },
      });
    }

    // Fallback: try agent session cookie
    const agent = await getAgentFromRequest(ctx.req);
    if (agent) {
      // Fire-and-forget lastSeenAt heartbeat (non-blocking)
      // Throttled to once per 30s per agent email (shouldWriteLastSeenAt).
      if (shouldWriteLastSeenAt(agent.agentEmail)) {
        try {
          const { getDb } = await import("../db");
          const { agents } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            db.update(agents)
              .set({ lastSeenAt: new Date() })
              .where(eq(agents.email, agent.agentEmail))
              .execute()
              .catch(() => { /* ignore */ });
          }
        } catch { /* ignore */ }
      }
      return next({
        ctx: {
          ...ctx,
          opsCaller: {
            id: String(agent.agentId),
            email: agent.agentEmail,  // email used for DB lookups
            name: agent.agentName,
            isOwner: false,
          },
        },
      });
    }

    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }),
);

/**
 * cleanerProcedure — validates the cleaner cookie session.
 * Use this for all cleaner portal procedures.
 */
export const cleanerProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const cleaner = await getCleanerFromRequest(ctx.req);
    if (!cleaner) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Cleaner login required" });
    }
    return next({
      ctx: {
        ...ctx,
        cleaner,
      },
    });
  }),
);
