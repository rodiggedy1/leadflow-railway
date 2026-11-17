import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { gmailSentLog, opsChatMessages } from "../../drizzle/schema";
import { customerReplyPlanSchema, type CustomerTask } from "../../shared/claudeCustomerTasks";
import type { getDb } from "../db";
import {
  CUSTOMER_EMAIL_RECEIPT_ACTION as action, CUSTOMER_EMAIL_RECEIPT_CHANNEL as channel,
  readCustomerEmailConfig,
  type CustomerEmailBinding, type CustomerEmailClaim, type CustomerEmailStore,
} from "./claudeCustomerEmail";
import { customerEmailBinding } from "./claudeCustomerEmailSource";
import { createClaudeCustomerTaskPersistence, CustomerTaskStoreError } from "./claudeCustomerTasksStore";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = Record<string, any>;
const rows = (result: unknown): Row[] => (result as any)[0];
const header = (result: unknown): { insertId: number; affectedRows: number } => (result as any)[0];
const decode = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
const key = (namespace: string, identity: string[]) => `ce-${namespace}:v1:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
const receiptKey = (binding: CustomerEmailBinding) => key("receipt", [binding.mailboxEmail, binding.threadId, binding.inboundMessageId]);
// Thread ID is the actual Gmail ID, never an alias. The row binds the actual mailbox
// at first intake; an earlier human guard can reserve this real thread before intake.
const authorityKey = (threadId: string) => key("thread", [threadId]);
const fail: (message: string) => never = message => { throw new CustomerTaskStoreError("CONFLICT", message); };
const phaseSchema = z.enum(["generating", "SENDING", "sent", "uncertain", "suppressed"]);
const receiptSchema = z.object({
  version: z.literal(1), type: z.literal("receipt"), binding: z.custom<CustomerEmailBinding>(value => !!value && typeof value === "object"),
  phase: phaseSchema, taskId: z.number().int().positive().nullable(), replyText: z.string().min(1).nullable(),
  providerMessageId: z.string().min(1).nullable(), code: z.string().nullable(),
}).strict();
type Receipt = z.infer<typeof receiptSchema>;
const authoritySchema = z.object({
  version: z.literal(1), type: z.literal("thread"), threadId: z.string().min(1), mailboxEmail: z.string().email().nullable(),
  // Entries are append-only; old message ownership and human guards are never erased.
  receiptIds: z.array(z.number().int().positive()),
  humanAnchors: z.array(z.object({ lastMessageAt: z.number().finite(), messageCount: z.number().int().nonnegative() }).strict()),
}).strict();
type Authority = z.infer<typeof authoritySchema>;

function emailTaskSource(binding: CustomerEmailBinding): Extract<CustomerTask, { sessionId: null }>["email"] {
  const source = binding.snapshot.messages.find(message => message.id === binding.inboundMessageId);
  return { mailboxEmail: binding.mailboxEmail, threadId: binding.threadId, fromEmail: binding.fromEmail,
    replyToEmail: binding.replyToEmail, recipientEmail: binding.recipientEmail, subject: binding.subject, rfcMessageId: binding.rfcMessageId,
    ...(!source?.text.trim() && source?.html ? { bodyFormat: "html" as const } : {}),
  };
}

function immutableBinding(binding: CustomerEmailBinding): CustomerEmailBinding {
  let actual: CustomerEmailBinding | null;
  try { actual = customerEmailBinding(binding.snapshot, binding.inboundMessageId, binding.receivedAt); }
  catch { actual = null; }
  if (!actual || JSON.stringify(actual) !== JSON.stringify(binding)) fail("The immutable email source binding is invalid.");
  // Detach all nested evidence from caller mutation after claim.
  return JSON.parse(JSON.stringify(actual));
}

/** Passive factory. No Gmail, model, provider, live DB acquisition or business actions. */
export function createClaudeCustomerEmailStore(db: Db): CustomerEmailStore {
  const tasks = createClaudeCustomerTaskPersistence();
  async function byKey(tx: Tx, dedupKey: string, lock = true): Promise<Row | undefined> {
    const [row] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${dedupKey} ${lock ? sql`FOR UPDATE` : sql``}`));
    if (row && (row.quickAction !== action || row.channel !== channel || row.sessionId !== null)) fail("Email authority row changed.");
    return row;
  }
  async function save(tx: Tx, row: Row, value: Receipt | Authority): Promise<void> {
    const encoded = JSON.stringify(value);
    const changed = header(await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${encoded}, lastActivityAt = ${Date.now()}
      WHERE id = ${Number(row.id)} AND quickAction = ${action} AND channel = ${channel} AND activeDedupKey = ${row.activeDedupKey}`));
    if (changed.affectedRows !== 1) fail("Email receipt could not be saved.");
    // TEXT must round-trip completely; truncation or incompatible storage aborts
    // the enclosing transaction rather than losing evidence or enabling a send.
    const stored = await byKey(tx, row.activeDedupKey);
    if (!stored || stored.metadata !== encoded) fail("Email metadata did not round-trip exactly.");
    row.metadata = encoded;
  }
  async function insert(tx: Tx, dedupKey: string, value: Receipt | Authority): Promise<Row> {
    const id = Number(header(await tx.insert(opsChatMessages).values({
      channel, quickAction: action, authorName: "Instinct", authorRole: "system", body: "Private email response authority",
      sessionId: null, activeDedupKey: dedupKey, cardStatus: "active", metadata: JSON.stringify(value), lastActivityAt: Date.now(),
    })).insertId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("EMAIL_RECEIPT_INSERT_ID_MISSING");
    const row = await byKey(tx, dedupKey);
    if (!row || Number(row.id) !== id || row.metadata !== JSON.stringify(value)) fail("Email metadata did not round-trip exactly.");
    return row;
  }
  async function threadMeta(tx: Tx, threadId: string): Promise<Row | undefined> {
    const [meta] = rows(await tx.execute(sql`SELECT * FROM gmail_thread_meta WHERE threadId = ${threadId} FOR UPDATE`));
    return meta;
  }
  async function authority(tx: Tx, threadId: string, mailboxEmail?: string): Promise<{ row: Row; state: Authority }> {
    let row = await byKey(tx, authorityKey(threadId));
    if (!row) row = await insert(tx, authorityKey(threadId), { version: 1, type: "thread", threadId,
      mailboxEmail: mailboxEmail ?? null, receiptIds: [], humanAnchors: [] });
    const state = authoritySchema.parse(decode(row.metadata));
    if (state.threadId !== threadId || (mailboxEmail && state.mailboxEmail !== null && state.mailboxEmail !== mailboxEmail)) fail("Email mailbox/thread authority changed.");
    return { row, state };
  }
  async function readReceipt(tx: Tx, id: number): Promise<{ row: Row; state: Receipt }> {
    const [row] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE id = ${id} AND quickAction = ${action} FOR UPDATE`));
    if (!row || row.channel !== channel || row.sessionId !== null) fail("Email receipt is missing.");
    const state = receiptSchema.parse(decode(row.metadata));
    const binding = immutableBinding(state.binding);
    if (row.activeDedupKey !== receiptKey(binding)) fail("Email receipt identity changed.");
    return { row, state };
  }
  async function lockClaim(tx: Tx, claim: CustomerEmailClaim) {
    const binding = immutableBinding(claim.binding);
    if (!Number.isSafeInteger(claim.receiptId) || claim.receiptId <= 0 || claim.key !== receiptKey(binding)) fail("Email claim identity changed.");
    const meta = await threadMeta(tx, binding.threadId);
    const owner = await authority(tx, binding.threadId, binding.mailboxEmail);
    if (!owner.state.receiptIds.includes(claim.receiptId)) fail("Email claim is not owned by this thread.");
    const receipt = await readReceipt(tx, claim.receiptId);
    if (JSON.stringify(receipt.state.binding) !== JSON.stringify(binding)) fail("Email receipt source binding changed.");
    return { ...receipt, owner, meta, binding };
  }
  async function fresh(tx: Tx, binding: CustomerEmailBinding, meta: Row | undefined): Promise<boolean> {
    if (!meta || Number(meta.lastMessageAt) !== binding.createdAt || Number(meta.messageCount) !== binding.snapshot.messages.length
      || meta.senderEmail !== binding.fromEmail) return false;
    return rows(await tx.execute(sql`SELECT id FROM gmail_sent_log WHERE threadId = ${binding.threadId} AND sentAt >= ${new Date(binding.createdAt)}`)).length === 0;
  }
  async function pendingLegacy(tx: Tx, binding: CustomerEmailBinding): Promise<boolean> {
    const drafts = rows(await tx.execute(sql`SELECT * FROM madison_email_drafts WHERE threadId = ${binding.threadId} FOR UPDATE`));
    return drafts.some(draft => draft.status === "SENDING" || draft.errorCode === "SUBMISSION_UNCERTAIN"
      || ["RECEIVED", "CLASSIFIED", "TOOLS_RUNNING"].includes(draft.status)
      || draft.status === "DRAFT_READY" && !binding.snapshot.messages.some(message =>
        message.id === draft.inboundMessageId && message.createdAt < binding.createdAt));
  }
  async function replyTask(tx: Tx, state: Receipt): Promise<CustomerTask | null> {
    if (state.taskId === null) return null;
    const task = tasks.parseTask(await tasks.taskRow(tx, state.taskId));
    const b = state.binding;
    if (task.sessionId !== null || !("email" in task) || task.sourceMessageId !== b.inboundMessageId || task.sourceText !== b.inboundText
      || task.receivedAt !== b.receivedAt || task.customerName !== b.senderName || task.reply.text !== state.replyText
      || JSON.stringify(task.email) !== JSON.stringify(emailTaskSource(b))) fail("Email task/source binding changed.");
    return task;
  }
  async function suppressGenerating(tx: Tx, row: Row, state: Receipt, code: string): Promise<void> {
    if (state.phase !== "generating") return;
    state.phase = "suppressed"; state.code = code;
    await save(tx, row, state);
  }
  return {
    async claim(rawBinding) {
      const binding = immutableBinding(rawBinding);
      try {
        return await db.transaction(async tx => {
          const meta = await threadMeta(tx, binding.threadId);
          const owner = await authority(tx, binding.threadId, binding.mailboxEmail);
          if (await byKey(tx, receiptKey(binding))) return null;
          for (const id of owner.state.receiptIds) {
            const old = await readReceipt(tx, id);
            if (["generating", "SENDING", "uncertain"].includes(old.state.phase)) return null;
          }
          if (owner.state.humanAnchors.some(anchor => anchor.lastMessageAt === binding.createdAt)
            || await pendingLegacy(tx, binding) || !await fresh(tx, binding, meta)) return null;
          const row = await insert(tx, receiptKey(binding), { version: 1, type: "receipt", binding, phase: "generating",
            taskId: null, replyText: null, providerMessageId: null, code: null });
          owner.state.mailboxEmail ??= binding.mailboxEmail;
          owner.state.receiptIds.push(Number(row.id));
          await save(tx, owner.row, owner.state);
          return { receiptId: Number(row.id), key: row.activeDedupKey, binding };
        });
      } catch (error) {
        if ((error as { code?: string })?.code === "ER_DUP_ENTRY") return null;
        throw error;
      }
    },
    prepare: (claim, rawPlan) => db.transaction(async tx => {
      const plan = customerReplyPlanSchema.parse(rawPlan), locked = await lockClaim(tx, claim);
      const { row, state, binding, meta } = locked;
      if (state.phase !== "generating") return false;
      if (await pendingLegacy(tx, binding) || !await fresh(tx, binding, meta)) {
        await suppressGenerating(tx, row, state, "STALE_EMAIL_OR_LEGACY_DRAFT"); return false;
      }
      if (plan.task?.items.some(item => !binding.inboundText.includes(item.evidenceQuote))) {
        throw new CustomerTaskStoreError("PRECONDITION_FAILED", "The checklist is not grounded in the incoming customer message.");
      }
      state.taskId = await tasks.createTask(tx, { sessionId: null, customerName: binding.senderName, customerPhone: null,
        sourceMessageId: binding.inboundMessageId, sourceText: binding.inboundText, receivedAt: binding.receivedAt,
        receivingPhoneNumberId: null, receivingPhoneNumber: null,
        email: emailTaskSource(binding),
      }, plan, key("task", [binding.mailboxEmail, binding.threadId, binding.inboundMessageId]));
      state.replyText = plan.replyText; state.phase = "SENDING";
      // Canonical task metadata is TEXT too: parse the actual stored record
      // before allowing the same transaction to become submission-ready.
      await replyTask(tx, state);
      await save(tx, row, state);
      return true;
    }),
    recordAcceptance: (claim, messageId) => db.transaction(async tx => {
      if (!messageId?.trim()) throw new CustomerTaskStoreError("PRECONDITION_FAILED", "A provider acceptance ID is required.");
      const { row, state, binding } = await lockClaim(tx, claim);
      if (state.phase === "sent") {
        if (state.providerMessageId !== messageId) fail("A different email acceptance is already recorded.");
        return true;
      }
      if (state.phase !== "SENDING") return false;
      if (!state.replyText || state.providerMessageId) fail("Prepared email receipt changed.");
      const task = await replyTask(tx, state);
      const existing = rows(await tx.execute(sql`SELECT * FROM gmail_sent_log WHERE messageId = ${messageId} FOR UPDATE`));
      if (existing.length) fail("The acceptance ID is already bound to another send.");
      await tx.insert(gmailSentLog).values({ threadId: binding.threadId, messageId, agentOpenId: "instinct", agentName: "Instinct", agentPhotoUrl: null });
      state.phase = "sent"; state.providerMessageId = messageId;
      await save(tx, row, state);
      if (task) { task.reply = { text: state.replyText, status: "sent", providerMessageId: messageId }; await tasks.saveTask(tx, task); }
      return true; // Acceptance only, never delivery or execution.
    }),
    markUncertain: claim => db.transaction(async tx => {
      const { row, state } = await lockClaim(tx, claim);
      if (state.phase !== "SENDING") return;
      const task = await replyTask(tx, state);
      state.phase = "uncertain"; state.code = "SUBMISSION_UNCERTAIN";
      await save(tx, row, state);
      if (task) { task.reply.status = "uncertain"; await tasks.saveTask(tx, task); }
    }),
    // Coordinator-only: its submitted=false branch proves provider was not called.
    // Never release a receipt with acceptance evidence or permanent uncertainty.
    suppress: (claim, code) => db.transaction(async tx => {
      const { row, state } = await lockClaim(tx, claim);
      if (!["generating", "SENDING"].includes(state.phase)) return;
      if (state.providerMessageId || state.code === "SUBMISSION_UNCERTAIN") fail("A submitted or uncertain email cannot be released.");
      const task = await replyTask(tx, state);
      if (task?.reply.status === "uncertain" || task?.reply.providerMessageId) fail("A submitted or uncertain email cannot be released.");
      state.phase = "suppressed"; state.code = code;
      await save(tx, row, state);
      if (task) { task.reply.status = "suppressed"; await tasks.saveTask(tx, task); }
    }),
    guardHumanReply: threadId => db.transaction(async tx => {
      if (!threadId || /\s/.test(threadId)) fail("A real Gmail thread ID is required.");
      const config = readCustomerEmailConfig();
      // Nonlocking probe avoids reversing the canonical meta -> authority lock
      // order, and lets disabled/no-claim manual replies remain write-free.
      const probe = await byKey(tx, authorityKey(threadId), false);
      const hasClaims = probe && authoritySchema.parse(decode(probe.metadata)).receiptIds.length > 0;
      if (!config.enabled && !hasClaims) return;
      const meta = await threadMeta(tx, threadId);
      const usableMeta = meta && meta.lastMessageAt !== null && meta.messageCount !== null
        && Number.isFinite(Number(meta.lastMessageAt)) && Number(meta.lastMessageAt) > 0
        && Number.isInteger(Number(meta.messageCount)) && Number(meta.messageCount) > 0;
      if (!hasClaims && (!usableMeta || Number(meta.lastMessageAt) < config.startAt || Number(meta.isActionable ?? 1) !== 1)) return;
      const owner = await authority(tx, threadId);
      for (const id of owner.state.receiptIds) {
        const receipt = await readReceipt(tx, id);
        if (["SENDING", "uncertain"].includes(receipt.state.phase)) throw new Error("CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN");
      }
      for (const id of owner.state.receiptIds) {
        const receipt = await readReceipt(tx, id);
        await suppressGenerating(tx, receipt.row, receipt.state, "HUMAN_REPLY");
      }
      if (!usableMeta) return;
      owner.state.humanAnchors.push({ lastMessageAt: Number(meta.lastMessageAt), messageCount: Number(meta.messageCount) });
      await save(tx, owner.row, owner.state);
    }),
    ownsThread: threadId => db.transaction(async tx => {
      await threadMeta(tx, threadId);
      const row = await byKey(tx, authorityKey(threadId));
      if (!row) return false;
      const owner = authoritySchema.parse(decode(row.metadata));
      if (owner.threadId !== threadId) fail("Email thread authority changed.");
      for (const id of owner.receiptIds) {
        if (["generating", "SENDING", "uncertain"].includes((await readReceipt(tx, id)).state.phase)) return true;
      }
      return false;
    }),
  };
}
