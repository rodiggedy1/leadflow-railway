/**
 * tasksRouter — internal task management for ops agents.
 *
 * All procedures require agent authentication (adminAgentProcedure).
 * Admin sees all tasks; agents see only tasks assigned to them.
 *
 * Procedures:
 *   list         — all tasks (admin board view), filterable
 *   listMine     — tasks assigned to the current agent
 *   getDue       — tasks due now for the current agent (popup trigger)
 *   create       — create a new task
 *   updateStatus — change status (todo → in_progress → done)
 *   update       — full edit (title, description, priority, dueAt, assignee, status)
 *   dismissPopup — stamp popupDismissedAt so the popup doesn't re-fire
 *   delete       — hard delete (admin only)
 */
import { z } from "zod";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { opsTasks } from "../drizzle/schema";
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { TRPCError } from "@trpc/server";

const priorityValues = ["urgent", "high", "medium", "low"] as const;
const statusValues = ["todo", "in_progress", "done"] as const;

export const tasksRouter = router({
  /** Admin board: all tasks, optional filters */
  list: adminAgentProcedure
    .input(z.object({
      status: z.enum(statusValues).optional(),
      priority: z.enum(priorityValues).optional(),
      assigneeAgentId: z.number().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [];
      if (input.status) conditions.push(eq(opsTasks.status, input.status));
      if (input.priority) conditions.push(eq(opsTasks.priority, input.priority));
      if (input.assigneeAgentId) conditions.push(eq(opsTasks.assigneeAgentId, input.assigneeAgentId));

      const offset = (input.page - 1) * input.pageSize;

      const [rows, countRows] = await Promise.all([
        db.select().from(opsTasks)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(
            // Sort: todo/in_progress first, then by priority weight, then by dueAt
            asc(opsTasks.completedAt), // nulls first (incomplete tasks)
            desc(opsTasks.createdAt),
          )
          .limit(input.pageSize)
          .offset(offset),
        db.select({ id: opsTasks.id }).from(opsTasks)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return {
        tasks: rows,
        total: countRows.length,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** Personal view: tasks assigned to the current agent */
  listMine: adminAgentProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db.select().from(opsTasks)
        .where(and(
          eq(opsTasks.assigneeAgentId, ctx.agent.agentId),
          or(
            eq(opsTasks.status, "todo"),
            eq(opsTasks.status, "in_progress"),
          ),
        ))
        .orderBy(asc(opsTasks.dueAt), desc(opsTasks.createdAt))
        .limit(100);

      return rows;
    }),

  /** Due-date popup: tasks that are due now and not yet dismissed/completed */
  getDue: adminAgentProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = Date.now();
      const rows = await db.select().from(opsTasks)
        .where(and(
          eq(opsTasks.assigneeAgentId, ctx.agent.agentId),
          lte(opsTasks.dueAt, now),
          isNull(opsTasks.completedAt),
          isNull(opsTasks.popupDismissedAt),
        ))
        .orderBy(asc(opsTasks.dueAt))
        .limit(10);

      return rows;
    }),

  /** Create a new task */
  create: adminAgentProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      priority: z.enum(priorityValues).default("medium"),
      status: z.enum(statusValues).default("todo"),
      assigneeAgentId: z.number().optional(),
      assigneeAgentName: z.string().max(128).optional(),
      dueAt: z.number().optional(), // UTC epoch ms
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [result] = await db.insert(opsTasks).values({
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        status: input.status,
        assigneeAgentId: input.assigneeAgentId ?? null,
        assigneeAgentName: input.assigneeAgentName ?? null,
        createdByAgentId: ctx.agent.agentId,
        createdByAgentName: ctx.agent.agentName,
        dueAt: input.dueAt ?? null,
      });

      broadcastOpsUpdate("task_update");
      return { id: (result as any).insertId as number };
    }),

  /** Update status only (quick action from board) */
  updateStatus: adminAgentProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(statusValues),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const completedAt = input.status === "done" ? Date.now() : null;
      await db.update(opsTasks)
        .set({ status: input.status, completedAt })
        .where(eq(opsTasks.id, input.id));

      broadcastOpsUpdate("task_update");
      return { success: true };
    }),

  /** Full edit */
  update: adminAgentProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).nullable().optional(),
      priority: z.enum(priorityValues).optional(),
      status: z.enum(statusValues).optional(),
      assigneeAgentId: z.number().nullable().optional(),
      assigneeAgentName: z.string().max(128).nullable().optional(),
      dueAt: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.status !== undefined) {
        patch.status = input.status;
        patch.completedAt = input.status === "done" ? Date.now() : null;
      }
      if (input.assigneeAgentId !== undefined) patch.assigneeAgentId = input.assigneeAgentId;
      if (input.assigneeAgentName !== undefined) patch.assigneeAgentName = input.assigneeAgentName;
      if (input.dueAt !== undefined) patch.dueAt = input.dueAt;

      if (Object.keys(patch).length > 0) {
        await db.update(opsTasks).set(patch as any).where(eq(opsTasks.id, input.id));
        broadcastOpsUpdate("task_update");
      }

      return { success: true };
    }),

  /** Dismiss the due-date popup for a task */
  dismissPopup: adminAgentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(opsTasks)
        .set({ popupDismissedAt: Date.now() })
        .where(eq(opsTasks.id, input.id));

      return { success: true };
    }),

  /** Hard delete (admin only) */
  delete: adminAgentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(opsTasks).where(eq(opsTasks.id, input.id));
      broadcastOpsUpdate("task_update");
      return { success: true };
    }),
});
