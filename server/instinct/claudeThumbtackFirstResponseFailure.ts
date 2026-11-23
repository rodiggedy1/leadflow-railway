import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { opsTasks, opsChatMessages } from "../../drizzle/schema";
import type { getDb } from "../db";
import type { FirstResponseFailure } from "./claudeThumbtackFirstResponse";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const rows = (result: unknown): any[] => (result as any)[0];
const insertId = (result: unknown): number => Number((result as any)[0]?.insertId);
function existingTask(row: any): number {
  const metadata = typeof row?.metadata === "string" ? JSON.parse(row.metadata) : row?.metadata;
  const id = metadata?.opsTaskId;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("NATIVE_FAILURE_TASK_BINDING_INVALID");
  return id;
}
function duplicateNotice(error: unknown): boolean {
  for (let value: any = error, depth = 0; value && depth < 5; value = value.cause, depth++) {
    if (value.code === "ER_DUP_ENTRY" && /\buq_ops_active_sms_card\b/.test(`${value.sqlMessage ?? ""} ${value.message ?? ""}`)) return true;
  }
  return false;
}
/** No model, customer send, new session, schema or scheduler. Existing ops task + ordinary Command Chat notice. */
export function createNativeIntroductionFailureReporter(options: {
  db: Db | null;
  notify: (payload: { title: string; content: string }) => Promise<boolean>;
  refresh: () => void | Promise<void>;
}) {
  return async (failure: FirstResponseFailure): Promise<void> => {
    const identity = failure.lead?.key ?? `capture:${failure.captureId}`;
    const key = "claude-native-failure:v1:" + createHash("sha256").update(identity).digest("hex");
    const bounded = (value: unknown, max: number) => typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : undefined;
    const provider = failure.provider ? {
      kind: failure.provider.kind, code: bounded(failure.provider.code, 128),
      httpStatus: failure.provider.httpStatus,
      providerStatus: bounded(failure.provider.providerStatus, 64), providerReason: bounded(failure.provider.providerReason, 512),
      providerCode: bounded(failure.provider.providerCode, 128), traceId: bounded(failure.provider.traceId, 256),
    } : undefined;
    const messageId = failure.messageId ?? failure.provider?.messageId;
    const title = messageId && failure.code === "ACCEPTANCE_SAVE_FAILED" ? "Record accepted Thumbtack introduction"
      : failure.uncertain ? "Check uncertain Thumbtack introduction" : "Follow up: Thumbtack introduction failed";
    const contact = [failure.lead?.facts.name, failure.lead?.phone].filter(Boolean).join(" · ");
    const instruction = messageId
      ? `Quo returned message ${messageId}. Check that existing message and its status; do not send a replacement introduction.`
      : failure.uncertain
      ? "Check the existing Quo conversation before sending anything: submission may already have been accepted."
      : "Review this lead and send the missing introduction from its existing lead card/conversation.";
    const providerDetails = [provider?.httpStatus ? `Quo HTTP ${provider.httpStatus}` : "",
      provider?.providerStatus ? `Provider status: ${provider.providerStatus}` : "",
      provider?.providerCode ? `Provider code: ${provider.providerCode}` : "",
      provider?.providerReason ? `Provider reason: ${provider.providerReason}` : "",
      provider?.traceId ? `Quo trace: ${provider.traceId}` : ""].filter(Boolean).join("\n");
    const description = [contact || "Customer identity unavailable", `Capture ${failure.captureId}`,
      failure.claim ? `Lead card ${failure.claim.cardId}; receipt ${failure.claim.draftId}` : "Failure before an introduction receipt committed",
      `Stage: ${failure.stage}; code: ${failure.code}`, ...(providerDetails ? [providerDetails] : []), instruction].join("\n");
    let taskId: number | null = null, created = false, persisted = false;
    try {
      const db = options.db;
      if (!db) throw new Error("NATIVE_FAILURE_DB_UNAVAILABLE");
      const save = async () => db.transaction(async tx => {
        // The retained capture is a real, stable lock even when the intake transaction rolled back.
        await tx.execute(sql`SELECT id FROM webhook_events WHERE id = ${failure.captureId} FOR UPDATE`);
        const [notice] = rows(await tx.execute(sql`SELECT metadata FROM ops_chat_messages WHERE activeDedupKey = ${key} LIMIT 1 FOR UPDATE`));
        if (notice) return { taskId: existingTask(notice), created: false };
        const id = insertId(await tx.insert(opsTasks).values({ title, description, priority: "urgent", status: "todo",
          createdByAgentName: "Claude", dueAt: Date.now() }));
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error("NATIVE_FAILURE_TASK_INSERT_ID_MISSING");
        const noticeId = insertId(await tx.insert(opsChatMessages).values({ channel: "command", authorName: "Claude", authorRole: "system",
          body: `${title}${contact ? ` · ${contact}` : ""}\nStaff task #${id}. ${instruction}\nCapture ${failure.captureId}; ${failure.stage}: ${failure.code}${providerDetails ? `\n${providerDetails}` : ""}`,
          sessionId: failure.claim?.sessionId ?? null, activeDedupKey: key,
          metadata: JSON.stringify({ opsTaskId: id, responseFailure: { workflow: "thumbtack_first_response", captureId: failure.captureId,
            draftId: failure.claim?.draftId ?? null, cardId: failure.claim?.cardId ?? null, stage: failure.stage, code: failure.code, uncertain: failure.uncertain,
            ...(provider ? { provider } : {}), ...(messageId ? { messageId } : {}) } }),
          lastActivityAt: Date.now() }));
        if (!Number.isSafeInteger(noticeId) || noticeId <= 0) throw new Error("NATIVE_FAILURE_NOTICE_INSERT_ID_MISSING");
        return { taskId: id, created: true };
      });
      let saved;
      try { saved = await save(); }
      catch (error) {
        if (!duplicateNotice(error)) throw error;
        const [notice] = rows(await db.execute(sql`SELECT metadata FROM ops_chat_messages WHERE activeDedupKey = ${key} LIMIT 1`));
        if (!notice) throw error;
        saved = { taskId: existingTask(notice), created: false };
      }
      taskId = saved.taskId; created = saved.created; persisted = true;
      if (created) {
        try { await options.refresh(); }
        catch { console.error("[ThumbtackClaude] failure task refresh failed", { captureId: failure.captureId, taskId }); }
      }
    } catch {
      console.error("[ThumbtackClaude] CRITICAL: failure task could not be persisted", { captureId: failure.captureId, stage: failure.stage, code: failure.code,
        ...(provider ? { provider } : {}), ...(messageId ? { messageId } : {}) });
    }
    // A task failure must not prevent the independent owner alert attempt. Do not repeat alerts for an existing notice.
    if (persisted && !created) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const delivered = await Promise.race([
        options.notify({ title, content: `${description}\n${taskId ? `Staff task #${taskId}.` : "Staff task could not be saved; immediate manual review required."}` }),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5_000); }),
      ]);
      if (!delivered) console.error("[ThumbtackClaude] owner failure notification unavailable", { captureId: failure.captureId, taskId, persisted });
    } catch {
      console.error("[ThumbtackClaude] owner failure notification failed", { captureId: failure.captureId, taskId, persisted });
    } finally { if (timer) clearTimeout(timer); }
  };
}
