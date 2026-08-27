import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { appendCsOutboundMessage } from "./sms/appendCsOutboundMessage";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { normalizePhoneLegacy } from "./utils/phone";
import { cleanerJobs, opsChatMessages, smsOptOuts } from "../drizzle/schema";
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
  csNumberId: typeof ENV.openPhoneCsNumberId;
};

const defaultSendDependencies: MadisonMoveSendDependencies = { getDb, listMoves: listMadisonMoves, sendSms, appendCsOutboundMessage, csNumberId: ENV.openPhoneCsNumberId };

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
  const results: Array<{ name: string; phone: string; success: boolean; error?: string }> = [];
  for (const recipient of requested) {
    if (stops.has(recipient.normalized!)) { results.push({ name: recipient.name, phone: recipient.phone, success: false, error: "Customer opted out via STOP" }); continue; }
    const sent = await dependencies.sendSms({ to: recipient.phone, content: input.message, fromNumberId: dependencies.csNumberId });
    results.push({ name: recipient.name, phone: recipient.phone, success: sent.success });
    if (sent.success) dependencies.appendCsOutboundMessage({ db: db as any, recipientPhone: recipient.phone, recipientName: recipient.name, message: input.message, senderName: ctx.user?.name ?? "Agent", openPhoneMessageId: sent.messageId }).catch(console.error);
  }
  const sentCount = results.filter((result) => result.success).length;
  const rows = await db.select().from(opsChatMessages).where(eq(opsChatMessages.channel, "madison_moves"));
  const stored = rows.find((row: any) => { try { return JSON.parse(row.metadata ?? "{}").moveKey === input.moveKey; } catch { return false; } });
  if (stored) {
    const meta = { ...JSON.parse(stored.metadata ?? "{}"), outcome: sentCount ? "sent" : "failed", sentAt: Date.now(), sentCount };
    await db.update(opsChatMessages).set({ cardStatus: "dismissed", activeDedupKey: null, metadata: JSON.stringify(meta), lastActivityAt: Date.now() }).where(eq(opsChatMessages.id, stored.id));
  } else {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null, channel: "madison_moves", authorName: "Madison", authorRole: "system", body: `Madison move ${sentCount ? "sent" : "failed"}.`, quickAction: "madisons_move",
      metadata: JSON.stringify({ moveKey: input.moveKey, kind: move.kind, outcome: sentCount ? "sent" : "failed", sentAt: Date.now(), sentCount, source: move.source ?? null }), cardStatus: "dismissed", lastActivityAt: Date.now(),
    });
  }
  return { message: sentCount ? `Sent to ${sentCount} customer${sentCount === 1 ? "" : "s"}.` : "No messages were sent.", results };
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
