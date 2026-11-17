import type { getDb } from "../db";
import { readCustomerEmailConfig } from "./claudeCustomerEmail";
import { customerEmailSenderAllowed, guardClaudeCustomerEmailHumanReply, ownsClaudeCustomerEmailThread } from "./claudeCustomerEmailApplication";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** Inbox/thread reads may suppress a competing draft, never generate/send/backfill. */
export async function skipLegacyCustomerEmailDraft(db: Db, source: {
  threadId: string; fromEmail: string | null | undefined; createdAt: number | null | undefined;
}): Promise<boolean> {
  if (await ownsClaudeCustomerEmailThread(source.threadId)) return true;
  const config = readCustomerEmailConfig();
  if (!config.enabled || typeof source.createdAt !== "number" || !Number.isFinite(source.createdAt)
    || source.createdAt < config.startAt || !source.fromEmail) return false;
  const { getInboxEmailAddress } = await import("../gmailService");
  const mailbox = await getInboxEmailAddress();
  if (!mailbox || source.fromEmail.toLowerCase() === mailbox.toLowerCase()
    || /^(?:no[-_]?reply|mailer-daemon|postmaster)(?:[+._-]|@)/i.test(source.fromEmail)) return false;
  return customerEmailSenderAllowed(db, { fromEmail: source.fromEmail, recipientEmail: source.fromEmail });
}
/** Called only after the existing email procedure authenticates and validates input. */
export async function arbitrateCustomerEmailHumanReply(threadId: string): Promise<void> {
  try { await guardClaudeCustomerEmailHumanReply(threadId); }
  catch (error) {
    const { TRPCError } = await import("@trpc/server");
    const busy = error instanceof Error && error.message === "CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN";
    throw new TRPCError({ code: busy ? "CONFLICT" : "INTERNAL_SERVER_ERROR",
      message: busy ? "The automatic email reply is sending or its result needs review. No additional email was sent."
        : "The automatic email reply status could not be checked. No email was sent." });
  }
}
