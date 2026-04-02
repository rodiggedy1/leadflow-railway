/**
 * followUpsRouter.ts
 *
 * tRPC procedures for the ops Follow-Ups modal in CommandChat.
 * Also exports `runFollowUpReminders()` — called by internalCron every 5 min
 * to send owner notifications when a follow-up is at or past its dueAt time.
 */

import { z } from "zod";
import { and, eq, isNull, lte } from "drizzle-orm";
import { router } from "./_core/trpc";
import { agentProcedure } from "./_core/trpc";
import { getDb, getAllAgents } from "./db";
import { followUps, opsChatMessages } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { logActivity } from "./activityLogger";

// ─── Shared input shapes ──────────────────────────────────────────────────────

const createInput = z.object({
  name: z.string().min(1).max(255),
  nextStep: z.string().min(1).max(255),
  dueAt: z.number().int(), // Unix ms
  owner: z.string().min(1).max(100),
  type: z.enum(["Lead callback", "Customer issue", "Reschedule", "Voicemail", "Team Issue"]),
  priority: z.enum(["High", "Normal", "Low"]).default("Normal"),
  internalNote: z.string().max(2000).optional(),
  customerFacingMove: z.string().max(2000).optional(),
});

const addHistoryInput = z.object({
  id: z.number().int(),
  text: z.string().min(1).max(500),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const followUpsRouter = router({
  /**
   * List active CS agents (name only) for the owner picker.
   */
  listAgents: agentProcedure.query(async () => {
    const all = await getAllAgents();
    return all
      .filter((a) => a.isActive === 1)
      .map((a) => a.name);
  }),

  /**
   * List all active (not completed) follow-ups, ordered by dueAt ascending.
   */
  list: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(followUps)
      .where(isNull(followUps.completedAt))
      .orderBy(followUps.dueAt);
    return rows.map((r) => ({
      ...r,
      history: safeParseHistory(r.history),
    }));
  }),

  /**
   * Create a new follow-up.
   */
  create: agentProcedure.input(createInput).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [result] = await db.insert(followUps).values({
      name: input.name,
      nextStep: input.nextStep,
      dueAt: input.dueAt,
      owner: input.owner,
      type: input.type,
      priority: input.priority,
      internalNote: input.internalNote ?? null,
      customerFacingMove: input.customerFacingMove ?? null,
      history: JSON.stringify([
        {
          text: `Follow-up created — ${input.type}`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          ts: Date.now(),
        },
      ]),
    });
    const insertId = (result as any).insertId as number;
    const [created] = await db.select().from(followUps).where(eq(followUps.id, insertId));

    // Post a compact card into the command channel
    try {
      const dueLabel = new Date(input.dueAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      await db.insert(opsChatMessages).values({
        channel: "command",
        authorName: input.owner,
        authorRole: "system",
        body: `Follow-up created — ${input.name}`,
        quickAction: "follow_up_created",
        metadata: JSON.stringify({
          followUpId: insertId,
          name: input.name,
          type: input.type,
          owner: input.owner,
          priority: input.priority,
          nextStep: input.nextStep,
          dueLabel,
          internalNote: input.internalNote ?? null,
        }),
      });
    } catch (err) {
      console.error("[followUps.create] Failed to post command chat card:", err);
    }

    return { ...created, history: safeParseHistory(created.history) };
  }),

  /**
   * Mark a follow-up as completed.
   */
  complete: agentProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .update(followUps)
        .set({ completedAt: Date.now() })
        .where(eq(followUps.id, input.id));
      return { ok: true };
    }),

  /**
   * Add a history note to an existing follow-up.
   */
  addNote: agentProcedure.input(addHistoryInput).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [row] = await db.select().from(followUps).where(eq(followUps.id, input.id));
    if (!row) throw new Error("Follow-up not found");
    const history = safeParseHistory(row.history);
    history.push({
      text: input.text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ts: Date.now(),
    });
    await db
      .update(followUps)
      .set({ history: JSON.stringify(history) })
      .where(eq(followUps.id, input.id));
    return { ok: true };
  }),

  /**
   * Reassign a follow-up to a different owner.
   */
  reassign: agentProcedure
    .input(z.object({ id: z.number().int(), owner: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // Append a history note
      const [row] = await db.select().from(followUps).where(eq(followUps.id, input.id));
      if (!row) throw new Error("Follow-up not found");
      const history = safeParseHistory(row.history);
      history.push({
        text: `Reassigned to ${input.owner} (was ${row.owner})`,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ts: Date.now(),
      });
      await db
        .update(followUps)
        .set({ owner: input.owner, history: JSON.stringify(history) })
        .where(eq(followUps.id, input.id));
      return { ok: true };
    }),

  /**
   * Snooze / change due time on an existing follow-up.
   * Also clears reminderSentAt so the cron will fire again at the new time.
   */
  updateDueAt: agentProcedure
    .input(z.object({ id: z.number().int(), dueAt: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db.select().from(followUps).where(eq(followUps.id, input.id));
      if (!row) throw new Error("Follow-up not found");
      const history = safeParseHistory(row.history);
      const newLabel = new Date(input.dueAt).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      history.push({
        text: `Due time changed to ${newLabel}`,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ts: Date.now(),
      });
      await db
        .update(followUps)
        .set({ dueAt: input.dueAt, reminderSentAt: null, history: JSON.stringify(history) })
        .where(eq(followUps.id, input.id));
      return { ok: true };
    }),

  /**
   * Update owner, priority, or dueAt on an existing follow-up.
   */
  update: agentProcedure
    .input(
      z.object({
        id: z.number().int(),
        owner: z.string().max(100).optional(),
        priority: z.enum(["High", "Normal", "Low"]).optional(),
        dueAt: z.number().int().optional(),
        nextStep: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const patch: Record<string, unknown> = {};
      if (input.owner !== undefined) patch.owner = input.owner;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
      if (input.nextStep !== undefined) patch.nextStep = input.nextStep;
      if (Object.keys(patch).length === 0) return { ok: true };
      await db.update(followUps).set(patch).where(eq(followUps.id, input.id));
      return { ok: true };
    }),
});

// ─── Cron: due-time reminders ─────────────────────────────────────────────────

/**
 * Called by internalCron every 5 minutes.
 * Finds follow-ups that are:
 *   - Not completed (completedAt IS NULL)
 *   - Past their dueAt time
 *   - Have not yet had a reminder sent (reminderSentAt IS NULL)
 *
 * For each, sends an owner notification and marks reminderSentAt.
 */
export async function runFollowUpReminders(): Promise<{ checked: number; sent: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, sent: 0 };

  const now = Date.now();

  const due = await db
    .select()
    .from(followUps)
    .where(
      and(
        isNull(followUps.completedAt),
        isNull(followUps.reminderSentAt),
        lte(followUps.dueAt, now)
      )
    )
    .limit(20);

  let sent = 0;
  for (const item of due) {
    const dueLabel = new Date(item.dueAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    // Mark reminder sent FIRST to prevent double-send if notification fails
    await db
      .update(followUps)
      .set({ reminderSentAt: now })
      .where(eq(followUps.id, item.id));

    // Owner notification (Manus bell)
    await notifyOwner({
      title: `Follow-up due: ${item.name}`,
      content: `${item.nextStep}\nOwner: ${item.owner} · Due: ${dueLabel}\n${item.internalNote ?? ""}`.trim(),
    }).catch((err) => {
      console.error("[FollowUpReminders] notifyOwner failed:", err);
    });

    // Activity log (shows in the bell feed inside the app)
    logActivity({
      eventType: "followup_due",
      title: `Follow-up due — ${item.name}`,
      body: `${item.nextStep} · Owner: ${item.owner} · Due: ${dueLabel}`,
      meta: { followUpId: item.id, owner: item.owner, type: item.type },
    }).catch(() => {});

    console.log(`[FollowUpReminders] Sent reminder for follow-up #${item.id} — ${item.name}`);
    sent++;
  }

  return { checked: due.length, sent };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseHistory(raw: string | null): Array<{ text: string; time: string; ts?: number }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
