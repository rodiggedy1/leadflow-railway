import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { opsChatMessages } from "../../drizzle/schema";
import { proposedCustomerTaskSchema, type ProposedCustomerTask } from "../../shared/claudeCustomerTasks";
import type { getDb } from "../db";
import { staffCallSourceSchema, type StaffCallSource } from "./claudeStaffCalls";
import { createClaudeCustomerTaskPersistence, CustomerTaskStoreError } from "./claudeCustomerTasksStore";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export const STAFF_CALL_RECEIPT_ACTION = "claude_staff_call_receipt";
export const STAFF_CALL_RECEIPT_CHANNEL = "instinct_staff_call";
export interface StaffCallClaim { receiptId: number; key: string; source: StaffCallSource }
const receiptSchema = z.object({
  version: z.literal(1), providerCallId: z.string().min(1), recordingId: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(["generating", "prepared", "no_task", "failed"]),
  taskId: z.number().int().positive().nullable(), code: z.string().nullable(),
  sourceSnapshot: staffCallSourceSchema.optional(),
}).strict().refine(state => state.phase === "prepared"
  ? state.taskId !== null && state.code === null
  : state.taskId === null && (state.phase === "failed" ? state.code !== null : state.code === null));
const rows = (result: unknown): Record<string, any>[] => (result as any)[0];
const header = (result: unknown): { insertId: number; affectedRows: number } => (result as any)[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const receiptKey = (id: string) => `sc-receipt:v1:${hash(id)}`;
const taskKey = (id: string) => `sc-task:v1:${hash(id)}`;
const fail = (): never => { throw new CustomerTaskStoreError("CONFLICT", "The staff call task source or receipt changed."); };
function detached(source: StaffCallSource): StaffCallSource {
  return JSON.parse(JSON.stringify(staffCallSourceSchema.parse(source)));
}

// Decode only the saved-row evidence contract; labels do not authenticate speakers.
function savedEvidence(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let dialogue: unknown;
  try { dialogue = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(dialogue) || !dialogue.length || dialogue.some(segment => !segment
    || typeof segment !== "object" || Array.isArray(segment) || typeof segment.content !== "string"
    || !segment.content.trim())) return null;
  return dialogue.map(segment => segment.content);
}

/** Passive factory: no DB acquisition, provider/model calls, sessions or sends. */
export function createClaudeStaffCallsStore(db: Db) {
  const tasks = createClaudeCustomerTaskPersistence();
  async function byKey(tx: Tx, key: string) {
    const [row] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${key} FOR UPDATE`));
    return row;
  }
  async function exactCall(tx: Tx, source: StaffCallSource, verifySavedEvidence = true) {
    const [row] = rows(await tx.execute(sql`SELECT id, openphoneCallId, callerPhone, direction, transcript FROM openphone_call_recordings WHERE id = ${source.recordingId} FOR UPDATE`));
    if (!row || Number(row.id) !== source.recordingId || row.openphoneCallId !== source.providerCallId
      || row.callerPhone !== source.callerPhone || row.direction !== source.direction) fail();
    if (verifySavedEvidence && source.transcriptSource === "saved" && !isDeepStrictEqual(savedEvidence(row.transcript), source.evidenceSegments)) fail();
  }
  function validateReceipt(row: Record<string, any> | undefined, claim: StaffCallClaim) {
    if (!Number.isSafeInteger(claim.receiptId) || claim.receiptId <= 0 || !row || Number(row.id) !== claim.receiptId
      || row.activeDedupKey !== claim.key || row.quickAction !== STAFF_CALL_RECEIPT_ACTION
      || row.channel !== STAFF_CALL_RECEIPT_CHANNEL || row.sessionId !== null) fail();
    return row!;
  }
  async function readClaim(tx: Tx, claim: StaffCallClaim) {
    const source = detached(claim.source);
    if (claim.key !== receiptKey(source.providerCallId)) fail();
    // Evidence is checked under the recording lock when claimed, then frozen in
    // the durable receipt. Later native transcription must not invalidate that
    // verified snapshot or cause a second generation for this same call.
    await exactCall(tx, source, false);
    const row = validateReceipt(await byKey(tx, claim.key), claim);
    let state: z.infer<typeof receiptSchema>;
    try { state = receiptSchema.parse(typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata); }
    catch { return fail(); }
    if (state.fingerprint !== hash(JSON.stringify(source)) || state.recordingId !== source.recordingId
      || state.providerCallId !== source.providerCallId || !isDeepStrictEqual(state.sourceSnapshot, source)) fail();
    return { source, row, state };
  }
  async function save(tx: Tx, claim: StaffCallClaim, state: z.infer<typeof receiptSchema>) {
    const encoded = JSON.stringify(receiptSchema.parse(state));
    const changed = header(await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${encoded}, lastActivityAt = ${Date.now()}
      WHERE id = ${claim.receiptId} AND quickAction = ${STAFF_CALL_RECEIPT_ACTION}`));
    if (changed.affectedRows !== 1) fail();
    const stored = validateReceipt(await byKey(tx, claim.key), claim);
    if (stored.metadata !== encoded) fail();
  }
  return {
    async claim(raw: StaffCallSource): Promise<StaffCallClaim | null> {
      const source = detached(raw), key = receiptKey(source.providerCallId);
      try {
        return await db.transaction(async tx => {
          await exactCall(tx, source);
          if (await byKey(tx, key)) return null;
          const state = { version: 1 as const, providerCallId: source.providerCallId, recordingId: source.recordingId,
            fingerprint: hash(JSON.stringify(source)), phase: "generating" as const, taskId: null, code: null, sourceSnapshot: source };
          const encoded = JSON.stringify(receiptSchema.parse(state));
          const receiptId = Number(header(await tx.insert(opsChatMessages).values({
            channel: STAFF_CALL_RECEIPT_CHANNEL, quickAction: STAFF_CALL_RECEIPT_ACTION,
            authorName: "Instinct", authorRole: "system", body: "Private staff-call task receipt", sessionId: null,
            activeDedupKey: key, cardStatus: "active", metadata: encoded, lastActivityAt: Date.now(),
          })).insertId);
          const claim = { receiptId, key, source };
          const row = validateReceipt(await byKey(tx, key), claim);
          if (row.metadata !== encoded) fail();
          return claim;
        });
      } catch (error) {
        if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return null;
        throw error;
      }
    },
    prepare: (claim: StaffCallClaim, raw: ProposedCustomerTask | null): Promise<number | null> => db.transaction(async tx => {
      const { source, state } = await readClaim(tx, claim);
      if (state.phase !== "generating") return state.taskId;
      const task = raw === null ? null : proposedCustomerTaskSchema.parse(raw);
      if (task?.items.some(item => !source.evidenceSegments.some(segment => segment.includes(item.evidenceQuote)))) {
        throw new CustomerTaskStoreError("PRECONDITION_FAILED", "The checklist is not grounded in the saved call transcript.");
      }
      const identity = {
        sessionId: source.sessionId, customerName: source.callerName, customerPhone: source.callerPhone,
        sourceMessageId: source.providerCallId, sourceText: source.evidenceSegments.join("\n\n"), receivedAt: source.receivedAt,
        receivingPhoneNumberId: null, receivingPhoneNumber: null,
        call: { provider: "openphone" as const, providerCallId: source.providerCallId, recordingId: source.recordingId,
          transcript: source.transcript, recordingUrl: source.recordingUrl, businessPhoneNumberId: source.businessPhoneNumberId,
          businessPhoneNumber: source.businessPhoneNumber, staffUserId: source.staffUserId, direction: source.direction,
          transcriptSource: source.transcriptSource, evidenceScope: source.evidenceScope },
      };
      const taskId = await tasks.createTask(tx, identity, { replyText: "", task }, taskKey(source.providerCallId));
      if (taskId !== null) {
        const taskRow = await tasks.taskRow(tx, taskId), stored = tasks.parseTask(taskRow);
        if (taskRow.activeDedupKey !== taskKey(source.providerCallId) || taskRow.body !== task?.title
          || Object.entries(identity).some(([key, value]) => !isDeepStrictEqual(stored[key as keyof typeof stored], value))
          || stored.status !== "unclaimed" || stored.title !== task?.title
          || !isDeepStrictEqual(stored.items.map(item => ({ title: item.title, evidenceQuote: item.evidenceQuote })), task?.items)) fail();
      }
      state.taskId = taskId; state.phase = taskId === null ? "no_task" : "prepared";
      await save(tx, claim, state);
      return taskId;
    }),
    fail: (claim: StaffCallClaim, code: string): Promise<void> => db.transaction(async tx => {
      const { state } = await readClaim(tx, claim);
      if (state.phase !== "generating") return;
      state.phase = "failed"; state.code = code;
      await save(tx, claim, state);
    }),
  };
}
