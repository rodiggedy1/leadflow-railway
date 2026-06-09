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
import { gmailState } from "../drizzle/schema";
import { eq } from "drizzle-orm";
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
        maxResults: z.number().min(1).max(100).default(30),
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

  /** Get full thread detail including all messages */
  getThread: adminAgentProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ input }) => {
      await requireGmailConnected();
      return getThreadDetail(input.threadId);
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
    .mutation(async ({ input }) => {
      await requireGmailConnected();
      return sendGmailReply({
        threadId: input.threadId,
        to: input.to,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        inReplyToMessageId: input.inReplyToMessageId,
      });
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
