import { ReadDbError, safeReadDbError, type SelectPort, type SqlRow, type SqlValue } from "./instinct/readDb";

/** Feature-specific projection allowlist: no general SQL execution or legacy
 * fallback. Reuses the existing read transport's error mapping and port shape. */
const TABLES = new Set([
  "conversation_sessions", "inbound_sms", "ops_chat_messages", "gmail_thread_meta", "madison_email_drafts",
  "openphone_call_recordings", "voice_calls", "call_log", "field_mgmt_calls", "confirmation_calls",
  "leadflow_jobs", "cleaner_portal_job_progress", "cleaner_portal_job_signoffs",
  "scheduling_teams", "booking_assignments", "bookings",
]);
export function assertTeamEvidenceSelect(query: string): void {
  if (!/^SELECT\s/i.test(query) || /[;'"\\#@]|--|\/\*|\*\/|:=/.test(query)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|CALL|DO|SET|INTO|FOR|LOCK|UNLOCK|UNION|SLEEP|BENCHMARK|LOAD_FILE|GET_LOCK|RELEASE_LOCK)\b/i.test(query)
    || /\bSELECT\s+(?:\w+\.)?\*/i.test(query)) throw new ReadDbError("DB_READ_FAILED");
  const matches = Array.from(query.matchAll(/\b(?:FROM|JOIN)\s+`([a-z_]+)`/gi));
  if (!matches.length || matches.some(match => !TABLES.has(match[1])) || /\b(?:FROM|JOIN)\s+(?!`)/i.test(query))
    throw new ReadDbError("DB_READ_FAILED");
}
export interface TeamEvidenceTransport {
  query(query: string, params: unknown[]): Promise<readonly [unknown, unknown]>;
  end(): Promise<void>;
}

/** Separate passive UTC read transport follows the existing readDb convention.
 * No pool is acquired at import/factory time, and the app's shared pool timezone,
 * credentials, retries and configuration are not changed. */
export function createTeamEvidenceReadPort(options: {
  databaseUrl?: () => string | undefined;
  driver?: (url: string) => Promise<TeamEvidenceTransport>;
} = {}): SelectPort & { close(): Promise<void> } {
  let current: Promise<TeamEvidenceTransport> | undefined;
  const transport = () => {
    if (!current) current = (async () => {
      const url = (options.databaseUrl ?? (() => process.env.DATABASE_URL))();
      if (!url) throw new ReadDbError("DB_UNAVAILABLE");
      if (options.driver) return options.driver(url);
      const mysql = await import("mysql2/promise");
      return mysql.createPool({ uri: url, supportBigNumbers: true, bigNumberStrings: true, timezone: "Z" }) as unknown as TeamEvidenceTransport;
    })().catch(error => { current = undefined; throw safeReadDbError(error); });
    return current;
  };
  return Object.freeze({
    select: async (query: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> => {
      assertTeamEvidenceSelect(query);
      try {
        const [rows] = await (await transport()).query(query, [...params]);
        if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row)))
          throw new ReadDbError("DB_READ_FAILED");
        return rows as SqlRow[];
      } catch (error) { throw safeReadDbError(error); }
    },
    close: async () => { if (current) { const saved = current; current = undefined; await (await saved).end(); } },
  });
}
