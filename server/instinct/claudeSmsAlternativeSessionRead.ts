import { sql, type SQL } from "drizzle-orm";
import { normalizePhone } from "../utils/phone";

export interface StoredSessionContact {
  readonly sessionId: string;
  readonly rawPhone: string | null;
  readonly phone: string | null;
  readonly displayName: string | null;
  readonly contactGap: "contact_unbound" | null;
}
type SqlRow = Readonly<Record<string, unknown>>;
export interface AlternativeSessionRow {
  contact: StoredSessionContact;
  messageHistory: unknown;
  lastInboundPhoneNumberId: unknown;
}
// Verbatim protected P1 contact SELECT and mapper. No P0/P1 API dependency.
const SESSION_CONTACT_SELECT = "SELECT CAST(`id` AS CHAR) AS `id`, `leadPhone`, `leadName` FROM `conversation_sessions` WHERE `id` = ? ORDER BY `id` ASC";
const SESSION_HISTORY_SELECT = "SELECT CAST(`id` AS CHAR) AS `id`, `leadPhone`, `messageHistory`, `lastInboundPhoneNumberId` FROM `conversation_sessions` WHERE `id` = ? ORDER BY `id` ASC";
function rowId(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}
function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
export function mapSessionContactRow(row: SqlRow, sessionId: string): StoredSessionContact {
  const exactId = rowId(row.id);
  if (!exactId || exactId !== sessionId) throw new Error("SESSION_CONTACT_CONFLICT");
  const rawPhone = text(row.leadPhone), phone = normalizePhone(rawPhone);
  return { sessionId: exactId, rawPhone, phone, displayName: text(row.leadName), contactGap: phone ? null : "contact_unbound" };
}
interface ReadDatabase { execute(query: SQL): Promise<unknown> }
export interface AlternativeSessionReaderOptions {
  getDatabase?: () => Promise<ReadDatabase | null>;
}
/** Caller must be authorized by opsChatProcedure before invoking this reader.
 * Existing getDb is imported lazily. Only the two literal exact-ID SELECTs are
 * executable; no account/bootstrap/mark-read/helper or separate pool exists. */
export function createAlternativeSessionReader(options: AlternativeSessionReaderOptions = {}) {
  const getDatabase = options.getDatabase ?? (async () => (await import("../db")).getDb());
  return async (sessionId: number): Promise<AlternativeSessionRow | null> => {
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error("INVALID_SESSION");
    const db = await getDatabase();
    if (!db) throw new Error("DATABASE_UNAVAILABLE");
    const id = String(sessionId);
    async function select(statement: string): Promise<SqlRow[]> {
      // Only constants above are passed here, with the ID bound by Drizzle.
      const [before, after] = statement.split("?");
      const result = await db!.execute(sql`${sql.raw(before)}${id}${sql.raw(after)}`);
      if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("INVALID_SESSION_ROWS");
      const rows = result[0] as unknown[];
      if (rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("INVALID_SESSION_ROWS");
      return rows as SqlRow[];
    }
    const contacts = await select(SESSION_CONTACT_SELECT);
    if (contacts.length > 1) throw new Error("SESSION_CONTACT_CONFLICT");
    if (!contacts.length) return null;
    const contact = mapSessionContactRow(contacts[0], id);
    const histories = await select(SESSION_HISTORY_SELECT);
    if (histories.length !== 1 || String(histories[0].id) !== id || histories[0].leadPhone !== contact.rawPhone) throw new Error("EXACT_SESSION_CONFLICT");
    return { contact, messageHistory: histories[0].messageHistory, lastInboundPhoneNumberId: histories[0].lastInboundPhoneNumberId };
  };
}
