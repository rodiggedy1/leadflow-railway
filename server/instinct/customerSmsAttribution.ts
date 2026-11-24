import { sql } from "drizzle-orm";
import { z } from "zod";
import { CLAUDE_CUSTOMER_REPLY_CAPABILITY } from "../../shared/claudeCustomerTasks";
import { normalizePhone } from "../utils/phone";
import { customerSmsEnvelopes, customerSmsHistory, customerSmsIds } from "./customerSmsFreshness";

type Session = { id: number; leadPhone: string | null };
type ReadDb = { execute(query: ReturnType<typeof sql>): Promise<unknown> };
const bindingSchema = z.object({
  account: z.literal("openphone").default("openphone"), sessionId: z.number().int().positive(),
  providerMessageId: z.string().min(1), fromPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  receivingPhoneNumberId: z.string().min(1), receivingPhoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  inboundText: z.string().min(1),
});
const decode = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;

/** Display only: a recorded automatic acceptance, not Quo's userId or message
 * wording, proves authorship. Preserve the saved history and every send rule.
 * One batch for only this response's sessions/provider IDs; no per-turn query. */
export async function projectAcceptedCustomerSmsSenders(db: ReadDb, sessions: Session[], rawHistory: string): Promise<string> {
  const history = customerSmsHistory(rawHistory);
  if (!history) return rawHistory;
  const phones = new Map(sessions.filter(session => Number.isSafeInteger(session.id) && session.id > 0 && session.leadPhone)
    .map(session => [session.id, normalizePhone(session.leadPhone!)]));
  const providerIds = Array.from(new Set(history.filter(turn => turn.role === "assistant").flatMap(customerSmsIds)));
  if (!phones.size || !providerIds.length) return rawHistory;
  try {
    const result = await db.execute(sql`SELECT id, sessionId, fromPhone, capability, capabilityVersion, status,
      inboundOpenPhoneId, originalMessage, resolvedContext, generatedDraft, approvedText,
      sendPolicyMode, outboundOpenPhoneId, sentAt
      FROM madison_sms_drafts WHERE capability = ${CLAUDE_CUSTOMER_REPLY_CAPABILITY}
      AND status IN ('SENT', 'DELIVERED') AND sentAt IS NOT NULL
      AND sessionId IN (${sql.join(Array.from(phones.keys()).map(id => sql`${id}`), sql`, `)})
      AND outboundOpenPhoneId IN (${sql.join(providerIds.map(id => sql`${id}`), sql`, `)})`);
    const rows = (result as any)?.[0];
    if (!Array.isArray(rows)) return rawHistory;
    const receipts = new Map<string, any[]>();
    for (const row of rows) {
      const existing = receipts.get(row.outboundOpenPhoneId) ?? [];
      existing.push(row); receipts.set(row.outboundOpenPhoneId, existing);
    }
    let changed = false;
    const projected = history.map(turn => {
      const ids = customerSmsIds(turn), matches = ids.length === 1 ? receipts.get(ids[0]) : null;
      if (turn.role !== "assistant" || !matches || matches.length !== 1 || turn.smsProvenance != null) return turn;
      const row = matches[0];
      let binding: z.infer<typeof bindingSchema>;
      try { binding = bindingSchema.parse(decode(row.resolvedContext)); } catch { return turn; }
      if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0
        || row.capability !== CLAUDE_CUSTOMER_REPLY_CAPABILITY || Number(row.capabilityVersion) !== 1
        || !["SENT", "DELIVERED"].includes(row.status) || !row.sentAt || row.sendPolicyMode !== "automatic"
        || Number(row.sessionId) !== binding.sessionId || phones.get(binding.sessionId) !== binding.fromPhone
        || row.fromPhone !== binding.fromPhone || row.inboundOpenPhoneId !== binding.providerMessageId
        || row.originalMessage !== binding.inboundText || row.outboundOpenPhoneId !== ids[0]
        || typeof row.generatedDraft !== "string" || !row.generatedDraft || row.approvedText !== row.generatedDraft
        || turn.content !== row.generatedDraft) return turn;
      const envelopes = customerSmsEnvelopes(turn);
      if (!envelopes.length) return turn;
      for (const part of envelopes) {
        if (part.sessionId != null && String(part.sessionId) !== String(binding.sessionId)) return turn;
        if (part.direction != null && part.direction !== "outgoing") return turn;
        for (const key of ["phoneNumberId", "fromNumberId", "receivingPhoneNumberId"]) {
          if (part[key] != null && part[key] !== binding.receivingPhoneNumberId) return turn;
        }
        for (const key of ["from", "fromPhone", "receivingPhoneNumber", "businessLine", "businessPhone"]) {
          if (part[key] != null && (typeof part[key] !== "string" || normalizePhone(part[key]) !== binding.receivingPhoneNumber)) return turn;
        }
        for (const key of ["to", "toPhone", "customerPhone"]) {
          if (part[key] == null) continue;
          const value = Array.isArray(part[key]) && part[key].length === 1 ? part[key][0] : part[key];
          if (typeof value !== "string" || normalizePhone(value) !== binding.fromPhone) return turn;
        }
      }
      if (turn.senderName === "Instinct") return turn;
      changed = true;
      return { ...turn, senderName: "Instinct" };
    });
    return changed ? JSON.stringify(projected) : rawHistory;
  } catch {
    // Optional display enrichment must never make the existing conversation unreadable.
    return rawHistory;
  }
}
