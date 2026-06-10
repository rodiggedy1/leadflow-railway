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
import { gmailState, quoteLeads, conversationSessions, completedJobs, gmailSentLog, users, gmailThreadMeta, agents } from "../drizzle/schema";
import { eq, or, inArray, desc } from "drizzle-orm";
import {
  listInboxThreads,
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

  /** List inbox threads with optional pagination and search */
  listThreads: agentProcedure
    .input(
      z.object({
        pageToken: z.string().optional(),
        maxResults: z.number().min(1).max(500).default(100),
        query: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      await requireGmailConnected();
      return listInboxThreads({
        pageToken: input.pageToken,
        maxResults: input.maxResults,
        query: input.query,
      });
    }),

  /** Get full thread detail including all messages, with agent sentBy info */
  getThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ input }) => {
      const { db } = await requireGmailConnected();
      const thread = await getThreadDetail(input.threadId);

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
      await markThreadRead(input.threadId);
      return { success: true };
    }),

  /** Mark a thread as unread */
  markUnread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      await markThreadUnread(input.threadId);
      return { success: true };
    }),

  /** Archive a thread (remove from inbox) */
  archiveThread: agentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      await archiveThread(input.threadId);
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
