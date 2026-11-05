import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { and, eq, getTableColumns, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { QueryBuilder } from "drizzle-orm/mysql-core/query-builders/query-builder";
import { conversationSessions } from "../drizzle/schema";

// Read the current repository, never import the router or its runtime dependencies.
// Semantic fake-driver parity is intentionally not a claim about a live SQL engine.
const source = fs.readFileSync(path.resolve(import.meta.dirname, "commandCenterRouter.ts"), "utf8");
const start = source.indexOf("listCommandChatInbox: agentProcedure");
const marker = ".query(async () => {";
const queryStart = source.indexOf(marker, start);
const bodyStart = queryStart + marker.length;
const bodyEnd = source.indexOf("\n    }),", bodyStart);
if (start < 0 || queryStart < start || bodyEnd <= bodyStart) {
  throw new Error("Actual inbox handler not found");
}
const body = source.slice(bodyStart, bodyEnd);
const declaration = (text: string, name: string) => {
  const from = text.indexOf(`      const ${name} =`);
  const to = text.indexOf(";", from);
  if (from < 0 || to < from) throw new Error(`Missing declaration: ${name}`);
  return text.slice(from, to + 1);
};
const corePredicate = declaration(body, "retainedOutboundCallActivityFilter");
const originalPredicate = [
  "      const retainedOutboundCallActivityFilter = sql`(",
  "        CHAR_LENGTH(REGEXP_REPLACE(${conversationSessions.leadPhone}, '[^0-9]', '')) >= 10",
  "        AND RIGHT(REGEXP_REPLACE(${conversationSessions.leadPhone}, '[^0-9]', ''), 10) IN (",
  "          SELECT DISTINCT RIGHT(REGEXP_REPLACE(ocr.callerPhone, '[^0-9]', ''), 10)",
  "          FROM openphone_call_recordings ocr",
  "          WHERE ocr.direction = 'outgoing'",
  "            AND UNIX_TIMESTAMP(ocr.callStartedAt) > 0",
  "            AND CHAR_LENGTH(REGEXP_REPLACE(ocr.callerPhone, '[^0-9]', '')) >= 10",
  "        )",
  "      )`;",
].join("\n");
const normalizedSqlPhone = (column: string) =>
  `(CASE WHEN CHAR_LENGTH(REGEXP_REPLACE(${column}, '[^0-9]', '')) >= 10 THEN RIGHT(REGEXP_REPLACE(${column}, '[^0-9]', ''), 10) ELSE NULL END)`;
const integratedPredicate = [
  "      const retainedOutboundCallActivityFilter = sql`EXISTS (",
  "        SELECT 1",
  "        FROM openphone_call_recordings ocr",
  "        WHERE ocr.direction = 'outgoing'",
  `          AND ${normalizedSqlPhone("ocr.callerPhone")} = ${normalizedSqlPhone("conversation_sessions.leadPhone")}`,
  "          AND UNIX_TIMESTAMP(ocr.callStartedAt) > 0",
  "      )`;",
].join("\n");
if (corePredicate !== integratedPredicate || body.split(corePredicate).length !== 2) {
  throw new Error("Expected exactly the integrated zero-schema predicate");
}
// Portable original control: replace precisely one predicate. Freeze every other
// handler byte against baseline 01bf6d8687de63b3136425bc350657d5d4c4c0de.
const originalBody = body.replace(corePredicate, originalPredicate);
const protectedBody = body.replace(corePredicate, "      /* retained-call predicate */");
const protectedHash = "3ea66d1b3aee4ca2684b683c471b699edac60704021dc1efc26efb8033ee3b0d";

const selectedKeys = [
  "id", "leadPhone", "leadName", "leadSource", "csQueue", "aiSummary",
  "lastInboundPhoneNumberId", "lastMessageText", "lastMessageTs",
  "lastMessageRole", "lastCalledAt", "createdAt", "updatedAt",
] as const;
type SelectedKey = typeof selectedKeys[number];
type SchemaSession = typeof conversationSessions.$inferSelect;
// NULL fixtures exercise the handler's existing defensive compatibility path;
// they do not propose changing the actual non-null schema declaration.
type SelectedSession = Omit<Pick<SchemaSession, SelectedKey>, "leadPhone"> & {
  leadPhone: string | null;
};
type Session = SelectedSession & {
  messageHistory: Array<{ role: string; content?: string }> | null;
  csResolvedAt: Date | null;
};
type InboxRow = SelectedSession & {
  lastMsgTs: number;
  calledAt: number | null;
  receivedAt: number;
  hasUnanswered: boolean;
  lastSenderRole: "user" | "assistant" | null;
  personType: "team" | "customer";
};
const responseKeys = [...selectedKeys, "lastMsgTs", "calledAt", "receivedAt", "hasUnanswered", "lastSenderRole", "personType"].sort();
type Recording = { callerPhone: string | null; direction: string; callStartedAt: number | null; sessionId?: number; createdAt?: number };
type Voice = { sessionId: number; createdAt: number | null };
type Profile = { phone: string | null; isActive: number };
type Query = { sql: string; params: unknown[] };
type Selection = { [K in SelectedKey]: (typeof conversationSessions)[K] };
type Options = {
  sessions?: Session[];
  recordings?: Recording[];
  voices?: Voice[];
  profiles?: Profile[];
  rawCallRows?: Array<{ phone10: unknown; latestCalledTs: unknown }>;
  afterVoice?: () => void;
};
const dialect = new MySqlDialect();
const compiler = new QueryBuilder(dialect);
const at = Date.parse("2026-11-04T20:33:00.000Z");
const normalize = (value: string | null) => (value ?? "").replace(/\D/g, "").slice(-10);
const casePhone = (value: string | null): string | null => {
  const digits = value?.replace(/\D/g, "");
  return digits && digits.length >= 10 ? digits.slice(-10) : null;
};
function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 1, leadPhone: "+18137063381", leadName: "Invented fixture",
    leadSource: "fixture-only", csQueue: "CS", aiSummary: null,
    lastInboundPhoneNumberId: null, lastMessageText: "Invented fixture message",
    lastMessageTs: at + 1000, lastMessageRole: "assistant", lastCalledAt: null,
    createdAt: new Date(at + 1000), updatedAt: new Date(at + 2000),
    messageHistory: [], csResolvedAt: null, ...overrides,
  };
}
const recording = (overrides: Partial<Recording> = {}): Recording => ({
  callerPhone: "+18137063381", direction: "outgoing", callStartedAt: at,
  sessionId: 0, ...overrides,
});
const originalMembership = (phone: string | null, records: Recording[]) => {
  const eligiblePhones = new Set(records.filter(r =>
    r.direction === "outgoing" && Number(r.callStartedAt) > 0 && normalize(r.callerPhone).length === 10
  ).map(r => normalize(r.callerPhone)));
  return normalize(phone).length === 10 && eligiblePhones.has(normalize(phone));
};
const integratedMembership = (phone: string | null, records: Recording[]) => {
  const normalized = casePhone(phone);
  return records.some(r => r.direction === "outgoing" && Number(r.callStartedAt) > 0 &&
    normalized !== null && casePhone(r.callerPhone) !== null && casePhone(r.callerPhone) === normalized);
};
const mutation = () => vi.fn(() => { throw new Error("Writes prohibited in isolated inbox tests"); });
function fakeDb(options: Options, membership: typeof integratedMembership) {
  const sessions = options.sessions ?? [session()];
  const recordings = options.recordings ?? [];
  const queries: Query[] = [];
  let selected: Session[] = [];
  const db = {
    select: vi.fn((selection: Selection) => ({
      from: (table: typeof conversationSessions) => ({
        where: async (predicate: SQL | undefined) => {
          if (!predicate) throw new Error("Core predicate required");
          queries.push(compiler.select(selection).from(table).where(predicate).toSQL());
          selected = sessions.filter(s => {
            const inbound = (s.messageHistory ?? []).some(m => m.role === "user" || m.role === "customer");
            return ((inbound || s.csQueue === "CS" || membership(s.leadPhone, recordings)) && s.csResolvedAt === null) ||
              s.lastCalledAt !== null || (options.voices ?? []).some(v => v.sessionId === s.id);
          });
          expect(Object.keys(selection).sort()).toEqual([...selectedKeys].sort());
          return selected.map(s => Object.fromEntries(selectedKeys.map(k => [k, s[k]])));
        },
      }),
    })),
    execute: vi.fn(async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      queries.push(query);
      if (/FROM voice_calls/i.test(query.sql)) {
        const latest = new Map<number, number>();
        for (const v of options.voices ?? []) {
          if (selected.some(s => s.id === v.sessionId) && v.createdAt !== null)
            latest.set(v.sessionId, Math.max(latest.get(v.sessionId) ?? -Infinity, v.createdAt));
        }
        const rows = [...latest].map(([sessionId, latestCallTs]) => ({ sessionId, latestCallTs }));
        options.afterVoice?.();
        return [rows];
      }
      if (/FROM openphone_call_recordings/i.test(query.sql)) {
        const cohort = [...new Set(selected.map(s => normalize(s.leadPhone)).filter(p => p.length === 10))];
        expect(query.params).toEqual(cohort);
        if (options.rawCallRows) return [options.rawCallRows];
        const latest = new Map<string, number>();
        for (const r of recordings) {
          const phone = normalize(r.callerPhone), time = Number(r.callStartedAt);
          if (r.direction === "outgoing" && cohort.includes(phone) && Number.isFinite(time) && time > (latest.get(phone) ?? 0))
            latest.set(phone, time);
        }
        return [[...latest].map(([phone10, time]) => ({ phone10, latestCalledTs: String(time) }))];
      }
      if (/FROM cleaner_profiles/i.test(query.sql)) {
        const cohort = [...query.sql.matchAll(/'(\d+)'/g)].map(match => match[1]);
        return [(options.profiles ?? []).filter(p => p.isActive === 1 && cohort.includes(normalize(p.phone)))
          .map(p => ({ phone10: normalize(p.phone) }))];
      }
      throw new Error(`Unexpected fixture SELECT: ${query.sql}`);
    }),
    insert: mutation(), update: mutation(), delete: mutation(), transaction: mutation(),
  };
  return { db, queries };
}
type FakeDb = ReturnType<typeof fakeDb>["db"];
type HandlerFactory = (
  getDb: () => Promise<FakeDb | null>, table: typeof conversationSessions,
  andFn: typeof and, eqFn: typeof eq, inFn: typeof inArray,
  notNullFn: typeof isNotNull, nullFn: typeof isNull, orFn: typeof or, sqlFn: typeof sql
) => () => Promise<InboxRow[]>;
function compileHandler(text: string): HandlerFactory {
  const compiled = ts.transpileModule(`const run = async () => {${text}\n};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error))
    throw new Error("Actual handler TypeScript transpilation failed");
  // The only dynamic boundary is extracted source; fixtures and SQL compilation
  // are typed. No router import, real driver, application startup or network.
  return new Function("getDb", "conversationSessions", "and", "eq", "inArray", "isNotNull", "isNull", "or", "sql",
    `${compiled.outputText}\nreturn run;`) as HandlerFactory;
}
const integratedFactory = compileHandler(body);
const originalFactory = compileHandler(originalBody);
async function run(options: Options = {}, original = false) {
  const { db, queries } = fakeDb(options, original ? originalMembership : integratedMembership);
  const getDb = vi.fn(async () => db);
  const handler = (original ? originalFactory : integratedFactory)(getDb, conversationSessions, and, eq, inArray, isNotNull, isNull, or, sql);
  const result = await handler();
  expect(getDb).toHaveBeenCalledTimes(1);
  for (const name of ["insert", "update", "delete", "transaction"] as const) expect(db[name]).not.toHaveBeenCalled();
  expect(queries.every(q => /^\s*SELECT\b/i.test(q.sql))).toBe(true);
  expect(queries.length).toBeLessThanOrEqual(4);
  expect(db.select).toHaveBeenCalledTimes(1);
  for (const row of result) expect(Object.keys(row).sort()).toEqual(responseKeys);
  return { result, queries, db };
}
const core = (queries: Query[]) => queries[0];
const lateCall = (queries: Query[]) => queries.filter(q => /FROM openphone_call_recordings/i.test(q.sql) && !/from `conversation_sessions`/i.test(q.sql));
const phases = (queries: Query[]) => queries.map(q => /from `conversation_sessions`/i.test(q.sql) ? "core" : /FROM voice_calls/i.test(q.sql) ? "voice" : /FROM openphone_call_recordings/i.test(q.sql) ? "Called" : "profiles");

const parityFixtures: Array<{ name: string; options: Options; ids: number[] }> = [
  { name: "empty", options: { sessions: [] }, ids: [] },
  { name: "whole-history user and customer, not outbound-only or role content", options: { sessions: [
    session({ id: 1, csQueue: null, messageHistory: [{ role: "user" }, { role: "assistant" }], lastMessageTs: 100 }),
    session({ id: 2, csQueue: null, messageHistory: [{ role: "customer" }, { role: "assistant" }], lastMessageTs: 200, leadPhone: "+13025551234" }),
    session({ id: 3, csQueue: null, messageHistory: [{ role: "assistant", content: "user customer" }], leadPhone: "+12025550040" }),
  ] }, ids: [2, 1] },
  { name: "queue unresolved and resolved exclusions", options: { sessions: [session(), session({ id: 2, csResolvedAt: new Date(at), leadPhone: "+13025551234" })] }, ids: [1] },
  { name: "old formatted orphan, incoming, invalid, short and NULL", options: { sessions: [
    session({ id: 1, csQueue: null, leadPhone: "(813) 706-3381" }),
    session({ id: 2, csQueue: null, leadPhone: "+13025551234" }),
    session({ id: 3, csQueue: null, leadPhone: "3381" }),
    session({ id: 4, csQueue: null, leadPhone: null }),
    session({ id: 5, csQueue: null, leadPhone: "+12025550040" }),
  ], recordings: [recording({ callStartedAt: 1 }), recording({ callerPhone: "+13025551234", direction: "incoming" }), recording({ callerPhone: "3381" }), recording({ callerPhone: null }), recording({ callerPhone: "+12025550040", callStartedAt: 0 })] }, ids: [1] },
  { name: "resolved call-only excluded, manual and voice overrides retained", options: { sessions: [
    session({ id: 1, csQueue: null, csResolvedAt: new Date(at) }),
    session({ id: 2, csQueue: null, csResolvedAt: new Date(at), lastCalledAt: new Date(at + 5), leadPhone: "+13025551234" }),
    session({ id: 3, csQueue: null, csResolvedAt: new Date(at), leadPhone: "+12025550040" }),
  ], recordings: [recording()], voices: [{ sessionId: 3, createdAt: at + 10 }] }, ids: [2, 3] },
  { name: "canonical voice wins but display sorts on message time", options: { sessions: [
    session({ id: 1, lastMessageTs: 100, lastMessageRole: "user" }),
    session({ id: 2, lastMessageTs: 200, lastCalledAt: new Date(at + 5000) }),
    session({ id: 3, leadPhone: "+13025551234", lastMessageTs: 0, updatedAt: new Date(at + 9999), lastMessageRole: "customer" }),
  ], voices: [{ sessionId: 1, createdAt: 300 }], recordings: [recording()], profiles: [{ phone: "(302) 555-1234", isActive: 1 }] }, ids: [3, 1] },
  { name: "raw trim grouping stays distinct from normalized Called propagation", options: { sessions: [
    session({ id: 1, leadPhone: " +18137063381 ", lastMessageTs: 100, lastCalledAt: new Date(at + 5000) }),
    session({ id: 2, leadPhone: "+18137063381", lastMessageTs: 200 }),
    session({ id: 3, leadPhone: "(813) 706-3381", lastMessageTs: 150 }),
  ], recordings: [recording()] }, ids: [2, 3] },
  { name: "manual overrides older calls and rejects outside cohort rows", options: { sessions: [session({ lastCalledAt: new Date(at + 5000) })], rawCallRows: [
    { phone10: "8137063381", latestCalledTs: String(at) }, { phone10: "3025551234", latestCalledTs: at + 9000 },
    { phone10: null, latestCalledTs: at + 9000 }, { phone10: "8137063381", latestCalledTs: "bad" },
  ] }, ids: [1] },
  { name: "NULL empty and whitespace raw phone group retains first row", options: { sessions: [
    session({ id: 22, leadPhone: null, lastMessageTs: 10 }), session({ id: 21, leadPhone: "", lastMessageTs: 10 }),
    session({ id: 20, leadPhone: "  ", lastMessageTs: 10 }),
  ] }, ids: [22] },
  { name: "Teams queue and inactive profiles", options: { sessions: [
    session({ id: 1, csQueue: "Teams", messageHistory: [{ role: "user" }], lastMessageTs: 20 }),
    session({ id: 2, leadPhone: "+13025551234", lastMessageTs: 10 }),
  ], profiles: [{ phone: "+13025551234", isActive: 0 }] }, ids: [1, 2] },
];

describe("Command Chat zero-schema actual-handler contracts", () => {
  it("changes precisely the frozen original predicate and preserves every protected handler byte", () => {
    expect(corePredicate).toBe(integratedPredicate);
    expect(createHash("sha256").update(protectedBody).digest("hex")).toBe(protectedHash);
    expect(originalBody.replace(originalPredicate, "      /* retained-call predicate */")).toBe(protectedBody);
    expect(originalBody.replace(originalPredicate, corePredicate)).toBe(body);
  });

  it("compiles correlated NULL-safe EXISTS with no schema/index/global-list dependency", async () => {
    const { queries } = await run({ recordings: [recording()] });
    const q = core(queries);
    expect(q.params).toEqual(["CS"]);
    expect(q.sql).toContain(normalizedSqlPhone("ocr.callerPhone") + " = " + normalizedSqlPhone("conversation_sessions.leadPhone"));
    expect(q.sql).toContain("ocr.direction = 'outgoing'");
    expect(q.sql).toContain("UNIX_TIMESTAMP(ocr.callStartedAt) > 0");
    expect(q.sql).toContain("EXISTS (\n        SELECT 1\n        FROM openphone_call_recordings ocr");
    expect(q.sql).not.toMatch(/SELECT\s+DISTINCT|\bIN\s*\(|\bJOIN\b|\bUNION\b|ORDER\s+BY|\bLIMIT\b/i);
    expect(body).not.toMatch(/historyEligible|leadPhoneNorm|callerPhoneNorm|idx_[a-z0-9_]+|retainedOutboundCallPhoneDigits|retainedOutboundCalledAtByPhone/);
    const columns = Object.keys(getTableColumns(conversationSessions));
    expect(columns).not.toEqual(expect.arrayContaining(["historyEligible"]));
    expect(columns).not.toContain("leadPhoneNorm");
  });

  it("preserves exact whole-history, voice, manual, unresolved filters and the 13-field projection", async () => {
    const { queries } = await run();
    const q = core(queries);
    for (const role of ["user", "customer"])
      expect(q.sql).toContain(`JSON_SEARCH(\`conversation_sessions\`.\`messageHistory\`, 'one', '${role}', NULL, '$[*].role') IS NOT NULL`);
    expect(q.sql).toContain("vc.sessionId = `conversation_sessions`.`id`");
    expect(q.sql).toContain("`conversation_sessions`.`lastCalledAt` is not null");
    expect(q.sql.match(/`conversation_sessions`\.`csResolvedAt` is null/g)).toHaveLength(2);
    expect(q.sql.slice(0, q.sql.indexOf(" from ")).match(/`[A-Za-z]+`/g)).toHaveLength(13);
    expect(body).not.toMatch(/\bLIMIT\b|\bINTERVAL\b|NOW\(/);
  });

  it("keeps one core SELECT then voice, selected-cohort Called and profiles reads", async () => {
    const { result, queries, db } = await run({ recordings: [recording()] });
    expect(result[0].calledAt).toBe(at);
    expect(phases(queries)).toEqual(["core", "voice", "Called", "profiles"]);
    expect(db.execute).toHaveBeenCalledTimes(3);
    const q = lateCall(queries)[0];
    expect(q.params).toEqual(["8137063381"]);
    expect(q.sql).toContain("MAX(UNIX_TIMESTAMP(callStartedAt) * 1000)");
    expect(q.sql).toContain("WHERE direction = 'outgoing'");
    expect(q.sql).toContain("CHAR_LENGTH(REGEXP_REPLACE(callerPhone, '[^0-9]', '')) >= 10");
    expect(q.sql).toContain("RIGHT(REGEXP_REPLACE(callerPhone, '[^0-9]', ''), 10) in (?)");
    expect(q.sql).toContain("GROUP BY RIGHT(REGEXP_REPLACE(callerPhone, '[^0-9]', ''), 10)");
    expect(q.sql).not.toMatch(/createdAt|8137063381/);
  });

  it("does not grow core SQL or preload phones for 70,000 unrelated recordings", async () => {
    const small = await run();
    const large = await run({ recordings: Array.from({ length: 70000 }, (_, i) => recording({ callerPhone: `+1${5000000000 + i}` })) });
    expect(core(large.queries)).toStrictEqual(core(small.queries));
    expect(lateCall(large.queries)[0].params).toEqual(["8137063381"]);
    expect(large.queries).toHaveLength(4);
    expect(large.result[0].calledAt).toBeNull();
  });

  it("keeps bounded statement counts for 1, 100 and 1,000 selected sessions, not N+1", async () => {
    for (const size of [1, 100, 1000]) {
      const { queries, result } = await run({ sessions: Array.from({ length: size }, (_, i) => session({ id: i + 1, leadPhone: `+1${6000000000 + i}` })) });
      expect(result).toHaveLength(size);
      expect(phases(queries)).toEqual(["core", "voice", "Called", "profiles"]);
      expect(lateCall(queries)).toHaveLength(1);
      expect(lateCall(queries)[0].params).toHaveLength(size);
      expect(core(queries).params).toEqual(["CS"]);
    }
  });

  it("skips all late reads for empty selected cohorts, even with retained unrelated calls", async () => {
    const empty = await run({ sessions: [], recordings: [recording()] });
    expect(empty.result).toEqual([]);
    expect(phases(empty.queries)).toEqual(["core"]);
    expect(empty.db.execute).not.toHaveBeenCalled();
  });

  it.each(["3381", "", "   ", null])("does not query Called for incomplete/NULL-compatible phone %s", async phone => {
    const { result, queries } = await run({ sessions: [session({ leadPhone: phone })], recordings: [recording({ callerPhone: phone })] });
    expect(result[0].calledAt).toBeNull();
    expect(lateCall(queries)).toEqual([]);
    expect(phases(queries).slice(0, 2)).toEqual(["core", "voice"]);
  });

  it("matches original IN and integrated CASE/EXISTS semantics without NULL-equals-NULL", async () => {
    const phones: Array<string | null> = [null, "", "3381", "abcdef", "123456789", "8137063381", "+18137063381", "(813) 706-3381", "0018137063381", "+13025551234"];
    for (const left of phones) for (const right of phones) {
      const records = [recording({ callerPhone: right })];
      expect(integratedMembership(left, records)).toBe(originalMembership(left, records));
    }
    for (const phone of phones) {
      const actual = await run({ sessions: [session({ csQueue: null, leadPhone: phone })], recordings: [recording({ callerPhone: phone })] });
      expect(actual.result.length).toBe(casePhone(phone) === null ? 0 : 1);
    }
    expect(integratedMembership(null, [recording({ callerPhone: null })])).toBe(false);
  });

  it.each([null, 0, -1])("does not select a call-only session from invalid start %s", async callStartedAt => {
    const { result } = await run({ sessions: [session({ csQueue: null })], recordings: [recording({ callStartedAt })] });
    expect(result).toEqual([]);
  });

  it("deduplicates selected full-phone parameters while retaining short display/profile semantics", async () => {
    const { result, queries } = await run({ sessions: [
      session({ id: 1 }), session({ id: 2, leadPhone: "(813) 706-3381" }),
      session({ id: 3, leadPhone: "3381" }), session({ id: 4, leadPhone: "+13025551234" }),
    ], recordings: [recording()], profiles: [{ phone: "3381", isActive: 1 }] });
    expect(lateCall(queries)[0].params).toEqual(["8137063381", "3025551234"]);
    expect(result.find(r => r.id === 3)).toMatchObject({ calledAt: null, personType: "team" });
    expect(result.filter(r => r.calledAt === at).map(r => r.id)).toEqual([1, 2]);
  });

  it("refreshes Called after voice, for selected sessions only, not newly eligible conversations", async () => {
    const sessions = [session(), session({ id: 2, leadPhone: "+13025551234", csQueue: null })];
    const recordings: Recording[] = [];
    const { result, queries } = await run({ sessions, recordings, afterVoice: () => {
      recordings.push(recording({ callStartedAt: at + 7777 }), recording({ callerPhone: "+13025551234", callStartedAt: at + 8888 }));
      sessions.push(session({ id: 3, leadPhone: "+12025550040" }));
    } });
    expect(result.map(r => r.id)).toEqual([1]);
    expect(result[0].calledAt).toBe(at + 7777);
    expect(lateCall(queries)[0].params).toEqual(["8137063381"]);
    expect(phases(queries)).toEqual(["core", "voice", "Called", "profiles"]);
  });

  it("rejects malformed, nonpositive and outside-cohort late Called rows", async () => {
    const { result } = await run({ rawCallRows: [
      { phone10: "8137063381", latestCalledTs: "bad" }, { phone10: "8137063381", latestCalledTs: null },
      { phone10: "8137063381", latestCalledTs: 0 }, { phone10: "8137063381", latestCalledTs: -1 },
      { phone10: "8137063381", latestCalledTs: Infinity }, { phone10: "8137063381", latestCalledTs: NaN },
      { phone10: "3025551234", latestCalledTs: at }, { phone10: null, latestCalledTs: at },
      { phone10: "(813) 706-3381", latestCalledTs: at },
    ] });
    expect(result[0].calledAt).toBeNull();
  });

  it("retains all 19 exact keys, Dates, sender flags, fallback message time and manual propagation", async () => {
    const fixture = parityFixtures.find(f => f.name === "canonical voice wins but display sorts on message time");
    if (!fixture) throw new Error("Fixture not found");
    const { result } = await run(fixture.options);
    expect(responseKeys).toHaveLength(19);
    expect(result[0]).toMatchObject({ id: 3, calledAt: null, personType: "team", lastSenderRole: null, hasUnanswered: false, lastMsgTs: at + 9999 });
    expect(result[1]).toMatchObject({ id: 1, calledAt: at + 5000, lastCalledAt: null, lastSenderRole: "user", hasUnanswered: true, lastMsgTs: 100, receivedAt: at + 1000 });
    for (const row of result) {
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      expect(row).not.toHaveProperty("messageHistory");
      expect(row).not.toHaveProperty("csResolvedAt");
    }
  });

  it("uses strict first-row canonical ties and stable display ties, never a new ID tiebreak", async () => {
    for (const ids of [[22, 21], [21, 22]]) {
      const same = await run({ sessions: ids.map(id => session({ id, lastMessageTs: 10 })), voices: ids.map(sessionId => ({ sessionId, createdAt: 10 })) });
      expect(same.result.map(r => r.id)).toEqual([ids[0]]);
      const display = await run({ sessions: ids.map((id, i) => session({ id, leadPhone: i ? "+13025551234" : "+18137063381", lastMessageTs: 10 })) });
      expect(display.result.map(r => r.id)).toEqual(ids);
      expect(core(same.queries).sql).not.toMatch(/ORDER\s+BY/i);
    }
    expect(body).toContain("> Math.max(current.lastMessageTs ?? 0, latestCallBySession.get(current.id) ?? 0)");
    expect(body).toContain(".sort((left, right) => right.lastMsgTs - left.lastMsgTs)");
    expect(body).not.toMatch(/candidate\.id\s*[<>]|(?:left|right)\.id\s*-/);
  });

  it("adds no writes, transactions, schema mutation, external actions, timers or router dependencies", () => {
    expect(body).not.toMatch(/\.(?:insert|update|delete|transaction)\s*\(|\b(?:fetch|sendSms|sendEmail|setTimeout|setInterval|startTwilioLeadBridge|invokeLLM|generateSpeech)\s*\(/);
    expect(body).not.toMatch(/(?:^|\n)\s*(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|CALL)\s+/i);
    expect(body).not.toMatch(/\b(?:import|require)\b/);
    expect(body).toContain("return canonicalSessions");
  });

  it("preserves the original unavailable-DB error without SQL or side effects", async () => {
    const getDb = vi.fn(async () => null);
    const handler = integratedFactory(getDb, conversationSessions, and, eq, inArray, isNotNull, isNull, or, sql);
    await expect(handler()).rejects.toThrow("Database unavailable");
    expect(getDb).toHaveBeenCalledTimes(1);
  });
});

describe("Command Chat complete ordered original-versus-integrated response equality", () => {
  it.each(parityFixtures)("$name", async ({ options, ids }) => {
    const original = await run(options, true);
    const integrated = await run(options);
    expect(integrated.result).toStrictEqual(original.result);
    expect(integrated.result.map(row => row.id)).toEqual(ids);
    expect(integrated.queries.slice(1)).toStrictEqual(original.queries.slice(1));
    expect(core(original.queries).sql).toContain("SELECT DISTINCT RIGHT(REGEXP_REPLACE(ocr.callerPhone");
    expect(core(integrated.queries).sql).not.toContain("SELECT DISTINCT");
  });

  it("preserves full response and late-query equality for calls arriving after voice", async () => {
    const fresh = (): Options => {
      const recordings: Recording[] = [];
      return {
        sessions: [session(), session({ id: 2, csQueue: null, leadPhone: "+13025551234" })],
        recordings,
        afterVoice: () => recordings.push(recording({ callStartedAt: at + 7777 }),
          recording({ callerPhone: "+13025551234", callStartedAt: at + 8888 })),
      };
    };
    const original = await run(fresh(), true);
    const integrated = await run(fresh());
    expect(integrated.result).toStrictEqual(original.result);
    expect(integrated.result.map(row => row.id)).toEqual([1]);
    expect(integrated.result[0].calledAt).toBe(at + 7777);
    expect(integrated.queries.slice(1)).toStrictEqual(original.queries.slice(1));
  });

  it("preserves full response equality for both input orders of canonical and display ties", async () => {
    for (const ids of [[22, 21], [21, 22]]) {
      for (const distinct of [false, true]) {
        const options: Options = {
          sessions: ids.map((id, index) => session({ id, leadPhone: distinct && index ? "+13025551234" : "+18137063381", lastMessageTs: 10 })),
          voices: ids.map(sessionId => ({ sessionId, createdAt: 10 })),
        };
        const original = await run(options, true);
        const integrated = await run(options);
        expect(integrated.result).toStrictEqual(original.result);
        expect(integrated.result.map(row => row.id)).toEqual(distinct ? ids : [ids[0]]);
        expect(integrated.queries.slice(1)).toStrictEqual(original.queries.slice(1));
      }
    }
  });
});
