/**
 * server/madison/comms/smsService.ts
 * Drafts the SMS message and builds the bulk_sms_confirm preview card.
 * Does NOT send — sending is done by the existing sendBulkSms procedure.
 */
import { invokeLLM } from "../../_core/llm";
import { buildSystemPrompt } from "../../csReplyStream";
import type { CommsRecipient } from "./validator";

export interface CommsSmsPreview {
  type: "bulk_sms_confirm";
  targetDescription: string;
  recipients: Array<{ cleanerProfileId: number; name: string; phone: string }>;
  draftMessage: string;
  command: string;
  excludedCount: number;
  excludedReasons: string[];
}

export async function buildSmsPreview(
  recipients: CommsRecipient[],
  targetDescription: string,
  messageHint: string,
  command: string,
  excludedCount: number,
  excludedReasons: string[]
): Promise<CommsSmsPreview> {
  const hasCustomers = recipients.some(r => r.entityType === "customer");
  const hasCleaners = recipients.some(r => r.entityType === "cleaner");

  let systemAddendum = "";
  if (hasCustomers && !hasCleaners) {
    const firstName = recipients[0].displayName.split(" ")[0];
    systemAddendum = `\n\n=== SMS RULES ===\nDraft an SMS to a CLIENT named ${firstName}. Warm, personal, on-brand. Address them by first name. 1-3 sentences max.`;
  } else if (hasCleaners && !hasCustomers) {
    const names = recipients.map(r => r.displayName.split(" ")[0]).join(", ");
    systemAddendum = `\n\n=== STAFF MESSAGE RULES ===\nYou are drafting an SMS from the dispatcher to cleaning STAFF (${names}).\nKeep it warm, direct, and brief (1-3 sentences).\nDo NOT include greetings like "Hi [Name]" — the message goes to multiple staff members.\nDo NOT include a sign-off or company name.\nJust write the message body.`;
  } else {
    systemAddendum = `\n\n=== SMS RULES ===\nDraft an SMS to ${targetDescription}. Professional and brief (1-3 sentences).`;
  }

  const result = await invokeLLM({
    messages: [
      { role: "system", content: buildSystemPrompt() + systemAddendum },
      {
        role: "user",
        content: hasCustomers && !hasCleaners
          ? `Draft an SMS to ${recipients[0].displayName.split(" ")[0]}. The dispatcher wants to: ${messageHint}. Write the exact message to send.`
          : `Draft an SMS to ${targetDescription}. The dispatcher wants to: ${messageHint}`,
      },
    ],
  });

  const draftMessage = (result.choices[0].message.content as string).trim();

  const mappedRecipients = recipients.map(r => ({
    cleanerProfileId: r.entityType === "cleaner" ? (parseInt(r.entityId.replace("cleaner:", ""), 10) || 0) : 0,
    name: r.displayName,
    phone: r.phone,
  }));

  return { type: "bulk_sms_confirm", targetDescription, recipients: mappedRecipients, draftMessage, command, excludedCount, excludedReasons };
}
