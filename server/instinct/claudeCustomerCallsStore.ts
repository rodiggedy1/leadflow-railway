import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { opsChatMessages } from "../../drizzle/schema";
import { proposedCustomerTaskSchema, type ProposedCustomerTask } from "../../shared/claudeCustomerTasks";
import type { getDb } from "../db";
import type { CustomerCallSource } from "./claudeCustomerCalls";
import { createClaudeCustomerTaskPersistence, CustomerTaskStoreError } from "./claudeCustomerTasksStore";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export const CUSTOMER_CALL_RECEIPT_ACTION = "claude_customer_call_receipt";
export const CUSTOMER_CALL_RECEIPT_CHANNEL = "instinct_call";
export interface CustomerCallClaim { receiptId: number; key: string; source: CustomerCallSource }
const receiptSchema = z.object({
  version: z.literal(1), providerCallId: z.string().min(1), voiceCallId: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(["generating", "prepared", "no_task", "failed"]),
  taskId: z.number().int().positive().nullable(), code: z.string().nullable(),
}).strict();
const sourceSchema = z.object({
  voiceCallId: z.number().int().positive(), providerCallId: z.string().min(1), sessionId: z.number().int().positive().nullable(),
  callerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(), callerName: z.string().nullable(),
  receivedAt: z.number().finite(), transcript: z.string().min(1), customerTurns: z.array(z.string().min(1)).min(1),
  recordingUrl: z.string().url().nullable(), callbackTaskIds: z.array(z.number().int().positive()),
  callbackRequests: z.array(z.object({ id: z.number().int().positive(), notes: z.string().nullable(), preferredCallbackTime: z.string().nullable() }).strict()),
}).strict();
const rows = (result: unknown): Record<string, any>[] => (result as any)[0];
const header = (result: unknown): { insertId: number; affectedRows: number } => (result as any)[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const receiptKey = (id: string) => `cc-receipt:v1:${hash(id)}`;
const taskKey = (id: string) => `cc-task:v1:${hash(id)}`;
const fail = (): never => { throw new CustomerTaskStoreError("CONFLICT", "The call task source or receipt changed."); };
function detached(source: CustomerCallSource): CustomerCallSource {
  const parsed = sourceSchema.parse(source);
  if (new Set(parsed.callbackTaskIds).size !== parsed.callbackTaskIds.length
    || JSON.stringify(parsed.callbackTaskIds) !== JSON.stringify(parsed.callbackRequests.map(item => item.id))) fail();
  return JSON.parse(JSON.stringify(parsed));
}

/** Passive store: no DB acquisition, provider/model calls, callback creation or sends. */
export function createClaudeCustomerCallsStore(db: Db) {
  const tasks = createClaudeCustomerTaskPersistence();
  async function byKey(tx: Tx, key: string) {
    const [row] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${key} FOR UPDATE`));
    return row;
  }
  async function exactCall(tx: Tx, source: CustomerCallSource) {
    const [row] = rows(await tx.execute(sql`SELECT id, vapiCallId FROM voice_calls WHERE id = ${source.voiceCallId} FOR UPDATE`));
    if (!row || Number(row.id) !== source.voiceCallId || row.vapiCallId !== source.providerCallId) fail();
  }
  async function readClaim(tx: Tx, claim: CustomerCallClaim) {
    const source = detached(claim.source);
    if (claim.key !== receiptKey(source.providerCallId)) fail();
    await exactCall(tx, source);
    const row = await byKey(tx, claim.key);
    if (!row || Number(row.id) !== claim.receiptId || row.quickAction !== CUSTOMER_CALL_RECEIPT_ACTION
      || row.channel !== CUSTOMER_CALL_RECEIPT_CHANNEL || row.sessionId !== null) fail();
    const state = receiptSchema.parse(typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata);
    if (state.fingerprint !== hash(JSON.stringify(source)) || state.voiceCallId !== source.voiceCallId
      || state.providerCallId !== source.providerCallId) fail();
    return { source, row, state };
  }
  async function save(tx: Tx, row: Record<string, any>, state: z.infer<typeof receiptSchema>) {
    const encoded = JSON.stringify(receiptSchema.parse(state));
    const changed = header(await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${encoded}, lastActivityAt = ${Date.now()}
      WHERE id = ${Number(row.id)} AND quickAction = ${CUSTOMER_CALL_RECEIPT_ACTION}`));
    if (changed.affectedRows !== 1) fail();
    const stored = await byKey(tx, row.activeDedupKey);
    if (!stored || stored.metadata !== encoded) fail();
  }
  return {
    async claim(raw: CustomerCallSource): Promise<CustomerCallClaim | null> {
      const source = detached(raw), key = receiptKey(source.providerCallId);
      try {
        return await db.transaction(async tx => {
          await exactCall(tx, source);
          if (await byKey(tx, key)) return null;
          const state = { version: 1 as const, providerCallId: source.providerCallId, voiceCallId: source.voiceCallId,
            fingerprint: hash(JSON.stringify(source)), phase: "generating" as const, taskId: null, code: null };
          const encoded = JSON.stringify(state);
          const receiptId = Number(header(await tx.insert(opsChatMessages).values({
            channel: CUSTOMER_CALL_RECEIPT_CHANNEL, quickAction: CUSTOMER_CALL_RECEIPT_ACTION,
            authorName: "Instinct", authorRole: "system", body: "Private AI-call task receipt", sessionId: null,
            activeDedupKey: key, cardStatus: "active", metadata: encoded, lastActivityAt: Date.now(),
          })).insertId);
          const row = await byKey(tx, key);
          if (!Number.isSafeInteger(receiptId) || receiptId <= 0 || !row || Number(row.id) !== receiptId || row.metadata !== encoded) fail();
          return { receiptId, key, source };
        });
      } catch (error) {
        if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return null;
        throw error;
      }
    },
    prepare: (claim: CustomerCallClaim, raw: ProposedCustomerTask | null): Promise<number | null> => db.transaction(async tx => {
      const { source, row, state } = await readClaim(tx, claim);
      if (state.phase !== "generating") return state.taskId;
      const task = raw === null ? null : proposedCustomerTaskSchema.parse(raw);
      if (task?.items.some(item => !source.customerTurns.some(turn => turn.includes(item.evidenceQuote)))) {
        throw new CustomerTaskStoreError("PRECONDITION_FAILED", "The checklist is not grounded in the caller's actual words.");
      }
      const taskId = await tasks.createTask(tx, {
        sessionId: source.sessionId, customerName: source.callerName, customerPhone: source.callerPhone,
        sourceMessageId: source.providerCallId, sourceText: source.customerTurns.join("\n\n"), receivedAt: source.receivedAt,
        receivingPhoneNumberId: null, receivingPhoneNumber: null,
        call: { provider: "vapi", providerCallId: source.providerCallId, voiceCallId: source.voiceCallId,
          transcript: source.transcript, recordingUrl: source.recordingUrl, callbackTaskIds: source.callbackTaskIds },
      }, { replyText: "", task }, taskKey(source.providerCallId));
      if (taskId !== null) {
        const stored = tasks.parseTask(await tasks.taskRow(tx, taskId));
        if (!("call" in stored) || stored.call.transcript !== source.transcript || stored.sourceText !== source.customerTurns.join("\n\n")) fail();
      }
      state.taskId = taskId; state.phase = taskId === null ? "no_task" : "prepared";
      await save(tx, row, state);
      return taskId;
    }),
    fail: (claim: CustomerCallClaim, code: string): Promise<void> => db.transaction(async tx => {
      const { row, state } = await readClaim(tx, claim);
      if (state.phase !== "generating") return;
      state.phase = "failed"; state.code = code;
      await save(tx, row, state);
    }),
  };
}
