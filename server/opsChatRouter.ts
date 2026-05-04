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
import { TRPCError } from "@trpc/server";
import { opsChatProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { sendPushToAll } from "./webPush";
import {
  cleanerJobs,
  cleanerProfiles,
  completedJobs,
  conversationSessions,
  fieldMgmtLog,
  jobPhotos,
  jobStatusHistory,
  jobSmsReplies,
  opsChatMessages,
  issueFlags,
  issueOwnership,
  issueComments,
  opsChatReads,
  opsChatReactions,
  channelPins,
  opsReminders,
  agents,
  users,
  quoteLeads,
} from "../drizzle/schema";
import { and, desc, eq, gte, inArray, isNull, isNotNull, like, lte, ne, or, sql } from "drizzle-orm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { sendSms } from "./openphone";
import { broadcastOpsUpdate } from "./sseBroadcast";
// ── helpers ───────────────────────────────────────────────────────────────────

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Map cleanerJob.jobStatus + flagged to the UI priority bucket */
function toPriorityStatus(jobStatus: string | null | undefined, flagged?: number | null): "issue" | "soon" | "progress" | "complete" | "assigned" {
  if (flagged === 1) return "issue"; // manually flagged always surfaces at top
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
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

// ── router ────────────────────────────────────────────────────────────────────

// In-memory typing presence store (ephemeral, no DB needed)
const typingStore = new Map<string, Map<string, { name: string; expiresAt: number }>>();

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
      .where(and(eq(cleanerJobs.jobDate, today), ne(cleanerJobs.bookingStatus, "rescheduled"), ne(cleanerJobs.bookingStatus, "cancelled")))
      .orderBy(cleanerJobs.serviceDateTime);

    // Fetch flaggedAt for open flags so the frontend can show escalation timers
    const flaggedJobIds = rows.filter(r => r.flagged === 1).map(r => r.id);
    let flaggedAtMap: Record<number, number> = {};
    if (flaggedJobIds.length > 0) {
      const flags = await db
        .select({ cleanerJobId: issueFlags.cleanerJobId, flaggedAt: issueFlags.flaggedAt })
        .from(issueFlags)
        .where(
          and(
            isNull(issueFlags.resolvedAt),
            or(...flaggedJobIds.map(id => eq(issueFlags.cleanerJobId, id)))
          )
        )
        .orderBy(desc(issueFlags.flaggedAt));
      for (const f of flags) {
        if (f.cleanerJobId && !flaggedAtMap[f.cleanerJobId]) {
          flaggedAtMap[f.cleanerJobId] = f.flaggedAt;
        }
      }
    }

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
      title: r.customerName ?? r.jobAddress ?? "Job",
      client: r.customerName ?? "",
      team: r.teamName ?? r.cleanerName,
      address: r.jobAddress ?? "",
      serviceType: r.serviceType ?? "",
      price: r.jobRevenue ? `$${r.jobRevenue}` : "",
      time: formatTime(r.serviceDateTime),
      serviceDateTime: r.serviceDateTime,
      status: toPriorityStatus(r.jobStatus, r.flagged),
      jobStatus: r.jobStatus,
      issueNote: r.issueNote ?? null,
      flagged: r.flagged === 1,
      flaggedAt: r.flagged === 1 ? (flaggedAtMap[r.id] ?? null) : null,
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

      // Open issue flag (for resolve button)
      const openFlags = await db
        .select({ id: issueFlags.id, note: issueFlags.issueNote, flaggedByName: issueFlags.flaggedByName })
        .from(issueFlags)
        .where(and(eq(issueFlags.cleanerJobId, input.jobId), isNull(issueFlags.resolvedAt)))
        .orderBy(desc(issueFlags.id))
        .limit(1);
      const openFlag = openFlags[0] ?? null;
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

      // Synthetic "completed" event — if the job is marked complete but no history
      // row exists for it (e.g. completed via markComplete which doesn't write history),
      // append one using completedAt (precise) or updatedAt (fallback).
      const alreadyHasCompleted = timeline.some(e => e.type === "complete");
      if (!alreadyHasCompleted && (job.jobStatus === "completed" || job.bookingStatus === "completed")) {
        const completedTs = job.completedAt
          ? job.completedAt.getTime()
          : job.updatedAt.getTime();
        const cleanerFirstNameFinal = job.cleanerName?.split(" ")[0] ?? "Team";
        timeline.push({
          id: "synthetic-complete",
          ts: completedTs,
          type: "complete",
          text: `${cleanerFirstNameFinal} marked job complete`,
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
        metadata?: string | null;
        replyToId?: number | null;
        replyToBody?: string | null;
        replyToAuthor?: string | null;
        source: "ops" | "sms";
        deliveryStatus?: string | null;
        isEtaUpdate?: boolean;
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
          metadata: m.metadata ?? null,
          replyToId: m.replyToId ?? null,
          replyToBody: m.replyToBody ?? null,
          replyToAuthor: m.replyToAuthor ?? null,
          source: "ops",
        });
      }

      for (const s of smsReplies) {
        // Skip system_outbound rows — these are the same client-facing automation SMS
        // already tracked in fieldMgmtLog (client_pre_job, client_on_the_way, etc.).
        // Including both causes duplicate cards in the job thread.
        if (s.senderType === "system_outbound") continue;
        thread.push({
          id: `sms-${s.id}`,
          ts: s.receivedAt.getTime(),
          from: s.senderType === "cleaner" ? (profile?.name ?? "Cleaner") : s.senderType === "system" ? "System (Manual SMS)" : (job.customerName ?? "Client"),
          role: s.senderType,
          body: s.body,
          source: "sms",
          deliveryStatus: (s as any).deliveryStatus ?? null,
        });
      }

      // Add outbound SMS sent to client from the automation engine (fieldMgmtLog)
      const CLIENT_FACING_STEPS = new Set(["client_pre_job", "client_on_the_way", "client_running_late"]);
      const STEP_LABELS: Record<string, string> = {
        client_pre_job: "Pre-Job Reminder",
        client_on_the_way: "On the Way",
        client_running_late: "Running Late",
      };
      for (const f of fmLog) {
        // Include eta_update_* steps (ETA update SMS sent to client on each ETA change)
        const isEtaUpdate = f.step.startsWith("eta_update_");
        if (!f.smsSent || (!CLIENT_FACING_STEPS.has(f.step) && !isEtaUpdate)) continue;
        thread.push({
          id: `fmlog-${f.id}`,
          ts: f.firedAt.getTime(),
          from: isEtaUpdate ? "System (ETA Update)" : `System (${STEP_LABELS[f.step] ?? f.step})`,
          role: "system_outbound",
          body: f.smsSent,
          source: "sms",
          deliveryStatus: (f as any).deliveryStatus ?? null,
          isEtaUpdate,
        });
      }

      // Add manual outbound SMS (senderType="system") from jobSmsReplies
      // (these are logged by sendJobSms in fieldMgmtRouter)
      // They are already included in smsReplies above since we fetch all rows,
      // so no extra loop needed — the role "system" will be handled by the frontend.

      thread.sort((a, b) => a.ts - b.ts);

      return {
        job: {
          id: job.id,
          title: job.customerName ?? job.jobAddress ?? "Job",
          client: job.customerName ?? "",
          address: job.jobAddress ?? "",
          serviceType: job.serviceType ?? "",
          price: job.jobRevenue ? `$${job.jobRevenue}` : "",
          time: formatTime(job.serviceDateTime),
          serviceDateTime: job.serviceDateTime,
          status: toPriorityStatus(job.jobStatus, job.flagged),
          jobStatus: job.jobStatus,
          issueNote: job.issueNote ?? null,
          customerNotes: job.customerNotes ?? null,
          staffNotes: job.staffNotes ?? null,
          adminNotes: job.adminNotes ?? null,
          flagged: job.flagged === 1,
          openFlagId: openFlag?.id ?? null,
          openFlagNote: openFlag?.note ?? null,
          openFlaggedBy: openFlag?.flaggedByName ?? null,
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
        mediaUrl: z.string().optional(), // JSON array of URLs or single URL for backwards compat
        quickAction: z.string().max(64).optional(),
        /** Quote-reply: ID of the message being replied to */
        replyToId: z.number().int().positive().optional(),
        /** Quote-reply: snapshot of replied-to body (truncated to 512 chars) */
        replyToBody: z.string().max(512).optional(),
        /** Quote-reply: display name of replied-to author */
        replyToAuthor: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Dedup guard: if this is an "I'm Back" message, check whether the same author
      // already posted one in the last 10 seconds. If so, silently skip the insert.
      // This prevents duplicate messages when the button click + keystroke handler
      // both fire before React has propagated the awayStatus state update.
      if (input.quickAction === "away_status:back") {
        const tenSecondsAgo = new Date(Date.now() - 10_000);
        const recent = await db
          .select({ id: opsChatMessages.id })
          .from(opsChatMessages)
          .where(
            and(
              eq(opsChatMessages.authorName, input.authorName),
              eq(opsChatMessages.quickAction, "away_status:back"),
              gte(opsChatMessages.createdAt, tenSecondsAgo)
            )
          )
          .limit(1);
        if (recent.length > 0) {
          return { success: true, deduped: true };
        }
      }

      await db.insert(opsChatMessages).values({
        cleanerJobId: input.cleanerJobId ?? null,
        channel: input.channel ?? null,
        authorName: input.authorName,
        authorRole: input.authorRole,
        body: input.body,
        mediaUrl: input.mediaUrl ?? null,
        quickAction: input.quickAction ?? null,
        replyToId: input.replyToId ?? null,
        replyToBody: input.replyToBody ?? null,
        replyToAuthor: input.replyToAuthor ?? null,
      });

      // Fire Web Push to all agents for real messages (skip system/away status noise)
      const isSystemNoise = input.quickAction?.startsWith("away_status") || input.authorRole === "system";
      if (!isSystemNoise) {
        const context = input.cleanerJobId
          ? `Job #${input.cleanerJobId}`
          : input.channel
          ? `#${input.channel}`
          : "Command Chat";
        const bodyPreview = input.body.length > 120 ? input.body.slice(0, 117) + "..." : input.body;
        void sendPushToAll({
          title: `${input.authorName} · ${context}`,
          body: bodyPreview,
          tag: `ops-msg-${input.cleanerJobId ?? input.channel ?? "cmd"}`,
          url: "/ops-chat",
          playSound: true,
        });
      }

      // Broadcast to all connected SSE clients so they refetch immediately
      broadcastOpsUpdate("new_message", {
        channel: input.channel,
        jobId: input.cleanerJobId,
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
        .limit(500);

      return msgs.reverse().map((m) => ({
        id: m.id,
        ts: m.createdAt.getTime(),
        from: m.authorName,
        role: m.authorRole,
        body: m.body,
        mediaUrl: m.mediaUrl,
        quickAction: m.quickAction,
        metadata: m.metadata ?? null,
        replyToId: m.replyToId ?? null,
        replyToBody: m.replyToBody ?? null,
        replyToAuthor: m.replyToAuthor ?? null,
        cleanerJobId: m.cleanerJobId ?? null,
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

      // Auto-post a system alert into the MIB Command Chat (command channel)
      // so the whole team sees it in real time without opening the job thread
      const [jobRow] = await db
        .select({ customerName: cleanerJobs.customerName, jobAddress: cleanerJobs.jobAddress })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);
      const jobLabel = jobRow?.customerName
        ? `${jobRow.customerName.split(" ")[0]} Home`
        : jobRow?.jobAddress ?? `Job #${input.cleanerJobId}`;
      await db.insert(opsChatMessages).values({
        cleanerJobId: null,
        channel: "command",
        authorName: "🚨 Dispatch Alert",
        authorRole: "office",
        body: `🚨 Issue raised at **${jobLabel}** (Job #${input.cleanerJobId}): ${input.issueNote}`,
        mediaUrl: input.photoUrl ?? null,
        quickAction: "issue",
      });

      // Broadcast job + command channel update
      broadcastOpsUpdate("job_update", { jobId: input.cleanerJobId });

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

      // Post styled issue_resolved card into the job thread
      const resolvedJobMeta = JSON.stringify({
        issueTitle: flag.issueNote,   // original issue description shown as "Original Issue"
        issueNote: flag.issueNote,    // also populate issueNote for backward compat
        resolutionNote: input.resolutionNote,
        resolvedBy: input.resolvedByName,
        resolvedAt: Date.now(),
      });
      await db.insert(opsChatMessages).values({
        cleanerJobId: flag.cleanerJobId,
        channel: null,
        authorName: input.resolvedByName,
        authorRole: "office",
        body: `✅ Issue resolved by ${input.resolvedByName}: ${input.resolutionNote}`,
        mediaUrl: null,
        quickAction: "issue_resolved",
        metadata: resolvedJobMeta,
      });

      // Auto-post a styled issue_resolved card into the MIB Command Chat
      const [jobRow] = await db
        .select({ customerName: cleanerJobs.customerName, jobAddress: cleanerJobs.jobAddress })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, flag.cleanerJobId))
        .limit(1);
      const jobLabel = jobRow?.customerName
        ? `${jobRow.customerName.split(" ")[0]} Home`
        : jobRow?.jobAddress ?? `Job #${flag.cleanerJobId}`;
      const resolvedCmdMeta = JSON.stringify({
        issueTitle: flag.issueNote,
        issueNote: null,
        jobTitle: jobLabel,
        resolutionNote: input.resolutionNote,
        resolvedBy: input.resolvedByName,
        resolvedAt: Date.now(),
      });
      await db.insert(opsChatMessages).values({
        cleanerJobId: null,
        channel: "command",
        authorName: input.resolvedByName,
        authorRole: "office",
        body: `✅ Issue resolved at ${jobLabel} (Job #${flag.cleanerJobId}) by ${input.resolvedByName}: ${input.resolutionNote}`,
        mediaUrl: null,
        quickAction: "issue_resolved",
        metadata: resolvedCmdMeta,
      });

      // Broadcast job update so all agents see the resolution immediately
      broadcastOpsUpdate("job_update", { jobId: flag.cleanerJobId });

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
      .where(and(eq(cleanerJobs.jobDate, today), ne(cleanerJobs.bookingStatus, "rescheduled"), ne(cleanerJobs.bookingStatus, "cancelled")));

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
   * getSeenByBulk — batch version of getSeenBy.
   * Returns a FLAT array of { messageId, callerName } pairs to avoid superjson
   * depth-limit issues with Record<number, string[]>. Client groups by messageId.
   * A caller has "seen" message N if their lastReadMessageId >= N.
   */
  getSeenByBulk: opsChatProcedure
    .input(z.object({
      messageIds: z.array(z.number().int().positive()).max(1000),
      channel: z.string().optional(),
      cleanerJobId: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db || input.messageIds.length === 0) return { reads: [] as { messageId: number; callerName: string }[] };
      try {
        // Fetch all read rows for this channel/thread in one query
        const rows = await db
          .select({
            callerName: opsChatReads.callerName,
            callerId: opsChatReads.callerId,
            lastReadMessageId: opsChatReads.lastReadMessageId,
          })
          .from(opsChatReads)
          .where(
            and(
              input.channel ? eq(opsChatReads.channel, input.channel) : isNull(opsChatReads.channel),
              input.cleanerJobId ? eq(opsChatReads.cleanerJobId, input.cleanerJobId) : isNull(opsChatReads.cleanerJobId),
            )
          );
        // Return flat list: (msgId, readerName) for every reader whose lastRead >= msgId
        // Excludes self. Client builds the map.
        const myCallerId = ctx.opsCaller.id;
        const reads: { messageId: number; callerName: string }[] = [];
        for (const msgId of input.messageIds) {
          for (const r of rows) {
            if (r.callerId !== myCallerId && r.lastReadMessageId >= msgId) {
              reads.push({ messageId: msgId, callerName: r.callerName });
            }
          }
        }
        return { reads };
      } catch (e) {
        // DB hiccup — return empty rather than crashing the server
        console.error('[getSeenByBulk] DB error, returning empty:', e);
        return { reads: [] as { messageId: number; callerName: string }[] };
      }
    }),

  /**
   * uploadOpsPhoto — upload an image from the admin/agent OpsChat composer.
   * Accepts base64-encoded image, stores in S3, returns the public URL.
   * The caller then includes the URL in a sendMessage call as mediaUrl.
   */
  uploadOpsPhoto: opsChatProcedure
    .input(z.object({
      filename: z.string().max(255),
      mimeType: z.string().max(50).refine((v) => v.startsWith("image/"), { message: "Must be an image" }),
      dataBase64: z.string().max(15 * 1024 * 1024), // 15 MB base64 limit
    }))
    .mutation(async ({ ctx, input }) => {
      const ext = input.filename.split(".").pop()?.toLowerCase() ?? "jpg";
      const randomSuffix = Math.random().toString(36).slice(2, 10);
      const callerId = ctx.opsCaller.id;
      const fileKey = `ops-chat-photos/${callerId}/${Date.now()}-${randomSuffix}.${ext}`;
      const buffer = Buffer.from(input.dataBase64, "base64");
      if (buffer.byteLength > 12 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image too large (max 12 MB)" });
      }
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      return { url };
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

  /**
   * Get all data needed for the MIB Command Chat view.
   */
  getCommandChatData: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { snapshot: { issue: 0, soon: 0, progress: 0, complete: 0, assigned: 0 }, alerts: [], pinnedJobs: [], autoRaised: [], manualIssues: [], unassignedJobs: [] };

    const today = todayDateString();
    const jobs = await db
      .select({
        id: cleanerJobs.id,
        customerName: cleanerJobs.customerName,
        jobAddress: cleanerJobs.jobAddress,
        serviceType: cleanerJobs.serviceType,
        jobStatus: cleanerJobs.jobStatus,
        flagged: cleanerJobs.flagged,
        issueNote: cleanerJobs.issueNote,
        serviceDateTime: cleanerJobs.serviceDateTime,
        teamName: cleanerJobs.teamName,
        teamId: cleanerJobs.teamId,
        cleanerProfileId: cleanerJobs.cleanerProfileId,
      })
      .from(cleanerJobs)
      .where(and(eq(cleanerJobs.jobDate, today), ne(cleanerJobs.bookingStatus, "rescheduled"), ne(cleanerJobs.bookingStatus, "cancelled")))
      .orderBy(cleanerJobs.serviceDateTime);

    // Open issue flags for auto-raised issues panel
    const jobIds = jobs.map((j) => j.id);
    const openFlags = jobIds.length > 0
      ? await db
          .select({
            id: issueFlags.id,
            cleanerJobId: issueFlags.cleanerJobId,
            note: issueFlags.issueNote,
            raisedBy: issueFlags.flaggedByName,
            createdAt: issueFlags.flaggedAt,
          })
          .from(issueFlags)
          .where(and(isNull(issueFlags.resolvedAt), or(...jobIds.map((id) => eq(issueFlags.cleanerJobId, id)))))
          .orderBy(desc(issueFlags.flaggedAt))
      : [];

    // Build snapshot counts
    const snapshot = { issue: 0, soon: 0, progress: 0, complete: 0, assigned: 0 };
    for (const j of jobs) {
      const s = toPriorityStatus(j.jobStatus, j.flagged);
      snapshot[s] = (snapshot[s] ?? 0) + 1;
    }

    // General issues posted via Open Issue chip (filter out resolved ones via metadata)
    const generalIssuesRaw = await db
      .select({
        id: opsChatMessages.id,
        body: opsChatMessages.body,
        metadata: opsChatMessages.metadata,
        createdAt: opsChatMessages.createdAt,
        authorName: opsChatMessages.authorName,
      })
      .from(opsChatMessages)
      .where(eq(opsChatMessages.quickAction, "general_issue"))
      .orderBy(desc(opsChatMessages.createdAt))
      .limit(20);
    // Filter out resolved ones (resolvedAt stored in metadata JSON)
    const generalIssues = generalIssuesRaw.filter((gi) => {
      try { const m = JSON.parse(gi.metadata ?? "{}"); return !m.resolvedAt; } catch { return true; }
    }).slice(0, 10);

    // Pending reminders (not yet fired)
    const pendingReminders = await db
      .select({ id: opsReminders.id, body: opsReminders.body, triggerAt: opsReminders.triggerAt })
      .from(opsReminders)
      .where(and(isNull(opsReminders.firedAt), eq(opsReminders.channel, "command")))
      .orderBy(opsReminders.triggerAt);

    // Live alerts: flagged jobs + starting-soon jobs (within 90 min)
    const now = Date.now();
    const alerts: Array<{
      type: "issue" | "soon" | "general_issue";
      jobId: number;
      title: string;
      body: string;
      source: string;
      ts: number;
      messageId?: number;
      resolvedAt?: number | null;
    }> = [];

    const flaggedAtByJobId: Record<number, number> = {};
    for (const f of openFlags) {
      if (f.cleanerJobId && !flaggedAtByJobId[f.cleanerJobId]) {
        flaggedAtByJobId[f.cleanerJobId] = new Date(f.createdAt as string | number | Date).getTime();
      }
    }

    for (const j of jobs) {
      const status = toPriorityStatus(j.jobStatus, j.flagged);
      if (status === "issue") {
        alerts.push({
          type: "issue",
          jobId: j.id,
          title: `Issue raised in ${j.customerName ?? j.jobAddress}`,
          body: j.issueNote ?? "Issue flagged — check job thread.",
          source: j.customerName ?? j.jobAddress ?? "Unknown",
          ts: flaggedAtByJobId[j.id] ?? now,
        });
      } else if (status === "soon") {
        const jobMs = j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : 0;
        const minutesUntil = Math.round((jobMs - now) / 60_000);
        const startTime = jobMs ? new Date(jobMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) : null;
        const timeLabel = minutesUntil > 0 ? `in ${minutesUntil} min` : startTime ? `at ${startTime}` : "soon";
        const bodyParts = [j.serviceType ?? "Cleaning", j.teamName ?? null].filter(Boolean);
        alerts.push({
          type: "soon",
          jobId: j.id,
          title: `🗓 ${j.customerName ?? j.jobAddress} — starts ${timeLabel}`,
          body: bodyParts.join(" · "),
          source: j.teamName ?? "Dispatch",
          ts: jobMs || now,
        });
      }
    }

    // Manual issues — built separately for the right panel (NOT added to alerts)
    const manualIssues = generalIssues.map((gi) => {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(gi.metadata ?? "{}"); } catch { /* ignore */ }
      const issueTitle = (meta.issueCustomer as string) || (meta.issueTitle as string) || gi.body.split("\n")[0] || "General Issue";
      const issueNote = (meta.issueNote as string) ||
        [meta.issueSeverity ? `Severity: ${meta.issueSeverity}` : null, meta.issueTeam ? `Team: ${meta.issueTeam}` : null, meta.issueCustomer ? `Customer: ${meta.issueCustomer}` : null].filter(Boolean).join(" · ") ||
        "";
      const jobTitle = (meta.jobTitle as string | null) ?? null;
      return {
        messageId: gi.id,
        title: issueTitle,
        note: issueNote,
        jobTitle,
        sourceBody: (meta.sourceMessageBody as string | null) ?? null,
        authorName: gi.authorName ?? "Team",
        ts: gi.createdAt ? new Date(gi.createdAt).getTime() : now,
      };
    });

    // Pinned day status cards
    const pinnedJobs = jobs.map((j) => ({
      id: j.id,
      name: j.customerName ?? j.jobAddress ?? "Job",
      time: j.serviceDateTime
        ? new Date(j.serviceDateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
        : "--",
      status: toPriorityStatus(j.jobStatus, j.flagged),
      address: j.jobAddress ?? "",
    }));

    // Auto-raised issues with job info
    const autoRaised = openFlags.map((f) => {
      const job = jobs.find((j) => j.id === f.cleanerJobId);
      return {
        flagId: f.id,
        jobId: f.cleanerJobId,
        jobName: job?.customerName ?? job?.jobAddress ?? "Unknown Job",
        note: f.note ?? "Issue flagged",
        raisedBy: f.raisedBy ?? "Team",
        ts: f.createdAt ? new Date(f.createdAt).getTime() : now,
      };
    });

    // Cleaner status updates from today
    const cleanerStatusesRaw = await db
      .select({
        id: opsChatMessages.id,
        body: opsChatMessages.body,
        metadata: opsChatMessages.metadata,
        createdAt: opsChatMessages.createdAt,
        dbCleanerJobId: opsChatMessages.cleanerJobId,
        // Pull live fields directly from cleanerJobs
        jobEtaTimestamp: cleanerJobs.etaTimestamp,
        jobIssueNote: cleanerJobs.issueNote,
        jobCustomerName: cleanerJobs.customerName,
        jobAddress: cleanerJobs.jobAddress,
        jobStatus: cleanerJobs.jobStatus,
        jobCleanerName: cleanerJobs.cleanerName,
        jobStatusChangedAt: sql<number | null>`(
          SELECT UNIX_TIMESTAMP(MAX(jsh.changedAt)) * 1000
          FROM job_status_history jsh
          WHERE jsh.cleanerJobId = ${cleanerJobs.id}
        )`.as("jobStatusChangedAt"),
      })
      .from(opsChatMessages)
      .leftJoin(cleanerJobs, sql`JSON_UNQUOTE(JSON_EXTRACT(${opsChatMessages.metadata}, '$.cleanerJobId')) = ${cleanerJobs.id}`)
      .where(eq(opsChatMessages.quickAction, "cleaner_status"))
      .orderBy(desc(opsChatMessages.createdAt))
      .limit(30);

    // Keep only today's entries, then deduplicate: one card per cleaner+job (most recent wins)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const seenCleanerJob = new Set<string>();
    const cleanerStatuses = cleanerStatusesRaw
      .filter(r => r.createdAt && new Date(r.createdAt).getTime() >= todayStart.getTime())
      .filter(r => {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(r.metadata ?? "{}"); } catch { /* ignore */ }
        // Use DB cleanerJobId column (reliable) + cleanerName from metadata for dedup key
        const jobId = r.dbCleanerJobId ?? (meta.cleanerJobId as number | null) ?? 0;
        const cleanerName = (meta.cleanerName as string) ?? "";
        const key = `${cleanerName}-${jobId}`;
        if (seenCleanerJob.has(key)) return false;
        seenCleanerJob.add(key);
        return true;
      })
      .map(r => {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(r.metadata ?? "{}"); } catch { /* ignore */ }
        // Use live jobStatus from cleanerJobs as authoritative — falls back to metadata
        const status = r.jobStatus ?? (meta.status as string) ?? "";
        const rawIssueNote = r.jobIssueNote ?? (meta.issueNote as string | null) ?? null;
        // Derive label/emoji from live status
        const STATUS_META: Record<string, { emoji: string; label: string }> = {
          on_the_way:        { emoji: "🚗", label: "On the way" },
          arrived:           { emoji: "🟢", label: "Arrived" },
          in_progress:       { emoji: "🧹", label: "In progress" },
          running_late:      { emoji: "⏰", label: "Running late" },
          issue_at_property: { emoji: "🚨", label: "Issue at property" },
          completed:         { emoji: "✅", label: "Completed" },
          finishing_up:      { emoji: "🏁", label: "Finishing up" },
          wrapping_up:       { emoji: "📦", label: "Wrapping up" },
        };
        const sm = STATUS_META[status];
        // issueNote is overloaded: for on_the_way/running_late it stores the ETA string.
        // Build etaLabel from: live etaTimestamp → meta.etaLabel → rawIssueNote (ETA string)
        let etaLabel: string | null = null;
        if (r.jobEtaTimestamp && r.jobEtaTimestamp > Date.now()) {
          etaLabel = new Date(r.jobEtaTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
        } else if ((meta.etaLabel as string | null)) {
          etaLabel = meta.etaLabel as string;
        } else if ((status === "on_the_way" || status === "running_late") && rawIssueNote) {
          etaLabel = rawIssueNote;
        }
        // Only surface issueNote as an issue for issue_at_property
        const issueNote = status === "issue_at_property" ? rawIssueNote : null;
        return {
          id: r.id,
          cleanerName: (meta.cleanerName as string) ?? "Cleaner",
          status,
          label: sm?.label ?? (meta.label as string) ?? "",
          emoji: sm?.emoji ?? (meta.emoji as string) ?? "🟡",
          customerName: r.jobCustomerName ?? (meta.customerName as string | null) ?? null,
          jobAddress: r.jobAddress ?? (meta.jobAddress as string | null) ?? null,
          etaLabel,
          etaTimestamp: r.jobEtaTimestamp ?? null,
          issueNote,
          cleanerJobId: (meta.cleanerJobId as number | null) ?? null,
          ts: r.jobStatusChangedAt ?? (r.createdAt ? new Date(r.createdAt).getTime() : now),
          // SMS auto-detection fields
          detectedFromSms: !!(meta.detectedFromSms as boolean | undefined),
          smsText: (meta.smsText as string | null) ?? null,
          // Test panel flag — call should go to test number, not real client
          isTestCard: !!(meta.isTestCard as boolean | undefined),
        };
      });

    // Inject stale ETA alerts from posted stale_eta messages (today only)
    const todayStartMs = new Date().setHours(0, 0, 0, 0);
    const staleEtaMsgs = await db
      .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata, cleanerJobId: opsChatMessages.cleanerJobId, createdAt: opsChatMessages.createdAt })
      .from(opsChatMessages)
      .where(and(eq(opsChatMessages.quickAction, "stale_eta"), gte(opsChatMessages.createdAt, new Date(todayStartMs))))
      .orderBy(opsChatMessages.createdAt);
    const todayJobIds = new Set(jobs.map(j => j.id));
    const jobStatusMap = new Map(jobs.map(j => [j.id, j.jobStatus]));
    for (const msg of staleEtaMsgs) {
      let meta2: Record<string, unknown> = {};
      try { meta2 = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
      const jobId2 = (meta2.cleanerJobId as number | null) ?? msg.cleanerJobId ?? 0;
      // Skip if this job is not in today's jobs
      if (!jobId2 || !todayJobIds.has(jobId2)) continue;
      const currentStatus = jobId2 ? jobStatusMap.get(jobId2) : undefined;
      // Skip if cleaner has since moved past on_the_way
      if (currentStatus && currentStatus !== "on_the_way" && currentStatus !== "running_late") continue;
      const cleanerName2 = (meta2.cleanerName as string) ?? "Team";
      const customerName2 = (meta2.customerName as string | null) ?? null;
      const etaStr2 = (meta2.etaStr as string | null) ?? null;
      alerts.unshift({
        type: "stale_eta" as any,
        jobId: (meta2.cleanerJobId as number | null) ?? msg.cleanerJobId ?? 0,
        title: `🚗⚠️ ${cleanerName2} — ETA passed`,
        body: `${customerName2 ? `For ${customerName2}` : "Still on the way"}${etaStr2 ? ` · ETA was ${etaStr2}` : ""}`,
        source: cleanerName2,
        ts: new Date(msg.createdAt).getTime(),
      });
    }
    // Inject no-show alerts from posted noshow_alert messages (today only)
    const noshowMsgs = await db
      .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata, cleanerJobId: opsChatMessages.cleanerJobId, createdAt: opsChatMessages.createdAt })
      .from(opsChatMessages)
      .where(and(eq(opsChatMessages.quickAction, "noshow_alert"), gte(opsChatMessages.createdAt, new Date(todayStartMs))))
      .orderBy(opsChatMessages.createdAt);
    for (const msg of noshowMsgs) {
      let meta3: Record<string, unknown> = {};
      try { meta3 = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
      const jobId3 = (meta3.cleanerJobId as number | null) ?? msg.cleanerJobId ?? 0;
      if (!jobId3 || !todayJobIds.has(jobId3)) continue;
      const currentStatus3 = jobStatusMap.get(jobId3);
      // Clear once cleaner has checked in or is on the way (including running_late)
      if (currentStatus3 && ["on_the_way", "running_late", "arrived", "in_progress", "completed"].includes(currentStatus3)) continue;
      const cleanerName3 = (meta3.cleanerName as string) ?? "Team";
      const customerName3 = (meta3.customerName as string | null) ?? null;
      const timeStr3 = (meta3.timeStr as string | null) ?? null;
      alerts.unshift({
        type: "noshow_alert" as any,
        jobId: jobId3,
        title: `🚨 ${cleanerName3} — no check-in`,
        body: `${customerName3 ? `For ${customerName3}` : "No status update"}${timeStr3 ? ` · Scheduled ${timeStr3}` : ""}`,
        source: cleanerName3,
        ts: new Date(msg.createdAt).getTime(),
      });
    }
    const cleanerStatusesFinal = cleanerStatuses;

    // Unassigned jobs: teamId IS NULL, not completed/cancelled/rescheduled, sorted by start time
    const unassignedJobs = jobs
      .filter(j => j.teamId == null && j.jobStatus !== 'completed')
      .map(j => {
        const jobMs = j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : 0;
        const minutesUntil = jobMs ? Math.round((jobMs - now) / 60_000) : null;
        const startTime = jobMs ? new Date(jobMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) : null;
        return {
          id: j.id,
          customerName: j.customerName ?? 'Unknown Client',
          jobAddress: j.jobAddress ?? '',
          serviceType: j.serviceType ?? '',
          startTime,
          startMs: jobMs,
          minutesUntil,
        };
      })
      .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

    return { snapshot, alerts, pinnedJobs, autoRaised, manualIssues, pendingReminderCount: pendingReminders.length, cleanerStatuses: cleanerStatusesFinal, unassignedJobs };
  }),

  /**
   * Broadcast an SMS message to all active cleaners with a phone number.
   */
  broadcastSmsToCleaners: opsChatProcedure
    .input(z.object({ message: z.string().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { sent: 0, failed: 0, results: [] };
      const profiles = await db
        .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.isActive, 1));

      const results: Array<{ name: string; phone: string; ok: boolean }> = [];
      for (const p of profiles) {
        if (!p.phone) continue;
        try {
          await sendSms({ to: p.phone, content: input.message });
          results.push({ name: p.name ?? "Cleaner", phone: p.phone, ok: true });
        } catch {
          results.push({ name: p.name ?? "Cleaner", phone: p.phone, ok: false });
        }
      }
      return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
    }),

  /**
   * claimLead — mark a lead card in the command channel as claimed by the current user.
   * Updates the opsChatMessages.metadata field and stamps the conversationSession.
   */
  claimLead: opsChatProcedure
    .input(z.object({ messageId: z.number(), sessionId: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const claimedAt = Date.now();
      const claimedBy = ctx.opsCaller.name;

      // Fetch existing metadata to merge
      const [existing] = await db
        .select({ metadata: opsChatMessages.metadata })
        .from(opsChatMessages)
        .where(eq(opsChatMessages.id, input.messageId))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });

      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(existing.metadata ?? "{}"); } catch { /* ignore */ }

      // If already claimed by someone else, don't override
      if (meta.claimedBy) {
        return { success: false, alreadyClaimedBy: meta.claimedBy as string };
      }

      meta.claimedBy = claimedBy;
      meta.claimedAt = claimedAt;

      await db
        .update(opsChatMessages)
        .set({ metadata: JSON.stringify(meta) })
        .where(eq(opsChatMessages.id, input.messageId));

      // Also stamp the conversation session if sessionId provided
      // This syncs the claim to the Lead List (which reads assignedAgentId + assignedAgentName).
      if (input.sessionId) {
        // Resolve the integer agentId from the agents table so the Lead List
        // agent-filter (which uses assignedAgentId) works correctly.
        let agentIntId: number | null = null;
        if (!ctx.opsCaller.isOwner) {
          // opsCaller.id is String(agent.agentId) for agent sessions
          const parsed = parseInt(ctx.opsCaller.id, 10);
          if (!isNaN(parsed)) agentIntId = parsed;
        }
        await db
          .update(conversationSessions)
          .set({
            assignedAgentName: claimedBy,
            ...(agentIntId !== null ? { assignedAgentId: agentIntId } : {}),
          })
          .where(eq(conversationSessions.id, input.sessionId))
          .catch(() => {}); // non-fatal
      }

      // Broadcast lead update so all agents see the claim immediately
      broadcastOpsUpdate("lead_update");

      return { success: true, claimedBy, claimedAt };
    }),

  /**
   * openIssue — post a general (non-job-specific) issue card to the command channel.
   */
  openIssue: opsChatProcedure
    .input(z.object({
      channel: z.string().default("command"),
      title: z.string().min(1).max(200),
      note: z.string().max(2000).optional(),
      jobId: z.number().int().positive().optional(),
      authorName: z.string().min(1).max(128),
      /** If provided, resolve this existing issue message instead of creating a new one */
      messageId: z.number().int().positive().optional(),
      /** Resolution note when resolving a general_issue */
      resolutionNote: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Resolve an existing general_issue
      if (input.messageId && input.title === "__resolve__") {
        const [existing] = await db
          .select({ metadata: opsChatMessages.metadata, channel: opsChatMessages.channel })
          .from(opsChatMessages)
          .where(eq(opsChatMessages.id, input.messageId))
          .limit(1);
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(existing?.metadata ?? "{}"); } catch { /* ignore */ }
        meta.resolvedAt = Date.now();
        meta.resolvedBy = input.authorName;
        meta.resolutionNote = input.resolutionNote ?? null;
        await db.update(opsChatMessages).set({ metadata: JSON.stringify(meta) }).where(eq(opsChatMessages.id, input.messageId));

        // Persist resolved state to issue_ownership so it survives page reloads
        const manualIssueKey = `manual-${input.messageId}`;
        await db
          .insert(issueOwnership)
          .values({ issueKey: manualIssueKey, resolvedAt: Date.now(), resolvedBy: input.authorName })
          .onDuplicateKeyUpdate({ set: { resolvedAt: Date.now(), resolvedBy: input.authorName } });

        // Post a styled issue_resolved card to the same channel
        const issueTitle = (meta.issueTitle as string) ?? "Issue";
        const issueNote = (meta.issueNote as string | null) ?? null;
        const jobTitle = (meta.jobTitle as string | null) ?? null;
        const resolvedMeta = JSON.stringify({
          issueTitle,
          issueNote,
          jobTitle,
          resolutionNote: input.resolutionNote ?? null,
          resolvedBy: input.authorName,
          resolvedAt: Date.now(),
        });
        await db.insert(opsChatMessages).values({
          channel: existing?.channel ?? input.channel,
          authorName: input.authorName,
          authorRole: "office",
          body: `✅ Issue resolved by ${input.authorName}${input.resolutionNote ? ": " + input.resolutionNote : ""}`,
          quickAction: "issue_resolved",
          metadata: resolvedMeta,
        });

        return { messageId: input.messageId };
      }

      // Optionally look up job name for the tag
      let jobTitle: string | null = null;
      if (input.jobId) {
        const [job] = await db
          .select({ customerName: cleanerJobs.customerName, jobAddress: cleanerJobs.jobAddress })
          .from(cleanerJobs)
          .where(eq(cleanerJobs.id, input.jobId))
          .limit(1);
        jobTitle = job?.customerName ?? job?.jobAddress ?? null;
      }

      const meta = JSON.stringify({
        issueTitle: input.title,
        issueNote: input.note ?? null,
        jobId: input.jobId ?? null,
        jobTitle,
      });

      await db.insert(opsChatMessages).values({
        channel: input.channel,
        authorName: input.authorName,
        authorRole: "office",
        body: input.note ? `${input.title}\n${input.note}` : input.title,
        quickAction: "general_issue",
        metadata: meta,
      });

      return { success: true };
    }),

  /**
   * setReminder — schedule a reminder to be posted to the channel at a future time.
   */
  setReminder: opsChatProcedure
    .input(z.object({
      channel: z.string().default("command"),
      body: z.string().min(1).max(1000),
      authorName: z.string().min(1).max(128),
      triggerAt: z.number().int().positive(), // UTC epoch ms
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.insert(opsReminders).values({
        channel: input.channel,
        body: input.body,
        authorName: input.authorName,
        triggerAt: input.triggerAt,
        callerId: ctx.opsCaller.id,
      });

      return { success: true };
    }),

  /**
   * pinNote — upsert the active sticky note for a channel.
   * Dismisses any existing active pin before creating the new one.
   */
  pinNote: opsChatProcedure
    .input(z.object({
      channel: z.string().default("command"),
      body: z.string().min(1).max(2000),
      authorName: z.string().min(1).max(128),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Dismiss any existing active pin for this channel
      await db
        .update(channelPins)
        .set({ dismissedAt: new Date() })
        .where(and(eq(channelPins.channel, input.channel), isNull(channelPins.dismissedAt)));

      await db.insert(channelPins).values({
        channel: input.channel,
        body: input.body,
        authorName: input.authorName,
      });

      return { success: true };
    }),

  /**
   * dismissPin — dismiss the active sticky note for a channel.
   */
  dismissPin: opsChatProcedure
    .input(z.object({ channel: z.string().default("command") }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .update(channelPins)
        .set({ dismissedAt: new Date() })
        .where(and(eq(channelPins.channel, input.channel), isNull(channelPins.dismissedAt)));

      return { success: true };
    }),

  /**
   * getChannelPin — fetch the active sticky note for a channel (null if none).
   */
  getChannelPin: opsChatProcedure
    .input(z.object({ channel: z.string().default("command") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const [pin] = await db
        .select()
        .from(channelPins)
        .where(and(eq(channelPins.channel, input.channel), isNull(channelPins.dismissedAt)))
        .orderBy(desc(channelPins.createdAt))
        .limit(1);

      if (!pin) return null;
      return {
        id: pin.id,
        body: pin.body,
        authorName: pin.authorName,
        createdAt: pin.createdAt.getTime(),
      };
    }),

  /**
   * announceBooking — post a celebratory booking announcement card to the command channel.
   */
  announceBooking: opsChatProcedure
    .input(z.object({
      channel: z.string().default("command"),
      personName: z.string().min(1).max(128),
      amount: z.string().max(32).optional(),
      note: z.string().max(500).optional(),
      authorName: z.string().min(1).max(128),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const meta = JSON.stringify({
        personName: input.personName,
        amount: input.amount ?? null,
        note: input.note ?? null,
      });

      const body = input.amount
        ? `🎉 New booking! ${input.personName} — ${input.amount}${input.note ? ` · ${input.note}` : ""}`
        : `🎉 New booking! ${input.personName}${input.note ? ` · ${input.note}` : ""}`;

      await db.insert(opsChatMessages).values({
        channel: input.channel,
        authorName: input.authorName,
        authorRole: "office",
        body,
        quickAction: "announce_booking",
        metadata: meta,
      });

      // Broadcast so all agents see the celebration card immediately
      broadcastOpsUpdate("new_message", { channel: input.channel });

      return { success: true };
    }),

  /**
   * getLatestCelebration — returns the most recent announce_booking message
   * in the command channel so clients can detect new celebrations via polling.
   */
  getLatestCelebration: opsChatProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select({ id: opsChatMessages.id, createdAt: opsChatMessages.createdAt })
        .from(opsChatMessages)
        .where(
          and(
            eq(opsChatMessages.channel, "command"),
            eq(opsChatMessages.quickAction, "announce_booking")
          )
        )
        .orderBy(desc(opsChatMessages.createdAt))
        .limit(1);
      return rows[0] ?? null;
    }),

  /**
   * Transcribe a voice note recorded in the browser.
   * Accepts base64-encoded audio (webm/mp3/wav) and returns the transcript text.
   */
  transcribeVoiceNote: opsChatProcedure
    .input(
      z.object({
        dataBase64: z.string().min(1),
        mimeType: z.string().default("audio/webm"),
      })
    )
    .mutation(async ({ input }) => {
      // Upload audio to S3 first so Whisper can fetch it via URL
      const audioBuffer = Buffer.from(input.dataBase64, "base64");
      const key = `voice-notes/${Date.now()}-${Math.random().toString(36).slice(2)}.webm`;
      const { url } = await storagePut(key, audioBuffer, input.mimeType);
      const result = await transcribeAudio({ audioUrl: url });
      if ("error" in result) throw new Error(result.error);
      return { text: result.text ?? "" };
    }),

  /**
   * Toggle an emoji reaction on a message.
   * If the caller already reacted with this emoji, remove it (toggle off).
   * Otherwise, insert it.
   */
  toggleReaction: opsChatProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      emoji: z.string().max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { action: "none" };
      const callerId = ctx.opsCaller.id;
      const callerName = ctx.opsCaller.name;
      // Check if reaction already exists
      const existing = await db
        .select({ id: opsChatReactions.id })
        .from(opsChatReactions)
        .where(
          and(
            eq(opsChatReactions.messageId, input.messageId),
            eq(opsChatReactions.callerId, callerId),
            eq(opsChatReactions.emoji, input.emoji),
          )
        )
        .limit(1);
      if (existing.length > 0) {
        await db.delete(opsChatReactions).where(eq(opsChatReactions.id, existing[0].id));
        broadcastOpsUpdate("reaction_update");
        return { action: "removed" };
      } else {
        await db.insert(opsChatReactions).values({
          messageId: input.messageId,
          callerId,
          callerName,
          emoji: input.emoji,
        });
        broadcastOpsUpdate("reaction_update");
        return { action: "added" };
      }
    }),

  /**
   * Get all reactions for a set of message IDs.
   * Used to hydrate reaction pills on load.
   */
  // NOTE: This is intentionally a mutation (not a query) so that the message IDs
  // are sent in the POST body rather than the URL. With hundreds of IDs, a GET
  // request would exceed nginx's URI size limit (HTTP 414).
  getReactions: opsChatProcedure
    .input(z.object({
      messageIds: z.array(z.number().int().positive()).max(1000),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { reactions: [] };
      if (input.messageIds.length === 0) return { reactions: [] };
      const { inArray } = await import("drizzle-orm");
      const rows = await db
        .select({
          messageId: opsChatReactions.messageId,
          callerId: opsChatReactions.callerId,
          callerName: opsChatReactions.callerName,
          emoji: opsChatReactions.emoji,
        })
        .from(opsChatReactions)
        .where(inArray(opsChatReactions.messageId, input.messageIds));
      return { reactions: rows };
    }),

  // ── Typing presence ──────────────────────────────────────────────────────────
  // In-memory store: channelKey → Map<callerId, { name, expiresAt }>
  // This is intentionally in-memory (no DB) — typing state is ephemeral.
  setTyping: opsChatProcedure
    .input(z.object({
      channelKey: z.string().max(120), // e.g. "general" or "job:12345"
      isTyping: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const callerId = ctx.opsCaller.id;
      const name = ctx.opsCaller.name;
      const map = typingStore.get(input.channelKey) ?? new Map<string, { name: string; expiresAt: number }>();
      if (input.isTyping) {
        map.set(callerId, { name, expiresAt: Date.now() + 4_000 });
      } else {
        map.delete(callerId);
      }
      typingStore.set(input.channelKey, map);
      return { ok: true };
    }),

  getTyping: opsChatProcedure
    .input(z.object({
      channelKey: z.string().max(120),
    }))
    .query(async ({ ctx, input }) => {
      const callerId = ctx.opsCaller.id;
      const map = typingStore.get(input.channelKey);
      if (!map) return { typers: [] };
      const now = Date.now();
      const typers: string[] = [];
      for (const entry of Array.from(map.entries())) {
        const [id, { name, expiresAt }] = entry;
        if (expiresAt < now) { map.delete(id); continue; }
        if (id !== callerId) typers.push(name);
      }
      return { typers };
    }),

  /**
   * updateIssueNote — add or edit the note on an issue flag (visible on the card).
   */
  updateIssueNote: opsChatProcedure
    .input(z.object({
      flagId: z.number().int().positive(),
      note: z.string().max(2000),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(issueFlags).set({ issueNote: input.note }).where(eq(issueFlags.id, input.flagId));
      return { success: true };
    }),

  /**
   * setReminderWithCaller — schedule a reminder and store the callerId so we can
   * deliver the popup to the right person.
   */
  setReminderWithCaller: opsChatProcedure
    .input(z.object({
      channel: z.string().default("command"),
      body: z.string().min(1).max(1000),
      authorName: z.string().min(1).max(128),
      triggerAt: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.insert(opsReminders).values({
        channel: input.channel,
        body: input.body,
        authorName: input.authorName,
        triggerAt: input.triggerAt,
        callerId: ctx.opsCaller.id,
      });
      return { success: true };
    }),

  /**
   * getDueReminders — returns reminders that have fired but not been dismissed/snoozed
   * for the current caller. Polled every 30s by the client.
   */
  getDueReminders: opsChatProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { reminders: [] };
      const callerId = ctx.opsCaller.id;
      const now = Date.now();
      try {
        const rows = await db
          .select()
          .from(opsReminders)
          .where(
            and(
              eq(opsReminders.callerId, callerId),
              lte(opsReminders.triggerAt, now),
              isNull(opsReminders.dismissedAt),
              // not snoozed or snooze has expired
              or(isNull(opsReminders.snoozedUntil), lte(opsReminders.snoozedUntil, now))
            )
          );
        return { reminders: rows };
      } catch (e) {
        // DB hiccup — return empty rather than crashing the server
        console.error('[getDueReminders] DB error, returning empty:', e);
        return { reminders: [] };
      }
    }),

  /**
   * dismissReminder — mark a reminder as dismissed.
   */
  dismissReminder: opsChatProcedure
    .input(z.object({ reminderId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(opsReminders).set({ dismissedAt: Date.now() }).where(eq(opsReminders.id, input.reminderId));
      return { success: true };
    }),

  /**
   * snoozeReminder — snooze a reminder by N minutes.
   */
  snoozeReminder: opsChatProcedure
    .input(z.object({
      reminderId: z.number().int().positive(),
      minutes: z.number().int().min(1).max(60),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const snoozedUntil = Date.now() + input.minutes * 60 * 1000;
      // Reset firedAt so it re-fires after snooze, clear dismissedAt
      await db.update(opsReminders).set({ snoozedUntil, firedAt: null, dismissedAt: null }).where(eq(opsReminders.id, input.reminderId));
      return { success: true };
    }),

  /**
   * uploadProfilePhoto — upload a profile photo to S3 and save the URL to the agent's profile.
   * Accepts base64-encoded image data.
   */
  uploadProfilePhoto: opsChatProcedure
    .input(z.object({
      base64Data: z.string().min(1), // base64 encoded image
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const callerId = ctx.opsCaller.id;
      const isOwner = ctx.opsCaller.isOwner;
      const agentEmail = (ctx.opsCaller as { email?: string }).email ?? null;
      const suffix = Date.now().toString(36);
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `profile-photos/${callerId}-${suffix}.${ext}`;

      const buffer = Buffer.from(input.base64Data, "base64");
      const { url } = await storagePut(key, buffer, input.mimeType);

      if (isOwner) {
        // Owner: store in users table by openId
        await db.update(users).set({ profilePhotoUrl: url }).where(eq(users.openId, callerId));
        // Also sync to agents table by name (owner may have an agents row for presence tracking)
        const ownerName = ctx.opsCaller.name;
        if (ownerName) {
          await db.update(agents).set({ profilePhotoUrl: url }).where(eq(agents.name, ownerName)).catch(() => { /* ignore if no row */ });
        }
      } else if (agentEmail) {
        // Agent: store in agents table by email
        await db.update(agents).set({ profilePhotoUrl: url }).where(eq(agents.email, agentEmail));
      }

      return { url };
    }),

  /**
   * getMyProfile — return the current caller's profile including photo URL.
   */
  getMyProfile: opsChatProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { name: ctx.opsCaller.name, photoUrl: null };
      if (ctx.opsCaller.isOwner) {
        // Owner: read from users table by openId
        const [userRow] = await db.select({ profilePhotoUrl: users.profilePhotoUrl, name: users.name }).from(users).where(eq(users.openId, ctx.opsCaller.id)).limit(1);
        const ownerName = userRow?.name ?? ctx.opsCaller.name;
        // Look up owner's email from agents table by name match
        const [ownerAgent] = await db.select({ email: agents.email }).from(agents).where(eq(agents.name, ownerName)).limit(1);
        let ownerEmail = ownerAgent?.email ?? null;
        if (!ownerEmail) {
          // Partial first-name match fallback
          const allAgents = await db.select({ name: agents.name, email: agents.email }).from(agents);
          const firstName = ownerName.split(/\s+/)[0].toLowerCase();
          ownerEmail = allAgents.find(a => a.email && a.name.toLowerCase().startsWith(firstName))?.email ?? ownerEmail;
        }
        return {
          name: ownerName,
          email: ownerEmail,
          photoUrl: userRow?.profilePhotoUrl ?? null,
        };
      }
      // Agent: read from agents table by email
      const agentEmail = (ctx.opsCaller as { email?: string }).email ?? ctx.opsCaller.id;
      const [agent] = await db.select({ profilePhotoUrl: agents.profilePhotoUrl, name: agents.name }).from(agents).where(eq(agents.email, agentEmail)).limit(1);
      return {
        name: agent?.name ?? ctx.opsCaller.name,
        email: agentEmail,
        photoUrl: agent?.profilePhotoUrl ?? null,
      };
    }),

  /**
   * getCallerProfiles — return photo URLs for a list of caller IDs (for rendering avatars).
   */
  getCallerProfiles: opsChatProcedure
    .input(z.object({ callerIds: z.array(z.string()).max(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db || input.callerIds.length === 0) return { profiles: {} };
      const rows = await db
        .select({ email: agents.email, name: agents.name, profilePhotoUrl: agents.profilePhotoUrl })
        .from(agents)
        .where(or(...input.callerIds.map(id => eq(agents.email, id))));
      const profiles: Record<string, { name: string; photoUrl: string | null }> = {};
      for (const row of rows) {
        profiles[row.email] = { name: row.name, photoUrl: row.profilePhotoUrl ?? null };
      }
      return { profiles };
    }),

  /**
   * getAllAgentPhotoMap — return name+photoUrl for ALL agents in one call.
   * Used by OpsChat/CommandChat to build a sender-name → photoUrl lookup map.
   */
  getAllAgentPhotoMap: opsChatProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { photos: {} };
      const rows = await db
        .select({ name: agents.name, profilePhotoUrl: agents.profilePhotoUrl })
        .from(agents);
      const photos: Record<string, string | null> = {};
      for (const row of rows) {
        photos[row.name] = row.profilePhotoUrl ?? null;
      }
      // Also emit each agent's FULL name from the users table as an alias key.
      // This handles cases where messages are stored with the OAuth full name (e.g. "Diane Ruiz")
      // but the agents table only has the short name (e.g. "Diane").
      const allUsers = await db
        .select({ name: users.name, profilePhotoUrl: users.profilePhotoUrl })
        .from(users);
      for (const userRow of allUsers) {
        if (!userRow.name) continue;
        // Find a matching agent by first-name prefix (case-insensitive)
        const firstName = userRow.name.split(/\s+/)[0].toLowerCase();
        const matchingAgent = rows.find(
          r => r.name.toLowerCase().startsWith(firstName) || firstName.startsWith(r.name.toLowerCase())
        );
        if (matchingAgent) {
          const photo = matchingAgent.profilePhotoUrl ?? userRow.profilePhotoUrl ?? null;
          // Emit both the agent short name AND the user full name as keys
          photos[matchingAgent.name] = photo;
          photos[userRow.name] = photo;
        }
      }
      // Also include the owner's photo from users table (owner has no agents row)
      if (ctx.opsCaller.isOwner) {
        const [ownerRow] = await db
          .select({ name: users.name, profilePhotoUrl: users.profilePhotoUrl })
          .from(users)
          .where(eq(users.openId, ctx.opsCaller.id))
          .limit(1);
        if (ownerRow?.name && ownerRow.profilePhotoUrl) {
          photos[ownerRow.name] = ownerRow.profilePhotoUrl;
        }
      }
      return { photos };
    }),

  /**
   * getAgentStatusList — return all active agents with name, photo, and last-seen timestamp.
   * Used by the Agent Status panel in the sidebar.
   */
  getAgentStatusList: opsChatProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { agents: [] };
      const rows = await db
        .select({
          id: agents.id,
          name: agents.name,
          email: agents.email,
          profilePhotoUrl: agents.profilePhotoUrl,
          lastSeenAt: agents.lastSeenAt,
          isAdmin: agents.isAdmin,
          awayStatus: agents.awayStatus,
          awaySetAt: agents.awaySetAt,
          onCallSince: agents.onCallSince,
          onCallCallId: agents.onCallCallId,
        })
        .from(agents)
        .where(eq(agents.isActive, 1))
        .orderBy(agents.name);
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const agentResults = rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email ?? null,
        photoUrl: r.profilePhotoUrl ?? null,
        lastSeenAt: r.lastSeenAt ? r.lastSeenAt.getTime() : null,
        isAdmin: r.isAdmin === 1,
        awayStatus: r.awayStatus ?? null,
        awaySetAt: r.awaySetAt ? r.awaySetAt.getTime() : null,
        // Auto-expire on-call status after 2h as a TTL safety net for missed webhooks
        onCallSince: r.onCallSince && (Date.now() - r.onCallSince) < TWO_HOURS_MS ? r.onCallSince : null,
      }));
      // If the caller is the owner, mark them as online right now.
      // Match by first-name prefix because OAuth name ("Rohan G") may differ from agents name ("Rohan Gilkes").
      if (ctx.opsCaller.isOwner) {
        const ownerFirstName = ctx.opsCaller.name.split(/\s+/)[0].toLowerCase();
        const ownerIdx = agentResults.findIndex(
          a => a.name.toLowerCase().startsWith(ownerFirstName) || ownerFirstName.startsWith(a.name.toLowerCase())
        );
        if (ownerIdx >= 0) {
          // Owner has an agents row — override lastSeenAt to now so they always appear green
          agentResults[ownerIdx] = { ...agentResults[ownerIdx], lastSeenAt: Date.now() };
        } else {
          // Owner has no agents row — inject from users table
          const [userRow] = await db
            .select({ name: users.name, profilePhotoUrl: users.profilePhotoUrl })
            .from(users)
            .where(eq(users.openId, ctx.opsCaller.id))
            .limit(1);
          if (userRow) {
            agentResults.push({
              id: -1,
              name: userRow.name ?? ctx.opsCaller.name,
              email: undefined as unknown as string,
              photoUrl: userRow.profilePhotoUrl ?? null,
              lastSeenAt: Date.now(),
              isAdmin: true,
              awayStatus: null,
              awaySetAt: null,
              onCallSince: null,
            });
          }
        }
      }
      return { agents: agentResults };
    }),

  // ── Presence Ping ──────────────────────────────────────────

  /**
   * pingPresence — lightweight mutation called every 2 minutes from the client.
   * Updates lastSeenAt for the current caller so their status dot stays green.
   */
  pingPresence: opsChatProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { ok: true };
      const now = new Date();
      if (ctx.opsCaller.isOwner) {
        // Owner: update agents row by first-name prefix (OAuth name may differ from agents table name)
        const ownerName = ctx.opsCaller.name;
        if (ownerName) {
          const firstName = ownerName.split(/\s+/)[0];
          await db.update(agents)
            .set({ lastSeenAt: now })
            .where(like(agents.name, `${firstName}%`))
            .execute()
            .catch(() => { /* ignore if no row */ });
        }
      } else {
        // Agent: update by email
        const agentEmail = (ctx.opsCaller as { email?: string }).email;
        if (agentEmail) {
          await db.update(agents)
            .set({ lastSeenAt: now })
            .where(eq(agents.email, agentEmail))
            .execute()
            .catch(() => { /* ignore */ });
        }
      }
      return { ok: true };
    }),

  // ── Direct Messages ──────────────────────────────────────────────────────────

  /**
   * Returns the current caller's stable DM key (agent email).
   * Used by the frontend to identify itself when opening DM threads.
   */
  getMyDmKey: opsChatProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { dmKey: ctx.opsCaller.id };
      if (ctx.opsCaller.isOwner) {
        // Step 1: look up the owner's record in users table to get their display name
        const [userRow] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.openId, ctx.opsCaller.id))
          .limit(1);
        const ownerName = userRow?.name ?? ctx.opsCaller.name;
        // Step 2: try exact name match in agents table
        const [agentByName] = await db
          .select({ email: agents.email })
          .from(agents)
          .where(eq(agents.name, ownerName))
          .limit(1);
        if (agentByName?.email) return { dmKey: agentByName.email };
        // Step 3: try first-name partial match (handles "Rohan G" vs "Rohan Gilkes" drift)
        const allAgents = await db.select({ name: agents.name, email: agents.email }).from(agents);
        const firstName = ownerName.split(/\s+/)[0].toLowerCase();
        const partialMatch = allAgents.find(
          (a) => a.email && a.name.toLowerCase().startsWith(firstName)
        );
        if (partialMatch?.email) return { dmKey: partialMatch.email };
        // Final fallback: slug the name (legacy — avoids hard crash)
        return { dmKey: slugify(ownerName) };
      }
      // Agent: email is directly available on the session
      const agentEmail = (ctx.opsCaller as any).email as string | undefined;
      return { dmKey: agentEmail ?? slugify(ctx.opsCaller.name) };
    }),

  /**
   * Send a private DM to another agent/cleaner.
   * dmThread key is built from stable email keys (sorted), NOT display name slugs.
   * senderKey and recipientKey should be agent emails (or cleaner:{id} for cleaners).
   */
  sendDm: opsChatProcedure
    .input(
      z.object({
        senderName: z.string().min(1),
        senderKey: z.string().min(1),
        recipientName: z.string().min(1),
        recipientKey: z.string().min(1),
        body: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const dmThread = buildDmThread(input.senderKey, input.recipientKey);
      const [result] = await db.insert(opsChatMessages).values({
        cleanerJobId: null,
        channel: null,
        dmThread,
        authorName: input.senderName,
        authorRole: "office",
        body: input.body,
      });
      // Broadcast DM as a new_message so the recipient's unread count updates
      broadcastOpsUpdate("new_message");
      return { id: (result as any).insertId as number, dmThread };
    }),
  /**
   * Fetch messages for a DM thread between two participants.
   * keyA and keyB are stable email keys (NOT display names).
   */
  listDmMessages: opsChatProcedure
    .input(
      z.object({
        keyA: z.string().min(1),
        keyB: z.string().min(1),
        // Legacy display-name params kept for backward compat (ignored if keys provided)
        participantA: z.string().min(1).optional(),
        participantB: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { messages: [] };
      const dmThread = buildDmThread(input.keyA, input.keyB);
      const rows = await db
        .select()
        .from(opsChatMessages)
        .where(eq(opsChatMessages.dmThread, dmThread))
        .orderBy(desc(opsChatMessages.createdAt))
        .limit(input.limit);
      return {
        dmThread,
        messages: rows.reverse().map((m) => ({
          id: m.id,
          authorName: m.authorName,
          body: m.body,
          createdAt: m.createdAt.getTime(),
        })),
      };
    }),
  /**
   * Get the full cleaner/agent roster for the DM picker.
   * Returns all active agents + cleaner profiles.
   */
  listDmRoster: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { people: [] };
    const agentRows = await db
      .select({
        name: agents.name,
        photoUrl: agents.profilePhotoUrl,
        type: agents.isAdmin,
      })
      .from(agents)
      .where(eq(agents.isActive, 1))
      .orderBy(agents.name);
    const cleanerRows = await db
      .select({
        name: cleanerProfiles.name,
      })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.isActive, 1))
      .orderBy(cleanerProfiles.name);
    const agentNames = new Set(agentRows.map((a) => a.name?.toLowerCase()));
    const people = [
      ...agentRows.map((a) => ({ name: a.name ?? "Unknown", photoUrl: a.photoUrl ?? null, role: a.type === 1 ? "admin" : "agent" as string })),
      ...cleanerRows
        .filter((c) => !agentNames.has(c.name?.toLowerCase()))
        .map((c) => ({ name: c.name ?? "Unknown", photoUrl: null as string | null, role: "cleaner" as string })),
    ];
    return { people };
  }),

  /**
   * Get unread DM counts for the current user.
   * Returns a map of dmThread -> unread count based on messages newer than
   * the user's last read timestamp for that thread.
   */
  getDmUnreadCounts: opsChatProcedure
    .input(z.object({ myName: z.string().min(1), myKey: z.string().min(1).optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { unread: {} };
      // Support both new email-key and legacy name-slug matching
      const mySlug = slugify(input.myName);
      const myKey = input.myKey;
      // Get all DM threads involving this user
      const rows = await db
        .select({
          dmThread: opsChatMessages.dmThread,
          id: opsChatMessages.id,
          authorName: opsChatMessages.authorName,
          createdAt: opsChatMessages.createdAt,
        })
        .from(opsChatMessages)
        .where(
          and(
            isNull(opsChatMessages.cleanerJobId),
            isNull(opsChatMessages.channel)
          )
        )
        .orderBy(desc(opsChatMessages.id))
        .limit(500);
      // Filter to threads involving myKey (email) OR legacy mySlug
      const myThreadRows = rows.filter((r) => {
        if (!r.dmThread) return false;
        const parts = r.dmThread.split("::");
        return (myKey && parts.includes(myKey)) || parts.includes(mySlug);
      });
      // Get last-read per thread from opsChatReads using dmThread as the channel key
      const threadKeySet = new Set(myThreadRows.map((r) => r.dmThread!).filter(Boolean));
      const threadKeys = Array.from(threadKeySet);
      const readRows = threadKeys.length > 0
        ? await db
            .select()
            .from(opsChatReads)
            .where(
              and(
                eq(opsChatReads.callerName, input.myName),
                isNull(opsChatReads.cleanerJobId)
              )
            )
        : [];
      const lastReadMap: Record<string, number> = {};
      for (const r of readRows) {
        if (r.channel) lastReadMap[r.channel] = r.lastReadMessageId;
      }
      const unread: Record<string, number> = {};
      for (const thread of threadKeys) {
        const lastRead = lastReadMap[thread] ?? 0;
        const threadMsgs = myThreadRows.filter(
          (r) => r.dmThread === thread && r.authorName !== input.myName
        );
        unread[thread] = threadMsgs.filter((r) => r.id > lastRead).length;
      }
      return { unread };
    }),

  /**
   * Mark a DM thread as read up to the latest message.
   */
  /**
   * Returns live status for a list of sessionIds extracted from new_lead card metadata.
   * Used by the Hot Leads tray and chat-feed lead cards to show booked/lost/stage badges.
   */
  getLeadSessionStatuses: opsChatProcedure
    .input(z.object({ sessionIds: z.array(z.number()).max(50) }))
    .query(async ({ input }) => {
      if (input.sessionIds.length === 0) return [];
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          id: conversationSessions.id,
          isBooked: conversationSessions.isBooked,
          bookedAt: conversationSessions.bookedAt,
          bookedByAgentName: conversationSessions.bookedByAgentName,
          bookedAmount: conversationSessions.bookedAmount,
          stage: conversationSessions.stage,
          lostReason: conversationSessions.lostReason,
        })
        .from(conversationSessions)
        .where(or(...input.sessionIds.map(id => eq(conversationSessions.id, id))));
      return rows.map(r => ({
        id: r.id,
        isBooked: r.isBooked === 1,
        bookedAt: r.bookedAt ? r.bookedAt.getTime() : null,
        bookedByAgentName: r.bookedByAgentName ?? null,
        bookedAmount: r.bookedAmount ?? null,
        stage: r.stage,
        lostReason: r.lostReason ?? null,
      }));
    }),

  /**
   * getTodayRevenue — sum of bookedAmount for all bookings confirmed today.
   * Used by the live revenue ticker in the Command Chat header.
   */
  getTodayRevenue: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, count: 0 };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = await db
      .select({
        bookedAmount: conversationSessions.bookedAmount,
      })
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.isBooked, 1),
          gte(conversationSessions.bookedAt, startOfDay)
        )
      );

    const total = rows.reduce((sum, r) => sum + (r.bookedAmount ?? 0), 0);
    return { total, count: rows.length };
  }),

  markDmRead: opsChatProcedure
    .input(z.object({ myName: z.string().min(1), dmThread: z.string().min(1), lastMessageId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: false };
      const callerId = `dm:${slugify(input.myName)}`;
      await db
        .insert(opsChatReads)
        .values({
          callerId,
          callerName: input.myName,
          cleanerJobId: null,
          channel: input.dmThread,
          lastReadMessageId: input.lastMessageId,
        })
        .onDuplicateKeyUpdate({ set: { lastReadMessageId: input.lastMessageId } });
      return { ok: true };
    }),

  /**
   * startCsConversation — agent initiates a new outbound CS conversation from scratch.
   * If an open session already exists for the phone, returns it instead of creating a duplicate.
   */
  startCsConversation: opsChatProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),  // raw phone — will be normalised to E.164
      firstMessage: z.string().min(1).max(1600),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Normalise to E.164 (+1XXXXXXXXXX for US numbers)
      const raw = input.phone.replace(/[^\d+]/g, "");
      const e164 = raw.startsWith("+") ? raw : `+1${raw.replace(/^1/, "")}`;

      // Check for an existing open CS session
      const existing = await db
        .select()
        .from(conversationSessions)
        .where(
          and(
            eq(conversationSessions.leadPhone, e164),
            isNull(conversationSessions.csResolvedAt),
          )
        )
        .limit(1);

      // Resolve customer name using the same lookup chain as backfillCsNames
      const p10 = e164.replace(/[^\d]/g, "").slice(-10);
      let resolvedName: string | null = null;
      // 1. completedJobs (E.164)
      if (!resolvedName) {
        const [r] = await db.select({ name: completedJobs.name }).from(completedJobs).where(eq(completedJobs.phone, e164)).limit(1);
        if (r?.name) resolvedName = r.name;
      }
      // 2. cleanerJobs.customerName
      if (!resolvedName) {
        const [r] = await db.select({ customerName: cleanerJobs.customerName }).from(cleanerJobs).where(sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${p10}`).limit(1);
        if (r?.customerName) resolvedName = r.customerName;
      }
      // 3. quoteLeads
      if (!resolvedName) {
        const [r] = await db.select({ name: quoteLeads.name }).from(quoteLeads).where(sql`REGEXP_REPLACE(${quoteLeads.phone}, '[^0-9]', '') LIKE ${'%' + p10}`).limit(1);
        if (r?.name) resolvedName = r.name;
      }
      // 4. Other sessions with same phone that have a name
      if (!resolvedName) {
        const [r] = await db.select({ leadName: conversationSessions.leadName }).from(conversationSessions)
          .where(and(eq(conversationSessions.leadPhone, e164), sql`${conversationSessions.leadName} IS NOT NULL AND ${conversationSessions.leadName} != '' AND ${conversationSessions.leadName} != ${e164}`))
          .orderBy(desc(conversationSessions.updatedAt)).limit(1);
        if (r?.leadName) resolvedName = r.leadName;
      }

      let sessionId: number;
      if (existing.length > 0) {
        sessionId = existing[0].id;
        // Always ensure the session surfaces in the CS inbox and has the right name
        // If the session is already tagged as a cleaner (Teams), never overwrite csQueue
        const existingIsTeams = existing[0].csQueue === "Teams" || existing[0].leadSource === "cs-inbound-cleaner";
        const updates: Record<string, unknown> = {
          csQueue: existingIsTeams ? "Teams" : (existing[0].csQueue ?? "Needs attention"),
          leadSource: existingIsTeams ? "cs-inbound-cleaner" : "cs_initiated",
        };
        if (resolvedName && (existing[0].leadName === e164 || !existing[0].leadName)) {
          updates.leadName = resolvedName;
        }
        await db.update(conversationSessions).set(updates as any).where(eq(conversationSessions.id, sessionId));
      } else {
        // Create a new agent-initiated CS session with resolved name
        const [result] = await db
          .insert(conversationSessions)
          .values({
            leadPhone: e164,
            leadName: resolvedName ?? e164,  // use real name if found, else phone as fallback
            stage: "QUOTE_SENT",
            messageHistory: "[]",
            aiMode: 0,               // agent-driven; no AI auto-replies
            csQueue: "Needs attention",
            leadSource: "cs_initiated",
          });
        sessionId = (result as any).insertId;
      }

      // Send the first SMS via the CS OpenPhone number
      const { sendSms } = await import("./openphone");
      const env = await import("./_core/env");
      const csNumberId = env.ENV.openPhoneCsNumberId;
      await sendSms({ to: e164, content: input.firstMessage, ...(csNumberId ? { fromNumberId: csNumberId } : {}) });

      // Append the message to history
      const [session] = await db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.id, sessionId))
        .limit(1);
      let history: Array<{ role: string; content: string; ts?: number; senderName?: string }> = [];
      try { history = JSON.parse(session?.messageHistory ?? "[]"); } catch { history = []; }
      const agentName = ctx.user?.name ?? "Agent";
      history.push({ role: "assistant", content: input.firstMessage, ts: Date.now(), senderName: agentName });
      await db
        .update(conversationSessions)
        .set({ messageHistory: JSON.stringify(history) })
        .where(eq(conversationSessions.id, sessionId));

      return { sessionId, isNew: existing.length === 0 };
    }),

  /**
   * syncCsOutboundMessages — manually trigger a sync of OpenPhone outbound messages
   * for a specific CS conversation. Useful for backfilling messages sent from the
   * OpenPhone app before this feature was deployed.
   */
  syncCsOutboundMessages: opsChatProcedure
    .input(z.object({ sessionId: z.number(), leadPhone: z.string() }))
    .mutation(async ({ input }) => {
      const { syncCsOutboundMessages } = await import("./webhooks");
      await syncCsOutboundMessages(input.leadPhone, input.sessionId);
      return { ok: true };
    }),

  /**
   * faqAsk — agent asks a question, AI answers using the Maids in Black knowledge base.
   * Supports multi-turn: pass the previous messages array for follow-up questions.
   */
  faqAsk: opsChatProcedure
    .input(z.object({
      question: z.string().min(1).max(500),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).optional().default([]),
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const { MAIDS_IN_BLACK_KNOWLEDGE_BASE } = await import("./knowledgeBase");

      const systemPrompt = `You are an internal FAQ assistant for Maids in Black agents.
Answer questions concisely and accurately using the knowledge base below.
If the answer is not in the knowledge base, say so clearly — do not make up information.
Keep answers short (2-4 sentences max) unless detail is specifically needed.
Speak directly to the agent, not the customer.

${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...input.history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: input.question },
      ];

      const result = await invokeLLM({ messages });
      const answer = result.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate an answer. Please try again.";
      return { answer };
    }),

  /**
   * csReply — given any customer service scenario, returns a world-class response
   * modeled on Disney HEARD, Ritz-Carlton Gold Standards, and Zappos WOW principles.
   * The agent describes the situation; the AI returns the exact words to say.
   */
  csReply: opsChatProcedure
    .input(z.object({
      scenario: z.string().max(2000).optional().default(""),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).optional().default([]),
      conversationContext: z.string().optional().default(""), // last few messages from the inbox
      customerName: z.string().optional().default(""), // customer's full name
      jobContext: z.string().optional().default(""), // upcoming/today job details (date, service type, cleaner/team name)
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const { MAIDS_IN_BLACK_KNOWLEDGE_BASE } = await import("./knowledgeBase");

      const systemPrompt = `You are a customer service agent for Maids in Black, a residential cleaning company in Washington DC. Your job is to write the exact SMS the agent should send — not advice, the actual text message.

=== TONE ===
Warm, direct, and genuinely human. Think: a real person texting, not a corporate script. Short sentences. Conversational. Like you actually care — because you do.

Be SPECIFIC. Use the customer's actual name, their actual booking date, their actual cleaner's name, their actual service type. Generic messages feel hollow. Specific messages feel like you actually know them — because you do.

Be CONNECTING. Don't just answer the question and bail. Acknowledge the person, not just the problem. A little warmth goes a long way. If they're excited, match it. If they're frustrated, sit with them for a moment before solving.

Length: Write until the message feels COMPLETE — not until you hit a sentence count. The test is: would a real person feel heard, helped, and cared for after reading this? If yes, you're done. If it still feels like a quick brush-off, you're not done yet. A genuine response to a special request, a complaint, or a meaningful moment should feel warm and full — not like a ticket being closed. Never count sentences. Never truncate to save space. Never pad with filler. Just write what the moment actually deserves.

Examples of the right tone:
- "No worries at all, [Name]! Life happens 😊. We've moved your clean to [New Day] at [New Time]. Your home will be ready whenever you are. ✨"
- "[Name], we are SO sorry we missed [area]. That's not our standard. We're sending someone back at NO charge to make it right. When works for you? 🙏"
- "Hey [Name]! Just checking in — still loving that clean-house feeling? 🌟 If anything wasn't perfect, tell us and we'll make it right. No drama, no hassle. 💪"
- "[Name], thank you for telling us — seriously. We'd rather know than not. Let's fix this together. What would make it right for you? 🤝"
- "Rise and shine, [Name]! ☀️ Today's the day your home gets its glow-up. Your crew arrives at [Time] and they are READY."
- "Hey [Name]! Meet your cleaner today — [Cleaner Name]! 👋 They're one of our absolute favorites (don't tell the others 😄). You're in great hands."
- "[Name], we're here! 🏡 Your crew just arrived and is getting started. Grab a coffee, go enjoy your day — we've completely got it from here. 😌"
- "Hey [Name]! Your cleaner noticed your [fridge/oven] was looking a little rough, so they showed it some extra love today — no charge. 🙌 We just can't help ourselves."
- "Hi [Name]! Your regular cleaner [Name] is out today. We're sending [Sub Name] instead, who is equally amazing. Same standards, same care. You're covered! 💛"
- "[Name], we completely understand the frustration and we hear you. Let us make this right — no runaround, no excuses. Here's what we're going to do: [solution]. Does that work for you? 💛"
- "No worries at all, [Name] — life is unpredictable and we totally get it! ✌️ Your clean is cancelled with zero fees. Whenever you're ready to book again, we'll be right here. 💛"
- "[Name], we saw your feedback and we're genuinely grateful you told us. We dropped the ball and we own it. Can we earn your trust back? We'd love one more shot — on us. 🙏"
- "[Name], please do NOT apologize for the mess — that's literally why we exist and we LOVE it 😄. The bigger the challenge, the better we feel about the results. No judgment ever. 🧹💪"
- "[Name], this just made our whole day!! 🥹 We're passing this along to [Cleaner Name] right now — they are going to be SO happy to hear this. Thank YOU for taking the time. 💛"
- "[Name], you've been with us for [X] months and we just want to make sure we're still knocking it out of the park for you. 🏡 Anything we can do better or differently? Honest answers welcome!"
- "Got it, [Name]! Notes are in — [specific instructions]. Your crew has been briefed and will follow these to the letter. ✅"

=== WHAT NOT TO WRITE (BAD EXAMPLES) ===
These are the kinds of hollow, corporate-sounding messages you must NEVER produce:
- "Got it, Kate! Thanks for confirming. Our team will take care of those cabinets for you. 😊" ← Too short. No warmth. Feels like a ticket being closed.
- "Hi Sarah! We've received your request and will handle it accordingly." ← Corporate, cold, zero personality.
- "No problem! We'll pass that along to the team." ← Vague, impersonal, says nothing.
- "Thank you for letting us know. We appreciate your patience." ← Filler. Means nothing. Sounds automated.
- "Noted! We'll make sure to address that." ← One sentence. No connection. Doesn't feel human.

When you catch yourself writing something like the above — stop. Start over. Ask: does this feel like a real person who actually cares? If not, rewrite it.

=== EMOJI RULES ===
- Use 1–3 emojis max per message, placed naturally (not forced).
- Only use emojis that fit the moment: 🙏 for apologies, ✨ for positive moments, 😊 for friendly, 💪 for reassurance.
- Never use sparkle/glitter emojis (✨🌟) for complaints or serious situations.
- No emoji overload. Less is more.

=== WRITING RULES ===
1. Write the EXACT message — not a template, not advice.
2. Use the customer's first name naturally (once, near the start).
3. If job details are provided (date, service type, cleaner name), weave them in naturally — don't just list them.
3a. NEVER change any date, time, day name, or number from the job context or conversation. If the context says "3pm", write "3pm". If it says "Tuesday April 14", write "Tuesday April 14". Copy every date, time, and number character-for-character. This rule overrides everything else — even if you think there is a typo, do NOT correct it.
4. Always include a clear next step or resolution — never leave them hanging.
5. Never be defensive. Never make excuses. Own the experience.
6. Sound like a real person, not a brand. No corporate buzzwords, no "we strive to...", no "rest assured".
7. Do NOT say "make your home sparkle" or similar cheesy lines.
8. Use the Maids in Black knowledge base for accurate details (guarantee, policies, team info).

=== MAIDS IN BLACK KNOWLEDGE BASE ===
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}

Write the exact SMS the agent should send for the scenario described.`;

      const firstName = input.customerName ? input.customerName.trim().split(/\s+/)[0] : "";
      const userParts: string[] = [];
      if (firstName) userParts.push(`Customer's first name: ${firstName}`);
      if (input.jobContext) userParts.push(`Upcoming job details:\n${input.jobContext}`);
      if (input.conversationContext) userParts.push(`Recent conversation with this customer:\n${input.conversationContext}`);
      if (input.scenario) {
        userParts.push(`Customer service scenario: ${input.scenario}`);
      } else {
        userParts.push("Based on the conversation above, write the best reply to send to the customer now.");
      }

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...input.history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: userParts.join("\n\n") },
      ];

      const result = await invokeLLM({ messages });
      const reply = result.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a response. Please try again.";
      return { reply };
    }),

  /**
   * objectionReply — given a customer objection, returns a high-converting rebuttal
   * script tailored to Maids in Black's sales approach. Supports follow-up turns.
   */
  objectionReply: opsChatProcedure
    .input(z.object({
      objection: z.string().min(1).max(1000),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).optional().default([]),
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");

      const systemPrompt = `You are a world-class sales coach for Maids in Black, a premium residential cleaning service in Washington DC.
Your job is to give CS agents the exact words to say when a customer raises an objection.

Rules:
- Respond with the SCRIPT the agent should say — not advice about what to say.
- Keep the main response under 4 sentences. Be warm, confident, and conversational.
- After the main script, add 1-2 follow-up lines for common sub-objections (prefix with "If [scenario]:").
- Never be pushy or desperate. The tone is helpful, expert, and slightly urgent.
- Speak as if you ARE the agent talking to the customer.
- Use the proven tactics below as your framework.

=== OBJECTION PLAYBOOK ===

Objection: Not sure about date
Tactic: Soft commitment + flexibility anchor
Script: "Totally get it — calendars can be tricky! What I can do is lock in your spot tentatively — no stress, no penalty if life happens. We just ask for 24 hours' notice to shift it. Most clients find it way easier to reschedule from a booked slot than to find a new opening later, because our cleaners fill up fast. Which time window feels roughly right — mornings or afternoons? Let's start there and we'll nail down the exact day together."
Follow-ups:
- If they hesitate: "I can hold that spot for 24 hours while you check — no card needed yet. Want me to do that?"
- If they need a week: "No problem at all. I'll send you a quick reminder Thursday — does that work?"

Objection: Price is too high
Tactic: Value reframe + micro-commitment
Script: "I hear you — it's a real number, and I want to make sure it makes sense for you. Think of it this way: that's roughly the cost of dinner out — and you get your whole weekend back. No scrubbing bathrooms, no mopping on a Sunday night. For a lot of our clients that trade-off is a no-brainer. Plus, first-time cleans are always the longest. Once we know your home, the recurring rate drops — and we have clients paying significantly less per clean than that first visit. Would it help to start with a one-room deep-clean to see the value before committing to the full home?"
Follow-ups:
- If they compare to a cheaper option: "Totally fair to shop around. What we can promise is insured, vetted cleaners and a satisfaction guarantee — if something's missed, we come back. Does that matter to you?"
- If budget is genuine: "Let me check if there's a lighter package that fits. What rooms absolutely have to be done?"

Objection: Shopping around
Tactic: Pattern interrupt + urgency (scarcity)
Script: "Smart — you should know your options! Here's what I'll tell you honestly: most services in this area quote low and add fees on arrival. We're all-in upfront, and our cleaners are background-checked, insured, and rated 4.9/5 by clients in your neighborhood. The one thing I'd flag: our schedule fills Thursday–Saturday by midweek, especially in your area. I'd hate for you to come back after comparing and find we're booked out for 3 weeks. What would need to be true for you to feel confident booking today?"
Follow-ups:
- If they want time: "Of course! Want me to hold a slot for 48 hours? No charge, zero obligation."
- If they name a competitor: "Great choice to compare — ask them about their re-clean policy and insurance. We include both free."

Objection: Don't know you / trust
Tactic: Social proof + risk removal
Script: "That's completely fair — you're letting someone into your home. Every cleaner on our team is background-checked, interviewed in person, and insured. We're not a gig app — these are our people, and we stand behind their work. We've cleaned hundreds of homes in your zip code. I can pull up reviews from neighbors if that helps, or send you our guarantee in writing before we book a thing. What would make you feel most comfortable — seeing reviews, meeting your cleaner first, or knowing our satisfaction guarantee covers you?"
Follow-ups:
- If they want references: "I'll text you three verified Google reviews from clients in your neighborhood right now."
- If still hesitant: "We offer a full refund on your first clean if you're not happy — no questions. Does that take the risk off the table?"

Objection: More questions first
Tactic: Question stacking → close
Script: "Absolutely, ask me anything — I want you to feel completely informed. [Answer their question clearly and briefly, then:] Does that answer it fully? [Yes] → Great — so the only thing left is picking a time that works for you. What does your week look like? The best clients we have started exactly where you are — a few questions, then booked. Questions usually mean you're close."
Follow-ups:
- If questions keep coming: "You're clearly thorough — I love it. Let me answer everything at once: what's your biggest concern with the service?"
- If they need product info: "We use eco-friendly products — want me to text you the full list before your clean?"

Objection: Had a bad experience
Tactic: Empathy bridge + differentiation
Script: "I'm really sorry that happened — honestly, it's way too common. That's exactly why we built things differently. Our cleaners aren't random — they're trained, rated after every job, and you get the same person each time so they know your home. If anything's ever off, we fix it within 24 hours, free. A lot of our best long-term clients came to us after a bad experience somewhere else. What specifically went wrong before? I want to make sure we address it directly."
Follow-ups:
- If they mention no-shows: "We have a 99.2% on-time record and send a 30-min heads-up text every time. That's a promise."
- If they mention damage: "We're fully insured — any accidental damage is covered. Has that ever been handled for you before?"

Objection: Won't be home / access
Tactic: Friction removal
Script: "Super common — most of our clients aren't home during the clean! A lot of people leave a key in a lockbox, use a door code, or have a neighbor let us in. We have a detailed entry protocol, and you'll get a text when the cleaner arrives and when they leave, with photos. Many clients say it's the best part — you leave for work, come home to a spotless house. How do you currently handle access for other services like deliveries? We can likely work the same way."
Follow-ups:
- If they're worried about security: "Every cleaner signs an NDA and is bonded. Want me to email you our access policy?"
- If they want to be present first time: "Totally understand for the first visit. Want to book it on a day you're around, then relax after that?"

Objection: Not the right time
Tactic: Future pace + stay-warm close
Script: "No worries at all — life gets busy. Can I ask — is it timing as in the calendar, or timing as in it doesn't feel like the right moment overall? Just so I understand where you're at. [Calendar issue] → What month looks lighter? Lock in a future date now — it's free to reschedule. [Not ready] → What would need to change for this to make sense? Sometimes the answer unlocks the real objection."
Follow-ups:
- If they just moved: "Post-move cleans are our specialty — it's actually the best time. Want a quote for a move-in clean?"
- If they'll call back: "I'll put a note so whoever picks up has your info ready. And I'll text you in two weeks — cool?"
=== END PLAYBOOK ===

Now respond to the customer objection the agent provides. Give the agent the exact script to say.`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...input.history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: `Customer objection: "${input.objection}"` },
      ];

       const result = await invokeLLM({ messages });
      const script = result.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a response. Please try again.";
      return { script };
    }),

  // ── OpenPhone User Sync ────────────────────────────────────────────────────
  /**
   * syncOpenPhoneUsers — fetch all users from the OpenPhone API, fuzzy-match
   * them to agents by name, and write openPhoneUserId to the DB for matched rows.
   * Returns a summary of matches and unmatched users for the admin to review.
   */
  syncOpenPhoneUsers: opsChatProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const apiKey = process.env.OPENPHONE_API_KEY ?? "";
      if (!apiKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "OPENPHONE_API_KEY not configured" });

      // Fetch all OpenPhone users
      const res = await fetch("https://api.openphone.com/v1/users", {
        headers: { Authorization: apiKey },
      });
      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `OpenPhone API error: ${res.status}` });
      }
      const json = await res.json() as any;
      const opUsers: Array<{ id: string; firstName: string; lastName: string; email: string }> =
        (json?.data ?? []).filter((u: any) => u.id);

      // Load all active agents
      const agentRows = await db
        .select({ id: agents.id, name: agents.name, openPhoneUserId: agents.openPhoneUserId })
        .from(agents)
        .where(eq(agents.isActive, 1));

      // Normalize names for fuzzy matching
      function normName(s: string) {
        return s.toLowerCase().replace(/[^a-z ]/g, "").trim();
      }

      const matched: Array<{ agentId: number; agentName: string; opUserId: string; opName: string }> = [];
      const unmatched: Array<{ opUserId: string; opName: string; opEmail: string }> = [];

      for (const opUser of opUsers) {
        const opFullName = normName(`${opUser.firstName ?? ""} ${opUser.lastName ?? ""}`);
        const opFirstName = normName(opUser.firstName ?? "");

        // Try exact full-name match first, then first-name prefix match
        let best = agentRows.find(a => normName(a.name) === opFullName);
        if (!best && opFirstName) {
          best = agentRows.find(a => {
            const agNorm = normName(a.name);
            const agFirst = agNorm.split(" ")[0];
            return agFirst === opFirstName || opFirstName === agFirst;
          });
        }

        if (best) {
          matched.push({ agentId: best.id, agentName: best.name, opUserId: opUser.id, opName: `${opUser.firstName ?? ""} ${opUser.lastName ?? ""}`.trim() });
        } else {
          unmatched.push({ opUserId: opUser.id, opName: `${opUser.firstName ?? ""} ${opUser.lastName ?? ""}`.trim(), opEmail: opUser.email ?? "" });
        }
      }

      // Write matched openPhoneUserId values to DB
      for (const m of matched) {
        await db.update(agents)
          .set({ openPhoneUserId: m.opUserId })
          .where(eq(agents.id, m.agentId));
      }

      return { matched, unmatched, agentRows: agentRows.map(a => ({ id: a.id, name: a.name })) };
    }),

  /**
   * setAgentOpenPhoneUserId — manually assign an OpenPhone userId to an agent.
   * Used by the admin UI to resolve unmatched agents.
   */
  setAgentOpenPhoneUserId: opsChatProcedure
    .input(z.object({ agentId: z.number(), openPhoneUserId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(agents)
        .set({ openPhoneUserId: input.openPhoneUserId })
        .where(eq(agents.id, input.agentId));
      return { ok: true };
    }),

  /**
   * AI pre-send message quality check.
   * Flags: pronouns (use name instead), assumptions (verify first), unclear sentences.
   * Returns { ok: true } if message is fine, or { ok: false, issues: [...], suggestion: string }
   */
  checkMessageQuality: opsChatProcedure
    .input(z.object({ message: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const systemPrompt = `You are a communication quality checker for an internal ops team chat at a cleaning company. Your job is to review messages before they are sent and flag issues that reduce clarity and professionalism.

Check for these three issues:
1. PRONOUN: The message uses a pronoun (he, she, her, him, they, them, his, hers, their) to refer to a person instead of using their name. Names should always be used for clarity.
2. ASSUMPTION: The message contains uncertain language like "I think", "I feel", "I believe", "probably", "maybe", "I'm not sure but", "I assume", "I guess". Ops messages should be factual — if you don't know, find out first.
3. UNCLEAR: The message is incomplete, missing context, uses abbreviations without explanation, or would not be understood by someone without prior context. Every message should be a complete, self-contained sentence.

Respond ONLY with valid JSON in this exact format:
{
  "ok": true
}
OR if there are issues:
{
  "ok": false,
  "issues": ["PRONOUN", "ASSUMPTION", "UNCLEAR"],
  "feedback": "Short explanation of what's wrong (1-2 sentences max)",
  "suggestion": "A rewritten version of the message that fixes all issues, using [Name] as placeholder where the actual name is unknown"
}

Only flag real issues. Do not flag messages that are already clear and professional. Do not be overly strict.`;

      let raw = "";
      try {
        const result = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.message },
          ],
          response_format: { type: "json_object" },
        });
        raw = (result?.choices?.[0]?.message?.content as string | undefined) ?? "{}";
        const parsed = JSON.parse(raw);
        return {
          ok: parsed.ok === true,
          issues: (parsed.issues as string[] | undefined) ?? [],
          feedback: (parsed.feedback as string | undefined) ?? "",
          suggestion: (parsed.suggestion as string | undefined) ?? "",
        };
      } catch {
        // If AI fails, allow the message through
        return { ok: true, issues: [], feedback: "", suggestion: "" };
      }
    }),

  /**
   * elevateReply — takes an agent's SMS draft and rewrites it to world-class
   * service level (Disney HEARD / Ritz-Carlton / Zappos WOW) while keeping
   * the same length and conversational SMS tone.
   */
  elevateReply: opsChatProcedure
    .input(z.object({
      draft: z.string().min(1).max(2000),
      clientName: z.string().optional(),
      messageHistory: z.string().optional(),
      jobContext: z.string().optional(), // upcoming/today job details (service type, date, team, address)
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const { MAIDS_IN_BLACK_KNOWLEDGE_BASE } = await import("./knowledgeBase");
      const firstName = input.clientName?.split(" ")[0] ?? "the client";
      const messages: Array<{ role: string; content: string }> = (() => {
        try { return JSON.parse(input.messageHistory ?? "[]"); } catch { return []; }
      })();
      const conversationSnippet = messages.slice(-6)
        .map((m) => `${m.role === "user" ? "Client" : "Agent"}: ${m.content}`)
        .join("\n");
      const jobContextSection = input.jobContext
        ? `\n=== CLIENT'S UPCOMING JOB ===\n${input.jobContext}\nUse these details naturally in the rewrite when relevant — reference the specific service, date, or team name to show you know exactly who this client is and what's coming up for them. Never invent details not listed here.\n`
        : "";
      const systemPrompt = `You are a world-class customer service coach for Maids in Black, a premium residential cleaning service in Washington DC.
Your job: take the agent's SMS draft and rewrite it using the Zappos WOW service philosophy — proactive ownership, genuine warmth, and a concrete next step that makes the client feel like the only person in the world.${jobContextSection}

The Zappos model in practice:
- Don't just confirm — OWN it. "We'll get you scheduled" → "I'm on it — let me find you the perfect slot."
- Be specific, not vague. "Whenever you're ready" is passive. Give them something to act on.
- Show you actually care about THIS person, not just the task. One specific, genuine detail beats three generic warm phrases.
- Proactive > reactive. If there's a natural next step, take it for them instead of putting it back on them.

RULES:
1. Return ONLY the rewritten message — no explanation, no preamble, no labels.
2. Keep roughly the same length as the draft — do NOT pad it out.
3. Keep the same intent and facts — do not invent new information or prices.
3a. NEVER change any date, time, day name, or number from the draft. If the draft says "3pm", the rewrite must say "3pm" — not "3am", not "3 PM", not "afternoon". If it says "Tuesday April 14", the rewrite must say "Tuesday April 14". Copy every date, time, and number character-for-character. This rule overrides everything else — even if you think there is a typo, do NOT correct it.
4. Use the client's first name (${firstName}) once, naturally.
5. Replace vague phrases ("whenever you're ready", "let me know", "feel free to reach out") with specific, action-oriented language.
6. Sound like a real person who genuinely wants to help, not a script. Direct, warm, confident.
7. NEVER use hollow filler: no "Absolutely!", "Of course!", "Happy to help!", "You're in great hands!", "Wonderful!", "Just checking in!", "Hope everything's going well!".
8. NEVER invent prices — keep any [placeholder] from the draft as-is.
9. If the draft is already excellent, return it unchanged.

EXAMPLES of the transformation:
Before: "Hey hope everything is going well we'll be able to get you scheduled"
After: "Hey ${firstName}, we have openings this week — want me to lock one in for you?"

Before: "Just wanted to follow up and see if you had any questions"
After: "${firstName}, I wanted to make sure you have everything you need — what's the one thing I can clear up for you right now?"

Before: "Let me know if you'd like to reschedule"
After: "${firstName}, I can move your appointment — does [day] or [day] work better for you?"

=== MAIDS IN BLACK KNOWLEDGE BASE ===
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;
      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          ...(conversationSnippet ? [{ role: "user" as const, content: `Recent conversation:\n${conversationSnippet}` }] : []),
          { role: "user", content: `Agent's draft: "${input.draft}"\n\nRewrite to world-class SMS level. Return only the rewritten message.` },
        ],
      });
      const elevated = ((result.choices?.[0]?.message?.content as string) ?? "").trim();
      return { elevated };
    }),

  /**
   * getCsConvInsight — generates a concise AI insight / action recommendation
   * for the currently selected CS conversation. Takes the last N messages plus
   * optional client profile context and returns a 1-3 sentence advisory.
   * NOTE: must be .mutation (POST) — messageHistory can be very long and exceeds nginx URI limits as a GET param
   */
  getCsConvInsight: opsChatProcedure
    .input(z.object({
      sessionId: z.number(),
      messageHistory: z.string(),
      clientName: z.string().optional(),
      queue: z.string().optional(),
      clientProfile: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const isTeams = input.queue === "Teams";
      const messages: Array<{ role: string; content: string }> = (() => {
        try { return JSON.parse(input.messageHistory); } catch { return []; }
      })();
      if (messages.length === 0) return { insight: "" };
      const recent = messages.slice(-12);
      const snippet = recent
        .map((m) => `${m.role === "user" ? (isTeams ? "Cleaner" : "Client") : "Agent"}: ${m.content}`)
        .join("\n");
      const firstName = input.clientName?.split(" ")[0] ?? "the client";
      const profileCtx = input.clientProfile ? `\n\nCLIENT HISTORY:\n${input.clientProfile}` : "";
      const systemPrompt = isTeams
        ? `You are an operations manager for Maids in Black, a premium home cleaning company in DC/MD/VA. Analyze this SMS conversation with a cleaner and give a 1-2 sentence operational insight: what is happening and what is the single most important action to take right now. Be direct and specific. No fluff. No bullet points.`
        : `You are a senior customer service advisor for Maids in Black, a premium home cleaning company in DC/MD/VA. Analyze this SMS conversation with a client named ${firstName} and give a 1-3 sentence insight: what is the client's situation or mood, what is the single most important action the agent should take right now, and any risk or opportunity to flag. Be specific and actionable. No fluff. No bullet points.${profileCtx}`;
      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `CONVERSATION:\n${snippet}\n\nProvide your insight now.` },
        ],
      });
      const insight = ((result.choices?.[0]?.message?.content as string) ?? "").trim();
      return { insight };
    }),
  /**
   * getCsConvMemory — generates 3-5 AI memory bullet points for a CS conversation.
   * Draws from both conversation history and customer profile context.
   * Results are cached in the DB by message count; returns cached value if still fresh.
   */
  getCsConvMemory: opsChatProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      messageHistory: z.string(),
      clientProfile: z.string().optional(),
      queue: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const db = await getDb();
      if (!db) return { bullets: [] as string[] };

      const messages: Array<{ role: string; content: string }> = (() => {
        try { return JSON.parse(input.messageHistory); } catch { return []; }
      })();
      const msgLen = messages.length;

      if (msgLen === 0) return { bullets: [] as string[] };

      // Check DB cache — return if message count hasn't changed
      const [row] = await db
        .select({ csMemoryCache: conversationSessions.csMemoryCache, csMemoryCachedMsgLen: conversationSessions.csMemoryCachedMsgLen })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);

      if (row?.csMemoryCache && row.csMemoryCachedMsgLen === msgLen) {
        try {
          const cached = JSON.parse(row.csMemoryCache) as string[];
          if (Array.isArray(cached) && cached.length > 0) return { bullets: cached };
        } catch { /* fall through to regenerate */ }
      }

      const isTeams = input.queue === "Teams";
      const snippet = messages.slice(-20)
        .map((m) => `${m.role === "user" ? (isTeams ? "Cleaner" : "Customer") : "Agent"}: ${m.content}`)
        .join("\n");

      const profileCtx = input.clientProfile ? `\n\nCUSTOMER PROFILE:\n${input.clientProfile}` : "";

      const systemPrompt = isTeams
        ? `You are an operations supervisor at Maids in Black, a premium home cleaning company in DC/MD/VA. This is an internal SMS conversation between office staff and a home cleaner (field employee) — NOT a customer conversation. The "Agent" role is office staff, the "Cleaner" role is the home cleaner. Analyze the conversation and return a JSON object with a "bullets" array of 3-5 short memory items (each under 8 words) capturing key operational facts: availability, job assignments, scheduling issues, commitments made, performance signals, supply needs, or anything the office needs to act on. Examples: "Available Sunday confirmed", "Needs early start time", "Reported supply shortage", "Committed to extra job", "Flagged client complaint". Return ONLY valid JSON like {"bullets":["item1","item2"]}.`
        : `You are a senior customer service advisor for Maids in Black. Analyze this SMS conversation and customer profile. Return a JSON object with a "bullets" array of 3-5 short memory items (each under 8 words) an agent needs to know: booking history, service preferences, issues raised, sentiment, upsell signals, commitments. Examples: "Bi-weekly customer", "Adds extras often", "No cancellations", "Upsell opportunity", "Arrival window changed". Return ONLY valid JSON like {"bullets":["item1","item2"]}.${profileCtx}`;

      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `CONVERSATION:\n${snippet}\n\nReturn the JSON now.` },
        ],
      });

      let bullets: string[] = [];
      try {
        const raw = (result.choices?.[0]?.message?.content as string) ?? "{}";
        console.log("[getCsConvMemory] LLM raw:", raw.slice(0, 300));
        // Strip markdown code fences if present
        const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const arr = Array.isArray(parsed) ? parsed : (parsed.bullets ?? parsed.items ?? parsed.memory ?? parsed.memories ?? Object.values(parsed)[0] ?? []);
        bullets = (Array.isArray(arr) ? arr : []).filter((b: unknown) => typeof b === "string" && (b as string).trim().length > 0).slice(0, 5);
        console.log("[getCsConvMemory] bullets:", bullets);
      } catch (e) { console.log("[getCsConvMemory] parse error:", e); bullets = []; }

      if (bullets.length > 0) {
        await db.update(conversationSessions)
          .set({ csMemoryCache: JSON.stringify(bullets), csMemoryCachedMsgLen: msgLen })
          .where(eq(conversationSessions.id, input.sessionId));
      }

      return { bullets };
    }),

  /**
   * addCsNote — saves an internal note to a CS conversation's messageHistory.
   * Notes use role="note" so they are never sent to the customer via SMS.
   * They appear in the thread as amber sticky-note bubbles visible only to agents.
   */
  addCsNote: opsChatProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      note: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [session] = await db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);
      if (!session) throw new Error("Session not found");
      let history: Array<{ role: string; content: string; ts?: number; senderName?: string }> = [];
      try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }
      const agentName = ctx.user?.name ?? "Agent";
      history.push({ role: "note", content: input.note, ts: Date.now(), senderName: agentName });
      await db
        .update(conversationSessions)
        .set({ messageHistory: JSON.stringify(history) })
        .where(eq(conversationSessions.id, input.sessionId));
      return { success: true };
    }),
  /**
   * getCsResolvedCount — count of resolved CS sessions for the Resolved tab badge.
   */
  getCsResolvedCount: opsChatProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { count: 0 };
      const sourceFilter = or(
        eq(conversationSessions.leadSource, "cs-inbound"),
        eq(conversationSessions.leadSource, "cs-inbound-cleaner"),
        eq(conversationSessions.leadSource, "cs_initiated")
      );
      const rows = await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(conversationSessions)
        .where(and(sourceFilter, isNotNull(conversationSessions.csResolvedAt)));
      return { count: Number(rows[0]?.cnt ?? 0) };
    }),

  /**
   * csNbaAnalysis — LLM-powered Next Best Action analysis.
   * Reads the full conversation + client context and returns ONE specific, contextual action
   * the agent should take right now — not forced into fixed buckets.
   * Returns: label (short action name), instruction (exactly what to do), ctaType (for icon/color), reason (why).
   */
  csNbaAnalysis: opsChatProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      messageHistory: z.string(),
      clientName: z.string().optional(),
      clientProfile: z.string().optional(),
      isAlreadyRecurring: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const messages: Array<{ role: string; content: string }> = (() => {
        try { return JSON.parse(input.messageHistory); } catch { return []; }
      })();
      if (messages.length === 0) return { label: "Review conversation", instruction: "Read the full conversation before responding.", ctaType: "info", reason: "" };
      const recent = messages.slice(-20);
      const snippet = recent
        .map((m) => `${m.role === "user" ? "Client" : "Agent"}: ${m.content}`)
        .join("\n");
      const firstName = input.clientName?.split(" ")[0] ?? "the client";
      const profileCtx = input.clientProfile ? `\n\nCLIENT CONTEXT:\n${input.clientProfile}` : "";
      const recurringNote = input.isAlreadyRecurring ? "\nNote: This client is already on a recurring plan." : "";

      const systemPrompt = `You are a senior customer service advisor for Maids in Black, a premium home cleaning company in DC/MD/VA. You are advising an agent who is reading an SMS conversation with a client named ${firstName}.${profileCtx}${recurringNote}

Your job: Read the conversation carefully and identify the SINGLE most important action the agent should take RIGHT NOW. Prioritize actions that make the business more money (upsells, recurring conversions, referrals) whenever the situation naturally allows it — but never at the expense of a service issue that needs to be resolved first.

REVENUE PRIORITY RULES (apply these when there is no urgent service issue):
1. BOOKING JUST CONFIRMED OR COMPLETED → If ${firstName} just booked a one-time clean OR the agent just confirmed a booking, immediately pitch recurring service. Say something like: "Now that we have you booked, have you thought about setting up a recurring schedule? Weekly, bi-weekly, or monthly — recurring clients save 10–15% and get priority scheduling."
2. HAPPY ONE-TIME CUSTOMER (not recurring) → If ${firstName} has had 1+ past cleans and is expressing satisfaction (said 'great', 'love it', 'amazing', 'perfect', etc.), pitch upgrading to bi-weekly or weekly. Mention the discount and priority scheduling.
3. HAPPY RECURRING CUSTOMER → If ${firstName} is already on a recurring plan and says something positive, push a referral. The exact offer: both ${firstName} AND the friend each receive a $50 credit applied to their next clean — but the credit only activates after the referred friend completes their first clean. Use this script: "By the way — we have a referral program where you and a friend each get $50 off. Once they complete their first clean, the $50 credit automatically applies to your next service. Just send us their name and number and we'll reach out to them directly!"
4. RECURRING CUSTOMER ON LOW FREQUENCY (monthly) → If ${firstName} is monthly and happy, suggest upgrading to bi-weekly: "Since you love the service, have you considered switching to bi-weekly? You'd get a 10% discount and your home would stay cleaner between visits."

AVAILABLE ADD-ON SERVICES (upsell these when the client mentions a relevant need):
- Inside Oven cleaning: +$45 — recommend when client mentions oven, cooking smells, or baked-on grease
- Inside Fridge cleaning: +$45 — recommend when client mentions fridge, food smells, or spring cleaning
- Laundry (wash + dry + fold, up to 2 loads): +$35 — recommend when client mentions laundry, clothes, or overwhelm
- Interior Window cleaning: +$60 — recommend when client mentions windows, light, or deep clean
- Organizing (1 area): +$50 — recommend when client mentions clutter, chaos, or organizing
- Move-out/Move-in deep clean: premium pricing — recommend when client mentions moving

Other good instructions:
- "Log into the CRM and reschedule ${firstName}'s booking to next Thursday — she confirmed that date works."
- "Close the booking — ${firstName} agreed to the 3BR deep clean on Friday at 10am. Lock it in and send confirmation."
- "Call ${firstName} now — she's locked out and the team is waiting outside. This can't be resolved over text."
- "Issue a $30 credit and apologize — ${firstName} says the bathroom was missed. Log it in the CRM under her account."
- "Send the quote — ${firstName} asked for pricing on a 2BR move-out clean. Give her a number and ask to book."
- "Ask for a review — ${firstName} just said the clean was amazing. Strike while the iron is hot."
- "Upsell the inside-oven add-on (+$45) — ${firstName} mentioned her oven is a mess and her booking is tomorrow."
- "Confirm the team is on the way — ${firstName} is asking for an ETA. Check the schedule and reply with a time."
- "Pitch recurring service — ${firstName} just confirmed her booking. Follow up with: 'Have you thought about setting up a recurring schedule? Recurring clients save 10–15% and get priority slots.'"
- "Push a referral — ${firstName} is a happy recurring customer. Text her: 'Quick one — we have a referral program: refer a friend and once they complete their first clean, you both get a $50 credit toward your next service. Know anyone who could use a great cleaner? Just send me their name and number!'"
- "Upgrade to bi-weekly — ${firstName} is monthly and just said she loves the service. Mention the 10% bi-weekly discount and cleaner home between visits."

Choose a ctaType that best fits the action:
- "book": closing or confirming a booking
- "crm": action requires logging into the CRM (reschedule, cancel, credit, notes)
- "call": agent should call the client
- "upsell": upselling recurring plan, frequency upgrade, or add-on
- "referral": pushing a referral ($50 off for both)
- "reply": agent should send a specific SMS reply
- "review": asking for a review
- "info": general advisory or wait-and-see

Also include a "prefillScript" field: for ctaType "reply", "upsell", or "referral", write the exact SMS message the agent should send (ready to copy-send, in first person as the agent, warm and friendly tone, max 2 sentences). For other ctaTypes, set prefillScript to null.

Respond ONLY with valid JSON, no markdown:
{"label": "Close Booking", "instruction": "Lock in the 3BR deep clean for Friday 10am — client confirmed.", "ctaType": "book", "reason": "Client said 'that works, let\'s do it' after you quoted Friday.", "prefillScript": null}`;

      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `CONVERSATION:\n${snippet}\n\nRespond with JSON now.` },
        ],
        response_format: { type: "json_object" } as any,
      });
      const raw = ((result.choices?.[0]?.message?.content as string) ?? "").trim();
      try {
        const parsed = JSON.parse(raw) as { label: string; instruction: string; ctaType: string; reason: string; prefillScript?: string | null };
        const validCtaTypes = ["book", "crm", "call", "upsell", "reply", "review", "referral", "info"] as const;
        const ctaType = validCtaTypes.includes(parsed.ctaType as any) ? parsed.ctaType as typeof validCtaTypes[number] : "info";
        return {
          label: parsed.label ?? "Next Action",
          instruction: parsed.instruction ?? "",
          ctaType,
          reason: parsed.reason ?? "",
          prefillScript: parsed.prefillScript ?? null,
        };
      } catch {
        return { label: "Review conversation", instruction: "Read the full context before responding.", ctaType: "info" as const, reason: "", prefillScript: null };
      }
    }),

  /**
   * Fetch ownership state for a list of issue keys.
   */
  getIssueOwnership: opsChatProcedure
    .input(z.object({ issueKeys: z.array(z.string()).max(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db || input.issueKeys.length === 0) return [];
      const rows = await db
        .select()
        .from(issueOwnership)
        .where(inArray(issueOwnership.issueKey, input.issueKeys));
      return rows;
    }),

  /**
   * Claim an issue (assign yourself as owner).
   */
  claimIssue: opsChatProcedure
    .input(z.object({ issueKey: z.string().max(128), claimedBy: z.string().max(128) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const now = Date.now();
      await db
        .insert(issueOwnership)
        .values({ issueKey: input.issueKey, claimedBy: input.claimedBy, claimedAt: now })
        .onDuplicateKeyUpdate({ set: { claimedBy: input.claimedBy, claimedAt: now, resolvedAt: null, resolvedBy: null } });
      // Auto-post system event comment
      await db.insert(issueComments).values({
        issueKey: input.issueKey,
        authorName: "system",
        body: `${input.claimedBy} claimed this issue`,
        type: "system",
        createdAt: now,
      });
      return { ok: true };
    }),

  /**
   * Mark an issue as resolved.
   */
  resolveIssueOwnership: opsChatProcedure
    .input(z.object({ issueKey: z.string().max(128), resolvedBy: z.string().max(128) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const now = Date.now();
      await db
        .insert(issueOwnership)
        .values({ issueKey: input.issueKey, resolvedAt: now, resolvedBy: input.resolvedBy })
        .onDuplicateKeyUpdate({ set: { resolvedAt: now, resolvedBy: input.resolvedBy } });
      // Auto-post system event comment
      await db.insert(issueComments).values({
        issueKey: input.issueKey,
        authorName: "system",
        body: `${input.resolvedBy} marked this issue resolved`,
        type: "system",
        createdAt: now,
      });
      // If this is an alert-type issue (key = "alert-{jobId}-{ts}"), also resolve
      // the underlying issue_flags row so the alert stops reappearing on next poll.
      const alertMatch = input.issueKey.match(/^alert-(\d+)-/);
      if (alertMatch) {
        const jobId = parseInt(alertMatch[1], 10);
        // Resolve all open flags for this job
        await db
          .update(issueFlags)
          .set({ resolvedAt: now, resolvedByName: input.resolvedBy, resolutionNote: "Resolved via Issues panel" })
          .where(and(eq(issueFlags.cleanerJobId, jobId), isNull(issueFlags.resolvedAt)));
        // Clear the job's flagged state
        await db
          .update(cleanerJobs)
          .set({ flagged: 0 })
          .where(eq(cleanerJobs.id, jobId));
      }
      return { ok: true };
    }),

  /**
   * Fetch all comments for a given issueKey, ordered oldest-first.
   */
  getIssueComments: opsChatProcedure
    .input(z.object({ issueKey: z.string().max(128) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueKey, input.issueKey))
        .orderBy(issueComments.createdAt);
      return rows.map(r => ({
        id: r.id,
        issueKey: r.issueKey,
        authorName: r.authorName,
        body: r.body,
        type: r.type as "text" | "system",
        createdAt: r.createdAt,
      }));
    }),

  /**
   * Add a comment (or system event) to an issue thread.
   */
  addIssueComment: opsChatProcedure
    .input(z.object({
      issueKey: z.string().max(128),
      authorName: z.string().max(128),
      body: z.string().max(2000),
      type: z.enum(["text", "system"]).default("text"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const now = Date.now();
      await db.insert(issueComments).values({
        issueKey: input.issueKey,
        authorName: input.authorName,
        body: input.body,
        type: input.type,
        createdAt: now,
      });
      return { ok: true, createdAt: now };
    }),

  /**
   * Use LLM to prefill issue fields from a chat message body.
   */
  prefillIssueFromComment: opsChatProcedure
    .input(z.object({ commentBody: z.string().max(2000) }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const result = await invokeLLM({
        messages: [
          { role: "system", content: "You are an operations assistant. Given a chat message, extract a short issue title (max 8 words), a severity (Critical/High/Medium/Low), a team name (e.g. Dispatch, Cleaning, Office), and a customer name if mentioned. Respond in JSON with keys: title, severity, team, customer." },
          { role: "user", content: input.commentBody },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "issue_prefill",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                severity: { type: "string" },
                team: { type: "string" },
                customer: { type: "string" },
              },
              required: ["title", "severity", "team", "customer"],
              additionalProperties: false,
            },
          },
        },
      });
      const raw = result?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
      return {
        title: parsed.title ?? "",
        severity: ["Critical", "High", "Medium", "Low"].includes(parsed.severity) ? parsed.severity : "Medium",
        team: parsed.team ?? "",
        customer: parsed.customer ?? "",
      };
    }),

  /**
   * Convert a chat message to a manual issue (creates a general_issue opsChatMessage).
   */
  convertChatMessageToIssue: opsChatProcedure
    .input(z.object({
      messageId: z.number().int(),
      title: z.string().max(256),
      severity: z.string().max(32),
      team: z.string().max(128),
      customer: z.string().max(256),
      authorName: z.string().max(128),
      channel: z.string().max(64),
      sourceMessageBody: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const now = Date.now();
      const issueKey = `issue-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const meta = JSON.stringify({
        issueTitle: input.title,
        issueSeverity: input.severity,
        issueTeam: input.team,
        issueCustomer: input.customer,
        sourceMessageId: input.messageId,
        sourceMessageBody: input.sourceMessageBody ?? null,
        raisedBy: input.authorName,
        ts: now,
      });
      await db.insert(opsChatMessages).values({
        channel: input.channel,
        authorName: input.authorName,
        body: input.title,
        quickAction: "general_issue",
        metadata: meta,
        createdAt: new Date(now),
      });
      await db.insert(issueOwnership).values({
        issueKey,
      });
      return { ok: true, newIssueKey: issueKey };
    }),

  /**
   * dismissSystemCard — delete a system-generated ops chat message by ID.
   * Used by the UI to dismiss alert cards like sync_watchdog.
   * Only allows deletion of messages with authorRole = 'system'.
   */
  dismissSystemCard: opsChatProcedure
    .input(z.object({ messageId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [msg] = await db
        .select({ id: opsChatMessages.id, authorRole: opsChatMessages.authorRole })
        .from(opsChatMessages)
        .where(eq(opsChatMessages.id, input.messageId))
        .limit(1);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (msg.authorRole !== "system") throw new TRPCError({ code: "FORBIDDEN", message: "Can only dismiss system messages" });
      await db.delete(opsChatMessages).where(eq(opsChatMessages.id, input.messageId));
      return { success: true };
    }),
});
/** Convert a display name to a URL-safe slug for dmThread keys (legacy fallback only) */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Build a stable DM thread key from two participant keys (emails or slugs).
 * Keys are sorted so A::B and B::A always produce the same thread.
 */
function buildDmThread(keyA: string, keyB: string): string {
  return [keyA, keyB].sort().join("::");
}
