/**
 * gmailRouter.ts — tRPC router for the shared Gmail inbox
 *
 * All procedures require agent authentication (adminAgentProcedure) so only
 * logged-in agents can read/send email through the shared inbox.
 */
import { z } from "zod";
import { router, adminAgentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { gmailState, quoteLeads, conversationSessions, completedJobs, gmailSentLog, users } from "../drizzle/schema";
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
      if (result?.messageId && ctx.user) {
        // Look up agent's profile photo from users table
        const [agentRow] = await db
          .select({ profilePhotoUrl: users.profilePhotoUrl })
          .from(users)
          .where(eq(users.openId, ctx.user.openId))
          .limit(1);

        await db.insert(gmailSentLog).values({
          threadId: input.threadId,
          messageId: result.messageId,
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
