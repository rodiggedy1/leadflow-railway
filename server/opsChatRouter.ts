/**
 * opsChatRouter — tRPC procedures for the internal OpsChat tool.
 *
 * Procedures:
 *   opsChat.listTodayJobs     — today's cleaner jobs with status, issue, team
 *   opsChat.getJobDetail      — full job detail + live timeline + thread
 *   opsChat.sendMessage       — post an internal ops message to a job thread or channel
 *   opsChat.listChannelMessages — fetch messages for a named channel
 *   opsChat.getChannelCounts  — unread/total counts per channel for the sidebar
 */

import { z } from "zod";
import { opsChatProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  fieldMgmtLog,
  jobPhotos,
  jobStatusHistory,
  jobSmsReplies,
  opsChatMessages,
  issueFlags,
  opsChatReads,
} from "../drizzle/schema";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";

// ── helpers ──────────────────────────────────────────────────────────────────

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Map cleanerJob.jobStatus to the UI priority bucket */
function toPriorityStatus(jobStatus: string | null | undefined): "issue" | "soon" | "progress" | "complete" | "assigned" {
  if (!jobStatus) return "assigned";
  if (jobStatus === "issue_at_property") return "issue";
  if (jobStatus === "completed") return "complete";
  if (jobStatus === "in_progress" || jobStatus === "arrived") return "progress";
  if (jobStatus === "on_the_way" || jobStatus === "running_late") return "soon";
  return "assigned";
}

/** Derive a human-readable time from serviceDateTime */
function formatTime(serviceDateTime: string | null | undefined): string {
  if (!serviceDateTime) return "";
  try {
    return new Date(serviceDateTime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

// ── router ────────────────────────────────────────────────────────────────────

export const opsChatRouter = router({
  /**
   * List all cleaner jobs for today, grouped by priority status.
   * Returns the minimal shape needed for the left-panel job list.
   */
  listTodayJobs: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const today = todayDateString();
    const rows = await db
      .select({
        id: cleanerJobs.id,
        cleanerName: cleanerJobs.cleanerName,
        teamName: cleanerJobs.teamName,
        customerName: cleanerJobs.customerName,
        jobAddress: cleanerJobs.jobAddress,
        serviceType: cleanerJobs.serviceType,
        jobRevenue: cleanerJobs.jobRevenue,
        jobStatus: cleanerJobs.jobStatus,
        issueNote: cleanerJobs.issueNote,
        serviceDateTime: cleanerJobs.serviceDateTime,
        bookingStatus: cleanerJobs.bookingStatus,
        customerNotes: cleanerJobs.customerNotes,
        staffNotes: cleanerJobs.staffNotes,
        flagged: cleanerJobs.flagged,
        adminNotes: cleanerJobs.adminNotes,
        cleanerProfileId: cleanerJobs.cleanerProfileId,
        photoSubmitted: cleanerJobs.photoSubmitted,
      })
      .from(cleanerJobs)
      .where(and(eq(cleanerJobs.jobDate, today)))
      .orderBy(cleanerJobs.serviceDateTime);

    // Fetch unread ops-chat message counts per job
    const jobIds = rows.map((r) => r.id);
    let msgCounts: Record<number, number> = {};
    if (jobIds.length > 0) {
      // Count all ops chat messages per job (simple approach — no read tracking yet)
      const msgs = await db
        .select({ cleanerJobId: opsChatMessages.cleanerJobId })
        .from(opsChatMessages)
        .where(
          or(...jobIds.map((id) => eq(opsChatMessages.cleanerJobId, id)))
        );
      for (const m of msgs) {
        if (m.cleanerJobId) {
          msgCounts[m.cleanerJobId] = (msgCounts[m.cleanerJobId] ?? 0) + 1;
        }
      }
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.customerName ? `${r.customerName.split(" ")[0]} Home` : r.jobAddress ?? "Job",
      client: r.customerName ?? "",
      team: r.teamName ?? r.cleanerName,
      address: r.jobAddress ?? "",
      serviceType: r.serviceType ?? "",
      price: r.jobRevenue ? `$${r.jobRevenue}` : "",
      time: formatTime(r.serviceDateTime),
      serviceDateTime: r.serviceDateTime,
      status: toPriorityStatus(r.jobStatus),
      jobStatus: r.jobStatus,
      issueNote: r.issueNote ?? null,
      flagged: r.flagged === 1,
      messageCount: msgCounts[r.id] ?? 0,
      cleanerProfileId: r.cleanerProfileId,
      photoSubmitted: r.photoSubmitted === 1,
    }));
  }),

  /**
   * Full job detail: job info + live timeline + thread (ops messages + SMS replies).
   */
  getJobDetail: opsChatProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const [job] = await db
        .select()
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.jobId))
        .limit(1);

      if (!job) return null;

      // Cleaner profile for phone
      const [profile] = await db
        .select({ phone: cleanerProfiles.phone, name: cleanerProfiles.name })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.id, job.cleanerProfileId))
        .limit(1);

      // Live timeline: status history + field mgmt log + photos
      const statusHistory = await db
        .select()
        .from(jobStatusHistory)
        .where(eq(jobStatusHistory.cleanerJobId, input.jobId))
        .orderBy(jobStatusHistory.changedAt);

      const fmLog = await db
        .select()
        .from(fieldMgmtLog)
        .where(eq(fieldMgmtLog.cleanerJobId, input.jobId))
        .orderBy(fieldMgmtLog.firedAt);

      const photos = await db
        .select()
        .from(jobPhotos)
        .where(eq(jobPhotos.cleanerJobId, input.jobId))
        .orderBy(jobPhotos.createdAt);

      // Thread: ops chat messages + inbound SMS replies
      const opsMessages = await db
        .select()
        .from(opsChatMessages)
        .where(eq(opsChatMessages.cleanerJobId, input.jobId))
        .orderBy(opsChatMessages.createdAt);

      const smsReplies = await db
        .select()
        .from(jobSmsReplies)
        .where(eq(jobSmsReplies.cleanerJobId, input.jobId))
        .orderBy(jobSmsReplies.receivedAt);

      // Merge timeline events into a unified sorted list
      type TimelineEvent = {
        id: string;
        ts: number;
        type: "arrival" | "photo" | "issue" | "schedule" | "complete";
        text: string;
      };

      const timeline: TimelineEvent[] = [];

      // Status history — team field events only
      const cleanerFirstName = job.cleanerName?.split(" ")[0] ?? "Team";
      for (const sh of statusHistory) {
        const statusLabels: Record<string, string> = {
          on_the_way:        `${cleanerFirstName} is on the way`,
          arrived:           `${cleanerFirstName} checked in on site`,
          running_late:      `${cleanerFirstName} running late`,
          in_progress:       `${cleanerFirstName} started the job`,
          completed:         `${cleanerFirstName} marked job complete`,
          issue_at_property: `Issue flagged at property`,
        };
        const type: TimelineEvent["type"] =
          sh.status === "arrived"           ? "arrival"
          : sh.status === "completed"       ? "complete"
          : sh.status === "issue_at_property" ? "issue"
          : "schedule";
        timeline.push({
          id: `sh-${sh.id}`,
          ts: sh.changedAt.getTime(),
          type,
          text: statusLabels[sh.status] ?? sh.status,
        });
      }

      // Photos — grouped by minute to show count
      const photoGroups = new Map<string, { ts: number; count: number }>();
      for (const p of photos) {
        const key = new Date(p.createdAt).toISOString().slice(0, 16);
        const g = photoGroups.get(key);
        if (g) { g.count++; } else { photoGroups.set(key, { ts: p.createdAt.getTime(), count: 1 }); }
      }
      let pgIdx = 0;
      for (const [, g] of Array.from(photoGroups)) {
        timeline.push({
          id: `ph-${pgIdx++}`,
          ts: g.ts,
          type: "photo",
          text: g.count === 1 ? "1 photo uploaded" : `${g.count} photos uploaded`,
        });
      }

      timeline.sort((a, b) => a.ts - b.ts);

      // Merge thread messages
      type ThreadMessage = {
        id: string;
        ts: number;
        from: string;
        role: string;
        body: string;
        mediaUrl?: string | null;
        quickAction?: string | null;
        source: "ops" | "sms";
      };

      const thread: ThreadMessage[] = [];

      for (const m of opsMessages) {
        thread.push({
          id: `ops-${m.id}`,
          ts: m.createdAt.getTime(),
          from: m.authorName,
          role: m.authorRole,
          body: m.body,
          mediaUrl: m.mediaUrl,
          quickAction: m.quickAction,
          source: "ops",
        });
      }

      for (const s of smsReplies) {
        thread.push({
          id: `sms-${s.id}`,
          ts: s.receivedAt.getTime(),
          from: s.senderType === "cleaner" ? (profile?.name ?? "Cleaner") : (job.customerName ?? "Client"),
          role: s.senderType,
          body: s.body,
          source: "sms",
        });
      }

      thread.sort((a, b) => a.ts - b.ts);

      return {
        job: {
          id: job.id,
          title: job.customerName ? `${job.customerName.split(" ")[0]} Home` : job.jobAddress ?? "Job",
          client: job.customerName ?? "",
          address: job.jobAddress ?? "",
          serviceType: job.serviceType ?? "",
          price: job.jobRevenue ? `$${job.jobRevenue}` : "",
          time: formatTime(job.serviceDateTime),
          serviceDateTime: job.serviceDateTime,
          status: toPriorityStatus(job.jobStatus),
          jobStatus: job.jobStatus,
          issueNote: job.issueNote ?? null,
          customerNotes: job.customerNotes ?? null,
          staffNotes: job.staffNotes ?? null,
          adminNotes: job.adminNotes ?? null,
          flagged: job.flagged === 1,
          photoSubmitted: job.photoSubmitted === 1,
          customerPhone: job.customerPhone ?? null,
          cleanerPhone: profile?.phone ?? null,
          cleanerName: job.cleanerName,
          teamName: job.teamName ?? null,
        },
        timeline,
        thread,
      };
    }),

  /**
   * Post an internal ops message to a job thread or channel.
   */
  sendMessage: opsChatProcedure
    .input(
      z.object({
        cleanerJobId: z.number().int().positive().optional(),
        channel: z.string().max(64).optional(),
        body: z.string().min(1).max(4000),
        authorName: z.string().min(1).max(128),
        authorRole: z.enum(["office", "agent", "system"]).default("office"),
        mediaUrl: z.string().url().optional(),
        quickAction: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      await db.insert(opsChatMessages).values({
        cleanerJobId: input.cleanerJobId ?? null,
        channel: input.channel ?? null,
        authorName: input.authorName,
        authorRole: input.authorRole,
        body: input.body,
        mediaUrl: input.mediaUrl ?? null,
        quickAction: input.quickAction ?? null,
      });

      return { success: true };
    }),

  /**
   * Fetch messages for a named channel (urgent, dispatch, general, cleaners).
   */
  listChannelMessages: opsChatProcedure
    .input(z.object({ channel: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const msgs = await db
        .select()
        .from(opsChatMessages)
        .where(eq(opsChatMessages.channel, input.channel))
        .orderBy(desc(opsChatMessages.createdAt))
        .limit(100);

      return msgs.reverse().map((m) => ({
        id: m.id,
        ts: m.createdAt.getTime(),
        from: m.authorName,
        role: m.authorRole,
        body: m.body,
        mediaUrl: m.mediaUrl,
        quickAction: m.quickAction,
      }));
    }),

  /**
   * Channel message counts for the sidebar badges.
   */
  getChannelCounts: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { urgent: 0, dispatch: 0, general: 0, cleaners: 0 };

    const channels = ["urgent", "dispatch", "general", "cleaners"] as const;
    const result: Record<string, number> = {};

    for (const ch of channels) {
      const rows = await db
        .select({ id: opsChatMessages.id })
        .from(opsChatMessages)
        .where(eq(opsChatMessages.channel, ch));
      result[ch] = rows.length;
    }

    return result as { urgent: number; dispatch: number; general: number; cleaners: number };
  }),

  /**
   * Flag an issue on a job. Requires an issueNote and at least one photo URL.
   * Creates a row in issue_flags and updates cleanerJobs.flagged + issueNote.
   */
  flagIssue: opsChatProcedure
    .input(
      z.object({
        cleanerJobId: z.number().int().positive(),
        issueNote: z.string().min(1).max(2000),
        photoUrl: z.string().url().optional(), // required in practice — validated in UI
        flaggedByName: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const now = Date.now();

      await db.insert(issueFlags).values({
        cleanerJobId: input.cleanerJobId,
        issueNote: input.issueNote,
        flaggedAt: now,
        flaggedBy: ctx.opsCaller.id,
        flaggedByName: input.flaggedByName,
        hasPhoto: input.photoUrl ? 1 : 0,
      });

      // Also update the job row so the priority queue reflects it immediately
      await db
        .update(cleanerJobs)
        .set({ flagged: 1, issueNote: input.issueNote })
        .where(eq(cleanerJobs.id, input.cleanerJobId));

      // Post a system message into the job thread for visibility
      await db.insert(opsChatMessages).values({
        cleanerJobId: input.cleanerJobId,
        channel: null,
        authorName: input.flaggedByName,
        authorRole: "office",
        body: `⚠️ Issue flagged: ${input.issueNote}`,
        mediaUrl: input.photoUrl ?? null,
        quickAction: "issue",
      });

      return { success: true };
    }),

  /**
   * Resolve an open issue flag. Records who resolved it, when, and the resolution note.
   */
  resolveIssue: opsChatProcedure
    .input(
      z.object({
        flagId: z.number().int().positive(),
        resolutionNote: z.string().min(1).max(2000),
        resolvedByName: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const now = Date.now();

      // Get the flag to find the job
      const [flag] = await db
        .select()
        .from(issueFlags)
        .where(eq(issueFlags.id, input.flagId))
        .limit(1);

      if (!flag) throw new Error("Flag not found");
      if (flag.resolvedAt) throw new Error("Flag already resolved");

      await db
        .update(issueFlags)
        .set({
          resolvedAt: now,
          resolvedBy: ctx.opsCaller.id,
          resolvedByName: input.resolvedByName,
          resolutionNote: input.resolutionNote,
        })
        .where(eq(issueFlags.id, input.flagId));

      // Check if any other open flags remain for this job
      const remaining = await db
        .select({ id: issueFlags.id })
        .from(issueFlags)
        .where(and(eq(issueFlags.cleanerJobId, flag.cleanerJobId), isNull(issueFlags.resolvedAt)));

      if (remaining.length === 0) {
        // No more open flags — clear the job's flagged state
        await db
          .update(cleanerJobs)
          .set({ flagged: 0 })
          .where(eq(cleanerJobs.id, flag.cleanerJobId));
      }

      // Post resolution message into the job thread
      await db.insert(opsChatMessages).values({
        cleanerJobId: flag.cleanerJobId,
        channel: null,
        authorName: input.resolvedByName,
        authorRole: "office",
        body: `✅ Issue resolved: ${input.resolutionNote}`,
        mediaUrl: null,
        quickAction: "resolved",
      });

      return { success: true };
    }),

  /**
   * Get all open issue flags for today's jobs (for the escalation countdown).
   */
  getOpenFlags: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const today = todayDateString();

    // Get today's job IDs
    const todayJobs = await db
      .select({ id: cleanerJobs.id })
      .from(cleanerJobs)
      .where(eq(cleanerJobs.jobDate, today));

    if (todayJobs.length === 0) return [];

    const jobIds = todayJobs.map((j) => j.id);

    const flags = await db
      .select()
      .from(issueFlags)
      .where(
        and(
          isNull(issueFlags.resolvedAt),
          or(...jobIds.map((id) => eq(issueFlags.cleanerJobId, id)))
        )
      )
      .orderBy(issueFlags.flaggedAt);

    return flags.map((f) => ({
      id: f.id,
      cleanerJobId: f.cleanerJobId,
      issueNote: f.issueNote,
      flaggedAt: f.flaggedAt,
      flaggedByName: f.flaggedByName ?? "",
      hasPhoto: f.hasPhoto === 1,
    }));
  }),

  /**
   * Mark all messages up to `lastMessageId` as read for the current caller.
   * Called when the user opens a channel or job thread.
   */
  markRead: opsChatProcedure
    .input(z.object({
      lastMessageId: z.number().int().positive(),
      channel: z.string().optional(),
      cleanerJobId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return;
      const callerId = ctx.opsCaller.id;
      const callerName = ctx.opsCaller.name;
      // Upsert: update if exists, insert if not
      const existing = await db
        .select({ id: opsChatReads.id })
        .from(opsChatReads)
        .where(
          and(
            eq(opsChatReads.callerId, callerId),
            input.channel ? eq(opsChatReads.channel, input.channel) : isNull(opsChatReads.channel),
            input.cleanerJobId ? eq(opsChatReads.cleanerJobId, input.cleanerJobId) : isNull(opsChatReads.cleanerJobId),
          )
        )
        .limit(1);
      if (existing.length > 0) {
        await db.update(opsChatReads)
          .set({ lastReadMessageId: input.lastMessageId, callerName, updatedAt: new Date() })
          .where(eq(opsChatReads.id, existing[0].id));
      } else {
        await db.insert(opsChatReads).values({
          callerId,
          callerName,
          channel: input.channel ?? null,
          cleanerJobId: input.cleanerJobId ?? null,
          lastReadMessageId: input.lastMessageId,
        });
      }
    }),

  /**
   * Get who has seen a specific message (for read receipts).
   * Returns names of callers whose lastReadMessageId >= the given messageId.
   */
  getSeenBy: opsChatProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      channel: z.string().optional(),
      cleanerJobId: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { seenBy: [] };
      const { gte: gteOp } = await import("drizzle-orm");
      const rows = await db
        .select({ callerName: opsChatReads.callerName, callerId: opsChatReads.callerId })
        .from(opsChatReads)
        .where(
          and(
            gteOp(opsChatReads.lastReadMessageId, input.messageId),
            input.channel ? eq(opsChatReads.channel, input.channel) : isNull(opsChatReads.channel),
            input.cleanerJobId ? eq(opsChatReads.cleanerJobId, input.cleanerJobId) : isNull(opsChatReads.cleanerJobId),
          )
        );
      // Exclude the current caller from their own read receipts
      const seenBy = rows
        .filter((r) => r.callerId !== ctx.opsCaller.id)
        .map((r) => r.callerName);
      return { seenBy };
    }),

  /**
   * Get unread message counts per channel for the current caller.
   * Returns count of messages with id > caller's lastReadMessageId.
   */
  getUnreadCounts: opsChatProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { urgent: 0, dispatch: 0, general: 0, cleaners: 0 };
    const callerId = ctx.opsCaller.id;
    const channels = ["urgent", "dispatch", "general", "cleaners"] as const;
    const result: Record<string, number> = {};
    const { gt: gtOp } = await import("drizzle-orm");
    for (const ch of channels) {
      // Get caller's last read message id for this channel
      const readRow = await db
        .select({ lastReadMessageId: opsChatReads.lastReadMessageId })
        .from(opsChatReads)
        .where(and(eq(opsChatReads.callerId, callerId), eq(opsChatReads.channel, ch)))
        .limit(1);
      const lastRead = readRow[0]?.lastReadMessageId ?? 0;
      // Count messages after that
      const rows = await db
        .select({ id: opsChatMessages.id })
        .from(opsChatMessages)
        .where(and(eq(opsChatMessages.channel, ch), gtOp(opsChatMessages.id, lastRead)));
      result[ch] = rows.length;
    }
    return result as { urgent: number; dispatch: number; general: number; cleaners: number };
  }),
});
