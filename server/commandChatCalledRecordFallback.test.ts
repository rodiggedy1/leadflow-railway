import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { conversationSessions } from "../drizzle/schema";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(
  path.join(root, "server/commandCenterRouter.ts"),
  "utf8"
);
const start = source.indexOf("listCommandChatInbox: agentProcedure");
const bodyStart =
  source.indexOf(".query(async () => {", start) + ".query(async () => {".length;
const bodyEnd = source.indexOf("\n    }),", bodyStart);
const body = source.slice(bodyStart, bodyEnd);
// Execute the real query handler without importing unrelated router side effects.
function handlerFactory(handlerBody: string) {
const compiled = ts.transpileModule(`const run = async () => {${handlerBody}\n};`, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;
return new Function(
  "getDb",
  "conversationSessions",
  "and",
  "eq",
  "inArray",
  "isNotNull",
  "isNull",
  "or",
  "sql",
  `${compiled}\nreturn run;`
);
}
const makeHandler = handlerFactory(body);
// Restoration changes only the actual source flag, never a parallel handler.
const restoredHandler = handlerFactory(body.replace(
  "const pauseRetainedCallReadsInProduction = true;",
  "const pauseRetainedCallReadsInProduction = false;"
));
beforeEach(() => vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "test"));
afterEach(() => vi.unstubAllEnvs());
const dialect = new MySqlDialect();
const normalize = (phone: string) => phone.replace(/\D/g, "").slice(-10);
const callAt = Date.parse("2026-11-04T20:33:00.000Z");

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 14100069,
    leadPhone: "+18137063381",
    leadName: "Reggie Johnson",
    leadSource: "cs-inbound",
    csQueue: "CS",
    aiSummary: null,
    lastInboundPhoneNumberId: null,
    lastMessageText: "Existing SMS",
    lastMessageTs: Date.parse("2026-11-04T20:36:29.000Z"),
    lastMessageRole: "assistant",
    lastCalledAt: null as Date | null,
    createdAt: new Date("2026-11-04T20:36:29.000Z"),
    updatedAt: new Date("2026-11-04T20:36:35.000Z"),
    csResolvedAt: null as Date | null,
    baseEligible: true,
    ...overrides,
  };
}
type Session = ReturnType<typeof session>;
type Recording = {
  phone: string;
  direction: string;
  callStartedAt: number | null;
  sessionId?: number;
  createdAt?: number;
};
function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    phone: "+18137063381",
    direction: "outgoing",
    callStartedAt: callAt,
    sessionId: 0,
    ...overrides,
  };
}

async function run(
  options: {
    sessions?: Session[];
    recordings?: Recording[];
    rawCallRows?: Array<{ phone10: string; latestCalledTs: unknown }>;
    voiceRows?: Array<{ sessionId: number; latestCallTs: number }>;
    teamPhones?: string[];
  } = {},
  factory = makeHandler
) {
  const sessions = options.sessions ?? [session()];
  const recordings = options.recordings ?? [];
  const filters: string[] = [];
  const filterParams: unknown[][] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(async predicate => {
          const query = dialect.sqlToQuery(predicate);
          filters.push(query.sql);
          filterParams.push(query.params);
          // SQL contract assertions below verify the actual outgoing-only predicate.
          return sessions.filter(
            s =>
              s.baseEligible ||
              (s.csResolvedAt === null &&
                query.sql.includes("openphone_call_recordings") &&
                recordings.some(
                  r =>
                    r.direction === "outgoing" &&
                    Number(r.callStartedAt) > 0 &&
                    normalize(s.leadPhone ?? "").length === 10 &&
                    normalize(r.phone).length === 10 &&
                    normalize(r.phone) === normalize(s.leadPhone ?? "")
                ))
          ).map(s => Object.fromEntries(
            Object.keys(selection).map(key => [key, s[key as keyof Session]])
          ));
        }),
      })),
    })),
    execute: vi.fn(async statement => {
      const query = dialect.sqlToQuery(statement);
      queries.push(query);
      if (query.sql.includes("FROM voice_calls"))
        return [options.voiceRows ?? []];
      if (query.sql.includes("FROM cleaner_profiles"))
        return [(options.teamPhones ?? []).map(phone10 => ({ phone10 }))];
      if (query.sql.includes("FROM openphone_call_recordings")) {
        if (options.rawCallRows) return [options.rawCallRows];
        const latest = new Map<string, number>();
        for (const r of recordings) {
          const phone = normalize(r.phone);
          if (
            r.direction !== "outgoing" ||
            phone.length !== 10 ||
            !query.params.includes(phone)
          )
            continue;
          const timestamp = Number(r.callStartedAt);
          if (
            Number.isFinite(timestamp) &&
            timestamp > (latest.get(phone) ?? 0)
          )
            latest.set(phone, timestamp);
        }
        return [
          Array.from(latest, ([phone10, timestamp]) => ({
            phone10,
            latestCalledTs: String(timestamp),
          })),
        ];
      }
      throw new Error(`Unexpected database operation: ${query.sql}`);
    }),
    insert: vi.fn(() => {
      throw new Error("No writes allowed");
    }),
    update: vi.fn(() => {
      throw new Error("No writes allowed");
    }),
    delete: vi.fn(() => {
      throw new Error("No writes allowed");
    }),
  };
  const handler = factory(
    async () => db,
    conversationSessions,
    and,
    eq,
    inArray,
    isNotNull,
    isNull,
    or,
    sql
  );
  const result = await handler();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
  expect(db.delete).not.toHaveBeenCalled();
  // Inspect real compiled SQL, not just fixture eligibility.
  expect(filters).toHaveLength(1);
  expect(filters[0]).toContain("JSON_SEARCH");
  expect(filters[0]).toContain("'$[*].role'");
  expect(filters[0]).toContain("`csQueue` = ?");
  expect(filters[0]).toContain("`csResolvedAt` is null");
  expect(filters[0]).toContain("FROM voice_calls vc WHERE vc.sessionId");
  expect(filters[0]).toContain("`lastCalledAt` is not null");
  expect(filters[0]).toContain("'one', 'user'");
  expect(filters[0]).toContain("'one', 'customer'");
  expect(filterParams).toEqual([["CS"]]);
  const paused = factory === makeHandler && process.env.RAILWAY_ENVIRONMENT_NAME === "production";
  expect(filters[0].includes("openphone_call_recordings")).toBe(!paused);
  const recordingQueries = queries.filter(q => q.sql.includes("FROM openphone_call_recordings"));
  const eligibleFullPhone = sessions.some(s =>
    (s.baseEligible || (!paused && s.csResolvedAt === null && recordings.some(r => r.direction === "outgoing" && Number(r.callStartedAt) > 0 && normalize(r.phone) === normalize(s.leadPhone ?? "")))) && normalize(s.leadPhone ?? "").length === 10
  );
  expect(recordingQueries).toHaveLength(!paused && eligibleFullPhone ? 1 : 0);
  expect(queries.every(q => /^\s*SELECT\b/i.test(q.sql))).toBe(true);
  return { result, queries, filters, db };
}

describe("Command Chat retained outgoing Called marker", () => {
  it("executes the exact existing inbox handler", () => {
    expect(start).toBeGreaterThan(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    expect(body).toContain("return canonicalSessions");
  });

  it("shows an orphaned outgoing call from before the conversation existed", async () => {
    const before = session();
    const { result } = await run({
      sessions: [before],
      recordings: [recording()],
    });
    expect(callAt).toBeLessThan(before.createdAt.getTime());
    expect(result[0].calledAt).toBe(callAt);
    expect(before.lastCalledAt).toBeNull();
    expect(result[0].lastCalledAt).toBeNull();
  });

  it("matches formatted full phones without relying on recording sessionId", async () => {
    const { result } = await run({
      sessions: [session({ leadPhone: "(813) 706-3381" })],
      recordings: [recording({ sessionId: 0 })],
    });
    expect(result[0].calledAt).toBe(callAt);
  });

  it("does not use another person's phone or an incoming recording", async () => {
    const { result } = await run({
      recordings: [
        recording({ phone: "+18137063382" }),
        recording({ direction: "incoming" }),
      ],
    });
    expect(result[0].calledAt).toBeNull();
  });

  it("uses the newest actual call start, not recording ingestion or SMS time", async () => {
    const { result } = await run({
      recordings: [
        recording({ callStartedAt: callAt - 1000 }),
        recording({ createdAt: callAt + 999999 }),
      ],
    });
    expect(result[0].calledAt).toBe(callAt);
    expect(result[0].lastMsgTs).toBe(session().lastMessageTs);
  });

  it("keeps a newer existing manual/bridge call stamp", async () => {
    const newer = callAt + 600000;
    const { result } = await run({
      sessions: [session({ lastCalledAt: new Date(newer) })],
      recordings: [recording()],
    });
    expect(result[0].calledAt).toBe(newer);
  });

  it("keeps existing same-phone session stamp propagation and canonical selection", async () => {
    const { result } = await run({
      sessions: [
        session({
          id: 1,
          lastMessageTs: 10,
          lastCalledAt: new Date(callAt + 1000),
        }),
        session({ id: 2, lastMessageTs: 20 }),
      ],
      recordings: [recording()],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
    expect(result[0].calledAt).toBe(callAt + 1000);
  });

  it("does not change voice-call canonical selection or turn incoming voice activity into Called", async () => {
    const { result } = await run({
      sessions: [
        session({ id: 1, lastMessageTs: 10 }),
        session({ id: 2, lastMessageTs: 20 }),
      ],
      voiceRows: [{ sessionId: 1, latestCallTs: 30 }],
    });
    expect(result[0].id).toBe(1);
    expect(result[0].calledAt).toBeNull();
  });

  it("includes an existing call-only conversation without creating a session", async () => {
    const { result, filters } = await run({
      sessions: [session({ baseEligible: false, csQueue: null })],
      recordings: [recording()],
    });
    expect(result).toHaveLength(1);
    expect(result[0].calledAt).toBe(callAt);
    expect(filters[0]).toContain("openphone_call_recordings");
    expect(filters[0]).toContain("ocr.direction = 'outgoing'");
    expect(filters[0]).toContain("UNIX_TIMESTAMP(ocr.callStartedAt) > 0");
    expect(filters[0]).toContain("CHAR_LENGTH(REGEXP_REPLACE");
    expect(filters[0]).toContain(
      "SELECT DISTINCT RIGHT(REGEXP_REPLACE(ocr.callerPhone"
    );
    const membershipSubquery = body.slice(
      body.indexOf("SELECT DISTINCT"),
      body.indexOf("const csTouchedOutboundFilter")
    );
    expect(membershipSubquery).not.toContain("conversationSessions.");
    expect(body).toContain(
      "and(retainedOutboundCallActivityFilter, isNull(conversationSessions.csResolvedAt))"
    );
  });

  it("does not reintroduce a resolved session solely because a retained call exists", async () => {
    const { result } = await run({
      sessions: [session({ baseEligible: false, csResolvedAt: new Date() })],
      recordings: [recording()],
    });
    expect(result).toEqual([]);
    const originallyVisible = await run({
      sessions: [
        session({
          csResolvedAt: new Date(),
          lastCalledAt: new Date(callAt + 1000),
        }),
      ],
      recordings: [recording()],
    });
    expect(originallyVisible.result[0].calledAt).toBe(callAt + 1000);
  });

  it("uses the existing canonical rule when a newly eligible call-only duplicate is newer", async () => {
    const { result } = await run({
      sessions: [
        session({ id: 1, lastMessageTs: 100, lastMessageRole: "user" }),
        session({
          id: 2,
          baseEligible: false,
          csQueue: null,
          lastMessageTs: 200,
        }),
      ],
      recordings: [recording()],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 2,
      calledAt: callAt,
      lastSenderRole: "assistant",
      hasUnanswered: false,
    });
  });

  it("does not include an incoming-only conversation via the new predicate", async () => {
    const { result } = await run({
      sessions: [session({ baseEligible: false, csQueue: null })],
      recordings: [recording({ direction: "incoming" })],
    });
    expect(result).toEqual([]);
  });

  it("preserves sender, reply, received-time, team classification and inbox ordering", async () => {
    const rows = [
      session({ id: 1, lastMessageRole: "user", lastMessageTs: 100 }),
      session({
        id: 2,
        leadPhone: "+13025551234",
        lastMessageRole: "assistant",
        lastMessageTs: 200,
      }),
    ];
    const { result } = await run({
      sessions: rows,
      recordings: [recording()],
      teamPhones: ["3025551234"],
    });
    expect(result.map((r: Session) => r.id)).toEqual([2, 1]);
    expect(result[0]).toMatchObject({
      lastSenderRole: "assistant",
      hasUnanswered: false,
      personType: "team",
      calledAt: null,
    });
    expect(result[1]).toMatchObject({
      lastSenderRole: "user",
      hasUnanswered: true,
      personType: "customer",
      calledAt: callAt,
      receivedAt: rows[0].createdAt.getTime(),
    });
  });

  it("rejects malformed/zero timestamps and returned phones outside the requested cohort", async () => {
    const { result } = await run({
      rawCallRows: [
        { phone10: "8137063381", latestCalledTs: "bad" },
        { phone10: "8137063381", latestCalledTs: null },
        { phone10: "8137063381", latestCalledTs: 0 },
        { phone10: "8137063381", latestCalledTs: Infinity },
        { phone10: "8137063382", latestCalledTs: callAt },
      ],
    });
    expect(result[0].calledAt).toBeNull();
  });

  it("skips the fallback query for empty sessions and incomplete phones", async () => {
    const empty = await run({ sessions: [] });
    expect(empty.result).toEqual([]);
    expect(empty.queries).toEqual([]);
    const short = await run({ sessions: [session({ leadPhone: "3381" })] });
    expect(short.result[0].calledAt).toBeNull();
    expect(
      short.queries.some(q => q.sql.includes("openphone_call_recordings"))
    ).toBe(false);
  });

  it("uses one parameterized outgoing-only aggregate rather than per-session queries", async () => {
    const { queries } = await run({
      sessions: [session(), session({ id: 2, leadPhone: "(813) 706-3381" })],
    });
    const fallback = queries.filter(q =>
      q.sql.includes("openphone_call_recordings")
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0].sql).toContain(
      "MAX(UNIX_TIMESTAMP(callStartedAt) * 1000)"
    );
    expect(fallback[0].sql).toContain("WHERE direction = 'outgoing'");
    expect(fallback[0].sql).not.toContain("UNIX_TIMESTAMP(createdAt)");
    expect(fallback[0].params).toEqual(["8137063381"]);
    expect(fallback[0].sql).not.toContain("8137063381");
    expect(queries.every(q => /^\s*SELECT\b/i.test(q.sql))).toBe(true);
  });

  it("adds no call, message, webhook, replay or persistence action to the handler", () => {
    for (const prohibited of [
      ".insert(",
      ".update(",
      ".delete(",
      "sendSms(",
      "startTwilioLeadBridge(",
      "fetch(",
      "setTimeout(",
      "cleaner" + "_jobs",
      "cleaner" + "Jobs",
    ]) {
      expect(body).not.toContain(prohibited);
    }
  });
});

describe("Production-only retained-call read pause", () => {
  it("matches the frozen original handler byte-for-byte after only the approved reversals", () => {
    const guard = [
      "      // Temporary Production mitigation: pause only the two retained lead-card recording reads.",
      "      // Set this local flag to false to restore them; other environments remain unchanged.",
      "      const pauseRetainedCallReadsInProduction = true;",
      "      const retainedCallReadsEnabled = !(pauseRetainedCallReadsInProduction",
      '        && process.env.RAILWAY_ENVIRONMENT_NAME === "production");',
    ].join("\n") + "\n";
    expect(body.split(guard)).toHaveLength(2);
    const membership = "retainedCallReadsEnabled ? and(retainedOutboundCallActivityFilter, isNull(conversationSessions.csResolvedAt)) : undefined";
    const late = "if (retainedCallReadsEnabled && calledPhoneDigits.length > 0)";
    expect(body.split(membership)).toHaveLength(2);
    expect(body.split(late)).toHaveLength(2);
    const original = body.replace(guard, "")
      .replace(membership, "and(retainedOutboundCallActivityFilter, isNull(conversationSessions.csResolvedAt))")
      .replace(late, "if (calledPhoneDigits.length > 0)");
    expect(createHash("sha256").update(original).digest("hex"))
      .toBe("617fdd7e0e49fe751e4dfb637d9aa41194d033f42702d6ddb773433eb92396c2");
  });

  it.each(["false", "true", undefined])("pauses both actual recording reads in production with PREVIEW_MODE=%s", async previewMode => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("PREVIEW_MODE", previewMode);
    const { result, filters, queries } = await run({
      sessions: [session(), session({ id: 2, leadPhone: "+13025551234", baseEligible: false, csQueue: null })],
      recordings: [recording(), recording({ phone: "+13025551234" })],
    });
    expect(result.map(r => r.id)).toEqual([14100069]);
    expect(result[0].calledAt).toBeNull();
    expect(filters[0]).not.toContain("openphone_call_recordings");
    expect(queries.some(q => q.sql.includes("openphone_call_recordings"))).toBe(false);
    expect(queries.some(q => q.sql.includes("FROM voice_calls"))).toBe(true);
    expect(queries.some(q => q.sql.includes("FROM cleaner_profiles"))).toBe(true);
  });

  it.each(["preview", "test", undefined])("preserves both recording reads outside production (%s)", async environment => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", environment);
    const { result, filters, queries } = await run({
      sessions: [session({ baseEligible: false, csQueue: null })], recordings: [recording()],
    });
    expect(result[0].calledAt).toBe(callAt);
    expect(filters[0]).toContain("SELECT DISTINCT RIGHT(REGEXP_REPLACE(ocr.callerPhone");
    expect(queries.filter(q => q.sql.includes("FROM openphone_call_recordings"))).toHaveLength(1);
  });

  it("preserves voice canonical choice, manual propagation, roles, team/CS history, ordering and 19-field shape in production", async () => {
    const options = {
      sessions: [
        session({ id: 1, lastMessageTs: 100, lastCalledAt: new Date(callAt + 1000) }),
        session({ id: 2, lastMessageTs: 200, lastMessageRole: "user" }),
        session({ id: 3, leadPhone: "+13025551234", csQueue: "Teams", lastMessageTs: 400 }),
        session({ id: 4, leadPhone: "+13025551235", csQueue: "CS", lastMessageTs: 300 }),
        session({ id: 5, leadPhone: "+13025551236", csQueue: null, lastMessageTs: 50 }),
      ],
      voiceRows: [{ sessionId: 2, latestCallTs: 500 }],
      recordings: [recording()], teamPhones: ["3025551236"],
    };
    const normal = await run(options);
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    const paused = await run(options);
    expect(paused.result).toEqual(normal.result);
    expect(paused.result.map(r => r.id)).toEqual([3, 4, 2, 5]);
    expect(paused.result[2]).toMatchObject({ calledAt: callAt + 1000, lastCalledAt: null, lastSenderRole: "user", hasUnanswered: true, receivedAt: options.sessions[1].createdAt.getTime() });
    expect(paused.result[0]).toMatchObject({ personType: "team", lastSenderRole: "assistant", hasUnanswered: false });
    expect(paused.result[1].personType).toBe("customer");
    expect(paused.result[3].personType).toBe("team");
    for (const row of paused.result) expect(Object.keys(row).sort()).toEqual([
      "id", "leadPhone", "leadName", "leadSource", "csQueue", "aiSummary", "lastInboundPhoneNumberId", "lastMessageText", "lastMessageTs", "lastMessageRole", "lastCalledAt", "createdAt", "updatedAt", "lastMsgTs", "calledAt", "receivedAt", "hasUnanswered", "lastSenderRole", "personType",
    ].sort());
  });

  it("restores both reads by flipping only the actual source flag and equals the normal environment", async () => {
    const options = { sessions: [session({ baseEligible: false, csQueue: null })], recordings: [recording()] };
    const normal = await run(options);
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    const restored = await run(options, restoredHandler);
    expect(restored.result).toEqual(normal.result);
    expect(restored.filters).toEqual(normal.filters);
    expect(restored.queries).toEqual(normal.queries);
    expect(restored.result[0].calledAt).toBe(callAt);
  });
});
