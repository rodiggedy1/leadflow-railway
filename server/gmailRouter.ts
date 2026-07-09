/**
 * gmailRouter.ts — tRPC router for the shared Gmail inbox
 *
 * All procedures require agent authentication (agentProcedure) so only
 * logged-in agents can read/send email through the shared inbox.
 */
import { z } from "zod";
import { router, agentProcedure } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { gmailState, quoteLeads, conversationSessions, completedJobs, gmailSentLog, users, gmailThreadMeta, agents, gmailSenderPolicies } from "../drizzle/schema";
import { eq, or, inArray, desc, isNotNull, isNull, and, like, sql } from "drizzle-orm";
import { processThread, enqueueThread, GLANCE_CATEGORY_META, type GlanceCategory, resolveIsActionable } from "./gmailGlanceWorker";
import {
  getInboxEmailAddress,
  getThreadDetail,
  sendGmailReply,
  sendGmailReplyWithAttachments,
  sendNewGmailEmail,
  markThreadRead,
  markThreadUnread,
  archiveThread,
  setupGmailWatch,
  getAttachmentData,
  getConversationsUnreadCount,
} from "./gmailService";
import { ENV } from "./_core/env";

async function requireGmailConnected() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available." });
  const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
  if (!state?.refreshToken) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Gmail not connected. Visit /api/gmail/oauth/start to connect.",
    });
  }
  return { db, state };
}

export const gmailRouter = router({
  /** Check whether Gmail is connected (refresh token stored in DB) */
  getConnectionStatus: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { connected: false, historyId: null, watchExpiration: null };
    const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
    return {
      connected: Boolean(state?.refreshToken),
      historyId: state?.historyId ?? null,
      watchExpiration: state?.watchExpiration ?? null,
    };
  }),

  /** List inbox threads — DB-backed, zero Gmail API calls.
   * The worker (processThread) is the canonical source for all display fields.
   * If no rows exist yet, returns { threads: [], syncing: true } so the UI
   * can show an "Inbox syncing..." banner instead of a blank or error state.
   * NEVER falls back to Gmail — the DB is the single source of truth.
   */
  listThreads: agentProcedure
    .input(
      z.object({
        pageToken: z.string().optional(),
        maxResults: z.number().min(1).max(500).default(100),
        query: z.string().optional(),
        showIgnored: z.boolean().optional().default(false),
        unreadOnly: z.boolean().optional().default(false),
      })
    )
    .query(async ({ input }) => {
      const { db } = await requireGmailConnected();
      const t0 = Date.now();
      const limit = Math.min(input.maxResults, 500);

      // Cursor-based pagination: pageToken encodes lastMessageAt of the last row
      const cursorAt = input.pageToken ? parseInt(input.pageToken, 10) : null;

      // Build WHERE clause.
      // When searching, skip inbox/actionable filters — search all threads regardless of state.
      const isSearch = !!input.query;
      const conditions = [isNotNull(gmailThreadMeta.senderName)];
      if (!isSearch) {
        // Normal (non-search) view: inbox only
        conditions.push(eq(gmailThreadMeta.isInInbox, 1));
        // When showIgnored=false (default), only show actionable threads
        if (!input.showIgnored) {
          conditions.push(eq(gmailThreadMeta.isActionable, 1));
        }
      }
      // When unreadOnly=true, only return unread threads (used by the right-panel quick-view)
      if (input.unreadOnly) {
        conditions.push(eq(gmailThreadMeta.isUnread, 1));
      }
      if (cursorAt && !isNaN(cursorAt)) {
        conditions.push(sql`${gmailThreadMeta.lastMessageAt} < ${cursorAt}`);
      }
      if (input.query) {
        const q = `%${input.query}%`;
        conditions.push(
          or(
            like(gmailThreadMeta.subject, q),
            like(gmailThreadMeta.senderName, q),
            like(gmailThreadMeta.senderEmail, q),
            like(gmailThreadMeta.snippet, q)
          )!
        );
      }

      const rows = await db
        .select()
        .from(gmailThreadMeta)
        .where(and(...conditions))
        .orderBy(desc(gmailThreadMeta.lastMessageAt))
        .limit(limit + 1); // fetch one extra to detect next page

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      // Explicit hydration check: count total inbox rows vs worker-processed rows
      // This gives an accurate syncing signal and progress metric
      const [hydrationRow] = await db
        .select({
          totalInboxRows: sql<number>`COUNT(*)`,
          hydratedRows: sql<number>`COUNT(${gmailThreadMeta.senderName})`,
        })
        .from(gmailThreadMeta)
        .where(eq(gmailThreadMeta.isInInbox, 1));
      const totalInboxRows = Number(hydrationRow?.totalInboxRows ?? 0);
      const hydratedRows = Number(hydrationRow?.hydratedRows ?? 0);

      // syncing = worker hasn't hydrated any rows yet but rows exist in DB
      // (i.e. the worker simply hasn't run since the new columns were added)
      // Note: do NOT gate on input.query or cursorAt — hydration state is global,
      // not dependent on what filter is active
      const syncing = hydratedRows === 0 && totalInboxRows > 0;

      // Compute stale rows for health logging
      const staleThreshold = Date.now() - 24 * 60 * 60 * 1000;
      const staleRows = pageRows.filter(
        (r) => !r.aiHistoryId || (r.aiProcessedAt && r.aiProcessedAt.getTime() < staleThreshold)
      ).length;

      // Get inbox email for correct contact display (cached after first call)
      const inboxEmail = await getInboxEmailAddress().catch(() => null);

      // Map DB rows to GmailThread shape (no messages — those load on thread open)
      const threads = pageRows.map((row) => ({
        id: row.threadId,
        subject: row.subject ?? "(no subject)",
        snippet: row.snippet ?? "",
        from: row.senderName ?? "",
        fromEmail: row.senderEmail ?? "",
        date: row.lastMessageAt ?? 0,
        isUnread: row.isUnread === 1,
        messageCount: row.messageCount ?? 0,
        messages: [], // not loaded for list view — fetched on thread open via getThread
        inboxEmail,
      }));

      const nextPageToken = hasMore
        ? String(pageRows[pageRows.length - 1].lastMessageAt ?? 0)
        : undefined;

      const durationMs = Date.now() - t0;
      console.log(
        `[InboxDB] totalInboxRows=${totalInboxRows} hydratedRows=${hydratedRows} rowsReturned=${threads.length} duration=${durationMs}ms gmailCalls=0 staleRows=${staleRows} syncing=${syncing}`
      );

      return { threads, nextPageToken, syncing };
    }),

  /** Get full thread detail including all messages, with agent sentBy info */
  getThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ input }) => {
      const { db } = await requireGmailConnected();
      const thread = await getThreadDetail(input.threadId, "getThread");

      // Fetch agent log entries for this thread
      const sentLogs = await db
        .select()
        .from(gmailSentLog)
        .where(eq(gmailSentLog.threadId, input.threadId));

      // Build a map of messageId -> agent info
      const sentByMap: Record<string, { name: string; photoUrl: string | null }> = {};
      for (const log of sentLogs) {
        sentByMap[log.messageId] = { name: log.agentName, photoUrl: log.agentPhotoUrl ?? null };
      }

      // Attach sentBy to each message
      const messagesWithAgent = thread.messages.map((msg: any) => ({
        ...msg,
        sentBy: sentByMap[msg.id] ?? null,
      }));

      return { ...thread, messages: messagesWithAgent };
    }),

  /** Reply to an existing thread */
  sendReply: agentProcedure
    .input(
      z.object({
        threadId: z.string(),
        to: z.string().email(),
        subject: z.string(),
        bodyHtml: z.string(),
        inReplyToMessageId: z.string().optional(),
        attachments: z.array(z.object({
          url: z.string(),
          filename: z.string(),
          mimeType: z.string(),
        })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = await requireGmailConnected();
      // Use multipart/mixed when attachments are present, plain HTML otherwise
      const result = (input.attachments && input.attachments.length > 0)
        ? await sendGmailReplyWithAttachments({
            threadId: input.threadId,
            to: input.to,
            subject: input.subject,
            bodyHtml: input.bodyHtml,
            inReplyToMessageId: input.inReplyToMessageId,
            attachments: input.attachments,
          })
        : await sendGmailReply({
            threadId: input.threadId,
            to: input.to,
            subject: input.subject,
            bodyHtml: input.bodyHtml,
            inReplyToMessageId: input.inReplyToMessageId,
          });

            // Log which agent sent this reply (wrapped in try/catch — email already sent above)
      try {
        if (result?.messageId) {
          // Look up agent's profile photo from agents table
          const [agentRow] = await db
            .select({ profilePhotoUrl: agents.profilePhotoUrl })
            .from(agents)
            .where(eq(agents.id, ctx.agent.agentId))
            .limit(1);
          await db.insert(gmailSentLog).values({
            threadId: input.threadId,
            messageId: result.messageId,
            agentOpenId: String(ctx.agent.agentId),
            agentName: ctx.agent.agentName ?? "Agent",
            agentPhotoUrl: agentRow?.profilePhotoUrl ?? null,
          }).onDuplicateKeyUpdate({ set: { agentName: ctx.agent.agentName ?? "Agent" } });
        }
      } catch (logErr) {
        console.error("[sendReply] Failed to log agent attribution (non-fatal):", logErr);
      }

      return result;
    }),

  /** Compose and send a brand-new email */
  composeNew: agentProcedure
    .input(
      z.object({
        to: z.string().email(),
        subject: z.string(),
        bodyHtml: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await requireGmailConnected();
      return sendNewGmailEmail({
        to: input.to,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
      });
    }),

  /** Mark a thread as read */
  markRead: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await markThreadRead(input.threadId);
      // Sync isUnread in gmail_thread_meta (UPDATE only — never insert partial rows)
      if (db) {
        await db.update(gmailThreadMeta)
          .set({ isUnread: 0 })
          .where(eq(gmailThreadMeta.threadId, input.threadId))
          .catch(() => {});
      }
      return { success: true };
    }),

  /** Mark a thread as unread */
  markUnread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await markThreadUnread(input.threadId);
      // Sync isUnread in gmail_thread_meta (UPDATE only — never insert partial rows)
      if (db) {
        await db.update(gmailThreadMeta)
          .set({ isUnread: 1 })
          .where(eq(gmailThreadMeta.threadId, input.threadId))
          .catch(() => {});
      }
      return { success: true };
    }),

  /** Archive a thread (remove from inbox) */
  archiveThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();
      await archiveThread(input.threadId);
      // Mark as no longer in inbox so glance counts update immediately
      if (db) {
        await db.insert(gmailThreadMeta)
          .values({ threadId: input.threadId, isInInbox: 0 })
          .onDuplicateKeyUpdate({ set: { isInInbox: 0 } })
          .catch(() => {});
      }
      return { success: true };
    }),

  /** Generate an AI draft reply for the current thread */
  draftReply: agentProcedure
    .input(
      z.object({
        threadId: z.string(),
        customerEmail: z.string().email().optional(),
        messages: z.array(
          z.object({
            from: z.string(),
            bodyText: z.string(),
            date: z.number(),
            isOutbound: z.boolean().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();

      // Look up customer context from DB if email provided
      let customerName = "there";
      let serviceType: string | null = null;
      let jobCount = 0;
      if (input.customerEmail) {
        const [lead] = await db.select().from(quoteLeads).where(eq(quoteLeads.email, input.customerEmail)).limit(1);
        if (lead) {
          customerName = lead.name?.split(" ")[0] ?? "there";
          serviceType = lead.serviceType ?? null;
          const jobs = await db.select({ id: completedJobs.id }).from(completedJobs).where(eq(completedJobs.email, input.customerEmail)).limit(10);
          jobCount = jobs.length;
        }
      }

      // Build conversation transcript (last 8 messages)
      const transcript = input.messages
        .slice(-8)
        .map((m) => {
          const role = m.isOutbound ? "Maids in Black (us)" : `Customer (${m.from})`;
          const text = m.bodyText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
          return `${role}: ${text}`;
        })
        .join("\n\n");

      const serviceInfo = serviceType ? ` regarding ${serviceType}` : "";
      const historyNote = jobCount > 0
        ? ` They have had ${jobCount} previous cleaning${jobCount > 1 ? "s" : ""} with us.`
        : "";

      const systemPrompt = `You are a friendly, professional customer service agent for Maids in Black, a premium residential cleaning company.
Write a concise, warm reply to this email thread.
Rules:
- Address the customer by their first name: ${customerName}
- Keep it under 120 words
- Be helpful and specific to what they asked — do not be generic
- Do NOT use placeholders like [Name] or [Date] or [Time]
- Sign off as: The Maids in Black Team
- Plain text only, no markdown, no HTML${historyNote}`;

      const userPrompt = `Customer: ${customerName}${serviceInfo}

Email thread (most recent last):
${transcript}

Write the reply now:`;

      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const draft = (result.choices[0]?.message?.content as string ?? "").trim();
      if (!draft) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI returned empty draft" });
      return { draft };
    }),

  /** Look up customer context by email — used in the inbox right panel */
  getCustomerContext: agentProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available." });

      // Query completed_jobs directly by email — no quoteLeads lookup needed
      const allJobs = await db
        .select()
        .from(completedJobs)
        .where(eq(completedJobs.email, input.email))
        .orderBy(desc(completedJobs.jobDate))
        .limit(200);

      // Compute lifetime stats
      const jobCount = allJobs.length;
      const lifetimeValue = allJobs.reduce((sum, j) => sum + (j.lastBookingPrice ?? 0), 0);
      const avgJobPrice = jobCount > 0 ? Math.round(lifetimeValue / jobCount) : 0;
      const firstJobDate = allJobs.length > 0 ? allJobs[allJobs.length - 1].jobDate : null;
      const lastJobDate = allJobs.length > 0 ? allJobs[0].jobDate : null;

      // Pull name and phone from the most recent job
      const mostRecentJob = allJobs[0] ?? null;

      // Return only the 20 most recent jobs for the UI timeline
      const recentJobs = allJobs.slice(0, 20);

      return {
        customerName: mostRecentJob?.name ?? null,
        customerPhone: mostRecentJob?.phone ?? null,
        completedJobs: recentJobs,
        stats: { jobCount, lifetimeValue, avgJobPrice, firstJobDate, lastJobDate },
      };
    }),

  /** Toggle issue flag on a thread. Generates AI summary when flagging. */
  flagIssue: agentProcedure
    .input(
      z.object({
        threadId: z.string(),
        flag: z.boolean(), // true = flag as issue, false = unflag
        messages: z.array(
          z.object({
            from: z.string(),
            bodyText: z.string(),
            date: z.number(),
            isOutbound: z.boolean().optional(),
          })
        ).optional(),
        subject: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { db } = await requireGmailConnected();
      const agentOpenId = String(ctx.agent.agentId);

      let issueSummary: string | null = null;

      if (input.flag && input.messages && input.messages.length > 0) {
        // Generate AI summary of why this is an issue
        try {
          const transcript = input.messages
            .slice(-6)
            .map((m) => {
              const role = m.isOutbound ? "Agent" : `Customer (${m.from})`;
              const text = m.bodyText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
              return `${role}: ${text}`;
            })
            .join("\n\n");

          const result = await invokeLLM({
            messages: [
              {
                role: "system",
                content: "You are a customer service manager. In ONE sentence (max 15 words), describe the core issue in this email thread. Be specific. Start with the problem, not 'Customer says'. Example: 'Missed cleaning on June 3rd, customer requesting refund.'",
              },
              {
                role: "user",
                content: `Subject: ${input.subject ?? "(no subject)"}\n\n${transcript}`,
              },
            ],
          });
          issueSummary = (result.choices[0]?.message?.content as string ?? "").trim().replace(/^"|"$/g, "");
        } catch {
          // Non-fatal — flag still works without summary
        }
      }

      // Upsert the thread meta row
      await db
        .insert(gmailThreadMeta)
        .values({
          threadId: input.threadId,
          isIssue: input.flag ? 1 : 0,
          issueSummary: input.flag ? issueSummary : null,
          flaggedBy: input.flag ? agentOpenId : null,
          flaggedAt: input.flag ? new Date() : null,
        })
        .onDuplicateKeyUpdate({
          set: {
            isIssue: input.flag ? 1 : 0,
            issueSummary: input.flag ? issueSummary : null,
            flaggedBy: input.flag ? agentOpenId : null,
            flaggedAt: input.flag ? new Date() : null,
            updatedAt: new Date(),
          },
        });

      return { success: true, issueSummary };
    }),

  /** Fetch thread meta for a list of thread IDs (used to hydrate issue badges) */
  listThreadMeta: agentProcedure
    .input(z.object({ threadIds: z.array(z.string()).max(200) }))
    .query(async ({ input }) => {
      if (input.threadIds.length === 0) return { meta: [] };
      const { db } = await requireGmailConnected();
      const rows = await db
        .select()
        .from(gmailThreadMeta)
        .where(inArray(gmailThreadMeta.threadId, input.threadIds));
      return { meta: rows };
    }),

  /** Fetch attachment bytes from Gmail API and return as base64 data URL */
  getAttachment: agentProcedure
    .input(z.object({
      messageId: z.string(),
      attachmentId: z.string(),
      mimeType: z.string(),
    }))
    .query(async ({ input }) => {
      await requireGmailConnected();
      const { data, size } = await getAttachmentData(input.messageId, input.attachmentId);
      return {
        dataUrl: `data:${input.mimeType};base64,${data}`,
        size,
      };
    }),

  /** Upload a file attachment to S3 for use in email replies */
  uploadAttachment: agentProcedure
    .input(z.object({
      filename: z.string(),
      mimeType: z.string(),
      base64Data: z.string(), // base64-encoded file content
    }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import("./storage");
      const buf = Buffer.from(input.base64Data, "base64");
      // Limit: 25MB per attachment (Gmail's limit)
      if (buf.length > 25 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment exceeds 25 MB limit." });
      }
      const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `gmail-attachments/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
      const { url } = await storagePut(key, buf, input.mimeType);
      return { url, key, filename: input.filename, mimeType: input.mimeType, size: buf.length };
    }),

  /** Return unread count for the Conversations tab (non-Thumbtack inbox threads) */
  getUnreadCount: agentProcedure.query(async () => {
    await requireGmailConnected();
    const count = await getConversationsUnreadCount();
    return { count };
  }),

  /** Assign a thread to an agent (or reassign). Agents can assign to themselves. */
  assignThread: agentProcedure
    .input(z.object({
      threadId: z.string(),
      agentId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();
      // Fetch agent info to cache name + photo
      const [agent] = await db
        .select({ id: agents.id, name: agents.name, profilePhotoUrl: agents.profilePhotoUrl })
        .from(agents)
        .where(eq(agents.id, input.agentId))
        .limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      // Upsert the meta row
      await db
        .insert(gmailThreadMeta)
        .values({
          threadId: input.threadId,
          isIssue: 0,
          assignedToId: agent.id,
          assignedToName: agent.name,
          assignedToPhotoUrl: agent.profilePhotoUrl ?? null,
          assignedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            assignedToId: agent.id,
            assignedToName: agent.name,
            assignedToPhotoUrl: agent.profilePhotoUrl ?? null,
            assignedAt: new Date(),
          },
        });
      return { success: true, assignedToName: agent.name };
    }),

  /** Remove assignment from a thread */
  unassignThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();
      await db
        .update(gmailThreadMeta)
        .set({ assignedToId: null, assignedToName: null, assignedToPhotoUrl: null, assignedAt: null })
        .where(eq(gmailThreadMeta.threadId, input.threadId));
      return { success: true };
    }),

  /** List active agents available for thread assignment */
  listAgentsForAssignment: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { agents: [] };
    const rows = await db
      .select({ id: agents.id, name: agents.name, profilePhotoUrl: agents.profilePhotoUrl })
      .from(agents)
      .where(eq(agents.isActive, 1));
    return { agents: rows };
  }),

  /** Inbox analytics: unread count, flagged count, assigned count, avg first-response time */
  getInboxAnalytics: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { unread: 0, flagged: 0, assigned: 0, avgResponseMs: null };
    // Flagged and assigned counts from meta table
    const metaRows = await db.select().from(gmailThreadMeta);
    const flagged = metaRows.filter((r) => r.isIssue === 1).length;
    const assigned = metaRows.filter((r) => r.assignedToId !== null).length;
    // Avg first-response time from gmailSentLog (time between first inbound and first reply per thread)
    const sentRows = await db
      .select({ threadId: gmailSentLog.threadId, sentAt: gmailSentLog.sentAt })
      .from(gmailSentLog)
      .orderBy(gmailSentLog.sentAt);
    // Group by threadId — take the earliest sent timestamp per thread
    const firstReplyByThread = new Map<string, Date>();
    for (const row of sentRows) {
      if (!firstReplyByThread.has(row.threadId) && row.sentAt) {
        firstReplyByThread.set(row.threadId, row.sentAt);
      }
    }
    // Get unread count (lightweight — reuse existing helper)
    let unread = 0;
    try {
      unread = await getConversationsUnreadCount();
    } catch { /* Gmail may not be connected */ }
    // Avg response time: we don't have inbound timestamps in DB, so return sent count as proxy
    // Return null for avgResponseMs when we don't have enough data
    const avgResponseMs = firstReplyByThread.size > 0 ? null : null; // placeholder — extend later
    return { unread, flagged, assigned, avgResponseMs, repliedThreadCount: firstReplyByThread.size };
  }),

  // ── AI Glance procedures ─────────────────────────────────────────────────────

  /**
   * Get the "Today at a Glance" summary: counts per category.
   * DB read for counts + Gmail API fetch for thread objects so the client
   * can inject them into the list — guaranteeing count == visible threads.
   * staleTime on client: 60s.
   */
  getGlance: agentProcedure.query(async () => {
    const { db } = await requireGmailConnected();

    // DB-backed: read all classified inbox rows in one query — zero Gmail API calls.
    // Display fields (senderName, senderEmail, subject, snippet, lastMessageAt, messageCount)
    // are written by the glance worker on every processThread() run.
    const rows = await db
      .select({
        threadId: gmailThreadMeta.threadId,
        aiCategory: gmailThreadMeta.aiCategory,
        aiUrgency: gmailThreadMeta.aiUrgency,
        aiResolvedAt: gmailThreadMeta.aiResolvedAt,
        senderName: gmailThreadMeta.senderName,
        senderEmail: gmailThreadMeta.senderEmail,
        subject: gmailThreadMeta.subject,
        snippet: gmailThreadMeta.snippet,
        lastMessageAt: gmailThreadMeta.lastMessageAt,
        messageCount: gmailThreadMeta.messageCount,
        isUnread: gmailThreadMeta.isUnread,
      })
      .from(gmailThreadMeta)
      .where(isNotNull(gmailThreadMeta.aiCategory));

    // Build category buckets — exclude resolved and general
    const buckets: Record<string, { threads: any[]; urgentCount: number }> = {};
    const allCategories = Object.keys(GLANCE_CATEGORY_META).filter((c) => c !== "general") as GlanceCategory[];
    for (const cat of allCategories) {
      buckets[cat] = { threads: [], urgentCount: 0 };
    }

    for (const row of rows) {
      if (!row.aiCategory || row.aiCategory === "general") continue;
      if (row.aiResolvedAt) continue;
      if (!buckets[row.aiCategory]) buckets[row.aiCategory] = { threads: [], urgentCount: 0 };
      // Map DB column names to the GmailThread shape the client expects
      buckets[row.aiCategory].threads.push({
        id: row.threadId,
        from: row.senderName ?? "",
        fromEmail: row.senderEmail ?? "",
        subject: row.subject ?? "",
        snippet: row.snippet ?? "",
        date: row.lastMessageAt ?? 0,
        isUnread: Boolean(row.isUnread),
        messageCount: row.messageCount ?? 0,
        messages: [],    // not needed in glance panel
        inboxEmail: "",  // not needed in glance panel
      });
      if (row.aiUrgency === "high") buckets[row.aiCategory].urgentCount++;
    }

    console.log(`[GlanceWorker] getGlance DB-backed: ${rows.length} rows read, 0 Gmail API calls`);

    const categories = allCategories
      .map((category) => {
        const bucket = buckets[category];
        return {
          category,
          ...GLANCE_CATEGORY_META[category],
          count: bucket.threads.length,
          urgentCount: bucket.urgentCount,
          threadIds: bucket.threads.map((t) => t.id),
          threads: bucket.threads,
        };
      })
      .sort((a, b) => b.urgentCount - a.urgentCount || b.count - a.count);

    return { categories, totalProcessed: rows.length };
  }),

  /**
   * On-demand: process a single thread immediately (used when user opens an unprocessed thread).
   * Returns the stored aiSummary and aiCategory after processing.
   */
  processThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      await requireGmailConnected();
      await processThread(input.threadId);
      const db = await getDb();
      if (!db) return { aiCategory: null, aiSummary: null, aiUrgency: null };
      const [row] = await db
        .select({ aiCategory: gmailThreadMeta.aiCategory, aiSummary: gmailThreadMeta.aiSummary, aiUrgency: gmailThreadMeta.aiUrgency })
        .from(gmailThreadMeta)
        .where(eq(gmailThreadMeta.threadId, input.threadId));
      return {
        aiCategory: row?.aiCategory ?? null,
        aiSummary: row?.aiSummary ?? null,
        aiUrgency: row?.aiUrgency ?? null,
      };
    }),

  /**
   * Mark a glance item as resolved — removes it from the glance panel.
   * Does NOT archive or modify the Gmail thread.
   */
  resolveGlanceItem: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();
      await db
        .insert(gmailThreadMeta)
        .values({ threadId: input.threadId, isIssue: 0, aiResolvedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { aiResolvedAt: new Date(), updatedAt: new Date() } });
      return { success: true };
    }),

  /**
   * Operator "I'm done with this email" workflow.
   * If the thread is still unread, marks it read first (Gmail + DB).
   * Then resolves the AI glance item (sets aiResolvedAt).
   * Single round-trip — orchestrates markRead + resolveGlanceItem without
   * duplicating their logic.
   */
  completeThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();
      // Step 1: mark read if currently unread (UPDATE only — never insert partial rows)
      const [meta] = await db
        .select({ isUnread: gmailThreadMeta.isUnread })
        .from(gmailThreadMeta)
        .where(eq(gmailThreadMeta.threadId, input.threadId))
        .limit(1);
      if (meta?.isUnread) {
        await markThreadRead(input.threadId).catch(() => {});
        await db.update(gmailThreadMeta)
          .set({ isUnread: 0 })
          .where(eq(gmailThreadMeta.threadId, input.threadId))
          .catch(() => {});
      }
      // Step 2: resolve the AI glance item
      await db
        .insert(gmailThreadMeta)
        .values({ threadId: input.threadId, isIssue: 0, aiResolvedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { aiResolvedAt: new Date(), updatedAt: new Date() } });
      return { success: true };
    }),

  /**
   * Get the stored AI summary + category for a single thread.
   * Used to hydrate the right panel when a thread is selected.
   */
  getThreadAiData: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { aiCategory: null, aiSummary: null, aiUrgency: null, aiProcessedAt: null };
      const [row] = await db
        .select({
          aiCategory: gmailThreadMeta.aiCategory,
          aiSummary: gmailThreadMeta.aiSummary,
          aiUrgency: gmailThreadMeta.aiUrgency,
          aiProcessedAt: gmailThreadMeta.aiProcessedAt,
        })
        .from(gmailThreadMeta)
        .where(eq(gmailThreadMeta.threadId, input.threadId));
      return {
        aiCategory: row?.aiCategory ?? null,
        aiSummary: row?.aiSummary ?? null,
        aiUrgency: row?.aiUrgency ?? null,
        aiProcessedAt: row?.aiProcessedAt ?? null,
      };
    }),

  /**
   * Manually override the AI category for a thread.
   * Clears aiResolvedAt so the thread re-appears in the glance panel under the new category.
   */
  recategorizeThread: agentProcedure
    .input(z.object({
      threadId: z.string(),
      category: z.enum([
        "refund_request", "quote_request", "booking_confirmation",
        "recurring_cancellation", "payroll_issue", "upset_customer",
        "revenue_opportunity", "general",
      ]),
    }))
    .mutation(async ({ input }) => {
      const { db } = await requireGmailConnected();
      await db
        .insert(gmailThreadMeta)
        .values({
          threadId: input.threadId,
          aiCategory: input.category,
          aiResolvedAt: null,
          isIssue: 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            aiCategory: input.category,
            aiResolvedAt: null,
            updatedAt: new Date(),
          },
        });
      return { success: true };
    }),

  /**
   * Get agent assignment buckets — returns all active agents with their open
   * (unresolved) assigned thread counts and full thread objects for filtering.
   * "Open" means: assignedToId IS NOT NULL AND aiResolvedAt IS NULL.
   */
  getAgentAssignments: agentProcedure.query(async () => {
    const { db } = await requireGmailConnected();

    // 1. Get all active agents
    const agentRows = await db
      .select({ id: agents.id, name: agents.name, profilePhotoUrl: agents.profilePhotoUrl })
      .from(agents)
      .where(eq(agents.isActive, 1));

    if (agentRows.length === 0) return { agents: [] };

    // 2. Get all open assigned threads (not resolved, has an assignee)
    const metaRows = await db
      .select({
        threadId: gmailThreadMeta.threadId,
        assignedToId: gmailThreadMeta.assignedToId,
        assignedToName: gmailThreadMeta.assignedToName,
        assignedToPhotoUrl: gmailThreadMeta.assignedToPhotoUrl,
        aiResolvedAt: gmailThreadMeta.aiResolvedAt,
      })
      .from(gmailThreadMeta)
      .where(isNotNull(gmailThreadMeta.assignedToId));

    // Filter to only unresolved
    const openRows = metaRows.filter((r) => !r.aiResolvedAt);

    // 3. Group thread IDs by agent ID
    const threadsByAgent = new Map<number, string[]>();
    for (const row of openRows) {
      if (row.assignedToId == null) continue;
      if (!threadsByAgent.has(row.assignedToId)) threadsByAgent.set(row.assignedToId, []);
      threadsByAgent.get(row.assignedToId)!.push(row.threadId);
    }

    // 4. Fetch thread objects for all assigned threads (parallel, batched)
    const allThreadIds = Array.from(new Set(openRows.map((r) => r.threadId)));
    const BATCH = 20;
    const threadMap = new Map<string, any>();
    const _assignT0 = Date.now();
    for (let i = 0; i < allThreadIds.length; i += BATCH) {
      const batch = allThreadIds.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map((id) => getThreadDetail(id, "getAgentAssignments")));
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") threadMap.set(batch[idx], r.value);
      });
    }
    console.log(`[GmailAPI] parent=getAgentAssignments completed count=${allThreadIds.length} duration=${Date.now() - _assignT0}ms`);

    // 5. Build per-agent result — include ALL active agents (0-count ones too)
    const result = agentRows.map((agent) => {
      const tids = threadsByAgent.get(agent.id) ?? [];
      const threads = tids.map((id) => threadMap.get(id)).filter(Boolean);
      return {
        agentId: agent.id,
        agentName: agent.name,
        agentPhotoUrl: agent.profilePhotoUrl ?? null,
        count: threads.length,
        threads,
      };
    });

    // Sort: agents with assignments first, then alphabetically
    result.sort((a, b) => b.count - a.count || a.agentName.localeCompare(b.agentName));

    return { agents: result };
  }),

  // ── Sender Policy procedures ─────────────────────────────────────────────────

  /** List all sender policies */
  listSenderPolicies: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { policies: [] };
    const rows = await db
      .select()
      .from(gmailSenderPolicies)
      .orderBy(desc(gmailSenderPolicies.createdAt));
    return { policies: rows };
  }),

  /**
   * Create or update a sender policy.
   * After saving, bulk-re-resolves all affected threads (no blind reset).
   */
  upsertSenderPolicy: agentProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(), // present = update
        senderEmail: z.string().max(255).optional(),
        senderDomain: z.string().max(255).optional(),
        isActionable: z.number().int().min(0).max(1),
        label: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available." });

      if (!input.senderEmail && !input.senderDomain) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "senderEmail or senderDomain required." });
      }

      if (input.id) {
        // Update existing
        await db
          .update(gmailSenderPolicies)
          .set({
            senderEmail: input.senderEmail ?? null,
            senderDomain: input.senderDomain ?? null,
            isActionable: input.isActionable,
            label: input.label ?? null,
            updatedAt: new Date(),
          })
          .where(eq(gmailSenderPolicies.id, input.id));
      } else {
        // Insert new
        await db.insert(gmailSenderPolicies).values({
          senderEmail: input.senderEmail ?? null,
          senderDomain: input.senderDomain ?? null,
          isActionable: input.isActionable,
          label: input.label ?? null,
        });
      }

      // Re-resolve all affected threads (email match or domain match)
      const emailLower = (input.senderEmail ?? "").toLowerCase().trim();
      const domainLower = (input.senderDomain ?? "").toLowerCase().trim();

      const affectedRows = await db
        .select({ threadId: gmailThreadMeta.threadId, senderEmail: gmailThreadMeta.senderEmail })
        .from(gmailThreadMeta)
        .where(
          or(
            emailLower ? like(gmailThreadMeta.senderEmail, emailLower) : sql`FALSE`,
            domainLower ? sql`${gmailThreadMeta.senderEmail} LIKE ${`%@${domainLower}`}` : sql`FALSE`
          )!
        );

      let updated = 0;
      for (const row of affectedRows) {
        const { isActionable: newActionable, actionableReason: newReason } = await resolveIsActionable(
          row.senderEmail ?? ""
        );
        await db
          .update(gmailThreadMeta)
          .set({ isActionable: newActionable, actionableReason: newReason, updatedAt: new Date() })
          .where(eq(gmailThreadMeta.threadId, row.threadId));
        updated++;
      }

      console.log(`[SenderPolicy] upsert senderEmail=${emailLower || null} senderDomain=${domainLower || null} isActionable=${input.isActionable} threadsUpdated=${updated}`);
      return { success: true, threadsUpdated: updated };
    }),

  /**
   * Delete a sender policy.
   * After deleting, re-resolves affected threads against remaining policies
   * (a deleted email rule may fall back to a domain rule — NOT a blind DEFAULT reset).
   */
  deleteSenderPolicy: agentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available." });

      // Fetch the policy before deleting so we know which threads to re-resolve
      const [policy] = await db
        .select()
        .from(gmailSenderPolicies)
        .where(eq(gmailSenderPolicies.id, input.id))
        .limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found." });

      // Delete the policy
      await db.delete(gmailSenderPolicies).where(eq(gmailSenderPolicies.id, input.id));

      // Re-resolve affected threads (policy is now gone — remaining rules apply)
      const emailLower = (policy.senderEmail ?? "").toLowerCase().trim();
      const domainLower = (policy.senderDomain ?? "").toLowerCase().trim();

      const affectedRows = await db
        .select({ threadId: gmailThreadMeta.threadId, senderEmail: gmailThreadMeta.senderEmail })
        .from(gmailThreadMeta)
        .where(
          or(
            emailLower ? like(gmailThreadMeta.senderEmail, emailLower) : sql`FALSE`,
            domainLower ? sql`${gmailThreadMeta.senderEmail} LIKE ${`%@${domainLower}`}` : sql`FALSE`
          )!
        );

      let updated = 0;
      for (const row of affectedRows) {
        const { isActionable: newActionable, actionableReason: newReason } = await resolveIsActionable(
          row.senderEmail ?? ""
        );
        await db
          .update(gmailThreadMeta)
          .set({ isActionable: newActionable, actionableReason: newReason, updatedAt: new Date() })
          .where(eq(gmailThreadMeta.threadId, row.threadId));
        updated++;
      }

      console.log(`[SenderPolicy] deleted id=${input.id} senderEmail=${emailLower || null} senderDomain=${domainLower || null} threadsReResolved=${updated}`);
      return { success: true, threadsReResolved: updated };
    }),

  /**
   * Rewrite a voice-transcribed email draft with a specific tone.
   * Mirrors opsChat.rewriteVoiceMessage but uses email-appropriate prompting.
   */
  rewriteEmailDraft: agentProcedure
    .input(z.object({
      rawDraft: z.string().min(1).max(2000),
      recipientName: z.string().min(1).max(100).optional(),
      tone: z.enum(["friendly", "professional", "casual"]),
      context: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const toneInstructions: Record<string, string> = {
        friendly: `Tone: FRIENDLY. Warm, personal, and upbeat. Use the recipient's name if known.\nInclude 1-2 emoji placed naturally (e.g. \ud83d\ude0a \ud83d\udc4b \ud83d\ude4f). A friendly email with zero emoji is wrong.\nFeel complete and warm.`,
        professional: `Tone: PROFESSIONAL. Polished, clear, and concise. No emoji.\nFormal but not cold. Sounds like a well-run business communicating professionally.`,
        casual: `Tone: CASUAL. Short and conversational.\n2-4 sentences max. No corporate language. Natural and relaxed. 0-1 emoji max.`,
      };

      const systemPrompt = `You are an expert email writer for a residential cleaning company.\nYou rewrite rough voice-dictated drafts into polished email replies.\n${toneInstructions[input.tone]}\n\nRules:\n- Write ONLY the email body text. No subject line, no salutation, no sign-off.\n- Keep it concise.\n- Preserve all factual details from the original draft (dates, prices, names).\n- Do not add information that wasn't in the original draft.`;

      const userPrompt = `${input.recipientName ? `Recipient: ${input.recipientName}\n` : ""}${input.context ? `Thread context: ${input.context}\n` : ""}Voice draft to rewrite: ${input.rawDraft}`;

      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const rewritten = ((result.choices[0].message.content as string) ?? "").trim();
      return { message: rewritten };
    }),

  /** Set up Gmail Pub/Sub watch — call once after OAuth, then renew before expiry */
  setupWatch: agentProcedure.mutation(async () => {
    const topicName = ENV.gmailPubsubTopic;
    if (!topicName) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "GMAIL_PUBSUB_TOPIC env var not set.",
      });
    }
    const { db } = await requireGmailConnected();
    const { historyId, expiration } = await setupGmailWatch(topicName);
    await db
      .update(gmailState)
      .set({ historyId, watchExpiration: Number(expiration) })
      .where(eq(gmailState.id, 1));
    return { historyId, expiration };
  }),
});
