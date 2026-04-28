/**
 * alwaysOnRouter.ts
 *
 * tRPC procedures for the Always-On Campaign admin UI.
 *
 * Procedures:
 *   alwaysOn.listGroups      → all 4 groups with stats
 *   alwaysOn.getGroupContacts → paginated enrollments for a group
 *   alwaysOn.updateGroup     → edit message template, batch size, isActive
 *   alwaysOn.manualEnroll    → trigger enrollment run now (for backfill)
 *   alwaysOn.groupStats      → aggregate stats per group
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb, insertSession } from "./db";
import {
  alwaysOnGroups,
  alwaysOnEnrollments,
  type AlwaysOnGroupType,
} from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { enrollNewlyEligible, seedDefaultGroups } from "./alwaysOnEngine";
import { personalizeMessage } from "./alwaysOnSend";
import { sendSms } from "./openphone";
import { conversationSessions } from "../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const alwaysOnRouter = router({
  /**
   * Returns all four always-on groups with their current stats.
   * Seeds default groups if they don't exist yet.
   */
  listGroups: protectedProcedure.query(async () => {
    await seedDefaultGroups();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const groups = await db
      .select()
      .from(alwaysOnGroups)
      .orderBy(alwaysOnGroups.id);

    return groups;
  }),

  /**
   * Returns paginated enrollments for a specific group.
   */
  getGroupContacts: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        status: z.enum(["PENDING", "SENT", "REPLIED", "BOOKED", "OPTED_OUT", "SKIPPED", "all"]).default("all"),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [eq(alwaysOnEnrollments.groupId, input.groupId)];
      if (input.status !== "all") {
        conditions.push(eq(alwaysOnEnrollments.status, input.status));
      }

      const contacts = await db
        .select()
        .from(alwaysOnEnrollments)
        .where(and(...conditions))
        .orderBy(desc(alwaysOnEnrollments.jobDate), desc(alwaysOnEnrollments.enrolledAt))
        .limit(input.limit)
        .offset(input.offset);

      // Total count for pagination
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(alwaysOnEnrollments)
        .where(and(...conditions));

      return {
        contacts,
        total: Number(countRow?.count ?? 0),
      };
    }),

  /**
   * Update a group's message template, batch size, or active status.
   */
  updateGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        messageTemplate: z.string().min(10).max(1600).optional(),
        batchSize: z.number().min(1).max(500).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const updates: Record<string, unknown> = {};
      if (input.messageTemplate !== undefined) updates.messageTemplate = input.messageTemplate;
      if (input.batchSize !== undefined) updates.batchSize = input.batchSize;
      if (input.isActive !== undefined) updates.isActive = input.isActive ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      await db
        .update(alwaysOnGroups)
        .set(updates)
        .where(eq(alwaysOnGroups.id, input.groupId));

      return { ok: true };
    }),

  /**
   * Manually trigger an enrollment run (useful for backfill or testing).
   * Enrolls all currently eligible completedJobs not yet in any group.
   */
  manualEnroll: protectedProcedure.mutation(async () => {
    const enrolled = await enrollNewlyEligible();
    const total = Object.values(enrolled).reduce((a, b) => a + b, 0);
    return { ok: true, enrolled, total };
  }),

  /**
   * Sends a test message for a group to a specified phone number.
   * Uses a sample enrollment (or placeholder tokens) to render the personalized message.
   */
  sendTestMessage: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        testPhone: z.string().min(10).max(20),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Load the group
      const [group] = await db
        .select()
        .from(alwaysOnGroups)
        .where(eq(alwaysOnGroups.id, input.groupId))
        .limit(1);

      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      // Try to find a real PENDING enrollment to use as sample data
      const [sampleEnrollment] = await db
        .select()
        .from(alwaysOnEnrollments)
        .where(
          and(
            eq(alwaysOnEnrollments.groupId, input.groupId),
            eq(alwaysOnEnrollments.status, "PENDING")
          )
        )
        .limit(1);

      // Render the message with real or placeholder tokens
      const renderedMessage = personalizeMessage(group.messageTemplate, {
        firstName: sampleEnrollment?.firstName ?? "Sarah",
        lastBookingPrice: sampleEnrollment?.lastBookingPrice ?? 18000, // $180 placeholder
        discountPct: sampleEnrollment?.discountPct ?? 10,
      });

      // Normalize phone number to E.164
      const digits = input.testPhone.replace(/\D/g, "");
      const e164 = digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

      // Send via OpenPhone
      const result = await sendSms({ to: e164, content: renderedMessage });

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to send test message",
        });
      }

      // Create a conversation session so replies to the test message go through the AI engine
      // Delete any existing REACTIVATION session for this test phone first to avoid duplicates
      await db
        .delete(conversationSessions)
        .where(
          and(
            eq(conversationSessions.leadPhone, e164),
            sql`${conversationSessions.leadSource} LIKE 'always-on-test:%'`
          )
        );

      const lastPrice = sampleEnrollment?.lastBookingPrice
        ? Math.round(sampleEnrollment.lastBookingPrice / 100)
        : 180; // $180 placeholder
      const discountPct = sampleEnrollment?.discountPct ?? 10;

      await insertSession(db, {
        leadPhone: e164,
        leadName: sampleEnrollment?.firstName ?? "Sarah",
        stage: "REACTIVATION",
        leadSource: `always-on-test:${group.groupType}`,
        reactivationLastPrice: lastPrice,
        reactivationDiscountPct: discountPct,
        messageHistory: JSON.stringify([
          { role: "assistant", content: renderedMessage, ts: Date.now() },
        ]),
        aiMode: 1,
        isBooked: 0,
      });

      return {
        ok: true,
        renderedMessage,
        sentTo: e164,
        usedSampleData: !!sampleEnrollment,
      };
    }),

  /**
   * Returns per-group stats breakdown (pending/sent/replied/booked counts).
   */
  groupStats: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({
          status: alwaysOnEnrollments.status,
          count: sql<number>`count(*)`,
        })
        .from(alwaysOnEnrollments)
        .where(eq(alwaysOnEnrollments.groupId, input.groupId))
        .groupBy(alwaysOnEnrollments.status);

      const stats: Record<string, number> = {
        PENDING: 0,
        SENT: 0,
        REPLIED: 0,
        BOOKED: 0,
        OPTED_OUT: 0,
        SKIPPED: 0,
      };

      for (const row of rows) {
        stats[row.status] = Number(row.count);
      }

      return stats;
    }),

  /**
   * Returns the full conversation thread for a specific enrollment.
   * Looks up the linked conversationSession and returns all messages
   * plus session metadata (stage, address, slot, etc.).
   */
  getConversation: protectedProcedure
    .input(z.object({ enrollmentId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Get the enrollment to find the sessionId and phone
      const [enrollment] = await db
        .select()
        .from(alwaysOnEnrollments)
        .where(eq(alwaysOnEnrollments.id, input.enrollmentId))
        .limit(1);

      if (!enrollment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found" });
      }

      // If there's a linked session, fetch it
      let session = null;
      if (enrollment.sessionId) {
        const [row] = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.id, enrollment.sessionId))
          .limit(1);
        session = row ?? null;
      } else {
        // Fall back: find the most recent session for this phone with always-on source
        const rows = await db
          .select()
          .from(conversationSessions)
          .where(
            and(
              eq(conversationSessions.leadPhone, enrollment.phone),
              sql`${conversationSessions.leadSource} LIKE 'always-on%'`
            )
          )
          .orderBy(desc(conversationSessions.createdAt))
          .limit(1);
        session = rows[0] ?? null;
      }

      // Parse messageHistory JSON
      let messages: Array<{ role: string; content: string; ts?: number }> = [];
      if (session?.messageHistory) {
        try {
          messages = JSON.parse(session.messageHistory as string);
        } catch {
          messages = [];
        }
      }

      // Prepend the initial outbound message (the always-on SMS that was sent)
      // so the thread starts with what we sent them
      const initialMessage = enrollment.openPhoneMessageId
        ? null // already in messageHistory if session was created
        : null;
      void initialMessage; // suppress unused warning

      return {
        enrollment: {
          id: enrollment.id,
          phone: enrollment.phone,
          name: enrollment.name,
          firstName: enrollment.firstName,
          status: enrollment.status,
          sentAt: enrollment.sentAt,
          repliedAt: enrollment.repliedAt,
          jobDate: enrollment.jobDate,
        },
        session: session
          ? {
              id: session.id,
              stage: session.stage,
              address: session.address,
              selectedSlot: session.selectedSlot,
              isBooked: session.isBooked,
              createdAt: session.createdAt,
            }
          : null,
        messages,
        hasSession: session !== null,
      };
    }),
});
