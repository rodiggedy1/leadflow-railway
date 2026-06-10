/**
 * gmailRouter.ts — tRPC router for the shared Gmail inbox
 *
 * All procedures require agent authentication (adminAgentProcedure) so only
 * logged-in agents can read/send email through the shared inbox.
 */
import { z } from "zod";
import { router, adminAgentProcedure } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { gmailState, quoteLeads, conversationSessions, completedJobs, gmailSentLog, users, gmailThreadMeta } from "../drizzle/schema";
import { eq, or, inArray } from "drizzle-orm";
import {
  listInboxThreads,
  getThreadDetail,
  sendGmailReply,
  sendNewGmailEmail,
  markThreadRead,
  markThreadUnread,
  archiveThread,
  setupGmailWatch,
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
  getConnectionStatus: adminAgentProcedure.query(async () => {
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
  listThreads: adminAgentProcedure
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
  getThread: adminAgentProcedure
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
  sendReply: adminAgentProcedure
    .input(
      z.object({
        threadId: z.string(),
        to: z.string().email(),
        subject: z.string(),
        bodyHtml: z.string(),
        inReplyToMessageId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = await requireGmailConnected();
      const result = await sendGmailReply({
        threadId: input.threadId,
        to: input.to,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        inReplyToMessageId: input.inReplyToMessageId,
      });

      // Log which agent sent this reply
      if (result?.id && ctx.user) {
        // Look up agent's profile photo from users table
        const [agentRow] = await db
          .select({ profilePhotoUrl: users.profilePhotoUrl })
          .from(users)
          .where(eq(users.openId, ctx.user.openId))
          .limit(1);

        await db.insert(gmailSentLog).values({
          threadId: input.threadId,
          messageId: result.id,
          agentOpenId: ctx.user.openId,
          agentName: ctx.user.name ?? "Agent",
          agentPhotoUrl: agentRow?.profilePhotoUrl ?? null,
        }).onDuplicateKeyUpdate({ set: { agentName: ctx.user.name ?? "Agent" } });
      }

      return result;
    }),

  /** Compose and send a brand-new email */
  composeNew: adminAgentProcedure
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
  markRead: adminAgentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      await markThreadRead(input.threadId);
      return { success: true };
    }),

  /** Mark a thread as unread */
  markUnread: adminAgentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      await markThreadUnread(input.threadId);
      return { success: true };
    }),

  /** Archive a thread (remove from inbox) */
  archiveThread: adminAgentProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ input }) => {
      await archiveThread(input.threadId);
      return { success: true };
    }),

  /** Generate an AI draft reply for the current thread */
  draftReply: adminAgentProcedure
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
  getCustomerContext: adminAgentProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available." });

      // Find lead by email
      const [lead] = await db
        .select()
        .from(quoteLeads)
        .where(eq(quoteLeads.email, input.email))
        .limit(1);

      // Get most recent conversation session for this lead
      let session = null;
      if (lead) {
        const sessions = await db
          .select()
          .from(conversationSessions)
          .where(eq(conversationSessions.quoteLeadId, lead.id))
          .limit(1);
        session = sessions[0] ?? null;
      }

      // Get completed job history by email or phone
      const jobs = lead
        ? await db
            .select()
            .from(completedJobs)
            .where(or(eq(completedJobs.email, input.email), eq(completedJobs.phone, lead.phone)))
            .limit(5)
        : [];

      return { lead: lead ?? null, session: session ?? null, completedJobs: jobs };
    }),

  /** Toggle issue flag on a thread. Generates AI summary when flagging. */
  flagIssue: adminAgentProcedure
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
      const agentOpenId = ctx.agent.agentId;

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
  listThreadMeta: adminAgentProcedure
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

  /** Set up Gmail Pub/Sub watch — call once after OAuth, then renew before expiry */
  setupWatch: adminAgentProcedure.mutation(async () => {
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
