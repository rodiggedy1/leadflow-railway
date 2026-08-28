import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { appendCsOutboundMessage } from "./sms/appendCsOutboundMessage";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { normalizePhoneLegacy } from "./utils/phone";
import { cleanerJobs, opsChatMessages, reactivationContacts, smsOptOuts } from "../drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { dismissMadisonMove, listMadisonMoveHistory, listMadisonMoves, restoreMadisonMove, setProtectTomorrowChecklistItem, type MadisonMoveKind } from "./madison/moves";

const kindSchema = z.enum(["protect_tomorrow", "save_cancellation", "fill_capacity", "recover_qualified_leads", "smart_upsell"]);

export function selectLiveMoveRecipients<T extends { name: string; phone: string }>(requested: T[], moveRecipients: T[]) {
  const allowed = new Map(moveRecipients.map((recipient) => [normalizePhoneLegacy(recipient.phone), recipient]));
  return requested.map((recipient) => ({ ...recipient, normalized: normalizePhoneLegacy(recipient.phone) }))
    .filter((recipient) => recipient.normalized && allowed.has(recipient.normalized));
}

export function excludeStopOptedRecipients<T extends { normalized?: string | null }>(recipients: T[], stoppedPhones: Set<string>) {
  return recipients.filter((recipient) => !stoppedPhones.has(recipient.normalized ?? ""));
}

type MadisonMoveSendInput = { moveKey: string; recipients: Array<{ name: string; phone: string }>; message: string };
type MadisonMoveSendDependencies = {
  getDb: typeof getDb;
  listMoves: typeof listMadisonMoves;
  sendSms: typeof sendSms;
  appendCsOutboundMessage: typeof appendCsOutboundMessage;
  recordRecentContact: typeof recordMadisonFillCapacityContact;
  csNumberId: typeof ENV.openPhoneCsNumberId;
};

export async function recordMadisonFillCapacityContact(input: { db: any; phone: string }) {
  await input.db.insert(reactivationContacts).values({
    campaignId: -1,
    phone: input.phone,
    bookingCount: 0,
    status: "SENT",
    sentAt: new Date(),
  });
}

const defaultSendDependencies: MadisonMoveSendDependencies = {
  getDb,
  listMoves: listMadisonMoves,
  sendSms,
  appendCsOutboundMessage,
  recordRecentContact: recordMadisonFillCapacityContact,
  csNumberId: ENV.openPhoneCsNumberId,
};

export async function sendMadisonMove(
  ctx: { user?: { name?: string | null } | null },
  input: MadisonMoveSendInput,
  dependencies: MadisonMoveSendDependencies = defaultSendDependencies,
) {
  const db = await dependencies.getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const liveMoves = await dependencies.listMoves(db);
  const move = liveMoves.find((candidate) => candidate.moveKey === input.moveKey);
  if (!move || !move.draftMessage) throw new TRPCError({ code: "BAD_REQUEST", message: "This opportunity is no longer available for outreach." });
  const requested = selectLiveMoveRecipients(input.recipients, move.recipients);
  if (requested.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No selected recipients remain eligible." });
  const stopRows = await db.select({ phone: smsOptOuts.phone }).from(smsOptOuts).where(inArray(smsOptOuts.phone, requested.map((recipient) => recipient.normalized!)));
  const stops = new Set(stopRows.map((row: { phone: string }) => row.phone));
  const sendable = excludeStopOptedRecipients(requested, stops);
  if (sendable.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No selected recipients remain eligible after STOP protection." });

  // Claim the reviewed move before the first external SMS call. If process execution
  // stops after a carrier accepts a text, this retained state prevents the card from
  // returning to Ready and inviting a duplicate batch.
  const existingRows = await db.select().from(opsChatMessages).where(eq(opsChatMessages.channel, "madison_moves"));
  const stored = existingRows.find((row: any) => { try { return JSON.parse(row.metadata ?? "{}").moveKey === input.moveKey; } catch { return false; } });
  const startedAt = Date.now();
  const sendingMeta = {
    ...(stored ? JSON.parse(stored.metadata ?? "{}") : {}),
    moveKey: input.moveKey,
    kind: move.kind,
    outcome: "sending",
    sendStartedAt: startedAt,
    intendedRecipientCount: sendable.length,
    snapshot: move,
    source: move.source ?? null,
  };
  let moveRecordId: number;
  if (stored) {
    await db.update(opsChatMessages).set({ body: move.headline, cardStatus: "dismissed", activeDedupKey: null, metadata: JSON.stringify(sendingMeta), lastActivityAt: startedAt }).where(eq(opsChatMessages.id, stored.id));
    moveRecordId = stored.id;
  } else {
    const inserted = await db.insert(opsChatMessages).values({
      cleanerJobId: null, channel: "madison_moves", authorName: "Madison", authorRole: "system", body: move.headline, quickAction: "madisons_move",
      metadata: JSON.stringify(sendingMeta), cardStatus: "dismissed", lastActivityAt: startedAt,
    });
    moveRecordId = (inserted as any).insertId as number;
  }

  const results: Array<{ name: string; phone: string; success: boolean; error?: string }> = [];
  let recentContactLoggedCount = 0;
  let recentContactLogFailedCount = 0;
  for (const recipient of sendable) {
    try {
      const sent = await dependencies.sendSms({ to: recipient.phone, content: input.message, fromNumberId: dependencies.csNumberId });
      results.push({ name: recipient.name, phone: recipient.phone, success: sent.success });
      if (sent.success) {
        if (move.kind === "fill_capacity") {
          try {
            await dependencies.recordRecentContact({ db, phone: recipient.normalized! });
            recentContactLoggedCount += 1;
          } catch (error) {
            recentContactLogFailedCount += 1;
            console.error(`[MadisonMoves] Failed to record Fill Capacity contact for ${recipient.normalized}:`, error);
          }
        }
        Promise.resolve(dependencies.appendCsOutboundMessage({ db: db as any, recipientPhone: recipient.phone, recipientName: recipient.name, message: input.message, senderName: ctx.user?.name ?? "Agent", openPhoneMessageId: sent.messageId })).catch(console.error);
      }
    } catch (error) {
      results.push({ name: recipient.name, phone: recipient.phone, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const sentCount = results.filter((result) => result.success).length;
  let statePersistenceError = false;
  try {
    const meta = {
      ...sendingMeta,
      outcome: sentCount ? "sent" : "failed",
      sentAt: Date.now(),
      sentCount,
      ...(move.kind === "fill_capacity" ? { recentContactLoggedCount, recentContactLogFailedCount } : {}),
    };
    await db.update(opsChatMessages).set({ body: `Madison move ${sentCount ? "sent" : "failed"}.`, cardStatus: "dismissed", activeDedupKey: null, metadata: JSON.stringify(meta), lastActivityAt: Date.now() }).where(eq(opsChatMessages.id, moveRecordId));
  } catch (error) {
    // The move remains in its pre-send "sending" state, which suppresses automatic retry.
    // A persistence failure after carrier success must never turn into a false send failure.
    console.error("[MadisonMoves] Failed to finalize send state after SMS delivery:", error);
    statePersistenceError = true;
  }
  const message = sentCount
    ? `Sent to ${sentCount} customer${sentCount === 1 ? "" : "s"}.${recentContactLogFailedCount ? ` Warning: ${recentContactLogFailedCount} successful send${recentContactLogFailedCount === 1 ? " was" : "s were"} not added to the recent-contact safeguard.` : ""}`
    : "No messages were sent.";
  return {
    message,
    results,
    ...(statePersistenceError ? { statePersistenceError: true } : {}),
    ...(recentContactLogFailedCount ? { recentContactPersistenceError: true } : {}),
  };
}

export const madisonMovesRouter = router({
  list: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const moves = await listMadisonMoves(db);
    const stats = { moves: moves.length, recipients: moves.reduce((sum, move) => sum + move.eligibleCount, 0), urgent: moves.filter((move) => move.priority === "urgent").length };
    return { moves, stats, refreshedAt: Date.now() };
  }),
  history: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return listMadisonMoveHistory(db);
  }),
  dismiss: agentProcedure.input(z.object({ moveKey: z.string().min(1).max(120), kind: kindSchema })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const move = (await listMadisonMoves(db)).find((candidate) => candidate.moveKey === input.moveKey);
    if (!move) throw new TRPCError({ code: "BAD_REQUEST", message: "This opportunity is no longer available." });
    await dismissMadisonMove(db, input.moveKey, input.kind as MadisonMoveKind, move);
    return { ok: true };
  }),
  restore: agentProcedure.input(z.object({ moveKey: z.string().min(1).max(120) })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    try {
      await restoreMadisonMove(db, input.moveKey);
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "This move cannot be restored." });
    }
    return { ok: true };
  }),
  reviewProtectTomorrowItem: agentProcedure.input(z.object({ moveKey: z.string().regex(/^protect:\d{4}-\d{2}-\d{2}$/), itemKey: z.string().min(1).max(160), resolved: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    try {
      return await setProtectTomorrowChecklistItem(db, { ...input, agentId: ctx.agent.agentId });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to update this review item." });
    }
  }),
  send: agentProcedure.input(z.object({
    moveKey: z.string().min(1).max(120),
    recipients: z.array(z.object({ name: z.string().min(1), phone: z.string().min(7) })).min(1).max(30),
    message: z.string().min(1).max(1600),
  })).mutation(async ({ ctx, input }) => sendMadisonMove(ctx, input)),
});
