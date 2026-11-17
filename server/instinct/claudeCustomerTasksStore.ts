import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { madisonSmsDrafts, opsChatMessages } from "../../drizzle/schema";
import {
  CLAUDE_CUSTOMER_REPLY_CAPABILITY as capability,
  CLAUDE_CUSTOMER_TASK_ACTION as action,
  customerReplyPlanSchema, customerTaskSchema, taskActorSchema,
  type CustomerReplyPlan, type CustomerTask, type TaskActor,
} from "../../shared/claudeCustomerTasks";
import type { getDb } from "../db";
import { normalizePhone } from "../utils/phone";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface CustomerSmsBinding {
  /** Trusted application account namespace; never customer-provided. */
  account?: string;
  sessionId: number;
  providerMessageId: string;
  fromPhone: string;
  receivingPhoneNumberId: string;
  receivingPhoneNumber: string;
  inboundText: string;
  createdAt: number;
  receivedAt: number;
  customerName: string | null;
  /** SHA256 of the exact stored messageHistory string, not reserialized JSON. */
  historyHash: string;
}
export interface CustomerSmsClaim { draftId: number; key: string; binding: CustomerSmsBinding }
export type CustomerTaskErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED";
export class CustomerTaskStoreError extends Error {
  constructor(readonly code: CustomerTaskErrorCode, message: string) { super(message); this.name = "CustomerTaskStoreError"; }
}
const fail = (code: CustomerTaskErrorCode, message: string): never => { throw new CustomerTaskStoreError(code, message); };
const bindingSchema = z.object({
  account: z.string().min(1).default("openphone"), sessionId: z.number().int().positive(),
  providerMessageId: z.string().min(1), fromPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  receivingPhoneNumberId: z.string().min(1), receivingPhoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  inboundText: z.string().min(1), createdAt: z.number().finite(), receivedAt: z.number().finite(),
  customerName: z.string().nullable(), historyHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const envelopeSchema = z.object({ taskId: z.number().int().positive(), task: customerTaskSchema }).strict();
const rows = (result: unknown): Record<string, any>[] => (result as any)[0];
const header = (result: unknown): { insertId: number; affectedRows: number } => (result as any)[0];
const decode = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Share the ORIGINAL inbound provider ID unique index with the existing draft path.
// The capability marks ownership; another capability's receipt is never taken over.
const keyFor = (binding: CustomerSmsBinding) => binding.providerMessageId;
const taskKeyFor = (binding: CustomerSmsBinding) => `cs-task:v1:${hash(JSON.stringify([binding.account ?? "openphone", binding.providerMessageId, binding.receivingPhoneNumberId]))}`;
const isInbound = (turn: any) => turn && ["user", "customer"].includes(turn.role);
const ids = (turn: any): string[] => Array.from(new Set([turn, turn?.metadata].filter(Boolean)
  .flatMap(part => [part.opMsgId, part.openPhoneId, part.openPhoneMessageId, part.providerMessageId])
  .filter((id): id is string => typeof id === "string" && id.length > 0)));
const stop = (text: string) => /^\s*(stop|unsubscribe|quit|end|remove me|opt.?out)\s*$/i.test(text);

export interface ClaudeCustomerTasksStore {
  claim(binding: CustomerSmsBinding): Promise<CustomerSmsClaim | null>;
  prepare(claim: CustomerSmsClaim, plan: CustomerReplyPlan): Promise<boolean>;
  recordAcceptance(claim: CustomerSmsClaim, providerMessageId: string): Promise<boolean>;
  markUncertain(claim: CustomerSmsClaim): Promise<void>;
  suppress(claim: CustomerSmsClaim, code: string): Promise<void>;
  suppressBeforeSubmission(claim: CustomerSmsClaim, code: string): Promise<void>;
  list(): Promise<CustomerTask[]>;
  get(id: number): Promise<CustomerTask | null>;
  claimTask(id: number, actor: TaskActor): Promise<CustomerTask>;
  completeItem(id: number, itemId: string, actor: TaskActor): Promise<CustomerTask>;
  completeTask(id: number, note: string | undefined, actor: TaskActor): Promise<CustomerTask>;
}

/** Internal shared persistence only; task ownership/completion remain in the canonical store. */
export function createClaudeCustomerTaskPersistence() {
  function parseTask(row: Record<string, any>): CustomerTask {
    try {
      const envelope = envelopeSchema.parse(decode(row.metadata));
      const task = envelope.task;
      if (row.quickAction !== action || row.channel !== "command" || envelope.taskId !== Number(row.id)
        || task.id !== Number(row.id) || (task.sessionId === null ? row.sessionId !== null : task.sessionId !== Number(row.sessionId))
        || (task.status === "unclaimed" && (task.owner !== null || task.claimedAt !== null))
        || (task.status !== "unclaimed" && (!task.owner || task.claimedAt === null))
        || (task.status === "done" && (!task.completedBy || task.completedAt === null
          || task.completedBy.id !== task.owner?.id || task.items.some(item => !item.completedBy || item.completedAt === null)))
        || new Set(task.items.map(item => item.id)).size !== task.items.length) throw new Error("Invalid task state");
      return task;
    } catch { return fail("PRECONDITION_FAILED", "The stored customer task is invalid. No task action was performed."); }
  }
  async function taskRow(tx: Tx, id: number): Promise<Record<string, any>> {
    const [row] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE id = ${id} AND quickAction = ${action} FOR UPDATE`));
    if (!row) return fail("NOT_FOUND", "Customer task not found.");
    return row;
  }
  async function saveTask(tx: Tx, task: CustomerTask): Promise<void> {
    customerTaskSchema.parse(task);
    const changed = header(await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${JSON.stringify({ taskId: task.id, task })},
      lastActivityAt = ${Date.now()} WHERE id = ${task.id} AND quickAction = ${action}`));
    if (changed.affectedRows !== 1) fail("CONFLICT", "Customer task could not be saved.");
  }
  async function createTask(tx: Tx, identity: Pick<CustomerTask, "sessionId" | "customerName" | "customerPhone" | "sourceMessageId" | "sourceText" | "receivedAt" | "receivingPhoneNumberId" | "receivingPhoneNumber"> & { email?: Extract<CustomerTask, { sessionId: null }>['email'] }, plan: CustomerReplyPlan, activeDedupKey: string): Promise<number | null> {
    if (!plan.task) return null;
    const id = Number(header(await tx.insert(opsChatMessages).values({
      channel: "command", authorName: "Instinct", authorRole: "system", body: plan.task.title,
      quickAction: action, sessionId: identity.sessionId, cardStatus: "active",
      activeDedupKey, lastActivityAt: Date.now(),
    })).insertId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("CUSTOMER_TASK_INSERT_ID_MISSING");
    const now = Date.now();
    const task = customerTaskSchema.parse({ id, version: 1, kind: action, ...identity, title: plan.task.title,
      items: plan.task.items.map((item, index) => ({ ...item, id: `item-${index + 1}`, completedBy: null, completedAt: null })),
      status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
      reply: { text: plan.replyText, status: "prepared", providerMessageId: null },
      activity: [{ action: "created", actor: null, at: now, note: null }],
    });
    await saveTask(tx, task);
    return id;
  }
  return { parseTask, taskRow, saveTask, createTask };
}

/** Passive factory: no application DB fetch, network, model, sender, or booking action. */
export function createClaudeCustomerTasksStore(db: Db, options: { allowTestCustomer?: (phone: string) => boolean } = {}): ClaudeCustomerTasksStore {
  const { parseTask, taskRow, saveTask, createTask } = createClaudeCustomerTaskPersistence();
  function validateReceipt(draft: Record<string, any> | undefined, claim: CustomerSmsClaim): Record<string, any> {
    const binding = bindingSchema.parse(claim.binding);
    if (!draft || !Number.isSafeInteger(claim.draftId) || claim.draftId <= 0 || claim.key !== keyFor(binding)
      || draft.capability !== capability || draft.inboundOpenPhoneId !== claim.key
      || Number(draft.sessionId) !== binding.sessionId || draft.fromPhone !== binding.fromPhone
      || draft.originalMessage !== binding.inboundText) return fail("CONFLICT", "Customer reply receipt binding changed.");
    try {
      if (JSON.stringify(bindingSchema.parse(decode(draft.resolvedContext))) !== JSON.stringify(binding)) throw new Error("binding");
    } catch { return fail("CONFLICT", "Customer reply receipt binding changed."); }
    return draft;
  }
  async function receipt(tx: Tx, claim: CustomerSmsClaim): Promise<Record<string, any>> {
    const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE id = ${claim.draftId} FOR UPDATE`));
    return validateReceipt(draft, claim);
  }
  async function fresh(tx: Tx, binding: CustomerSmsBinding): Promise<boolean> {
    const [session] = rows(await tx.execute(sql`SELECT * FROM conversation_sessions WHERE id = ${binding.sessionId} FOR UPDATE`));
    const testCustomer = options.allowTestCustomer?.(binding.fromPhone) === true;
    if (!session || normalizePhone(session.leadPhone) !== binding.fromPhone
      || session.lastInboundPhoneNumberId !== binding.receivingPhoneNumberId || Number(session.smsOptOut) !== 0
      || typeof session.leadSource !== "string" || (!testCustomer && (/cleaner|hiring|interview|internal|staff|schedule_confirm/i.test(session.leadSource)
        || session.csQueue === "Teams" || /^INTERVIEW_|^SCHEDULE_CONFIRM/.test(session.stage ?? "")))
      || binding.fromPhone === binding.receivingPhoneNumber || stop(binding.inboundText)
      || typeof session.messageHistory !== "string" || hash(session.messageHistory) !== binding.historyHash) return false;
    let history: any;
    try { history = JSON.parse(session.messageHistory); } catch { return false; }
    if (!Array.isArray(history) || history.some(turn => !turn || typeof turn !== "object")) return false;
    const matches = history.map((turn, index) => ({ turn, index })).filter(({ turn }) => ids(turn).includes(binding.providerMessageId));
    if (matches.length !== 1 || !isInbound(matches[0].turn) || ids(matches[0].turn).length !== 1
      || matches[0].turn.content !== binding.inboundText) return false;
    const anchor = matches[0];
    if (history.slice(anchor.index + 1).some(turn => isInbound(turn) || turn.role === "assistant")) return false;
    const envelopes = [anchor.turn, anchor.turn.metadata].filter(Boolean);
    for (const part of envelopes) {
      for (const field of ["phoneNumberId", "receivingPhoneNumberId"]) {
        if (part[field] != null && part[field] !== binding.receivingPhoneNumberId) return false;
      }
      for (const field of ["to", "toPhone", "businessLine", "businessPhone", "receivingPhoneNumber"]) {
        if (part[field] == null) continue;
        const value = Array.isArray(part[field]) && part[field].length === 1 ? part[field][0] : part[field];
        if (typeof value !== "string" || normalizePhone(value) !== binding.receivingPhoneNumber) return false;
      }
      for (const field of ["from", "fromPhone", "customerPhone"]) {
        if (part[field] != null && normalizePhone(part[field]) !== binding.fromPhone) return false;
      }
    }
    return rows(await tx.execute(sql`SELECT id FROM sms_opt_outs WHERE phone = ${binding.fromPhone}`)).length === 0;
  }
  function taskId(draft: Record<string, any>): number | null {
    const state = decode(draft.capabilityResult);
    if (state?.taskId == null) return null;
    if (!Number.isSafeInteger(state.taskId) || state.taskId <= 0) return fail("CONFLICT", "Customer task receipt is invalid.");
    return state.taskId;
  }
  async function replyTask(tx: Tx, draft: Record<string, any>, claim: CustomerSmsClaim): Promise<CustomerTask | null> {
    const id = taskId(draft);
    if (id === null) return null;
    const task = parseTask(await taskRow(tx, id));
    if (task.sessionId !== claim.binding.sessionId || task.sourceMessageId !== claim.binding.providerMessageId
      || task.customerPhone !== claim.binding.fromPhone || task.receivingPhoneNumberId !== claim.binding.receivingPhoneNumberId
      || task.reply.text !== draft.generatedDraft) return fail("CONFLICT", "Customer task reply binding changed.");
    return task;
  }
  function requireOwner(task: CustomerTask, actor: TaskActor): void {
    if (!task.owner || task.owner.id !== actor.id) fail("FORBIDDEN", "Only the staff member who claimed this task may confirm it done.");
  }
  async function mutateTask(id: number, rawActor: TaskActor, change: (task: CustomerTask, actor: TaskActor) => boolean): Promise<CustomerTask> {
    const actor = taskActorSchema.parse(rawActor);
    return db.transaction(async tx => {
      const task = parseTask(await taskRow(tx, id));
      if (change(task, actor)) await saveTask(tx, task);
      return task;
    });
  }
  return {
    async claim(rawBinding) {
      const binding = bindingSchema.parse(rawBinding), key = keyFor(binding);
      try {
        return await db.transaction(async tx => {
          if (rows(await tx.execute(sql`SELECT id FROM madison_sms_drafts WHERE inboundOpenPhoneId = ${key}`)).length) return null;
          if (!await fresh(tx, binding)) return fail("PRECONDITION_FAILED", "The incoming customer message is no longer eligible for a reply.");
          const now = new Date();
          const draftId = Number(header(await tx.insert(madisonSmsDrafts).values({
            inboundOpenPhoneId: key, sessionId: binding.sessionId, fromPhone: binding.fromPhone,
            senderName: binding.customerName, senderType: "customer", status: "TOOLS_RUNNING", capability, capabilityVersion: 1,
            originalMessage: binding.inboundText, resolvedContext: binding, capabilityResult: { phase: "claimed", taskId: null },
            observations: [], suggestedActions: [], followUps: [], sendPolicyMode: "automatic",
            sendPolicyEnabled: 1, sendPolicyEvaluatedAt: now, createdAt: now, updatedAt: now,
          })).insertId);
          if (!Number.isSafeInteger(draftId) || draftId <= 0) throw new Error("CUSTOMER_REPLY_INSERT_ID_MISSING");
          return { draftId, key, binding };
        });
      } catch (error) {
        if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return null;
        throw error;
      }
    },
    prepare: (claim, rawPlan) => db.transaction(async tx => {
      const plan = customerReplyPlanSchema.parse(rawPlan), draft = await receipt(tx, claim);
      if (draft.status !== "TOOLS_RUNNING") return false;
      if (draft.dismissedAt || draft.dismissedBy || !await fresh(tx, claim.binding)) {
        const changed = header(await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'DISMISSED', errorStage = 'GATE',
          errorCode = ${"STALE_CUSTOMER_MESSAGE"}, updatedAt = NOW(3)
          WHERE id = ${claim.draftId} AND capability = ${capability} AND status = 'TOOLS_RUNNING'`));
        if (changed.affectedRows !== 1) throw new Error("CUSTOMER_REPLY_SUPPRESSION_SAVE_FAILED");
        return false;
      }
      if (plan.task?.items.some(item => !claim.binding.inboundText.includes(item.evidenceQuote))) {
        return fail("PRECONDITION_FAILED", "The checklist is not grounded in the incoming customer message.");
      }
      const id = await createTask(tx, {
        sessionId: claim.binding.sessionId, customerName: claim.binding.customerName, customerPhone: claim.binding.fromPhone,
        sourceMessageId: claim.binding.providerMessageId, sourceText: claim.binding.inboundText,
        receivedAt: claim.binding.receivedAt, receivingPhoneNumberId: claim.binding.receivingPhoneNumberId,
        receivingPhoneNumber: claim.binding.receivingPhoneNumber,
      }, plan, taskKeyFor(claim.binding));
      const changed = header(await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'SENDING', generatedDraft = ${plan.replyText},
        approvedText = ${plan.replyText}, capabilityResult = ${JSON.stringify({ phase: "submission_started", taskId: id })},
        updatedAt = NOW(3) WHERE id = ${claim.draftId} AND capability = ${capability} AND status = 'TOOLS_RUNNING'`));
      if (changed.affectedRows !== 1) throw new Error("CUSTOMER_REPLY_PREPARE_FAILED");
      return true;
    }),
    recordAcceptance: (claim, providerMessageId) => db.transaction(async tx => {
      if (!providerMessageId?.trim()) return fail("PRECONDITION_FAILED", "A provider acceptance ID is required.");
      const draft = await receipt(tx, claim);
      if (draft.status === "SENT") {
        if (draft.outboundOpenPhoneId !== providerMessageId) return fail("CONFLICT", "A different reply acceptance is already recorded.");
        return true;
      }
      if (draft.status !== "SENDING") return false;
      if (typeof draft.generatedDraft !== "string" || !draft.generatedDraft || draft.approvedText !== draft.generatedDraft
        || decode(draft.capabilityResult)?.phase !== "submission_started") return fail("CONFLICT", "Prepared reply receipt changed.");
      const [session] = rows(await tx.execute(sql`SELECT * FROM conversation_sessions WHERE id = ${claim.binding.sessionId} FOR UPDATE`));
      if (!session || normalizePhone(session.leadPhone) !== claim.binding.fromPhone) return fail("CONFLICT", "Customer reply session binding changed.");
      let history: any;
      try { history = JSON.parse(session.messageHistory); } catch { return fail("CONFLICT", "Customer reply history is invalid."); }
      if (!Array.isArray(history)) return fail("CONFLICT", "Customer reply history is invalid.");
      const task = await replyTask(tx, draft, claim), now = Date.now();
      const existing = history.filter(turn => ids(turn).includes(providerMessageId));
      if (existing.length && (existing.length !== 1 || existing[0]?.role !== "assistant" || existing[0]?.content !== draft.generatedDraft)) {
        return fail("CONFLICT", "The acceptance ID is already bound to a different message.");
      }
      if (!existing.length) {
        const entry = { role: "assistant", content: draft.generatedDraft, ts: now, senderName: "Instinct", opMsgId: providerMessageId,
          fromNumberId: claim.binding.receivingPhoneNumberId, receivingPhoneNumberId: claim.binding.receivingPhoneNumberId,
          from: claim.binding.receivingPhoneNumber, to: [claim.binding.fromPhone] };
        const changed = header(await tx.execute(sql`UPDATE conversation_sessions SET messageHistory = JSON_ARRAY_APPEND(messageHistory, '$', CAST(${JSON.stringify(entry)} AS JSON)),
          lastMessageText = ${draft.generatedDraft.slice(0, 255)}, lastMessageTs = ${now}, lastMessageRole = 'assistant',
          messageCount = messageCount + 1 WHERE id = ${claim.binding.sessionId} AND leadPhone = ${session.leadPhone}`));
        if (changed.affectedRows !== 1) throw new Error("CUSTOMER_REPLY_HISTORY_SAVE_FAILED");
      }
      const changed = header(await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'SENT', outboundOpenPhoneId = ${providerMessageId},
        sentAt = NOW(3), errorStage = NULL, errorCode = NULL, updatedAt = NOW(3)
        WHERE id = ${claim.draftId} AND capability = ${capability} AND status = 'SENDING'`));
      if (changed.affectedRows !== 1) throw new Error("CUSTOMER_REPLY_ACCEPTANCE_SAVE_FAILED");
      if (task) { task.reply = { text: draft.generatedDraft, status: "sent", providerMessageId }; await saveTask(tx, task); }
      return true; // Provider acceptance only; deliberately never sets deliveredAt.
    }),
    markUncertain: claim => db.transaction(async tx => {
      const draft = await receipt(tx, claim);
      if (draft.status !== "SENDING") return;
      const task = await replyTask(tx, draft, claim);
      await tx.execute(sql`UPDATE madison_sms_drafts SET errorStage = 'SEND', errorCode = 'SUBMISSION_UNCERTAIN', updatedAt = NOW(3)
        WHERE id = ${claim.draftId} AND capability = ${capability} AND status = 'SENDING'`);
      if (task) { task.reply.status = "uncertain"; await saveTask(tx, task); }
    }),
    suppress: (claim, code) => db.transaction(async tx => {
      const draft = await receipt(tx, claim);
      if (draft.status !== "TOOLS_RUNNING") return;
      const task = await replyTask(tx, draft, claim);
      await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'DISMISSED', errorStage = 'GATE', errorCode = ${code}, updatedAt = NOW(3)
        WHERE id = ${claim.draftId} AND capability = ${capability} AND status = 'TOOLS_RUNNING'`);
      if (task) { task.reply.status = "suppressed"; await saveTask(tx, task); }
    }),
    // Only the coordinator's branch BEFORE calling send may invoke this. An
    // uncertain submission/acceptance must never be converted to a retryable state.
    suppressBeforeSubmission: (claim, code) => db.transaction(async tx => {
      const draft = await receipt(tx, claim);
      if (!["TOOLS_RUNNING", "SENDING"].includes(draft.status)) return;
      if (draft.outboundOpenPhoneId || draft.sentAt || draft.errorCode === "SUBMISSION_UNCERTAIN")
        return fail("CONFLICT", "A submitted or uncertain reply cannot be released.");
      const task = await replyTask(tx, draft, claim);
      if (task?.reply.status === "uncertain" || task?.reply.providerMessageId)
        return fail("CONFLICT", "A submitted or uncertain reply cannot be released.");
      const changed = header(await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'DISMISSED', errorStage = 'GATE',
        errorCode = ${code}, updatedAt = NOW(3) WHERE id = ${claim.draftId} AND capability = ${capability}
        AND status IN ('TOOLS_RUNNING', 'SENDING') AND outboundOpenPhoneId IS NULL AND sentAt IS NULL
        AND (errorCode IS NULL OR errorCode <> 'SUBMISSION_UNCERTAIN')`));
      if (changed.affectedRows !== 1) throw new Error("CUSTOMER_REPLY_NO_SUBMISSION_SAVE_FAILED");
      if (task) { task.reply.status = "suppressed"; await saveTask(tx, task); }
    }),
    async list() {
      return rows(await db.execute(sql`SELECT * FROM ops_chat_messages WHERE quickAction = ${action} AND channel = 'command' ORDER BY id DESC`)).map(parseTask);
    },
    async get(id) {
      const [row] = rows(await db.execute(sql`SELECT * FROM ops_chat_messages WHERE id = ${id} AND quickAction = ${action}`));
      return row ? parseTask(row) : null;
    },
    claimTask: (id, actor) => mutateTask(id, actor, (task, staff) => {
      if (task.owner) {
        if (task.owner.id !== staff.id) return fail("CONFLICT", `This task is already claimed by ${task.owner.name}.`);
        return false;
      }
      if (task.status !== "unclaimed") return fail("CONFLICT", "This task cannot be claimed.");
      const now = Date.now(); task.owner = staff; task.status = "claimed"; task.claimedAt = now;
      task.activity.push({ action: "claimed", actor: staff, at: now, note: null }); return true;
    }),
    completeItem: (id, itemId, actor) => mutateTask(id, actor, (task, staff) => {
      requireOwner(task, staff);
      const item = task.items.find(item => item.id === itemId);
      if (!item) return fail("NOT_FOUND", "Checklist item not found.");
      if (item.completedBy) return false;
      if (task.status !== "claimed") return fail("CONFLICT", "This task is not available for confirmation.");
      const now = Date.now(); item.completedBy = staff; item.completedAt = now;
      task.activity.push({ action: "item_completed", actor: staff, at: now, note: item.id }); return true;
    }),
    completeTask: (id, note, actor) => mutateTask(id, actor, (task, staff) => {
      requireOwner(task, staff);
      const completionNote = typeof note === "string" ? note.trim() : "";
      if (!completionNote) return fail("PRECONDITION_FAILED", "Add a completion note before marking this task done.");
      if (task.status === "done") return false;
      if (task.status !== "claimed") return fail("PRECONDITION_FAILED", "Claim the task before confirming it done.");
      const now = Date.now();
      // This records the owner's human confirmation, never execution or system verification.
      for (const item of task.items) {
        if (item.completedBy) continue;
        item.completedBy = staff; item.completedAt = now;
        task.activity.push({ action: "item_completed", actor: staff, at: now, note: item.id });
      }
      task.status = "done"; task.completedAt = now; task.completedBy = staff;
      task.completionNote = completionNote;
      task.activity.push({ action: "completed", actor: staff, at: now, note: task.completionNote }); return true;
    }),
  };
}
