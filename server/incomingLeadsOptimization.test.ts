import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { agents, conversationSessions } from "../drizzle/schema";
import { NON_LEAD_SOURCES } from "../shared/leadSources";

// Compile the actual procedure and helpers, as in commandChatCalledRecordFallback.test.ts.
// Do not import the application/router dependency graph or connect to any service.
const root = resolve(import.meta.dirname, "..");
const baselineRevision = "ae10c3b51ace8cf773d9c5ba8ed77e5a2206b720";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const baseline = (path: string) =>
  execFileSync("git", ["show", `${baselineRevision}:${path}`], {
    cwd: root,
    encoding: "utf8",
  });
const currentSource = read("server/commandCenterRouter.ts");
const baselineSource = baseline("server/commandCenterRouter.ts");
const permissionSource = read("server/_core/trpc.ts");
const dbSource = read("server/db.ts");
const selectedFields = [
  "id",
  "leadName",
  "leadPhone",
  "leadSource",
  "stage",
  "assignedAgentName",
  "serviceType",
  "bedrooms",
  "bathrooms",
  "address",
  "quotedPrice",
  "bookedAmount",
  "isBooked",
  "messageCount",
  "messageHistory",
  "lastMessageText",
  "lastMessageRole",
  "lastMessageTs",
  "lastCustomerMessageTs",
  "lastReadAt",
  "updatedAt",
  "createdAt",
];
const responseFields = [
  "id",
  "name",
  "phone",
  "email",
  "source",
  "stage",
  "ownerName",
  "serviceType",
  "bedrooms",
  "bathrooms",
  "address",
  "quotedPrice",
  "bookedAmount",
  "isBooked",
  "messageCount",
  "lastMessage",
  "lastMessageRole",
  "lastActivityAt",
  "createdAt",
  "hasUnread",
  "activity",
];
const now = Date.parse("2026-11-05T01:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const dialect = new MySqlDialect();
const offlineSql = drizzle(async () => {
  throw new Error("SQL execution is prohibited");
});
type Row = Record<string, any>;
type Input = { limit?: number } | undefined;
type Query = {
  table: string;
  projection: string[];
  predicate: string;
  order: string[];
  limit: number;
  sql: string;
  params: unknown[];
};

function findNode(
  source: string,
  predicate: (node: ts.Node) => boolean
): ts.Node {
  const file = ts.createSourceFile(
    "isolated.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const matches: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1)
    throw new Error(`Expected one source node, found ${matches.length}`);
  return matches[0];
}
function declaration(source: string, name: string) {
  return findNode(
    source,
    node => ts.isFunctionDeclaration(node) && node.name?.text === name
  ).getText();
}
function procedure(source: string) {
  const property = findNode(
    source,
    node =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === "listIncomingLeads"
  ) as ts.PropertyAssignment;
  return property.initializer.getText();
}
function selection(source: string) {
  const expression = procedure(source);
  return findNode(
    expression,
    node =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "select" &&
      node.expression.expression.getText() === "db"
  ).getText();
}
function compile(source: string, names: string[]) {
  const output = ts.transpileModule(source.replace(/^export /gm, ""), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...names, output);
}
const permission = declaration(permissionSource, "agentPageProcedure");
// Substitute only the dynamic module-loading boundary; execute the existing middleware.
const isolatedPermission = permission.replace(
  'await import("../db")',
  "dbModule"
);
if (isolatedPermission === permission)
  throw new Error("Permission import isolation failed");
const lookupFactory = compile(
  `${declaration(dbSource, "getAgentById")}\nreturn getAgentById;`,
  ["getDb", "agents", "eq"]
);
function routerFactory(source: string) {
  const helpers = [
    "leadsCrmMilliseconds",
    "parseLeadsCrmHistory",
    "leadsCrmThirtyDayActivity",
  ]
    .map(name => declaration(source, name))
    .join("\n");
  return compile(
    `${helpers}\n${isolatedPermission}\nreturn t.router({ listIncomingLeads: ${procedure(source)} });`,
    [
      "t",
      "z",
      "TRPCError",
      "getAgentFromRequest",
      "dbModule",
      "getDb",
      "conversationSessions",
      "sql",
      "isNull",
      "or",
      "desc",
      "LEADS_CRM_EXCLUDED_SOURCES",
    ]
  );
}
const currentFactory = routerFactory(currentSource);
const baselineFactory = routerFactory(baselineSource);

function session(overrides: Row = {}): Row {
  // Populate every baseline schema column, so the control really reads all 80 fields.
  const row = Object.fromEntries(
    Object.keys(getTableColumns(conversationSessions)).map(name => [name, null])
  );
  return {
    ...row,
    id: 1,
    leadName: "Synthetic lead",
    leadPhone: "+15555550101",
    leadSource: "website",
    stage: "QUOTE_SENT",
    assignedAgentName: "Synthetic agent",
    serviceType: "Standard",
    bedrooms: "2",
    bathrooms: "1",
    address: "Synthetic address",
    quotedPrice: "175.00",
    bookedAmount: 15000,
    isBooked: 1,
    messageCount: 0,
    messageHistory: "[]",
    lastMessageText: "Stored text",
    lastMessageRole: "assistant",
    lastMessageTs: now - day,
    lastCustomerMessageTs: null,
    lastReadAt: 0,
    updatedAt: new Date(now - day),
    createdAt: new Date(now - 2 * day),
    internalNotes: "Unused large field ".repeat(100),
    ...overrides,
  };
}
function sqlOrderTime(row: Row) {
  const value = row.lastCustomerMessageTs ?? row.lastMessageTs;
  return value === null || value === undefined
    ? new Date(row.createdAt).getTime()
    : Number(value);
}
async function run(
  factory: ReturnType<typeof routerFactory>,
  rows: Row[] = [session()],
  input: unknown = undefined,
  options: { agent?: Row; loggedOut?: boolean; noSessionDb?: boolean } = {}
) {
  const queries: Query[] = [];
  const calls: string[] = [];
  const agent = options.agent ?? {
    id: 7,
    name: "Synthetic agent",
    email: "synthetic@example.invalid",
    isActive: 1,
    isAdmin: 0,
    pagePermissions: '["leads"]',
  };
  const db = {
    select: vi.fn((projection?: Record<string, unknown>) => {
      calls.push("select");
      let table: typeof agents | typeof conversationSessions;
      let predicate: any;
      const order: any[] = [];
      const chain = {
        from: (value: typeof table) => {
          calls.push("from");
          table = value;
          return chain;
        },
        where: (value: any) => {
          calls.push("where");
          predicate = value;
          return chain;
        },
        orderBy: (...values: any[]) => {
          calls.push("orderBy");
          order.push(...values);
          return chain;
        },
        limit: async (limit: number) => {
          calls.push("limit");
          if (table !== agents && table !== conversationSessions)
            throw new Error("Unexpected table");
          const fields = Object.keys(projection ?? getTableColumns(table));
          const statement = offlineSql
            .select(projection as any)
            .from(table!)
            .where(predicate)
            .orderBy(...order)
            .limit(limit)
            .toSQL();
          const isAgent = table === agents;
          queries.push({
            table: isAgent ? "agents" : "conversation_sessions",
            projection: fields,
            predicate: dialect.sqlToQuery(predicate).sql,
            order: order.map(value => dialect.sqlToQuery(value).sql),
            limit,
            ...statement,
          });
          const matches = isAgent
            ? [agent]
            : rows.filter(
                row =>
                  row.leadSource == null ||
                  !NON_LEAD_SOURCES.includes(row.leadSource)
              );
          const sorted = isAgent
            ? matches
            : [...matches].sort(
                (left, right) => sqlOrderTime(right) - sqlOrderTime(left)
              );
          return sorted
            .slice(0, limit)
            .map(row =>
              Object.fromEntries(fields.map(name => [name, row[name]]))
            );
        },
      };
      return chain;
    }),
    insert: vi.fn(() => {
      throw new Error("Writes prohibited");
    }),
    update: vi.fn(() => {
      throw new Error("Writes prohibited");
    }),
    delete: vi.fn(() => {
      throw new Error("Writes prohibited");
    }),
    execute: vi.fn(() => {
      throw new Error("Extra SQL prohibited");
    }),
  };
  const getDb = vi.fn(async () =>
    options.noSessionDb && queries.length > 0 ? null : db
  );
  const getAgentById = lookupFactory(getDb, agents, eq);
  const getAgentFromRequest = vi.fn(async () =>
    options.loggedOut ? null : { agentId: 7 }
  );
  const router = factory(
    initTRPC.create(),
    z,
    TRPCError,
    getAgentFromRequest,
    { getAgentById },
    getDb,
    conversationSessions,
    sql,
    isNull,
    or,
    desc,
    NON_LEAD_SOURCES
  );
  let result: Row[] | undefined;
  let error: any;
  try {
    result = await router.createCaller({ req: {} }).listIncomingLeads(input);
  } catch (caught) {
    error = caught;
  }
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
  expect(db.delete).not.toHaveBeenCalled();
  expect(db.execute).not.toHaveBeenCalled();
  return { result, error, queries, calls, getDb, db, getAgentFromRequest };
}
async function compare(
  rows: Row[] = [session()],
  input: unknown = undefined,
  options: Parameters<typeof run>[3] = {}
) {
  const before = await run(baselineFactory, rows, input, options);
  const after = await run(currentFactory, rows, input, options);
  expect(after.result).toEqual(before.result);
  expect(after.error?.code).toBe(before.error?.code);
  expect(after.error?.message).toBe(before.error?.message);
  expect(
    after.queries.map(({ projection, sql: statement, ...query }) => query)
  ).toEqual(
    before.queries.map(({ projection, sql: statement, ...query }) => query)
  );
  expect(after.calls).toEqual(before.calls);
  expect(after.getDb.mock.calls.length).toBe(before.getDb.mock.calls.length);
  return { before, after };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("incoming leads Phase 1 projection preserves the executable baseline", () => {
  it("changes only the approved SELECT and leaves permissions, lookup, helpers, and mapping byte-identical", () => {
    expect(selection(baselineSource).replace(/\s/g, "")).toBe("db.select()");
    expect(
      currentSource.replace(selection(currentSource), selection(baselineSource))
    ).toBe(baselineSource);
    expect(permissionSource).toBe(baseline("server/_core/trpc.ts"));
    expect(declaration(dbSource, "getAgentById")).toBe(
      declaration(baseline("server/db.ts"), "getAgentById")
    );
    expect(Object.keys(getTableColumns(conversationSessions))).toHaveLength(80);
  });

  it("actually reads exactly the 22 approved columns, not full rows, and returns exactly the same 21 fields", async () => {
    const { before, after } = await compare();
    expect(after.error).toBeUndefined();
    expect(before.queries[1].projection).toHaveLength(80);
    expect(after.queries[1].projection).toEqual(selectedFields);
    expect(after.queries[1].sql.split(" from ")[0]).toBe(
      `select ${selectedFields.map(field => `\`${field}\``).join(", ")}`
    );
    expect(Object.keys(after.result![0])).toEqual(responseFields);
    expect(after.result![0]).not.toHaveProperty("messageHistory");
    expect(after.result![0]).not.toHaveProperty("internalNotes");
    expect(after.result![0].activity).toHaveLength(12);
  });

  it("preserves history-first legacy roles, full-text fallback, mixed timestamps, counts, unread and 12 buckets", async () => {
    const history = [
      { role: "user", content: "Too old", ts: now - 30 * day - 1 },
      { role: "customer", content: "Window start", ts: String(now - 30 * day) },
      { role: "assistant", content: "Invalid", ts: "invalid" },
      {
        role: "user",
        content: "ISO timestamp",
        ts: new Date(now - 4 * day).toISOString(),
      },
      { role: "assistant", content: "Future", ts: now + 1 },
      {
        role: "customer",
        content: "Synthetic full text ".repeat(100),
        ts: now,
      },
    ];
    const { after } = await compare([
      session({
        messageHistory: JSON.stringify(history),
        messageCount: null,
        lastMessageText: null,
        lastMessageRole: "assistant",
        updatedAt: new Date(now - 1),
      }),
    ]);
    expect(after.result![0]).toMatchObject({
      lastMessage: history[5].content,
      lastMessageRole: "customer",
      messageCount: 6,
      lastActivityAt: now,
      hasUnread: true,
    });
    expect(after.result![0].activity).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    const iso = await compare([
      session({
        messageHistory: JSON.stringify([
          {
            role: "user",
            content: "ISO last",
            ts: new Date(now).toISOString(),
          },
        ]),
        lastMessageText: null,
      }),
    ]);
    expect(iso.after.result![0]).toMatchObject({
      lastActivityAt: now,
      lastMessageRole: "user",
      lastMessage: "ISO last",
    });
    expect(iso.after.result![0].activity).toEqual(Array(12).fill(0));
  });

  it.each([null, "", "{malformed", "null", "{}", "42", '"text"', "[]"])(
    "keeps malformed/non-array/null history fallback for %j",
    async history => {
      const { after } = await compare([
        session({
          messageHistory: history,
          messageCount: null,
          lastMessageText: null,
          lastMessageRole: "user",
        }),
      ]);
      expect(after.result![0]).toMatchObject({
        messageCount: 0,
        lastMessage: null,
        lastMessageRole: "user",
        hasUnread: true,
      });
      expect(after.result![0].activity).toEqual(Array(12).fill(0));
    }
  );

  it("keeps null values, zero and empty string semantics, strict booking flags, and stored summary precedence", async () => {
    const rows = [
      session({
        id: 1,
        leadName: null,
        leadSource: null,
        assignedAgentName: null,
        serviceType: null,
        bedrooms: null,
        bathrooms: null,
        address: null,
        quotedPrice: null,
        bookedAmount: null,
        isBooked: 0,
        messageCount: null,
        messageHistory: null,
        lastMessageText: null,
        lastMessageRole: null,
        lastMessageTs: null,
        lastCustomerMessageTs: null,
        updatedAt: null,
        createdAt: null,
        lastReadAt: null,
      }),
      session({
        id: 2,
        isBooked: "1",
        messageCount: 0,
        lastMessageText: "",
        messageHistory: JSON.stringify([
          { role: "user", content: "Do not replace empty summary", ts: now },
        ]),
        lastReadAt: String(now),
      }),
      session({
        id: 3,
        isBooked: 1,
        lastMessageText: "Stored summary wins",
        messageHistory: JSON.stringify([
          { role: "assistant", content: "History", ts: now - 1 },
        ]),
        lastMessageRole: "user",
        updatedAt: String(now),
        lastReadAt: 0,
      }),
    ];
    const { after } = await compare(rows);
    const byId = new Map(after.result!.map(row => [row.id, row]));
    expect(byId.get(1)).toMatchObject({
      name: null,
      email: null,
      source: null,
      ownerName: null,
      quotedPrice: null,
      bookedAmount: null,
      isBooked: false,
      messageCount: 0,
      lastMessage: null,
      lastMessageRole: null,
      createdAt: 0,
      lastActivityAt: 0,
      hasUnread: false,
    });
    expect(byId.get(2)).toMatchObject({
      isBooked: false,
      messageCount: 0,
      lastMessage: "",
      hasUnread: false,
    });
    expect(byId.get(3)).toMatchObject({
      isBooked: true,
      lastMessage: "Stored summary wins",
      lastMessageRole: "assistant",
      lastActivityAt: now,
      hasUnread: false,
    });
  });

  it("preserves the exact source predicate, null inclusion and COALESCE DESC before LIMIT without MAX or tie-breaker", async () => {
    const rows = [
      session({
        id: 1,
        leadSource: null,
        lastCustomerMessageTs: now - 10 * day,
        lastMessageTs: now,
      }),
      session({
        id: 2,
        leadSource: "cs_initiated",
        lastCustomerMessageTs: null,
        lastMessageTs: now - day,
      }),
      session({
        id: 3,
        leadSource: "review_rebooking",
        lastCustomerMessageTs: null,
        lastMessageTs: null,
        createdAt: new Date(now - 2 * day),
      }),
      session({
        id: 4,
        leadSource: "website",
        lastCustomerMessageTs: 0,
        lastMessageTs: now,
      }),
      ...NON_LEAD_SOURCES.map((source, index) =>
        session({
          id: 10 + index,
          leadSource: source,
          lastMessageTs: now + day,
        })
      ),
    ];
    const { after } = await compare(rows);
    expect(after.result!.map(row => row.id)).toEqual([2, 3, 1, 4]);
    expect(after.queries[1].predicate).toBe(
      "(`conversation_sessions`.`leadSource` is null or `conversation_sessions`.`leadSource` NOT IN ('schedule_confirm', 'hiring_interview', 'hiring', 'cs-inbound', 'cs-inbound-cleaner', 'review'))"
    );
    expect(after.queries[1].order).toEqual([
      "COALESCE(`conversation_sessions`.`lastCustomerMessageTs`, `conversation_sessions`.`lastMessageTs`, UNIX_TIMESTAMP(`conversation_sessions`.`createdAt`) * 1000) desc",
    ]);
    expect(after.calls).toEqual([
      "select",
      "from",
      "where",
      "limit",
      "select",
      "from",
      "where",
      "orderBy",
      "limit",
    ]);
    const capped = await compare(rows, { limit: 2 });
    expect(capped.after.result!.map(row => row.id)).toEqual([2, 3]);
  });

  it.each([undefined, {}, { limit: 1 }, { limit: 500 }])(
    "keeps valid/default bounds %j and a maximum of 500",
    async input => {
      const rows = Array.from({ length: 501 }, (_, index) =>
        session({ id: index + 1, lastMessageTs: now - index })
      );
      const { after } = await compare(rows, input);
      const limit = (input as Input)?.limit ?? 500;
      expect(after.result).toHaveLength(limit);
      expect(after.queries[1].limit).toBe(limit);
      expect(after.queries[1].params).toEqual([limit]);
    }
  );

  it.each([
    { limit: 0 },
    { limit: -1 },
    { limit: 501 },
    { limit: 1.5 },
    { limit: "2" },
    null,
  ])(
    "rejects invalid input %j without a session read, exactly as baseline",
    async input => {
      const { after } = await compare([session()], input);
      expect(after.error?.code).toBe("BAD_REQUEST");
      expect(
        after.queries.filter(query => query.table === "conversation_sessions")
      ).toHaveLength(0);
    }
  );

  it.each([0, 1, 25, 500])(
    "keeps one session SELECT plus the existing one auth SELECT for %i rows, with no N+1",
    async count => {
      const rows = Array.from({ length: count }, (_, index) =>
        session({ id: index + 1 })
      );
      const { after } = await compare(rows);
      expect(after.result).toHaveLength(count);
      expect(after.queries.map(query => query.table)).toEqual([
        "agents",
        "conversation_sessions",
      ]);
      expect(after.db.select).toHaveBeenCalledTimes(2);
      expect(after.getDb).toHaveBeenCalledTimes(2);
      expect(after.getAgentFromRequest).toHaveBeenCalledTimes(1);
    }
  );

  it("keeps the missing session database fallback without extra reads", async () => {
    const { after } = await compare([session()], undefined, {
      noSessionDb: true,
    });
    expect(after.result).toEqual([]);
    expect(after.queries.map(query => query.table)).toEqual(["agents"]);
  });

  it("keeps unauthorized and page-denied requests out of the session query", async () => {
    const loggedOut = await compare([session()], undefined, {
      loggedOut: true,
    });
    expect(loggedOut.after.error?.code).toBe("UNAUTHORIZED");
    expect(loggedOut.after.queries).toEqual([]);
    for (const agent of [
      { id: 7, isActive: 0, isAdmin: 1, pagePermissions: null },
      { id: 7, isActive: 1, isAdmin: 0, pagePermissions: '["bookings"]' },
    ]) {
      const { after } = await compare([session()], undefined, { agent });
      expect(after.error?.code).toBe(
        agent.isActive ? "FORBIDDEN" : "UNAUTHORIZED"
      );
      expect(after.queries.map(query => query.table)).toEqual(["agents"]);
    }
  });

  it("does not silently repair malformed history array entries that the baseline rejects", async () => {
    const { after } = await compare([session({ messageHistory: "[null]" })]);
    expect(after.error).toBeDefined();
  });
});
