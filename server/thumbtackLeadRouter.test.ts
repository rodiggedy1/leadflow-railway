import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router, opsChatProcedure: t.procedure };
});
vi.mock("./db", () => ({ getDb: vi.fn() }));
import { getDb } from "./db";
import { thumbtackLeadRouter } from "./thumbtackLeadRouter";

const dialect = new MySqlDialect();
const phone = "+13015550123";
const payload = (customerPhone: string | null = phone) => ({ data: { negotiationID: "SYNTHETIC_NEGOTIATION",
  customer: { firstName: "Synthetic", lastName: "Customer", ...(customerPhone ? { phone: customerPhone } : {}) } } });
const message = (id: number, leadPhone: string, sessionId: number, leadName = "Synthetic Customer", claimedBy: string | null = null) => ({
  id, sessionId, metadata: JSON.stringify({ leadPhone, sessionId, leadName, claimedBy }),
});
type Session = { id: number; leadPhone: string; isBooked: number; bookedByAgentName: string | null };
const session = (id: number, leadPhone: string, isBooked = 0): Session => ({ id, leadPhone, isBooked, bookedByAgentName: isBooked ? "Synthetic staff" : null });

function offline(options: { nativePhone?: string | null; messages?: ReturnType<typeof message>[]; sessions?: Session[] } = {}) {
  const sessions = options.sessions ?? [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query); queries.push(compiled);
    if (compiled.sql.includes("FROM webhook_events")) return [[{ raw_payload: JSON.stringify(payload(options.nativePhone)) }]];
    if (compiled.sql.includes("FROM ops_chat_messages")) return [options.messages ?? []];
    if (compiled.sql.includes("FROM conversation_sessions")) {
      const found = compiled.sql.includes("REGEXP_REPLACE")
        ? sessions.filter(row => row.leadPhone.replace(/\D/g, "").slice(-10) === compiled.params[0]).sort((a, b) => b.id - a.id)
        : sessions.filter(row => row.id === compiled.params[0]);
      return [found.slice(0, 1)];
    }
    throw new Error("Unexpected query in read-only offline test");
  });
  vi.mocked(getDb).mockResolvedValue({ execute } as never);
  return { queries, execute, list: () => thumbtackLeadRouter.createCaller({} as never).listNative() };
}

beforeEach(() => { vi.clearAllMocks(); });
describe("native Thumbtack identity linkage — mocked only", () => {
  it("prioritizes the actual canonical phone session over newer loose-name and placeholder email linkage", async () => {
    const work = offline({ messages: [message(100, "+13015559999", 80), message(99, phone, 81, "Synthetic Customer", "Synthetic claimer")],
      sessions: [session(81, "email-session14220455"), session(82, "(301) 555-0123", 1), session(80, "+13015559999")] });
    expect(await work.list()).toMatchObject([{ phone, messageId: 99, sessionId: 82, claimedBy: "Synthetic claimer", isBooked: true, bookedByAgentName: "Synthetic staff" }]);
    expect(work.queries[2].sql).toContain("RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = ?");
    expect(work.queries[2].params).toEqual(["3015550123"]);
  });

  it("keeps a real-phone card usable with null session linkage rather than attaching a wrong-phone name session", async () => {
    const work = offline({ messages: [message(100, "+13015559999", 80)], sessions: [session(80, "+13015559999", 1)] });
    expect(await work.list()).toMatchObject([{ phone, sessionId: null, messageId: null, isBooked: false, claimedBy: null }]);
  });

  it("retains the exact phone card for claim identity but never trusts its unverified sessionId", async () => {
    const work = offline({ messages: [message(99, phone, 81)], sessions: [session(81, "email-session14220455", 1)] });
    expect(await work.list()).toMatchObject([{ phone, sessionId: null, messageId: 99, isBooked: false }]);
  });

  it("finds a canonical phone session without any matching card, choosing the newest real-phone session", async () => {
    const work = offline({ sessions: [session(42, phone), session(43, "301-555-0123"), session(99, "+13015559999")] });
    expect(await work.list()).toMatchObject([{ sessionId: 43, messageId: null }]);
  });

  it("preserves the existing loose-name metadata fallback for native leads with no phone", async () => {
    const work = offline({ nativePhone: null, messages: [message(100, "email-placeholder", 81, "Synthetic C.", "Original claimer")],
      sessions: [session(81, "email-placeholder", 1)] });
    expect(await work.list()).toMatchObject([{ phone: null, messageId: 100, sessionId: 81, claimedBy: "Original claimer", isBooked: true }]);
    expect(work.queries[2].sql).toContain("WHERE id = ?");
  });

  it("remains read-only and returns no leads when the mocked DB is absent", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    expect(await thumbtackLeadRouter.createCaller({} as never).listNative()).toEqual([]);
  });
});
