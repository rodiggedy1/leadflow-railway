import { sql } from "drizzle-orm";
import {
  dispatchClaudeCustomerEmail, readCustomerEmailConfig, type CustomerEmailBinding,
  type CustomerEmailConfig, type CustomerEmailStore,
} from "./claudeCustomerEmail";
import type { CustomerReplyPlan } from "../../shared/claudeCustomerTasks";
import type { getDb } from "../db";
import type { GmailThread } from "../gmailService";
import type { ClaudeCustomerSmsGenerationOptions } from "./claudeCustomerSmsGeneration";

import { historyWindowStart, withoutQuotedEmailHistory } from "./claudeHistoryWindow";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** First email sent to Claude: the last emails of the thread, always including the one being answered. */
function emailWindowStart(source: CustomerEmailBinding): number {
  const messages = source.snapshot.messages;
  return historyWindowStart(messages.length, messages.findIndex(message => message.id === source.inboundMessageId));
}
export interface CapturedCustomerEmail { inboundMessageId: string; receivedAt: number; rawThread: unknown }
export interface CustomerEmailApplicationOptions {
  config?: () => CustomerEmailConfig;
  database?: () => Promise<Db | null>;
  mailbox?: () => Promise<string | null>;
  readThread?: (id: string) => Promise<GmailThread>;
  senderAllowed?: (db: Db, binding: CustomerEmailBinding) => Promise<boolean>;
  store?: (db: Db) => CustomerEmailStore;
  generate?: (binding: CustomerEmailBinding) => Promise<CustomerReplyPlan>;
  replyGeneration?: ClaudeCustomerSmsGenerationOptions;
  send?: (binding: CustomerEmailBinding, text: string) => Promise<{ messageId: string; threadId: string }>;
  broadcast?: () => Promise<void> | void;
}
const resultRows = (result: unknown): Array<Record<string, unknown>> => (result as any)[0];
/** Exact directory exclusions only; never infer or merge customer identity. */
export async function customerEmailSenderAllowed(db: Db, binding: Pick<CustomerEmailBinding, "fromEmail" | "recipientEmail">): Promise<boolean> {
  const addresses = Array.from(new Set([binding.fromEmail, binding.recipientEmail].map(s => s.toLowerCase())));
  for (const address of addresses) {
    const [policy] = resultRows(await db.execute(sql`SELECT isActionable FROM gmail_sender_policies
      WHERE LOWER(senderEmail) = ${address}`));
    const domain = address.split("@")[1];
    const [domainPolicy] = policy ? [] : resultRows(await db.execute(sql`SELECT isActionable FROM gmail_sender_policies
      WHERE LOWER(senderDomain) = ${domain}`));
    if (Number((policy ?? domainPolicy)?.isActionable ?? 1) !== 1) return false;
    const staff = resultRows(await db.execute(sql`SELECT email FROM agents WHERE LOWER(email) = ${address}`));
    const cleaners = resultRows(await db.execute(sql`SELECT email FROM cleaner_profiles WHERE LOWER(email) = ${address}`));
    const applicants = resultRows(await db.execute(sql`SELECT email FROM candidates WHERE LOWER(email) = ${address}`));
    if (staff.length || cleaners.length || applicants.length) return false;
  }
  return true;
}
/** Deterministic representation only: do not rewrite, summarize or truncate Claude's reply. */
export function customerEmailReplyHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n|\r|\n/g, "<br>");
}
export function createClaudeCustomerEmailApplication(options: CustomerEmailApplicationOptions = {}) {
  const config = options.config ?? (() => readCustomerEmailConfig());
  const database = options.database ?? (async () => (await import("../db")).getDb());
  const mailbox = options.mailbox ?? (async () => (await import("../gmailService")).getInboxEmailAddress());
  const readThread = options.readThread ?? (async (id: string) => (await import("../gmailService")).getThreadDetail(id, "claude-customer-email-freshness", true));
  const senderAllowed = options.senderAllowed ?? customerEmailSenderAllowed;
  const getStore = async (db: Db) => options.store ? options.store(db) : (await import("./claudeCustomerEmailStore")).createClaudeCustomerEmailStore(db);
  const broadcast = options.broadcast ?? (async () => {
    const { broadcastOpsUpdate } = await import("../sseBroadcast");
    broadcastOpsUpdate("task_update"); broadcastOpsUpdate("gmail_new_messages");
  });
  return {
    async captured(event: CapturedCustomerEmail): Promise<boolean> {
      const current = config();
      if (!current.enabled || !event.inboundMessageId || !Number.isFinite(event.receivedAt) || event.receivedAt < current.startAt) return false;
      const { emailSnapshotFromRawThread, customerEmailBinding, emailSnapshotHash } = await import("./claudeCustomerEmailSource");
      const account = await mailbox();
      if (!account) return false;
      const snapshot = emailSnapshotFromRawThread(event.rawThread, account);
      const binding = customerEmailBinding(snapshot, event.inboundMessageId, event.receivedAt);
      if (!binding || binding.createdAt < current.startAt) return false;
      const db = await database();
      if (!db || !await senderAllowed(db, binding)) return false;
      const store = await getStore(db);
      const generate = options.generate ?? (async (source: CustomerEmailBinding) => {
        const { createClaudeCustomerReplyGenerator } = await import("./claudeCustomerSmsGeneration");
        // Phase 2: the optional quality-complaint label is read from the same answer (no extra AI call, same runner).
        const { createQualityLabelRunner } = await import("./qualityComplaintLabelRunner");
        const label = createQualityLabelRunner(options.replyGeneration?.runner);
        const plan = await createClaudeCustomerReplyGenerator({ ...options.replyGeneration, runner: label.runner })({ incomingMessage: source.inboundText,
          protectedIds: [source.threadId, source.inboundMessageId, source.rfcMessageId],
          context: {
            source: "email", contact: { displayName: source.senderName, email: source.fromEmail },
            // Token trim (model payload only): the raw thread snapshot (every message again,
            // with its HTML copy and headers), its hash, internal IDs and the duplicate
            // incoming text are left out. Each message's text stays in originalConversation.
            binding: { mailboxEmail: source.mailboxEmail, fromEmail: source.fromEmail, replyToEmail: source.replyToEmail,
              recipientEmail: source.recipientEmail, senderName: source.senderName, subject: source.subject,
              createdAt: source.createdAt, receivedAt: source.receivedAt },
            // History window (model payload only): the last emails, always including the one being answered.
            // Older emails drop the copy of the thread quoted inside them; the answered email is sent whole.
            ...(emailWindowStart(source) > 0 ? { earlierEmailsOmitted: emailWindowStart(source) } : {}),
            originalConversation: source.snapshot.messages.slice(emailWindowStart(source)).map(message => ({
              role: message.fromEmail.toLowerCase() === source.mailboxEmail.toLowerCase() ? "assistant" : "user",
              content: message.id === source.inboundMessageId || !message.text ? message.text || message.html : withoutQuotedEmailHistory(message.text),
              timestamp: message.createdAt, fromEmail: message.fromEmail, subject: message.subject,
            })), bookingContext: null,
          },
        });
        try {
          const complaint = label.take(source.inboundText);
          if (complaint) (await import("../teamQualitySignals")).recordAiQualityComplaintInBackground(complaint, {
            sourceKey: `email:msg:${source.inboundMessageId}`, channel: "email", detector: "claude_email", reportedAtMs: source.receivedAt,
            customerEmail: source.fromEmail, customerName: source.senderName, evidenceText: source.inboundText,
            sourceRef: { threadId: source.threadId, inboundMessageId: source.inboundMessageId } });
        } catch { /* the email reply is unaffected */ }
        return plan;
      });
      const send = options.send ?? (async (source: CustomerEmailBinding, text: string) => {
        return (await import("../gmailService")).sendGmailReply({
          threadId: source.threadId, to: source.recipientEmail, subject: source.subject,
          bodyHtml: customerEmailReplyHtml(text), inReplyToMessageId: source.rfcMessageId,
          automaticReply: true,
        });
      });
      const readCurrent = async (source: CustomerEmailBinding) => {
        if (!await senderAllowed(db, source)) return false;
        const fresh = await readThread(source.threadId);
        if (!fresh.inboxEmail || fresh.inboxEmail.toLowerCase() !== source.mailboxEmail.toLowerCase() || !fresh.sourceSnapshot) return false;
        const currentSnapshot = emailSnapshotFromRawThread(fresh.sourceSnapshot, fresh.inboxEmail);
        const currentBinding = customerEmailBinding(currentSnapshot, source.inboundMessageId, source.receivedAt);
        return Boolean(currentBinding && emailSnapshotHash(currentSnapshot) === source.snapshotHash);
      };
      try {
        const disposition = await dispatchClaudeCustomerEmail(binding, { readConfig: config, store, readCurrent, generate, send, broadcast });
        console.log("[ClaudeCustomerEmail]", disposition, binding.inboundMessageId);
      } catch { console.error("[ClaudeCustomerEmail] receipt persistence failed", binding.inboundMessageId); }
      // A verified eligible event belongs to this path even when generation fails.
      return true;
    },
    async ownsThread(threadId: string): Promise<boolean> {
      const db = await database();
      return db ? (await getStore(db)).ownsThread(threadId) : false;
    },
    async humanReply(threadId: string): Promise<void> {
      const db = await database();
      if (!db) throw new Error("CUSTOMER_EMAIL_STATUS_UNAVAILABLE");
      await (await getStore(db)).guardHumanReply(threadId);
    },
  };
}
const application = createClaudeCustomerEmailApplication();
export const dispatchCapturedClaudeCustomerEmail = application.captured;
export const ownsClaudeCustomerEmailThread = application.ownsThread;
export const guardClaudeCustomerEmailHumanReply = application.humanReply;
