import { createHash } from "node:crypto";

/** Stored metadata/provider enrichment is not a new conversational turn. Text,
 * roles, timestamps and supplied routing/identity evidence remain meaningful. */
export function customerSmsHistory(value: unknown): any[] | null {
  try {
    const history = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(history) || history.some(turn => !turn || typeof turn !== "object"
      || typeof turn.role !== "string" || typeof turn.content !== "string")) return null;
    return history;
  } catch { return null; }
}
export function customerSmsEnvelopes(turn: any): any[] {
  let metadata = turn?.metadata;
  if (typeof metadata === "string") { try { metadata = JSON.parse(metadata); } catch { return []; } }
  if (metadata != null && (typeof metadata !== "object" || Array.isArray(metadata))) return [];
  return metadata ? [turn, metadata] : [turn];
}
export function customerSmsIds(turn: any): string[] {
  return Array.from(new Set(customerSmsEnvelopes(turn).flatMap(part =>
    [part.opMsgId, part.openPhoneId, part.openPhoneMessageId, part.providerMessageId]
      .filter((id): id is string => typeof id === "string" && !!id))));
}
export function customerSmsContextHash(value: unknown): string | null {
  const history = customerSmsHistory(value);
  if (!history) return null;
  const meaningful = history.map(turn => {
    const identity: Record<string, unknown[]> = {};
    for (const field of ["sessionId", "direction", "phoneNumberId", "receivingPhoneNumberId", "from", "fromPhone", "customerPhone", "to", "toPhone", "businessLine", "businessPhone", "receivingPhoneNumber"]) {
      const values = customerSmsEnvelopes(turn).map(part => part[field]).filter(value => value != null);
      if (values.length) identity[field] = Array.from(new Set(values.map(value => JSON.stringify(value)))).sort();
    }
    return JSON.stringify({ role: turn.role, content: turn.content, ts: turn.ts ?? null, identity });
  }).sort();
  return createHash("sha256").update(JSON.stringify(meaningful)).digest("hex");
}
/** Compare event chronology when both timestamps are known; otherwise retain the
 * existing saved-order safety gate. Never infer identity from equal message text. */
export function customerSmsTurnAfter(history: any[], turn: any, anchor: any): boolean {
  if (typeof turn.ts === "number" && Number.isFinite(turn.ts) && typeof anchor.ts === "number" && Number.isFinite(anchor.ts)
    && turn.ts !== anchor.ts) return turn.ts > anchor.ts;
  return history.indexOf(turn) > history.indexOf(anchor);
}
